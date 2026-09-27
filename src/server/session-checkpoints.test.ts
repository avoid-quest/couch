import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { createSession } from "./session";
import { createPlaybackTargets } from "./playback-targets";
import { openStore } from "./store";
import { playbackMediaId } from "./progress";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const entry = { id: "movie", title: "Movie", source: "https://media.example/movie.mp4" };
const tracks: NonNullable<PlayerState["tracks"]> = [{ id: "audio-1", index: 1, kind: "audio", label: "English", language: "eng", selected: true }];
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function database() { const directory = mkdtempSync(join(tmpdir(), "session-checkpoint-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true })); return join(directory, "state.sqlite"); }
function fixture(path: string) {
  const store = openStore(path);
  const commands: PlaybackCommand[] = [];
  const resolutions: string[] = [];
  const native = { onCommand: (_command: PlaybackCommand) => {} };
  let now = 1_000, closed = false;
  const targets = createPlaybackTargets(command => { commands.push(command); native.onCommand(command); }, () => session, { timeout: 50 });
  const session = createSession(store, targets.send, () => {}, { now: () => now, nativeTarget: () => targets.nativeAssigned, transferBusy: () => targets.busy, resolveSource: (_entry, playbackId) => { resolutions.push(playbackId); return { source: `https://media.example/fresh-${resolutions.length}.mp4` }; } });
  targets.publish();
  const close = (crash = false) => { if (closed) return; closed = true; if (!crash) session.close(); targets.close(); store.close(); };
  cleanup.push(() => close());
  return { store, session, targets, commands, resolutions, native, close, advance: (ms: number) => { now += ms; } };
}
async function start(f: ReturnType<typeof fixture>) {
  f.targets.observeNative(idle);
  f.session.command({ type: "enqueue", entry, playNow: true });
  await Bun.sleep(0);
  const load = f.commands.find(command => command.type === "load");
  if (!load || load.type !== "load") throw new Error("Missing initial load");
  f.targets.observeNative({ ...idle, playbackId: load.playbackId, status: "paused", position: 37, duration: 120, seekable: true, speed: 1.5, tracks, audioTracksKnown: true });
  return load.playbackId;
}
function browser(f: ReturnType<typeof fixture>, refuse = false) {
  const commands: PlaybackCommand[] = [];
  let state = { ...idle };
  const registration = f.targets.register("Browser", command => {
    commands.push(command);
    if (command.type === "load") state = { ...idle, playbackId: command.playbackId, status: refuse ? "error" : "paused", position: command.startPosition ?? 0, duration: 120, seekable: true, speed: command.preferences?.speed, tracks, error: refuse ? "Decoder refused" : null };
    else if (command.type === "seek") state = { ...state, position: command.position };
    else if (command.type === "stop") state = { ...idle };
    else if (command.type === "pause") state = { ...state, status: command.paused ? "paused" : "playing" };
    else if (command.type === "speed") state = { ...state, speed: command.speed };
    queueMicrotask(() => registration.observe(state));
  });
  return { registration, commands };
}

for (const shutdown of ["close", "quiesce"] as const) test(`${shutdown} restores finite playback intent without resolving or commanding hardware`, async () => {
  const path = database(), first = fixture(path), original = await start(first);
  const presentationId = first.session.state.presentationId;
  if (shutdown === "quiesce") first.session.quiesce();
  first.close();
  const restored = fixture(path);
  expect(restored.session.state).toMatchObject({ currentEntryId: entry.id, presentationId, targetId: "checkpoint", player: { status: "unavailable", position: 37, duration: 120, speed: 1.5, tracks } });
  expect(restored.session.state.player.playbackId).not.toBe(original);
  expect(restored.session.state.player.playbackId).toBeString();
  expect(restored.resolutions).toEqual([]); expect(restored.commands).toEqual([]);
  restored.targets.observeNative(idle);
  expect(restored.session.state.player).toMatchObject({ status: "unavailable", position: 37 });
  expect(restored.targets.nativeAssigned).toBe(false);
  const destination = browser(restored);
  await restored.targets.move(destination.registration.id);
  expect(restored.resolutions).toHaveLength(1);
  expect(destination.commands[0]).toMatchObject({ type: "load", source: "https://media.example/fresh-1.mp4", startPosition: 37, paused: true, preferences: { speed: 1.5 } });
  expect(restored.session.state.player).toMatchObject({ status: "paused", position: 37, speed: 1.5 });
  const active = restored.session.state.player;
  destination.registration.observe({ ...active, status: "playing", position: 49 });
  restored.targets.observeNative({ ...active, position: 99, status: "ended" });
  restored.session.checkpoint();
  expect(restored.store.sharedProgress(playbackMediaId(entry)!)?.position).toBe(49);
  expect(restored.store.playbackCheckpoint()?.position).toBe(49);
});

test("Stop and ended observations clear durable intent even when progress callbacks flush", async () => {
  for (const finish of ["stop", "ended"] as const) {
    const path = database(), f = fixture(path), attempt = await start(f);
    expect(f.store.playbackCheckpoint()).not.toBeNull();
    if (finish === "stop") f.session.command({ type: "stop" });
    else f.targets.observeNative({ ...idle, playbackId: attempt, status: "ended", position: 120, duration: 120 });
    expect(f.store.playbackCheckpoint()).toBeNull();
    f.close();
    expect(fixture(path).session.state.currentEntryId).toBeNull();
  }
});

test("deleted entries and changed source identities cannot restore stale checkpoints", async () => {
  for (const changed of [false, true]) {
    const path = database(), f = fixture(path); await start(f); f.close();
    const store = openStore(path);
    store.saveQueue(changed ? [{ ...entry, source: "https://media.example/replacement.mp4" }] : []);
    store.close();
    const restored = fixture(path);
    expect(restored.session.restoredCheckpoint).toBe(false);
    expect(restored.session.state.currentEntryId).toBeNull();
    expect(restored.resolutions).toEqual([]);
  }
});

test("periodic observation checkpoints survive a crash and never persist an unacknowledged seek", async () => {
  const path = database(), f = fixture(path), attempt = await start(f);
  f.advance(10_001);
  f.targets.observeNative({ ...f.session.state.player, playbackId: attempt, status: "playing", position: 51 });
  expect(f.store.playbackCheckpoint()?.position).toBe(51);
  f.session.command({ type: "seek", playbackId: attempt, position: 95 });
  f.session.checkpoint();
  expect(f.store.playbackCheckpoint()?.position).toBe(51);
  f.close(true);
  const restored = fixture(path);
  expect(restored.session.state.player).toMatchObject({ status: "unavailable", position: 51 });
});

test("a refused destination leaves the restored checkpoint resumable", async () => {
  const path = database(), first = fixture(path); await start(first); first.close();
  const f = fixture(path), checkpoint = f.store.playbackCheckpoint(), destination = browser(f, true);
  await expect(f.targets.move(destination.registration.id)).rejects.toThrow("Decoder refused");
  expect(f.session.state).toMatchObject({ currentEntryId: entry.id, targetId: "checkpoint", player: { status: "unavailable", position: 37 } });
  expect(f.store.playbackCheckpoint()).toEqual(checkpoint);
  destination.registration.close();
  const working = browser(f);
  await f.targets.move(working.registration.id);
  expect(f.session.state.player).toMatchObject({ status: "paused", position: 37 });
});

test("strict checkpoint failure rejects without erasing the previous durable intent", async () => {
  const f = fixture(database()); await start(f);
  const before = f.store.playbackCheckpoint();
  const failure = spyOn(f.store, "savePlaybackCheckpoint").mockImplementation(() => { throw new Error("disk full"); });
  try {
    expect(() => f.session.checkpoint()).toThrow();
    expect(() => f.session.quiesce()).toThrow();
    expect(f.store.playbackCheckpoint()).toEqual(before);
    expect(f.session.state.player).toMatchObject({ position: 37, status: "paused" });
  } finally { failure.mockRestore(); }
});

test("explicit native selection freshly resolves the checkpoint and resumes paused", async () => {
  const path = database(), first = fixture(path); await start(first); first.close();
  const f = fixture(path);
  let state = { ...idle };
  f.native.onCommand = command => {
    if (command.type === "load") state = { ...idle, playbackId: command.playbackId, position: command.startPosition ?? 0, status: "paused", duration: 120, seekable: true, speed: command.preferences?.speed, tracks };
    if (command.type === "seek") state = { ...state, position: command.position };
    queueMicrotask(() => f.targets.observeNative(state));
  };
  f.targets.observeNative(idle);
  expect(f.commands).toEqual([]);
  await f.targets.move("native");
  expect(f.resolutions).toHaveLength(1);
  expect(f.session.state).toMatchObject({ targetId: "native", player: { status: "paused", position: 37, speed: 1.5, tracks } });
});

test("resumed progress retains its saved history owner when the active profile changed before restart", async () => {
  const path = database(), first = fixture(path); await start(first);
  const owner = first.store.activeProfile().id;
  first.session.checkpoint(); first.close();
  const store = openStore(path), other = store.createProfile("Other viewer");
  store.selectProfile(other.id); store.close();
  const f = fixture(path), destination = browser(f);
  expect(f.session.state.activeProfile.id).toBe(other.id);
  await f.targets.move(destination.registration.id);
  destination.registration.observe({ ...f.session.state.player, status: "playing", position: 58 });
  f.session.checkpoint();
  expect(f.store.progress(owner, playbackMediaId(entry)!)?.position).toBe(58);
  expect(f.store.progress(other.id, playbackMediaId(entry)!)).toBeNull();
});

test("restored playback requires Stop before changing its profile and keeps tracking after resume", async () => {
  const path = database(), first = fixture(path); await start(first); first.close();
  const f = fixture(path), owner = f.store.activeProfile().id, other = f.store.createProfile("Other viewer");
  expect(() => f.session.selectProfile(other.id)).toThrow("Stop playback");
  const destination = browser(f);
  await f.targets.move(destination.registration.id);
  destination.registration.observe({ ...f.session.state.player, status: "playing", position: 58 });
  f.session.checkpoint();
  expect(f.store.progress(owner, playbackMediaId(entry)!)?.position).toBe(58);
  expect(f.store.progress(other.id, playbackMediaId(entry)!)).toBeNull();
  f.session.command({ type: "stop" });
  await Bun.sleep(0);
  expect(f.session.selectProfile(other.id).id).toBe(other.id);
});

test("restored playback protects its history and profile until explicitly stopped", async () => {
  const path = database(), first = fixture(path), owner = first.store.createProfile("Viewer");
  first.session.selectProfile(owner.id);
  await start(first); first.close();
  const f = fixture(path), mediaId = playbackMediaId(entry)!;
  const history = f.store.sharedProgressRows(mediaId);
  const before = f.store.playbackCheckpoint();
  expect(() => f.session.removeProfile(owner.id, owner.name)).toThrow("Stop playback");
  expect(() => f.session.editProgress(mediaId, { clearResume: true }, { title: entry.title, libraryItemId: null })).toThrow("Stop this item");
  expect(() => f.session.removeHistory(mediaId)).toThrow("Stop this item");
  expect(() => f.session.restoreProgress(history, history)).toThrow("Stop this item");
  expect(f.store.playbackCheckpoint()).toEqual(before);
  expect(f.store.sharedProgressRows(mediaId)).toEqual(history);
  f.session.command({ type: "stop" });
  expect(f.session.removeHistory(mediaId)).toEqual(history);
  f.session.restoreProgress(history);
  expect(f.store.sharedProgressRows(mediaId)).toEqual(history);
  expect(() => f.session.editProgress(mediaId, { clearResume: true }, { title: entry.title, libraryItemId: null })).not.toThrow();
  expect(() => f.session.removeProfile(owner.id, owner.name)).not.toThrow();
});
