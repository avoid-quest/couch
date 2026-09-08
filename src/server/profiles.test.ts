import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HistoryItem } from "../shared/library";
import type { PlaybackCommand, PlayerState, SessionState } from "../shared/protocol";
import { createProgress } from "./progress";
import { createSession } from "./session";
import { openStore } from "./store";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const preferences = { replayGain: "off", audioLanguage: "ita", subtitleLanguage: "eng", subtitles: "off", speed: 1.25 } as const;
const history: HistoryItem = { mediaId: "library:movie", libraryItemId: "movie", title: "Movie", position: 24, duration: 120, watched: true, lastPlayedAt: 100 };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-profiles-"));
  const path = join(directory, "state.sqlite");
  const store = openStore(path);
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }), () => store.close());
  return { store, path };
}

test("rename preserves stable IDs, preferences, resume, watched marks and all history across reopen", () => {
  const { store, path } = fixture();
  const viewer = store.createProfile("Viewer");
  const other = store.createProfile("Other");
  for (const id of [viewer.id, other.id, "household"]) {
    store.saveProfilePreferences(id, preferences);
    store.saveProgress(id, history);
    store.saveProgress(id, { ...history, mediaId: "library:second", position: 10, watched: false });
  }
  store.selectProfile(viewer.id);
  store.saveAudioDelay(0.7);
  const controllerToken = store.pair("Phone");
  const controller = store.controllerForToken(controllerToken);
  const renamed = store.renameProfile(viewer.id, "  Movie night  ", viewer.name);
  expect(renamed).toEqual({ id: viewer.id, name: "Movie night" });
  store.renameProfile("household", "Family", "Household");
  const reopened = openStore(path);
  cleanup.push(() => reopened.close());
  expect(reopened.activeProfile()).toEqual(renamed);
  expect(reopened.profiles().find(profile => profile.id === "household")?.name).toBe("Family");
  for (const id of [viewer.id, other.id, "household"]) {
    expect(reopened.history(id)).toEqual(store.history(id));
    expect(reopened.history(id)).toHaveLength(2);
    expect(reopened.progress(id, history.mediaId)).toEqual(history);
    expect(reopened.playbackPreferences(id)).toEqual({ profile: preferences, device: { audioDelay: 0.7 } });
  }
  expect(reopened.controllerForToken(controllerToken)).toEqual(controller);
});

test("create and rename share name validation, including case-insensitive duplicate rejection", () => {
  const { store } = fixture();
  const viewer = store.createProfile("Viewer");
  for (const name of [undefined, null, 42, {}, "", " ", "x".repeat(61), "bad\nname", "bad\u0000name", "bad\u007fname", "hOuSeHoLd"]) {
    let error = "";
    try { store.createProfile(name); } catch (reason) { error = (reason as Error).message; }
    expect(error).not.toBe("");
    expect(() => store.renameProfile(viewer.id, name, viewer.name)).toThrow(error);
    expect(store.profiles()).toHaveLength(2);
    expect(store.profiles()).toContainEqual(viewer);
  }
  expect(store.renameProfile(viewer.id, "VIEWER", viewer.name)).toEqual({ ...viewer, name: "VIEWER" });
  expect(store.renameProfile(viewer.id, "VIEWER", "VIEWER")).toEqual({ ...viewer, name: "VIEWER" });
  expect(store.renameProfile(viewer.id, "x".repeat(60), "VIEWER").name).toHaveLength(60);
});

test("removing the selected viewer keeps a renamed shared fallback and every other viewer's data", () => {
  const { store, path } = fixture();
  const viewer = store.createProfile("Viewer"), other = store.createProfile("Other");
  const fallback = store.renameProfile("household", "Family", "Household");
  for (const id of [viewer.id, other.id, fallback.id]) {
    store.saveProgress(id, history);
    store.saveProfilePreferences(id, preferences);
  }
  store.selectProfile(viewer.id);
  expect(store.removeProfile(viewer.id, viewer.name)).toEqual(fallback);
  const reopened = openStore(path);
  cleanup.push(() => reopened.close());
  expect(reopened.activeProfile()).toEqual(fallback);
  expect(reopened.profiles()).toHaveLength(2);
  expect(reopened.history(viewer.id)).toEqual([]);
  expect(reopened.playbackPreferences(viewer.id).profile.speed).toBe(1);
  for (const id of [other.id, fallback.id]) {
    expect(reopened.progress(id, history.mediaId)).toEqual(history);
    expect(reopened.playbackPreferences(id).profile).toEqual(preferences);
  }
  expect(() => reopened.removeProfile(fallback.id, fallback.name)).toThrow("shared default");
  expect(reopened.removeProfile(other.id, other.name)).toEqual(fallback);
  expect(reopened.profiles()).toEqual([fallback]);
  expect(reopened.selectProfile(fallback.id)).toEqual(fallback);
});

test("stale rename/removal and repeated removal fail without changing profile data", () => {
  const { store } = fixture();
  const viewer = store.createProfile("Viewer");
  store.saveProgress(viewer.id, history);
  store.saveProfilePreferences(viewer.id, preferences);
  const renamed = store.renameProfile(viewer.id, "Renamed", viewer.name);
  expect(() => store.renameProfile(viewer.id, "Stale", viewer.name)).toThrow("renamed on another remote");
  expect(() => store.removeProfile(viewer.id, viewer.name)).toThrow("renamed on another remote");
  expect(store.profiles()).toContainEqual(renamed);
  expect(store.progress(viewer.id, history.mediaId)).toEqual(history);
  expect(store.playbackPreferences(viewer.id).profile).toEqual(preferences);
  store.removeProfile(viewer.id, renamed.name);
  expect(() => store.removeProfile(viewer.id, renamed.name)).toThrow("removed on another remote");
  expect(() => store.renameProfile(viewer.id, "Gone", renamed.name)).toThrow("removed on another remote");
});

test("a failed final delete rolls back the selected profile, preferences and history without broadcasting", () => {
  const { store, path } = fixture();
  const viewer = store.createProfile("Viewer");
  store.selectProfile(viewer.id);
  store.saveProgress(viewer.id, history);
  store.saveProfilePreferences(viewer.id, preferences);
  const database = new Database(path);
  cleanup.push(() => database.close());
  database.run("CREATE TRIGGER fail_profile_delete BEFORE DELETE ON watching_profiles BEGIN SELECT RAISE(ABORT, 'storage failure'); END");
  const published: SessionState[] = [];
  const session = createSession(store, () => {}, state => published.push(structuredClone(state)));
  const before = structuredClone(session.state);
  expect(() => session.removeProfile(viewer.id, viewer.name)).toThrow("storage failure");
  expect(store.activeProfile()).toEqual(viewer);
  expect(store.progress(viewer.id, history.mediaId)).toEqual(history);
  expect(store.playbackPreferences(viewer.id).profile).toEqual(preferences);
  expect(session.state).toEqual(before);
  expect(published).toEqual([]);
  database.run("DROP TRIGGER fail_profile_delete");
  session.close();
});

test("rename publishes after commit during playback, while removal and selection retain all active guards", () => {
  const { store, path } = fixture();
  const viewer = store.createProfile("Viewer"), other = store.createProfile("Other");
  store.selectProfile(viewer.id);
  const reader = openStore(path);
  cleanup.push(() => reader.close());
  let published = 0;
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), state => {
    expect(reader.activeProfile()).toEqual(state.activeProfile);
    expect(reader.playbackPreferences(state.activeProfile.id)).toEqual(state.preferences!);
    published++;
  });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "movie", title: "Movie", source: "library:movie" } });
  session.command({ type: "play", entryId: "movie" });
  for (const status of ["loading", "playing", "paused"] as const) {
    session.observe({ ...idle, status, playbackId: session.state.player.playbackId });
    const before = structuredClone(session.state), count = published;
    for (const id of [viewer.id, other.id]) expect(() => session.removeProfile(id, id === viewer.id ? viewer.name : other.name)).toThrow("Stop playback");
    expect(() => session.selectProfile(other.id)).toThrow("Stop playback");
    expect(session.state).toEqual(before);
    expect(published).toBe(count);
  }
  const before = structuredClone(session.state), count = commands.length;
  session.renameProfile(viewer.id, "Renamed", viewer.name);
  expect(session.state).toEqual({ ...before, activeProfile: { ...viewer, name: "Renamed" }, libraryVersion: (before.libraryVersion ?? 0) + 1 });
  expect(commands).toHaveLength(count);
  session.command({ type: "stop" });
  session.observe(idle);
  session.removeProfile(viewer.id, "Renamed");
  expect(session.state.activeProfile.id).toBe("household");
  expect(reader.profiles()).not.toContainEqual({ ...viewer, name: "Renamed" });
  session.close();
});

test("only a committed removal discards a failed checkpoint, preventing later stop/close resurrection", () => {
  const { store, path } = fixture();
  const viewer = store.createProfile("Viewer");
  store.selectProfile(viewer.id);
  let fail = true, writes = 0;
  const session = createSession({ ...store, saveProgress(id, item) {
    writes++;
    if (fail) throw new Error("Storage full");
    store.saveProgress(id, item);
  } }, () => {}, () => {});
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "movie", title: "Movie", source: "library:movie" } });
  session.command({ type: "play", entryId: "movie" });
  const playbackId = session.state.player.playbackId;
  session.observe({ ...idle, status: "playing", playbackId, position: 24, duration: 120 });
  session.observe({ ...idle, status: "error", playbackId });
  expect(session.state.progressError).toContain("Could not save");
  expect(() => session.removeProfile(viewer.id, "Old name")).toThrow("renamed");
  fail = false;
  session.command({ type: "stop" });
  expect(store.progress(viewer.id, history.mediaId)?.position).toBe(24);
  session.command({ type: "play", entryId: "movie" });
  fail = true;
  session.observe({ ...idle, status: "playing", playbackId: session.state.player.playbackId, position: 32, duration: 120 });
  session.observe({ ...idle, status: "error", playbackId: session.state.player.playbackId });
  session.removeProfile(viewer.id, viewer.name);
  const count = writes;
  fail = false;
  session.command({ type: "stop" });
  session.close();
  expect(writes).toBe(count);
  const reopened = openStore(path);
  cleanup.push(() => reopened.close());
  expect(reopened.history(viewer.id)).toEqual([]);
  expect(reopened.activeProfile().id).toBe("household");
});

test("forgetting a different profile retains the current viewer's checkpoint", () => {
  const { store } = fixture();
  const progress = createProgress(store, () => {}, () => 100);
  progress.begin({ id: "movie", title: "Movie", source: "library:movie" }, "play", "household");
  progress.observe({ ...idle, status: "playing", playbackId: "play", position: 24, duration: 120 });
  progress.forgetProfile("different");
  progress.observe({ ...idle, status: "playing", playbackId: "play", position: 32, duration: 120 });
  progress.finish();
  expect(store.progress("household", history.mediaId)?.position).toBe(32);
});


test("legacy databases keep labels and data unconfirmed until explicit naming on the same ID", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-person-name-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite");
  const legacy = new Database(path);
  legacy.run("CREATE TABLE watching_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE); INSERT INTO watching_profiles VALUES ('household', 'MBP'), ('older', 'Other');");
  legacy.close();
  const store = openStore(path);
  cleanup.push(() => store.close());
  expect(store.activeProfile()).toEqual({ id: "household", name: "MBP" });
  expect(store.profiles().every(profile => profile.personName === undefined)).toBe(true);
  store.saveProgress("household", history);
  store.saveProfilePreferences("household", preferences);
  const token = store.pair("MBP");
  const device = store.controllerForToken(token);
  const named = store.namePerson("household", "  Francesco  ", "MBP");
  expect(named).toEqual({ id: "household", name: "Francesco", personName: "Francesco" });
  const reopened = openStore(path);
  cleanup.push(() => reopened.close());
  expect(reopened.activeProfile()).toEqual(named);
  expect(reopened.profiles()).toHaveLength(2);
  expect(reopened.selectProfile("household")).toEqual(named);
  expect(reopened.progress("household", history.mediaId)).toEqual(history);
  expect(reopened.playbackPreferences("household").profile).toEqual(preferences);
  expect(reopened.controllerForToken(token)).toEqual(device);
  expect(reopened.renameProfile("household", "MBP", "Francesco")).toEqual({ id: "household", name: "MBP" });
  expect(reopened.activeProfile().personName).toBeUndefined();
});

test("person naming validates, refuses stale writes and publishes without changing playback", () => {
  const { store } = fixture();
  for (const value of [null, "", " ", "x".repeat(61), "bad\nname"]) expect(() => store.namePerson("household", value, "Household")).toThrow("Enter your name");
  store.createProfile("Existing");
  expect(() => store.namePerson("household", "Existing", "Household")).toThrow("already has a saved history");
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "movie", title: "Movie", source: "library:movie" } });
  session.command({ type: "play", entryId: "movie" });
  session.observe({ ...idle, status: "paused", playbackId: session.state.player.playbackId, position: 24, duration: 120 });
  const before = structuredClone(session.state), count = commands.length;
  const named = session.namePerson("household", "Francesco", "Household");
  expect(session.state).toEqual({ ...before, activeProfile: named, libraryVersion: (before.libraryVersion ?? 0) + 1 });
  expect(commands).toHaveLength(count);
  expect(() => session.namePerson("household", "Stale", "Household")).toThrow("renamed on another remote");
  expect(session.state.activeProfile).toEqual(named);
  session.close();
});


test("person naming refuses an inactive history without mutation or broadcast", () => {
  const { store } = fixture();
  const first = store.activeProfile(), second = store.createProfile("Other");
  store.saveProgress(first.id, history);
  store.saveProfilePreferences(first.id, preferences);
  let published = 0;
  const session = createSession(store, () => {}, () => published++);
  session.selectProfile(second.id);
  const before = structuredClone(session.state), count = published;
  expect(() => session.namePerson(first.id, "Francesco", first.name)).toThrow("active history changed");
  expect(session.state).toEqual(before);
  expect(published).toBe(count);
  expect(store.profiles()).toContainEqual(first);
  expect(store.progress(first.id, history.mediaId)).toEqual(history);
  expect(store.playbackPreferences(first.id).profile).toEqual(preferences);
  expect(session.renameProfile(first.id, "Older history", first.name)).toEqual({ ...first, name: "Older history" });
  expect(session.state.activeProfile).toEqual(second);
  session.close();
});
