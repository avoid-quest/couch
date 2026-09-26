import { expect, test } from "bun:test";
import type { PlaybackCommand, PlayerState, QueueEntry } from "../shared/protocol";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const entries: QueueEntry[] = [{ id: "first", title: "Track", source: "https://media.example/track" }, { id: "second", title: "Track", source: "https://media.example/track" }];

test("bulk append commits once, keeps duplicate occurrences and current playback", () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  let broadcasts = 0;
  const session = createSession(store, command => commands.push(command), () => { broadcasts++; });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "https://media.example/current" } });
  session.command({ type: "play", entryId: "current" });
  const player = session.state.player;
  const before = broadcasts;
  const sent = commands.length;
  const added = session.loadQueue(entries, "append");
  expect(broadcasts).toBe(before + 1);
  expect(commands).toHaveLength(sent);
  expect(session.state.player).toEqual(player);
  expect(session.state.queue).toHaveLength(3);
  expect(new Set(added.map(entry => entry.id)).size).toBe(2);
  expect(added.every(entry => !entries.some(saved => saved.id === entry.id))).toBe(true);
  store.close();
});

test("replace retires slow resolution, leaves the new queue stopped and play starts its first occurrence", async () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const pending = Promise.withResolvers<MediaSource>();
  const session = createSession(store, command => commands.push(command), () => {}, { resolveSource: entry => entry.id === "slow" ? pending.promise : { source: entry.source } });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "slow", title: "Slow", source: "https://media.example/slow" } });
  session.command({ type: "play", entryId: "slow" });
  session.loadQueue(entries, "replace");
  session.observe(idle);
  pending.resolve({ source: "https://private.example/late" });
  await Bun.sleep(0);
  expect(commands.filter(command => command.type === "load")).toHaveLength(0);
  expect(session.state.player.status).toBe("idle");
  expect(session.state.currentEntryId).toBeNull();
  const added = session.loadQueue(entries, "play");
  expect(session.state.currentEntryId).toBe(added[0]!.id);
  expect(commands.at(-1)).toMatchObject({ type: "load", source: entries[0]!.source });
  store.close();
});

test("queue limits and storage failures leave the old queue and player intact", () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  session.observe(idle);
  session.loadQueue(entries, "play");
  const previous = session.state;
  const sent = commands.length;
  expect(() => session.loadQueue(Array.from({ length: 499 }, () => entries[0]!), "append")).toThrow("500");
  expect(() => session.loadQueue([], "play")).toThrow("empty");
  expect(session.state).toEqual(previous);
  store.close();
  expect(() => session.loadQueue(entries, "replace")).toThrow();
  expect(session.state).toEqual(previous);
  expect(commands).toHaveLength(sent);
});

test.each(["replace", "play"] as const)("failed %s preserves progress observation until a later stop", mode => {
  const store = openStore(":memory:");
  let failProgress = false;
  let failQueue = false;
  let time = 0;
  const commands: PlaybackCommand[] = [];
  const session = createSession({ ...store,
    saveProgress(profileId, item) { if (failProgress) throw new Error("Progress write failed"); store.saveProgress(profileId, item); },
    saveQueue(queue) { if (failQueue) throw new Error("Queue write failed"); store.saveQueue(queue); },
  }, command => commands.push(command), () => {}, { now: () => time });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "library:current" } });
  session.command({ type: "play", entryId: "current" });
  const observed: PlayerState = { ...idle, playbackId: session.state.player.playbackId, status: "playing", duration: 1000, seekable: true };
  session.observe({ ...observed, position: 100 });
  time = 1000;
  session.observe({ ...observed, position: 120 });
  const before = session.state;
  const sent = commands.length;
  failProgress = true;
  expect(() => session.loadQueue(entries, mode)).toThrow("Couldn't save your progress");
  expect(session.state.queue).toEqual(before.queue);
  expect(session.state.player).toEqual(before.player);
  expect(store.progress("household", "library:current")?.position).toBe(100);
  failProgress = false;
  failQueue = true;
  expect(() => session.loadQueue(entries, mode)).toThrow(mode === "play" ? "Couldn't save your place in Up next" : "Queue write failed");
  expect(session.state.queue).toEqual(before.queue);
  expect(session.state.player).toEqual(before.player);
  expect(commands).toHaveLength(sent);
  expect(store.queueCursorEntryId()).toBe(before.queueCursorEntryId!);
  expect(store.progress("household", "library:current")?.position).toBe(mode === "play" ? 100 : 120);
  failQueue = false;
  time = 20_000;
  session.observe({ ...observed, position: 150 });
  expect(store.progress("household", "library:current")?.position).toBe(150);
  session.command({ type: "seek", playbackId: observed.playbackId!, position: 90 });
  session.observe({ ...observed, position: 90 });
  expect(store.progress("household", "library:current")?.position).toBe(90);
  session.observe({ ...observed, position: 95 });
  session.command({ type: "stop" });
  expect(store.progress("household", "library:current")).toMatchObject({ position: 95, watched: false });
  store.close();
});

test.each(["replace", "play"] as const)("%s marks a near-end item watched only after the queue commits", mode => {
  const store = openStore(":memory:");
  let failQueue = false;
  const session = createSession({ ...store, saveQueue(queue) {
    if (failQueue) throw new Error("Queue write failed");
    store.saveQueue(queue);
  } }, () => {}, () => {});
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "library:current" } });
  session.command({ type: "play", entryId: "current" });
  session.observe({ ...idle, playbackId: session.state.player.playbackId, status: "playing", position: 950, duration: 1000, seekable: true });
  const before = session.state;
  failQueue = true;
  expect(() => session.loadQueue(entries, mode)).toThrow(mode === "play" ? "Couldn't save your place in Up next" : "Queue write failed");
  expect(session.state.queue).toEqual(before.queue);
  expect(session.state.player).toEqual(before.player);
  expect(store.queueCursorEntryId()).toBe(before.queueCursorEntryId!);
  expect(store.progress("household", "library:current")).toMatchObject({ position: 950, watched: false });
  failQueue = false;
  session.loadQueue(entries, mode);
  expect(store.progress("household", "library:current")).toMatchObject({ position: 0, watched: true });
  store.close();
});

test("a completion-write failure rolls back playlist Play and keeps observing the current item", () => {
  const store = openStore(":memory:");
  let failCompletion = true;
  const commands: PlaybackCommand[] = [];
  const session = createSession({ ...store, saveProgress(profileId, item) {
    if (failCompletion && item.watched) throw new Error("Completion write failed");
    store.saveProgress(profileId, item);
  } }, command => commands.push(command), () => {});
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "library:current" }, playNow: true });
  session.observe({ ...idle, playbackId: session.state.player.playbackId, status: "playing", position: 950, duration: 1000, seekable: true });
  const before = session.state;
  const sent = commands.length;
  expect(() => session.loadQueue(entries, "play")).toThrow("Couldn't save your progress");
  expect(session.state.queue).toEqual(before.queue);
  expect(session.state.player).toEqual(before.player);
  expect(session.state.currentEntryId).toBe("current");
  expect(store.queueCursorEntryId()).toBe("current");
  expect(commands).toHaveLength(sent);
  expect(store.progress("household", "library:current")).toMatchObject({ position: 950, watched: false });
  failCompletion = false;
  session.observe({ ...before.player, status: "paused", position: 960 });
  expect(store.progress("household", "library:current")).toMatchObject({ position: 960, watched: false });
  const added = session.loadQueue(entries, "play");
  expect(session.state.queue).toEqual(added);
  expect(session.state.currentEntryId).toBe(added[0]!.id);
  expect(commands.at(-1)).toMatchObject({ type: "load", source: entries[0]!.source });
  expect(store.progress("household", "library:current")).toMatchObject({ position: 0, watched: true });
  store.close();
});
