import { strict as assert } from "node:assert";
import type { HistoryItem, WatchingProfile } from "../../src/shared/library";
import type { Action, PlaybackPreferences, SessionState } from "../../src/shared/protocol";
import { assertNativePortal, assertResponsive, keys, type startHttpRemote, type UiDriver, type Wait } from "./ui";

type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = {
  origin: string;
  ui: UiDriver;
  httpRemote: HttpRemote;
  otherRemote: HttpRemote;
  until: Wait;
  clients: { token: string; state: SessionState | null; command: (action: Action) => Promise<void> }[];
  api: (path: string, body?: unknown, index?: number) => Promise<any>;
  entryId: string;
  artifactDir: string;
};
export type PersistedProfiles = {
  removed: WatchingProfile;
  survivor: WatchingProfile;
  history: HistoryItem[];
  preferences: PlaybackPreferences;
  original: WatchingProfile;
  originalHistory: HistoryItem[];
  originalPreferences: PlaybackPreferences;
};

const row = (id: string) => `[data-profile-id="${id}"]`;
const form = '[aria-label="Rename watching profile"]';

export async function verifyProfileManagement(context: Context): Promise<PersistedProfiles> {
  const { origin, ui, httpRemote, otherRemote, until, clients, api, entryId, artifactDir } = context;
  assert.ok(clients.length >= 2, "Profile acceptance requires two independently paired controllers");
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => client.state && predicate(client.state));
  const state = () => clients[0]!.state!;
  const list = async () => (await api("/api/profiles")).profiles as WatchingProfile[];
  const history = async () => (await api("/api/progress/history")).items as HistoryItem[];
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("profile fixture waits for native Stop acknowledgement", () => all(state => state.player.status === "idle" && state.currentEntryId === null));
  };
  const select = async (profile: WatchingProfile) => {
    await api(`/api/profiles/${profile.id}/select`, {}, 1);
    await until(`both controllers select ${profile.name}`, () => all(state => state.activeProfile.id === profile.id));
  };
  const open = async (target: UiDriver) => {
    await target.controls();
    await target.click(".watching-profile");
    await until("watching profiles finish loading", () => target.execute("return document.querySelector('[aria-label=\"Watching profiles\"]')?.getAttribute('aria-busy') === 'false'"));
  };
  const close = async (target: UiDriver) => {
    await target.key(keys.escape);
    await until("profile dialog closes and restores its trigger", () => target.execute("return !document.querySelector('[role=dialog]') && document.activeElement?.matches('.watching-profile')"));
  };
  const create = async (target: UiDriver, name: string) => {
    await open(target);
    await target.type("#watching-profile-name", name);
    await target.button("Add profile", "[role=dialog]");
    let profile: WatchingProfile | undefined;
    await until(`profile ${name} created through the visible dialog`, async () => !!(profile = (await list()).find(item => item.name === name)));
    await close(target);
    return profile!;
  };
  const checkpoint = async (position: number) => {
    await clients[0]!.command({ type: "play", entryId, fromStart: true });
    await until("profile fixture plays a scanned local item in native libmpv", () => all(state => state.currentEntryId === entryId && state.player.status === "playing" && state.player.seekable));
    await clients[0]!.command({ type: "pause", playbackId: state().player.playbackId!, paused: true });
    await until("profile fixture pauses native playback", () => all(state => state.player.status === "paused"));
    await clients[1]!.command({ type: "seek", playbackId: state().player.playbackId!, position });
    await until("profile fixture observes its requested resume point", () => all(state => Math.abs(state.player.position - position) < 0.4));
  };
  const raw = (id: string, operation: "rename" | "remove", body: unknown, index = 0) => fetch(`${origin}/api/profiles/${id}/${operation}`, {
    method: "POST", headers: { Origin: origin, Authorization: `Bearer ${clients[index]!.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  const guard = async (profile: WatchingProfile, status: string) => {
    const removed = await raw(profile.id, "remove", { expectedName: profile.name });
    assert.equal(removed.status, 409, `${status} rejects removal through an actual paired HTTP request`);
    assert.match((await removed.json()).error, /Stop playback/);
    await open(ui);
    await until(`${status} disables every native selection and removal action while retaining rename`, () => ui.execute(`
      const selections = [...document.querySelectorAll('[aria-label="Watching profiles"] button[aria-pressed]')];
      const removals = [...document.querySelectorAll('[data-action="remove"]')];
      return selections.length >= 3 && selections.every(button => button.disabled) && removals.length >= 2 && removals.every(button => button.disabled) && !document.querySelector(arguments[0] + ' [data-action="rename"]').disabled;
    `, [row(profile.id)]));
    await close(ui);
  };

  await stop();
  const original = state().activeProfile;
  const originalHistory = await history(), originalPreferences = structuredClone(state().preferences!);
  const suffix = crypto.randomUUID().slice(0, 8);
  await httpRemote.minimize();
  await otherRemote.minimize();
  const survivor = await create(ui, `Keep ${suffix}`);
  await httpRemote.restore();
  const removed = await create(httpRemote.ui, `Remove ${suffix}`);
  await httpRemote.minimize();
  await select(survivor);
  await checkpoint(7);
  await stop();
  const saved = (await history())[0]!;
  assert.ok(saved.mediaId.startsWith("library:"), "Profile fixture uses a real scanned library identity");
  await api(`/api/progress/${encodeURIComponent(saved.mediaId)}`, { watched: true });
  await clients[0]!.command({ type: "preferences", profileId: survivor.id, preferences: { speed: 1.25, audioLanguage: "ita" } });
  const survivorHistory = await history(), survivorPreferences = structuredClone(state().preferences!);
  await select(removed);
  await checkpoint(4);
  await guard(removed, "paused");
  await open(ui);
  await ui.click(`${row(removed.id)} [data-action="rename"]`);
  await ui.type("#watching-profile-rename", `Renamed ${suffix}`);
  await assertNativePortal(ui, "[role=dialog]", artifactDir, "profiles-native-rename-paused");
  const playback = structuredClone(state().player), prefs = structuredClone(state().preferences!);
  await ui.button("Save name", form);
  removed.name = `Renamed ${suffix}`;
  await until("native rename reaches both controllers without replacing playback", () => all(state => state.activeProfile.name === removed.name));
  assert.deepEqual(state().player, playback);
  assert.deepEqual(state().preferences, prefs);
  await close(ui);
  await clients[0]!.command({ type: "pause", playbackId: state().player.playbackId!, paused: false });
  await until("profile removal is tested against native playing status", () => all(state => state.player.status === "playing"));
  await guard(removed, "playing");
  await stop();

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  const delayed = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { requested = true; await gate; return new Response(Bun.file("/mnt/fixtures/multitrack.mkv")); } });
  const loadingId = crypto.randomUUID();
  try {
    await clients[0]!.command({ type: "enqueue", entry: { id: loadingId, title: "Profile loading guard", source: `http://127.0.0.1:${delayed.port}/delayed.mkv` } });
    await clients[0]!.command({ type: "play", entryId: loadingId });
    await until("native media request remains loading for removal guard", () => requested && all(state => state.player.status === "loading"));
    await guard(removed, "loading");
  } finally {
    release();
    try { await stop(); await clients[0]!.command({ type: "remove", entryId: loadingId }); }
    finally { await delayed.stop(true); }
  }

  await httpRemote.restore();
  await open(httpRemote.ui);
  await httpRemote.ui.click(`${row(survivor.id)} [data-action="rename"]`);
  await httpRemote.ui.type("#watching-profile-rename", `My draft ${suffix}`);
  await otherRemote.restore();
  await open(otherRemote.ui);
  await otherRemote.ui.click(`${row(survivor.id)} [data-action="rename"]`);
  await otherRemote.ui.type("#watching-profile-rename", `Other name ${suffix}`);
  await otherRemote.ui.button("Save name", form);
  await close(otherRemote.ui);
  await otherRemote.minimize();
  await httpRemote.restore();
  await until("the first HTTP browser keeps its draft and explains the other remote's rename", () => httpRemote.ui.execute("return document.querySelector('#watching-profile-rename')?.value === arguments[0] && document.querySelector('[role=dialog]')?.textContent.includes('Another remote renamed')", [`My draft ${suffix}`]));
  await httpRemote.ui.button("Use current profile", form);
  await httpRemote.ui.button("Save name", form);
  survivor.name = `My draft ${suffix}`;
  await until("the reviewed name is shared", async () => (await list()).some(profile => profile.id === survivor.id && profile.name === survivor.name));
  await assertResponsive(httpRemote.ui, "Phone watching profile management");
  await httpRemote.screenshot("profiles-phone-list");
  await close(httpRemote.ui);
  await httpRemote.refresh();
  await until("HTTP reload reconnects with the current profile snapshot", () => httpRemote.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  await open(httpRemote.ui);
  await httpRemote.ui.click(`${row(removed.id)} [data-action="remove"]`);
  await until("removal confirmation states all local consequences and unchanged upstream/controller scope", () => httpRemote.ui.execute(`
    const text = document.querySelector('[aria-label="Remove watching profile"]')?.textContent || '';
    return ['resume points', 'watched marks', 'media history', 'saved playback preferences', "Other viewers'", 'Jellyfin', 'paired remotes', 'administrator'].every(value => text.includes(value));
  `));
  await assertResponsive(httpRemote.ui, "Phone profile removal confirmation");
  await httpRemote.screenshot("profiles-phone-remove");
  await httpRemote.ui.button("Cancel", '[aria-label="Remove watching profile"]');
  assert.ok((await list()).some(profile => profile.id === removed.id), "Cancel leaves the profile and its local records in place");
  await httpRemote.ui.click(`${row(removed.id)} [data-action="remove"]`);
  await httpRemote.ui.button("Remove profile", '[aria-label="Remove watching profile"]');
  await until("removing the selected viewer switches both controllers to the shared fallback", () => all(state => state.activeProfile.id === "household"));
  await close(httpRemote.ui);
  assert.ok(!(await list()).some(profile => profile.id === removed.id));
  assert.equal((await raw(removed.id, "remove", { expectedName: removed.name }, 1)).status, 404);
  await select(survivor);
  assert.deepEqual(await history(), survivorHistory, "Another viewer's entire history survives rename and removal");
  assert.deepEqual(state().preferences, survivorPreferences, "Another viewer's saved preferences survive rename and removal");
  await select(original);
  assert.deepEqual(await history(), originalHistory);
  assert.deepEqual(state().preferences, originalPreferences);
  await httpRemote.minimize();
  const persisted = { removed, survivor, history: survivorHistory, preferences: survivorPreferences, original, originalHistory, originalPreferences };
  await Bun.write(`${artifactDir}/profiles-before-restart.json`, JSON.stringify(persisted, null, 2));
  return persisted;
}

export async function assertProfilesAfterRestart({ clients, api, until, httpRemote, artifactDir }: Context, expected: PersistedProfiles) {
  const profiles = (await api("/api/profiles")).profiles as WatchingProfile[];
  assert.ok(!profiles.some(profile => profile.id === expected.removed.id), "Removed viewer stays removed after native restart");
  assert.deepEqual(profiles.find(profile => profile.id === expected.survivor.id), expected.survivor);
  assert.ok(clients.every(client => client.state?.currentEntryId === null), "Profile persistence does not start playback after restart");
  for (const [profile, history, preferences] of [[expected.survivor, expected.history, expected.preferences], [expected.original, expected.originalHistory, expected.originalPreferences]] as const) {
    await api(`/api/profiles/${profile.id}/select`, {});
    await until("restarted controllers receive the stored watching profile and preferences", () => clients.every(client => client.state?.activeProfile.id === profile.id));
    assert.deepEqual((await api("/api/progress/history")).items, history);
    assert.deepEqual(clients[0]!.state!.preferences, preferences);
  }
  await httpRemote.restore();
  await httpRemote.ui.controls();
  await httpRemote.ui.click(".watching-profile");
  await until("reconnected HTTP browser displays the renamed survivor and no removed viewer", () => httpRemote.ui.execute("return document.querySelector(arguments[0])?.textContent.includes(arguments[2]) && !document.querySelector(arguments[1])", [row(expected.survivor.id), row(expected.removed.id), expected.survivor.name]));
  await httpRemote.screenshot("profiles-after-restart");
  await httpRemote.ui.key(keys.escape);
  await httpRemote.minimize();
  await Bun.write(`${artifactDir}/profiles-after-restart.json`, JSON.stringify({ profiles, retained: expected.survivor }, null, 2));
}
