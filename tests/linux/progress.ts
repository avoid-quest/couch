import { strict as assert } from "node:assert";
import type { HistoryItem, LibraryItem, WatchingProfile } from "../../src/shared/library";
import type { Action, SessionState } from "../../src/shared/protocol";
import { type UiDriver, type Wait } from "./ui";

type Remote = { token: string; state: SessionState | null; command: (action: Action) => Promise<void> };
type ProgressContext = {
  origin: string;
  ui: UiDriver;
  until: Wait;
  clients: readonly Remote[];
  api: (path: string, body?: unknown, index?: number) => Promise<any>;
  item: LibraryItem;
  entryId: string;
  switchEntryId: string;
};

export type PersistedProgress = {
  household: WatchingProfile;
  otherProfile: WatchingProfile;
  householdProgress: HistoryItem;
  otherProgress: HistoryItem;
};

function controls({ clients, until }: Pick<ProgressContext, "clients" | "until">) {
  assert.ok(clients.length >= 2, "Progress acceptance requires two independently paired remotes");
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => client.state && predicate(client.state));
  const first = () => clients[0]!.state!;
  const pause = async () => {
    await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
    await until("both remotes observe native playback paused for a progress checkpoint", () => all(state => state.player.status === "paused"));
  };
  const seek = async (position: number) => {
    await clients[1]!.command({ type: "seek", playbackId: first().player.playbackId!, position });
    await until(`native playback acknowledges a seek to ${position.toFixed(1)} seconds`, () => all(state => Math.abs(state.player.position - position) < 0.4));
  };
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("native playback stops before changing viewing state", () => all(state => state.player.status === "idle" && state.currentEntryId === null));
  };
  const started = async (previous: string | null, entryId: string, position: number, description: string) => {
    await until(description, () => all(state => state.currentEntryId === entryId && state.player.playbackId !== previous && state.player.status === "playing" && state.player.seekable));
    for (const client of clients) assert.ok(Math.abs(client.state!.player.position - position) < 2, `${description}: native position ${client.state!.player.position} is near ${position}`);
  };
  const play = async (entryId: string, position: number, fromStart = false) => {
    const previous = first().player.playbackId;
    await clients[1]!.command({ type: "play", entryId, ...(fromStart ? { fromStart: true } : {}) });
    await started(previous, entryId, position, fromStart ? "explicit play from start resets the native start position" : "normal play loads the profile's saved point in native libmpv");
  };
  return { all, first, pause, seek, stop, started, play };
}

const labeled = (label: string) => `[aria-label=${JSON.stringify(label)}]`;

export async function verifyLocalProgress(context: ProgressContext): Promise<PersistedProgress> {
  const { origin, ui, until, clients, api, item, entryId, switchEntryId } = context;
  const { all, first, pause, seek, stop, started, play } = controls(context);
  const queueIds = first().queue.map(entry => entry.id);
  const originalVolume = first().player.volume;
  const mediaId = `library:${item.id}`;
  const catalog = async () => (await api(`/api/library/items?${new URLSearchParams({ q: item.title, offset: "0", limit: "30" })}`, undefined, 1)).items.find((candidate: LibraryItem) => candidate.id === item.id) as LibraryItem;
  const history = async () => await api("/api/progress/history?limit=40", undefined, 1) as { items: HistoryItem[]; profile: WatchingProfile };
  const saved = async () => (await history()).items.find(candidate => candidate.mediaId === mediaId);
  const profiles = await api("/api/profiles", undefined, 1) as { profiles: WatchingProfile[]; activeProfile: WatchingProfile };
  const household = profiles.profiles.find(profile => profile.name === "Household")!;
  assert.ok(household, "Household is the initial shared watching profile");
  assert.equal(profiles.activeProfile.id, household.id);
  assert.ok(item.duration !== null && item.duration >= 19 && item.duration < 60, "The scanned fixture is long enough to seek and short enough to require actual EOF for watched state");

  await stop();
  const version = first().libraryVersion ?? 0;
  await play(entryId, 0, true);
  await pause();
  await seek(7);
  await stop();
  await until("stopping native local media commits the observed point and invalidates both remote catalogs", async () =>
    all(state => (state.libraryVersion ?? 0) > version) && Math.abs((await catalog()).progress!.position - 7) < 0.4,
  );
  const firstHistory = await history();
  const checkpoint = firstHistory.items.find(candidate => candidate.mediaId === mediaId)!;
  assert.equal(firstHistory.profile.id, household.id);
  assert.equal(checkpoint.libraryItemId, item.id);
  assert.equal(checkpoint.title, item.title);
  assert.equal(checkpoint.watched, false);
  assert.ok(checkpoint.lastPlayedAt && Math.abs(checkpoint.position - 7) < 0.4);

  await ui.section("Find");
  await ui.type("#media-search", item.title);
  await until("native Library displays the committed resume action", async () => await ui.execute("return !!document.querySelector(arguments[0] + ':enabled')", [`[aria-label="Library search results"] ${labeled(`Resume: ${item.title}`)}`]));
  let previous = first().player.playbackId;
  await ui.click(`[aria-label="Library search results"] ${labeled(`Resume: ${item.title}`)}`);
  await until("native Library Resume starts its scanned item for both remotes", () => all(state => state.player.status === "playing" && state.player.playbackId !== previous && state.queue.find(entry => entry.id === state.currentEntryId)?.source === mediaId));
  await started(previous, first().currentEntryId!, 7, "native Library Resume passes the saved point to libmpv");
  await pause();
  await stop();
  await ui.button(`Details for ${item.title}`, '[aria-label="Library search results"]');
  await until("native Library offers an explicit restart for resumable media", async () => await ui.execute("return !!document.querySelector(arguments[0] + ':enabled')", [`[role=dialog] ${labeled(`Play ${item.title} from start`)}`]));
  previous = first().player.playbackId;
  await ui.click(`[role=dialog] ${labeled(`Play ${item.title} from start`)}`);
  await until("native Library Play from start opens the scanned item", () => all(state => state.player.status === "playing" && state.player.playbackId !== previous && state.queue.find(entry => entry.id === state.currentEntryId)?.source === mediaId));
  await started(previous, first().currentEntryId!, 0, "native Library Play from start clears mpv's previous start option");
  await pause();
  await seek(2);
  await stop();
  await until("rewinding replaces the old resume point with the lower native observation", async () => Math.abs((await saved())!.position - 2) < 0.4);

  await play(entryId, 2);
  await until("native local playback advances before switching sources", () => all(state => state.player.position >= 4));
  const beforeSwitch = first().player.position;
  await clients[0]!.command({ type: "play", entryId: switchEntryId });
  await until("another source replaces local playback on the single native player", () => all(state => state.currentEntryId === switchEntryId && state.player.status === "playing"));
  await stop();
  const switched = (await saved())!;
  assert.ok(switched.position >= beforeSwitch - 0.4 && switched.position < beforeSwitch + 2, "Source switching flushes the last observed local position");
  assert.equal(switched.watched, false);

  const profileName = `Native viewer ${crypto.randomUUID().slice(0, 8)}`;
  const otherProfile = (await api("/api/profiles", { name: profileName })).profile as WatchingProfile;
  assert.ok((await api("/api/profiles", undefined, 1)).profiles.some((profile: WatchingProfile) => profile.id === otherProfile.id));
  await api(`/api/profiles/${otherProfile.id}/select`, {});
  await until("selecting a watching profile updates both controllers", () => all(state => state.activeProfile.id === otherProfile.id));
  assert.equal((await catalog()).progress!.position, switched.position, "Find exposes the shared TV resume point after changing profile");
  assert.equal((await saved())!.position, switched.position, "Now history stays shared across watching profiles");
  await play(entryId, switched.position);
  await pause();
  await seek(5);
  const select = () => fetch(`${origin}/api/profiles/${household.id}/select`, { method: "POST", headers: { origin, Authorization: `Bearer ${clients[1]!.token}`, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
  let rejected = await select();
  assert.equal(rejected.status, 409, "A paired remote cannot change the watching profile while paused");
  assert.match((await rejected.json() as { error: string }).error, /Stop playback/);
  await stop();
  const otherProgress = (await saved())!;
  assert.ok(Math.abs(otherProgress.position - 5) < 0.4);

  // Hold a real media response open so loading cannot race the profile request.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  const delayed = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() {
    requested = true;
    await gate;
    return new Response(Bun.file("/mnt/fixtures/multitrack.mkv"));
  } });
  const loadingEntry = crypto.randomUUID();
  try {
    await clients[0]!.command({ type: "enqueue", entry: { id: loadingEntry, title: "Loading profile fixture", source: `http://127.0.0.1:${delayed.port}/delayed.mkv` } });
    await clients[0]!.command({ type: "play", entryId: loadingEntry });
    await until("a real native HTTP load remains pending for the profile guard check", () => requested && all(state => state.player.status === "loading"));
    rejected = await select();
    assert.equal(rejected.status, 409, "A paired remote cannot change the watching profile while loading");
    assert.ok(all(state => state.activeProfile.id === otherProfile!.id));
  } finally {
    release();
    try {
      await stop();
      await clients[0]!.command({ type: "remove", entryId: loadingEntry });
    } finally { await delayed.stop(true); }
  }

  await api(`/api/profiles/${household.id}/select`, {}, 1);
  await until("the second remote can select Household once playback is stopped", () => all(state => state.activeProfile.id === household.id));
  assert.equal((await saved())!.position, otherProgress.position, "Changing profiles retains the latest shared checkpoint");
  const eofEntryId = crypto.randomUUID();
  await clients[0]!.command({ type: "enqueueLibrary", itemId: item.id, entryId: eofEntryId });
  await play(eofEntryId, 0, true);
  await clients[0]!.command({ type: "move", entryId: eofEntryId, beforeEntryId: null });
  await until("playing EOF fixture is last on both controllers", () => all(state => state.queue.at(-1)?.id === eofEntryId));
  await pause();
  await seek(first().player.duration! - 0.7);
  await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: false });
  await until("actual native EOF marks short local media watched and clears its resume point", async () => all(state => state.player.status === "ended") && (await saved())?.watched === true && (await saved())?.position === 0);
  await stop();
  await ui.section("Now");
  await ui.click(`.history-items ${labeled(`Watching options for ${item.title}`)}`);
  await until("native watching-options popover offers the committed watched state", async () => await ui.execute("return [...document.querySelectorAll('[data-slot=popover-content] button')].some(button => button.textContent.trim() === 'Mark unwatched')"));
  await ui.button("Mark unwatched", "[data-slot=popover-content]");
  await until("native watched-state action is committed for the other remote", async () => (await saved())?.watched === false);

  await play(entryId, 0, true);
  await pause();
  await seek(6);
  await stop();
  await ui.section("Now");
  await until("native Library History shows the active profile and saved item", async () => await ui.execute("return !!document.querySelector(arguments[0] + ':enabled')", [`.history-items ${labeled(`Resume ${item.title}`)}`, `${household.name}'s local history.`]));
  previous = first().player.playbackId;
  await ui.click(`.history-items ${labeled(`Resume ${item.title}`)}`);
  await until("native history resumes its local item without changing source navigation", async () => all(state => state.player.status === "playing" && state.player.playbackId !== previous && state.queue.find(entry => entry.id === state.currentEntryId)?.source === mediaId) && !!await ui.execute("return document.querySelector('.history-panel')"));
  await started(previous, first().currentEntryId!, 6, "native History resumes at its committed point");
  await pause();
  await seek(6);
  await stop();
  const householdProgress = (await saved())!;
  assert.ok(Math.abs(householdProgress.position - 6) < 0.4);
  for (const entry of first().queue) if (!queueIds.includes(entry.id)) await clients[0]!.command({ type: "remove", entryId: entry.id });
  for (const id of queueIds) await clients[0]!.command({ type: "move", entryId: id, beforeEntryId: null });
  await until("viewing acceptance preserves the existing queue and volume", () => all(state => JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queueIds) && state.player.volume === originalVolume));
  return { household, otherProfile: otherProfile!, householdProgress, otherProgress: householdProgress };
}

export async function assertLocalProgressAfterRestart(context: ProgressContext, expected: PersistedProgress) {
  const { api, until, clients, entryId } = context;
  const { all, play, pause, stop } = controls(context);
  await until("watching profile survives desktop restart without autoplay", () => all(state => state.activeProfile.id === expected.household.id && state.player.status === "idle"));
  const profiles = (await api("/api/profiles", undefined, 1)).profiles as WatchingProfile[];
  assert.ok(profiles.some(profile => profile.id === expected.otherProfile.id && profile.name === expected.otherProfile.name));
  for (const [profile, progress] of [[expected.household, expected.householdProgress], [expected.otherProfile, expected.otherProgress]] as const) {
    await api(`/api/profiles/${profile.id}/select`, {}, 1);
    await until(`${profile.name} selection reaches both remotes after restart`, () => all(state => state.activeProfile.id === profile.id));
    const history = await api("/api/progress/history?limit=40", undefined, 1) as { items: HistoryItem[]; profile: WatchingProfile };
    const persisted = history.items.find(item => item.mediaId === progress.mediaId)!;
    assert.equal(history.profile.id, profile.id);
    for (const key of ["mediaId", "position", "duration", "watched", "lastPlayedAt", "libraryItemId"] as const) assert.equal(persisted[key], progress[key], `${profile.name} ${key} survives the real desktop restart`);
  }
  await api(`/api/profiles/${expected.household.id}/select`, {}, 1);
  await until("Household is restored after verifying shared persisted history", () => all(state => state.activeProfile.id === expected.household.id));
  await play(entryId, expected.householdProgress.position);
  await pause();
  await stop();
}

export async function verifyJellyfinResume(context: Pick<ProgressContext, "ui" | "until" | "clients" | "api" | "entryId"> & {
  item: { id: string; title: string };
  config: { containerUrl: string; accessToken: string; userId: string };
}) {
  const { ui, until, clients, api, entryId, item, config } = context;
  const { all, first, pause, seek, stop, started } = controls(context);
  const queueIds = first().queue.map(entry => entry.id);
  const watchingProfile = first().activeProfile.id;
  const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${config.containerUrl}${path}`, {
      method, headers: { "X-Emby-Token": config.accessToken, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    assert.ok(response.ok, `Jellyfin fixture ${method} ${path} returned ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  };
  const activeSessions = async () => (await request("/Sessions") as any[]).filter(session => session.NowPlayingItem?.Id === item.id && session.UserId === config.userId);
  const resumeItem = async () => (await api("/api/jellyfin/items?resume=true&startIndex=0", undefined, 1)).items.find((candidate: { id: string }) => candidate.id === item.id);
  const configuration = await request("/System/Configuration");
  try {
    // Jellyfin normally excludes media shorter than 300 seconds from resume.
    // Use its real playback-report path with this 20-second generated fixture.
    await request("/System/Configuration", { ...configuration, MinResumeDurationSeconds: 0 });
    await stop();
    await until("Jellyfin has no active report before the resume fixture starts", async () => (await activeSessions()).length === 0);
    await request(`/UserPlayedItems/${item.id}?userId=${config.userId}`, undefined, "DELETE");
    let previous = first().player.playbackId;
    await clients[1]!.command({ type: "play", entryId, fromStart: true });
    await started(previous, entryId, 0, "Jellyfin fixture starts in native libmpv before saving progress");
    await pause();
    await seek(7);
    await until("one host reports the observed Jellyfin seek despite multiple paired controllers", async () => {
      const sessions = await activeSessions();
      return sessions.length === 1 && sessions[0].PlayState?.IsPaused === true && Math.abs(sessions[0].PlayState?.PositionTicks / 10_000_000 - 7) < 0.4;
    });
    await stop();
    await until("Jellyfin stop report leaves a resumable item for the other remote", async () => {
      const item = await resumeItem();
      return (await activeSessions()).length === 0 && item?.played === false && Math.abs(item.resumePosition - 7) < 0.4;
    });
    await ui.section("Jellyfin");
    await ui.type("#media-search", item.title);
    const resume = `[aria-label="Jellyfin search results"] ${labeled(`Resume: ${item.title}`)}`;
    await until("native Jellyfin Continue watching displays the server's resume action", async () => await ui.execute("return !!document.querySelector(arguments[0] + ':enabled')", [resume]));
    previous = first().player.playbackId;
    await ui.click(resume);
    await until("native Jellyfin Resume starts its item for every controller", () => all(state => state.player.status === "playing" && state.player.playbackId !== previous && state.queue.find(entry => entry.id === state.currentEntryId)?.source.endsWith(`:${item.id}`) === true));
    await started(previous, first().currentEntryId!, 7, "native Jellyfin Resume starts at the upstream saved point");
    await pause();
    await seek(7);
    await stop();
    await until("Jellyfin resume stop is reported before an explicit restart", async () => (await activeSessions()).length === 0 && Math.abs((await resumeItem())?.resumePosition - 7) < 0.4);
    await ui.button(`Details for ${item.title}`, '[aria-label="Jellyfin search results"]');
    const restart = `[role=dialog] ${labeled(`Play ${item.title} from start`)}`;
    await until("native Jellyfin Continue watching offers Play from start", async () => await ui.execute("return !!document.querySelector(arguments[0] + ':enabled')", [restart]));
    previous = first().player.playbackId;
    await ui.click(restart);
    await until("native Jellyfin Play from start loads the selected item", () => all(state => state.player.status === "playing" && state.player.playbackId !== previous && state.queue.find(entry => entry.id === state.currentEntryId)?.source.endsWith(`:${item.id}`) === true));
    await started(previous, first().currentEntryId!, 0, "native Jellyfin Play from start resets its previous resume offset");
    await pause();
    assert.ok(all(state => state.activeProfile.id === watchingProfile), "Jellyfin progress belongs to its account and does not change the local watching profile");
  } finally {
    try {
      await stop();
      await until("Jellyfin progress acceptance leaves the upstream playback session stopped", async () => (await activeSessions()).length === 0);
      for (const entry of first().queue) if (!queueIds.includes(entry.id)) await clients[0]!.command({ type: "remove", entryId: entry.id });
      await ui.section("Now");
    } finally {
      const current = await request("/System/Configuration");
      await request("/System/Configuration", { ...current, MinResumeDurationSeconds: configuration.MinResumeDurationSeconds });
      assert.equal((await request("/System/Configuration")).MinResumeDurationSeconds, configuration.MinResumeDurationSeconds, "Resume acceptance restores the existing Jellyfin duration policy");
    }
  }
}
