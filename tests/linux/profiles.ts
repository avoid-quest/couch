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
  // The profile picker is retired; exercise the retained profile contract
  // against actual native playback and independent paired credentials.
  const create = async (_target: UiDriver, name: string) => (await api("/api/profiles", { name })).profile as WatchingProfile;
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
  const playback = structuredClone(state().player), prefs = structuredClone(state().preferences!);
  assert.equal((await raw(removed.id, "rename", { expectedName: removed.name, name: `Renamed ${suffix}` })).status, 200);
  removed.name = `Renamed ${suffix}`;
  await until("native rename reaches both controllers without replacing playback", () => all(state => state.activeProfile.name === removed.name));
  assert.deepEqual(state().player, playback);
  assert.deepEqual(state().preferences, prefs);
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

  const oldName = survivor.name;
  assert.equal((await raw(survivor.id, "rename", { expectedName: oldName, name: `Other name ${suffix}` }, 1)).status, 200);
  assert.equal((await raw(survivor.id, "rename", { expectedName: oldName, name: `My draft ${suffix}` })).status, 409, "Stale rename cannot overwrite another controller's change");
  assert.equal((await raw(survivor.id, "rename", { expectedName: `Other name ${suffix}`, name: `My draft ${suffix}` })).status, 200);
  survivor.name = `My draft ${suffix}`;
  assert.equal((await raw(removed.id, "remove", { expectedName: removed.name })).status, 200);
  await until("removing the selected viewer switches both controllers to the shared fallback", () => all(state => state.activeProfile.id === "household"));
  assert.ok(!(await list()).some(profile => profile.id === removed.id));
  assert.equal((await raw(removed.id, "remove", { expectedName: removed.name }, 1)).status, 404);
  await select(survivor);
  assert.deepEqual(await history(), survivorHistory, "Another viewer's entire history survives rename and removal");
  assert.deepEqual(state().preferences, survivorPreferences, "Another viewer's saved preferences survive rename and removal");
  await select(original);
  assert.deepEqual(await history(), survivorHistory, "The shared TV history is independent of the selected preference profile");
  assert.deepEqual(state().preferences, originalPreferences);
  await httpRemote.minimize();
  const persisted = { removed, survivor, history: survivorHistory, preferences: survivorPreferences, original, originalHistory: survivorHistory, originalPreferences };
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
  await Bun.write(`${artifactDir}/profiles-after-restart.json`, JSON.stringify({ profiles, retained: expected.survivor }, null, 2));
}
