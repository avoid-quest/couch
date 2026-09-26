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
function fixture(path = ":memory:", options: Parameters<typeof createSession>[3] = {}) {
  const store = openStore(path), commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, options);
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

test("choosing an existing item preserves the waiting queue when replaying current or played media", () => {
  const f = fixture();
  f.add("current", true); f.add("first"); f.add("chosen"); f.add("last");
  f.session.command({ type: "play", entryId: "chosen" });
  expect(f.upcoming()).toEqual(["first", "last"]);
  const queue = f.session.state.queue;
  f.session.command({ type: "play", entryId: "chosen" });
  expect(f.session.state.queue).toEqual(queue);
  f.session.command({ type: "play", entryId: "current" });
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["chosen", "current", "first", "last"]);
  expect(f.upcoming()).toEqual(["first", "last"]);
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

test("canceling a play intent leaves separately queued album entries intact", () => {
  const f = fixture();
  f.add("current", true); f.add("waiting");
  const intent = f.session.reservePlay();
  f.session.command({ type: "stop" });
  const album = f.session.loadQueue(["first", "second"].map(id => ({ id, title: id, source: `library:${id}` })), "append");
  expect(() => f.session.playIfCurrent(intent, album[0]!.id, true, undefined, undefined, album.map(entry => entry.id))).toThrow("Another action canceled playback");
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


test.each([false, true])("replaying a played item keeps previous plays out of Up next (stopped: %s)", stopped => {
  const f = fixture();
  f.add("A", true); f.add("B"); f.add("C"); f.add("D");
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  if (stopped) f.session.command({ type: "stop" });
  f.session.command({ type: "play", entryId: "A" });
  expect(f.session.state.queue.map(entry => entry.id)).toEqual(["B", "C", "A", "D"]);
  expect(f.upcoming()).toEqual(["D"]);
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  expect(f.session.state.currentEntryId).toBe("D");
  expect(f.upcoming()).toEqual([]);
});

test("replay preserves its waiting queue across restart and natural completion", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-replay-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "session.db"), f = fixture(path);
  f.add("A", true); f.add("B"); f.add("C");
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  f.session.command({ type: "play", entryId: "A" });
  f.session.command({ type: "stop" });
  const restarted = fixture(path);
  expect(restarted.session.state.queue.map(entry => entry.id)).toEqual(["B", "A", "C"]);
  expect(restarted.upcoming()).toEqual(["C"]);
  expect(restarted.commands.filter(command => command.type === "load")).toEqual([]);
  restarted.session.command({ type: "play", entryId: "A" });
  restarted.observe("ended");
  expect(restarted.session.state.currentEntryId).toBe("C");
});

test("a failed replay reorder preserves the active item, persisted queue and cursor", () => {
  const f = fixture();
  f.add("A", true); f.add("B"); f.add("C");
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
  const previous = f.session.state, sent = f.commands.length;
  const save = spyOn(f.store, "saveQueue").mockImplementation(() => { throw new Error("Disk full"); });
  try {
    expect(() => f.session.command({ type: "play", entryId: "A" })).toThrow();
    expect(f.session.state.queue).toEqual(previous.queue);
    expect(f.session.state.currentEntryId).toBe("B");
    expect(f.session.state.player).toEqual(previous.player);
    expect(f.store.queueCursorEntryId()).toBe("B");
    expect(f.commands).toHaveLength(sent);
  } finally { save.mockRestore(); }
});


test("an audio-route refusal rejects Play without adding the unplayed item to Up next", () => {
  const f = fixture(":memory:", { prepareAudio: () => { throw new Error("Audio output unavailable"); } });
  f.add("waiting");
  expect(() => f.add("unrequested", true)).toThrow("Audio output unavailable");
  expect(f.session.state.currentEntryId).toBeNull();
  expect(f.upcoming()).toEqual(["waiting"]);
});


for (const kind of ["direct", "catalog", "playlist"] as const) test.each(["audio", "storage"])(`${kind} Play admission failure (%s) preserves existing playback and queue`, failure => {
  let refuseAudio = false;
  const f = fixture(":memory:", { prepareAudio: () => { if (refuseAudio) throw new Error("Audio output unavailable"); return "test-output"; } });
  f.add("current", true); f.add("waiting");
  const before = f.session.state, sent = f.commands.length;
  refuseAudio = failure === "audio";
  const save = failure === "storage" ? spyOn(f.store, "saveQueue").mockImplementation(() => { throw new Error("Disk full"); }) : null;
  const entry = { id: "new", title: "New", source: "https://media.example/new" };
  try {
    expect(() => {
      if (kind === "direct") f.session.command({ type: "enqueue", entry, playNow: true });
      else if (kind === "catalog") f.session.playNewEntries([entry], { intent: f.session.reservePlay() });
      else f.session.loadQueue([entry], "play");
    }).toThrow();
    expect(f.session.state.queue).toEqual(before.queue);
    expect(f.session.state.currentEntryId).toBe(before.currentEntryId);
    expect(f.session.state.player).toEqual(before.player);
    expect(f.store.queueCursorEntryId()).toBe(before.queueCursorEntryId!);
    expect(f.upcoming()).toEqual(["waiting"]);
    expect(f.commands).toHaveLength(sent);
  } finally { save?.mockRestore(); }
});
