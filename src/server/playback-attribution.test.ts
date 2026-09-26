import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackActor, PlayerState } from "../shared/protocol";
import { playbackMediaId } from "./progress";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const phone: PlaybackActor = { deviceId: "phone", name: "Frank's phone" };
const laptop: PlaybackActor = { deviceId: "laptop", name: "Laptop" };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture(options: Parameters<typeof createSession>[3] = {}) {
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {}, options);
  cleanups.push(() => { session.close(); store.close(); });
  session.observe(idle);
  for (const id of ["one", "two"]) session.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}` } });
  const mediaId = (index = 0) => playbackMediaId(session.state.queue.find(entry => entry.id === ["one", "two"][index])!)!;
  const observe = (status: PlayerState["status"] = "playing", position = 20) => session.observe({ ...idle, playbackId: session.state.player.playbackId, status, position, duration: 120, seekable: true });
  return { store, session, mediaId, observe };
}

test("manual play attribution is separate from queue ownership and is saved only after playback is observed", () => {
  const f = fixture();
  f.session.command({ type: "play", entryId: "one" }, undefined, phone);
  expect(f.session.state.playedBy).toEqual(phone);
  expect(f.session.state.queue[0]).not.toHaveProperty("playedBy");
  expect(f.store.sharedProgress(f.mediaId())?.playedBy).toBeUndefined();
  f.observe();
  expect(f.store.sharedProgress(f.mediaId())?.playedBy).toEqual(phone);
  f.session.command({ type: "pause", playbackId: f.session.state.player.playbackId!, paused: true }, undefined, laptop);
  expect(f.session.state.playedBy).toEqual(phone);
  f.session.command({ type: "stop" });
  expect(f.session.state.playedBy).toBeUndefined();
  expect(f.store.sharedProgress(f.mediaId())?.playedBy).toEqual(phone);
  f.session.playHistory(f.mediaId(), false, undefined, laptop);
  expect(f.session.state.playedBy).toEqual(laptop);
  expect(f.store.sharedProgress(f.mediaId())?.playedBy).toEqual(phone);
  f.observe();
  expect(f.store.sharedProgress(f.mediaId())?.playedBy).toEqual(laptop);
});

test("late, canceled and failed resolutions never claim another device started media", async () => {
  const pending: Array<ReturnType<typeof Promise.withResolvers<MediaSource>>> = [];
  const f = fixture({ resolveSource() { const result = Promise.withResolvers<MediaSource>(); pending.push(result); return result.promise; } });
  f.session.command({ type: "play", entryId: "one" }, undefined, phone);
  f.session.command({ type: "play", entryId: "two" }, undefined, laptop);
  expect(f.session.state.playedBy).toBeUndefined();
  pending[0]!.resolve({ source: "https://stream.example/old" });
  await Bun.sleep(0);
  expect(f.session.state.playedBy).toBeUndefined();
  pending[1]!.resolve({ source: "https://stream.example/new" });
  await Bun.sleep(0);
  expect(f.session.state.playedBy).toEqual(laptop);
  f.observe();
  expect(f.store.sharedProgress(f.mediaId())?.playedBy).toBeUndefined();
  expect(f.store.sharedProgress(f.mediaId(1))?.playedBy).toEqual(laptop);
  f.session.command({ type: "play", entryId: "one" }, undefined, phone);
  f.session.command({ type: "stop" });
  pending[2]!.resolve({ source: "https://stream.example/canceled" });
  await Bun.sleep(0);
  expect(f.session.state.playedBy).toBeUndefined();
  f.session.command({ type: "play", entryId: "one" }, undefined, phone);
  pending[3]!.reject(new Error("Unavailable"));
  await Bun.sleep(0);
  expect(f.session.state.playedBy).toBeUndefined();
  expect(f.store.sharedProgress(f.mediaId())?.playedBy).toBeUndefined();
});

test("automatic advancement is unattributed, while a manually requested Next names its device", () => {
  const f = fixture();
  f.session.command({ type: "play", entryId: "one" }, undefined, phone);
  f.observe("ended", 120);
  expect(f.session.state.currentEntryId).toBe("two");
  expect(f.session.state.playedBy).toBeUndefined();
  f.observe();
  expect(f.store.sharedProgress(f.mediaId(1))?.playedBy).toBeUndefined();
  f.session.command({ type: "play", entryId: "one" }, undefined, phone);
  f.session.command({ type: "enqueue", entry: { ...f.session.state.queue.find(entry => entry.id === "two")!, id: "two-again" } });
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! }, undefined, laptop);
  expect(f.session.state.playedBy).toEqual(laptop);
  f.observe();
  expect(f.store.sharedProgress(f.mediaId(1))?.playedBy).toEqual(laptop);
});

test("attribution migration leaves old history rows unnamed and keeps new snapshots across reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "couch-attribution-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "couch.sqlite");
  const entry = { id: "one", title: "One", source: "https://media.example/one" };
  const mediaId = playbackMediaId(entry)!;
  const legacy = new Database(path);
  legacy.run("CREATE TABLE history_sources (mediaId TEXT PRIMARY KEY, entry TEXT NOT NULL)");
  legacy.query("INSERT INTO history_sources VALUES (?, ?)").run(mediaId, JSON.stringify(entry));
  legacy.run("CREATE TABLE viewing_progress (profileId TEXT NOT NULL, mediaId TEXT NOT NULL, title TEXT NOT NULL, libraryItemId TEXT, position REAL NOT NULL DEFAULT 0, duration REAL, watched INTEGER NOT NULL DEFAULT 0, lastPlayedAt INTEGER, PRIMARY KEY (profileId, mediaId))");
  legacy.query("INSERT INTO viewing_progress VALUES (?, ?, ?, NULL, 12, 120, 0, 500)").run("household", mediaId, entry.title);
  legacy.close();
  const store = openStore(path);
  expect(store.historySource(mediaId)).toEqual(entry);
  expect(store.sharedProgress(mediaId)).toMatchObject({ position: 12, lastPlayedAt: 500 });
  expect(store.sharedProgress(mediaId)?.playedBy).toBeUndefined();
  store.saveProgress("household", { mediaId, title: entry.title, libraryItemId: null, position: 20, duration: 120, watched: false, lastPlayedAt: 1000, playedBy: phone }, entry);
  store.close();
  const reopened = openStore(path);
  expect(reopened.sharedProgress(mediaId)?.playedBy).toEqual(phone);
  expect(reopened.sharedHistory()).toHaveLength(1);
  reopened.close();
});

test("removing a newer legacy history never assigns its device to the surviving older record", () => {
  const f = fixture();
  const item = { mediaId: f.mediaId(), title: "One", libraryItemId: null, position: 10, duration: 120, watched: false, lastPlayedAt: 1000 };
  f.store.saveProgress("household", item, f.session.state.queue[0]);
  const legacy = f.store.createProfile("Old history");
  f.store.saveProgress(legacy.id, { ...item, lastPlayedAt: 2000, playedBy: phone }, f.session.state.queue[0]);
  expect(f.store.sharedHistory()[0]?.playedBy).toEqual(phone);
  f.store.removeProfile(legacy.id, legacy.name);
  expect(f.store.sharedHistory()[0]).toMatchObject({ lastPlayedAt: 1000 });
  expect(f.store.sharedHistory()[0]?.playedBy).toBeUndefined();
});
