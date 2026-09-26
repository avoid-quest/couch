import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "./session";
import { openStore } from "./store";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const entries = ["one", "two", "three", "four"].map(id => ({ id, title: id, source: `https://media.example/${id}` }));
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-queue-position-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "session.db");
  // A legacy database has neither a cursor nor a queue_position table.
  const db = new Database(path);
  db.run("CREATE TABLE session (id INTEGER PRIMARY KEY, queue TEXT NOT NULL, volume REAL NOT NULL)");
  db.query("INSERT INTO session VALUES (1, ?, 42)").run(JSON.stringify(entries));
  db.close();
  const start = () => {
    const store = openStore(path), commands: PlaybackCommand[] = [];
    const session = createSession(store, command => commands.push(command), () => {});
    session.observe(idle);
    let closed = false;
    const close = () => { if (!closed) { session.close(); store.close(); closed = true; } };
    cleanup.push(close);
    return { store, session, commands, close };
  };
  return { ...start(), start };
}

test("legacy entries stay upcoming; Stop and restart retain position without autoplay or deleting data", () => {
  const f = fixture();
  expect(f.session.state.queueCursorEntryId).toBeNull();
  expect(f.session.state.queue).toEqual(entries);
  expect(f.store.volume).toBe(42);
  f.session.command({ type: "play", entryId: "two" });
  expect(f.session.state).toMatchObject({ currentEntryId: "two", queueCursorEntryId: "two" });
  f.session.command({ type: "stop" });
  expect(f.session.state).toMatchObject({ currentEntryId: null, queueCursorEntryId: "two" });
  f.close();
  const restarted = f.start();
  expect(restarted.session.state).toMatchObject({ currentEntryId: null, queueCursorEntryId: "two", queue: [entries[1], entries[0], ...entries.slice(2)] });
  expect(restarted.commands).toEqual([{ type: "volume", volume: 42 }]);
});

test("restart during playback retains the last selection and replay preserves the waiting boundary", () => {
  const f = fixture();
  f.session.command({ type: "play", entryId: "one" });
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  f.close();
  const restarted = f.start();
  expect(restarted.session.state).toMatchObject({ currentEntryId: null, queueCursorEntryId: "three" });
  restarted.session.command({ type: "play", entryId: "one" });
  expect(restarted.session.state).toMatchObject({ currentEntryId: "one", queueCursorEntryId: "one", queue: [entries[1], entries[2], entries[0], entries[3]] });
  expect(restarted.store.history("household")).toEqual([]);
});

test("reorder follows the cursor identity and deleting current keeps the previous boundary and stops", () => {
  const f = fixture();
  f.session.command({ type: "play", entryId: "one" });
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  f.session.command({ type: "move", entryId: "four", beforeEntryId: "three" });
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["one", "two", "four", "three"]);
  expect(f.session.state.queueCursorEntryId).toBe("two");
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  expect(f.session.state.currentEntryId).toBe("four");
  f.session.command({ type: "remove", entryId: "four" });
  expect(f.session.state).toMatchObject({ currentEntryId: null, queueCursorEntryId: "two" });
  f.session.command({ type: "remove", entryId: "one" });
  expect(f.session.state.queueCursorEntryId).toBe("two");
  f.session.command({ type: "remove", entryId: "two" });
  expect(f.session.state.queueCursorEntryId).toBeNull();
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["three"]);
});

test("moving a stopped cursor preserves its identity while append, replace and play have distinct boundaries", () => {
  const f = fixture();
  f.session.command({ type: "play", entryId: "two" });
  f.session.command({ type: "stop" });
  f.session.command({ type: "move", entryId: "two", beforeEntryId: "four" });
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["one", "three", "two", "four"]);
  expect(f.session.state.queueCursorEntryId).toBe("two");
  const added = f.session.loadQueue(entries, "append");
  expect(f.session.state.queueCursorEntryId).toBe("two");
  expect(f.session.state.queue.slice(4)).toEqual(added);
  const replaced = f.session.loadQueue(entries, "replace");
  expect(f.session.state).toMatchObject({ currentEntryId: null, queueCursorEntryId: null, queue: replaced });
  const played = f.session.loadQueue(entries, "play");
  expect(f.session.state).toMatchObject({ currentEntryId: played[0]!.id, queueCursorEntryId: played[0]!.id, queue: played });
});

test("Play next inserts after the shared cursor and persists who added it", () => {
  const f = fixture();
  f.session.command({ type: "play", entryId: "two" });
  f.session.command({ type: "enqueue", entry: { id: "next", title: "next", source: "https://media.example/next" }, placement: "next" }, undefined, { deviceId: "phone", name: "Phone" });
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["two", "next", "one", "three", "four"]);
  expect(f.session.state.queue[1]?.addedBy).toEqual({ deviceId: "phone", name: "Phone" });
  f.session.command({ type: "stop" });
  const added = f.session.loadQueue([{ id: "list", title: "list", source: "https://media.example/list" }], "append", undefined, undefined, "next");
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["two", added[0]?.id, "next", "one", "three", "four"]);
  f.close();
  const restarted = f.start().session.state;
  expect(restarted.queue.map(entry => entry.id)).toEqual(["two", added[0]?.id, "next", "one", "three", "four"]);
  expect(restarted.queue[2]?.addedBy).toEqual({ deviceId: "phone", name: "Phone" });
});

test("a failed explicit cursor write leaves the current item and its progress tracker active", () => {
  const f = fixture();
  f.session.command({ type: "enqueue", entry: { id: "local", title: "Local", source: "library:local" } });
  f.session.command({ type: "play", entryId: "local" });
  const playbackId = f.session.state.player.playbackId!;
  f.session.observe({ ...idle, playbackId, status: "playing", position: 10, duration: 100 });
  const save = spyOn(f.store, "saveQueueCursor").mockImplementation(() => { throw new Error("Disk full"); });
  try {
    expect(() => f.session.command({ type: "play", entryId: "two" })).toThrow("Couldn't save your place in Up next");
    f.session.observe({ ...idle, playbackId, status: "paused", position: 40, duration: 100 });
    expect(f.session.state).toMatchObject({ currentEntryId: "local", queueCursorEntryId: "local", player: { playbackId, position: 40 } });
    expect(f.store.progress("household", "library:local")?.position).toBe(40);
  } finally { save.mockRestore(); }
});

test("failed progress completion rolls back the cursor and continues observing the old item", () => {
  const f = fixture();
  f.session.command({ type: "enqueue", entry: { id: "local", title: "Local", source: "library:local" } });
  f.session.command({ type: "play", entryId: "local" });
  const playbackId = f.session.state.player.playbackId!;
  f.session.observe({ ...idle, playbackId, status: "playing", position: 10, duration: 100 });
  f.session.observe({ ...idle, playbackId, status: "playing", position: 20, duration: 100 });
  const queue = f.session.state.queue;
  const save = spyOn(f.store, "saveProgress").mockImplementation(() => { throw new Error("Disk full"); });
  try {
    expect(() => f.session.command({ type: "play", entryId: "two" })).toThrow();
    expect(f.store.queueCursorEntryId()).toBe("local");
    expect(f.session.state.currentEntryId).toBe("local");
    expect(f.session.state.queue).toEqual(queue);
    expect(f.start().session.state.queue).toEqual(queue);
  } finally { save.mockRestore(); }
  f.session.observe({ ...idle, playbackId, status: "paused", position: 40, duration: 100 });
  expect(f.store.progress("household", "library:local")?.position).toBe(40);
});

test("a failed transaction commit restores the old tracker and its last persisted snapshot", () => {
  const f = fixture();
  f.session.command({ type: "enqueue", entry: { id: "local", title: "Local", source: "library:local" } });
  f.session.command({ type: "play", entryId: "local" });
  const playbackId = f.session.state.player.playbackId!;
  f.session.observe({ ...idle, playbackId, status: "playing", position: 10, duration: 100 });
  f.session.observe({ ...idle, playbackId, status: "playing", position: 20, duration: 100 });
  const save = spyOn(f.store, "saveQueueCursor").mockImplementation((_id, beforeCommit) => {
    beforeCommit?.();
    throw new Error("Commit I/O failure");
  });
  try {
    expect(() => f.session.command({ type: "play", entryId: "two" })).toThrow("Couldn't save your place in Up next");
    expect(f.session.state).toMatchObject({ currentEntryId: "local", queueCursorEntryId: "local", player: { playbackId } });
    const checkpoint = spyOn(f.store, "saveProgress");
    try {
      f.session.observe({ ...idle, playbackId, status: "paused", position: 20, duration: 100 });
      expect(checkpoint).toHaveBeenCalledTimes(1);
      f.session.observe({ ...idle, playbackId, status: "playing", position: 40, duration: 100 });
      expect(f.store.progress("household", "library:local")?.position).toBe(40);
    } finally { checkpoint.mockRestore(); }
  } finally { save.mockRestore(); }
});
