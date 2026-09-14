import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { createSession } from "./session";
import { openStore } from "./store";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture(path = ":memory:") {
  const store = openStore(path), commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  session.observe(idle);
  cleanup.push(() => { session.close(); store.close(); });
  const add = (id: string, playNow = false) => session.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}` }, playNow });
  const observe = (status: PlayerState["status"]) => session.observe({ ...idle, playbackId: session.state.player.playbackId, status });
  const upcoming = () => { const state = session.state; return state.queue.slice(state.queue.findIndex(entry => entry.id === state.queueCursorEntryId) + 1).map(entry => entry.id); };
  return { store, session, commands, add, observe, upcoming };
}

test.each(["direct", "catalog", "queued"])("%s Play now while idle keeps the previously queued item upcoming", kind => {
  const f = fixture();
  f.add("waiting");
  expect(f.commands.filter(command => command.type === "load")).toEqual([]);
  expect(f.session.state.currentEntryId).toBeNull();
  if (kind === "direct") f.add("chosen", true);
  else {
    const intent = f.session.reservePlay();
    f.add("chosen");
    if (kind === "catalog") f.session.playIfCurrent(intent, "chosen");
    else f.session.command({ type: "play", entryId: "chosen" });
  }
  expect(f.session.state.currentEntryId).toBe("chosen");
  expect(f.upcoming()).toEqual(["waiting"]);
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["chosen", "waiting"]);
  expect(f.commands.filter(command => command.type === "load")).toHaveLength(1);
});

test("Play now preserves waiting order through Next and natural completion", () => {
  const f = fixture();
  f.add("current", true); f.observe("playing");
  f.add("first"); f.add("second"); f.add("chosen", true);
  expect(f.upcoming()).toEqual(["first", "second"]);
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["current", "chosen", "first", "second"]);
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  expect(f.session.state.currentEntryId).toBe("first");
  expect(f.upcoming()).toEqual(["second"]);
  f.observe("ended");
  expect(f.session.state.currentEntryId).toBe("second");
  expect(f.upcoming()).toEqual([]);
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["current", "chosen", "first", "second"]);
});

test("choosing an existing upcoming item moves only it and replay keeps the same order", () => {
  const f = fixture();
  f.add("current", true); f.add("first"); f.add("chosen"); f.add("last");
  f.session.command({ type: "play", entryId: "chosen" });
  expect(f.upcoming()).toEqual(["first", "last"]);
  const queue = f.session.state.queue;
  f.session.command({ type: "play", entryId: "chosen" });
  expect(f.session.state.queue).toEqual(queue);
  f.session.command({ type: "play", entryId: "current" });
  expect(f.session.state.queue).toEqual(queue);
  expect(f.upcoming()).toEqual(["chosen", "first", "last"]);
});

test("Add to queue appends without interrupting paused playback", () => {
  const f = fixture();
  f.add("current", true); f.observe("paused"); f.add("first");
  const player = f.session.state.player, sent = f.commands.length;
  f.add("last");
  expect(f.session.state.player).toEqual(player);
  expect(f.commands).toHaveLength(sent);
  expect(f.upcoming()).toEqual(["first", "last"]);
});

test("Play now keeps an explicitly selected album together ahead of the waiting queue", () => {
  const f = fixture();
  f.add("current", true); f.add("waiting");
  const intent = f.session.reservePlay();
  const album = f.session.loadQueue(["first", "second"].map(id => ({ id, title: id, source: `library:${id}` })), "append");
  expect(f.upcoming()).toEqual(["waiting", ...album.map(entry => entry.id)]);
  f.session.playIfCurrent(intent, album[0]!.id, true, undefined, undefined, album.map(entry => entry.id));
  expect(f.session.state.queue.map(entry => entry.title)).toEqual(["current", "first", "second", "waiting"]);
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  expect(f.session.state.currentEntryId).toBe(album[1]!.id);
  expect(f.upcoming()).toEqual(["waiting"]);
});

test("canceled album Play now stays appended without changing playback or pending order", () => {
  const f = fixture();
  f.add("current", true); f.add("waiting");
  const intent = f.session.reservePlay();
  f.session.command({ type: "stop" });
  const album = f.session.loadQueue(["first", "second"].map(id => ({ id, title: id, source: `library:${id}` })), "append");
  expect(() => f.session.playIfCurrent(intent, album[0]!.id, true, undefined, undefined, album.map(entry => entry.id))).toThrow("Playback was canceled");
  expect(f.session.state.currentEntryId).toBeNull();
  expect(f.upcoming()).toEqual(["waiting", ...album.map(entry => entry.id)]);
});

test("restart retains reordered upcoming items without autoplay", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-play-now-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "session.db"), f = fixture(path);
  f.add("waiting"); f.add("chosen", true); f.session.command({ type: "stop" });
  const restarted = fixture(path);
  expect(restarted.session.state.currentEntryId).toBeNull();
  expect(restarted.session.state.queueCursorEntryId).toBe("chosen");
  expect(restarted.upcoming()).toEqual(["waiting"]);
  expect(restarted.commands.filter(command => command.type === "load")).toEqual([]);
});

test("failed Play now queue persistence leaves current playback, queue and cursor intact", () => {
  const f = fixture();
  f.add("current", true); f.observe("playing"); f.add("waiting"); f.add("chosen");
  const previous = f.session.state, sent = f.commands.length;
  const save = spyOn(f.store, "saveQueue").mockImplementation(() => { throw new Error("Disk full"); });
  try {
    expect(() => f.session.command({ type: "play", entryId: "chosen" })).toThrow();
    expect(f.session.state.queue).toEqual(previous.queue);
    expect(f.session.state.currentEntryId).toBe("current");
    expect(f.session.state.player).toEqual(previous.player);
    expect(f.session.state.queueCursorEntryId).toBe("current");
    expect(f.store.queueCursorEntryId()).toBe("current");
    expect(f.commands).toHaveLength(sent);
  } finally { save.mockRestore(); }
});
