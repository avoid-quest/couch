import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState, QueueEntry } from "../shared/protocol";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const station: QueueEntry = { id: "station", title: "My station", source: "radio:stable-id", thumbnail: "https://example.test/logo.png" };
const following: QueueEntry = { id: "following", title: "Next item", source: "https://example.test/movie.mp4" };
const cleanups: (() => void)[] = [];
let time = 100_000;
beforeEach(() => { jest.useFakeTimers(); time = 100_000; });
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); jest.useRealTimers(); });
const advance = (milliseconds: number) => { time += milliseconds; jest.advanceTimersByTime(milliseconds); };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function setup(resolveSource: NonNullable<Parameters<typeof createSession>[3]>["resolveSource"] = entry => ({ source: entry.source }), entry = station, databasePath = ":memory:") {
  const store = openStore(databasePath);
  const commands: PlaybackCommand[] = [];
  const observations: PlayerState[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, { resolveSource, now: () => time, observe: player => observations.push(player) });
  cleanups.push(() => { session.close(); store.close(); });
  session.observe(idle);
  session.command({ type: "enqueue", entry });
  session.command({ type: "enqueue", entry: following });
  const play = () => session.command({ type: "play", entryId: entry.id }, undefined, { deviceId: "phone", name: "Phone" });
  const observe = (changes: Partial<PlayerState>) => session.observe({ ...idle, playbackId: session.state.player.playbackId, ...changes });
  return { store, session, commands, observations, play, observe, loads: () => commands.filter(command => command.type === "load") };
}

test("radio EOF retries the station's current source three times, retires failed generations and then stays failed", () => {
  const resolutions: string[] = [];
  const test = setup(entry => { resolutions.push(entry.source); return { source: `https://private.test/stream-${resolutions.length}` }; });
  test.play();
  expect(test.loads()[0]).toMatchObject({ radio: true });
  expect(test.session.state.playedBy).toEqual({ deviceId: "phone", name: "Phone" });
  for (const [index, delay] of [1000, 2000, 4000].entries()) {
    const failedId = test.session.state.player.playbackId!;
    test.observe({ status: "playing", nowPlaying: { title: "Current song", artist: "Artist" } });
    expect(test.session.state.radioRetry).toBeNull();
    test.observe({ status: index === 1 ? "error" : "ended", error: index === 1 ? "Network failed" : null });
    expect(test.session.state).toMatchObject({ currentEntryId: station.id, radioRetry: { attempt: index + 1, maximum: 3, retryAt: time + delay }, player: { status: "loading", nowPlaying: null } });
    expect(test.session.state.player.playbackId).not.toBe(failedId);
    expect(() => test.session.command({ type: "pause", playbackId: failedId, paused: true })).toThrow("changed");
    const waiting = test.session.state;
    test.session.observe({ ...idle, playbackId: failedId, status: "ended" });
    test.session.observe(idle);
    expect(test.session.state).toEqual(waiting);
    expect(test.session.state.playedBy).toEqual({ deviceId: "phone", name: "Phone" });
    advance(delay - 1);
    expect(test.loads()).toHaveLength(index + 1);
    advance(1);
    expect(test.loads()).toHaveLength(index + 2);
    expect(test.loads().at(-1)).toMatchObject({ source: `https://private.test/stream-${index + 2}`, radio: true });
    expect(test.session.state.radioRetry).toEqual({ attempt: index + 1, maximum: 3, retryAt: null });
  }
  test.observe({ status: "error", error: "Network failed" });
  expect(test.session.state).toMatchObject({ currentEntryId: station.id, radioRetry: { attempt: 3, maximum: 3, retryAt: null }, player: { status: "error" } });
  expect(test.session.state.player.error).toContain("after 3 retries");
  expect(resolutions).toEqual(Array(4).fill(station.source));
  const exhausted = test.session.state;
  advance(60_000);
  test.session.observe(idle);
  expect(test.session.state).toEqual(exhausted);
  expect(test.loads()).toHaveLength(4);
  expect(test.session.state.queue[0]).toEqual(station);
  test.play();
  test.observe({ status: "error" });
  expect(test.session.state.radioRetry?.attempt).toBe(1);
});

test("synchronous and asynchronous resolver failures share the same bounded retry budget", async () => {
  let attempts = 0;
  const test = setup(() => {
    attempts++;
    if (attempts % 2) throw new Error("Station unavailable");
    return Promise.reject(new Error("Station unavailable"));
  });
  expect(test.play).toThrow("Station unavailable");
  for (const delay of [1000, 2000, 4000]) { advance(delay); await flush(); }
  expect(attempts).toBe(4);
  expect(test.loads()).toHaveLength(0);
  expect(test.session.state.player.status).toBe("error");
  expect(test.session.state.radioRetry).toEqual({ attempt: 3, maximum: 3, retryAt: null });
  advance(100_000);
  expect(attempts).toBe(4);
});

test("revocation during radio backoff keeps reconnecting the accepted station", async () => {
  const store = openStore(":memory:");
  const token = store.pair("Revoked remote");
  const survivor = store.pair("Surviving remote");
  const commands: PlaybackCommand[] = [];
  let attempts = 0;
  const session = createSession(store, command => commands.push(command), () => {}, {
    now: () => time,
    resolveSource: entry => { attempts++; return entry.id === station.id && attempts === 1 ? Promise.reject(new Error("Station unavailable")) : { source: entry.source }; },
  });
  cleanups.push(() => { session.close(); store.close(); });
  const authorize = (credential: string) => () => { if (!store.isPaired(credential)) throw new Error("This remote's access was revoked. Pair again."); };
  session.observe(idle);
  session.command({ type: "enqueue", entry: station });
  session.command({ type: "enqueue", entry: following });
  session.command({ type: "play", entryId: station.id }, authorize(token));
  await flush();
  expect(session.state.radioRetry?.retryAt).toBe(time + 1000);
  store.revokeController(store.controllerForToken(token)!.id);
  expect(() => session.command({ type: "pause", playbackId: session.state.player.playbackId!, paused: true }, authorize(token))).toThrow("revoked");
  advance(1000);
  expect(session.state.radioRetry).toEqual({ attempt: 1, maximum: 3, retryAt: null });
  expect(commands.at(-1)).toMatchObject({ type: "load", source: station.source, radio: true });
  expect(attempts).toBe(2);
  session.command({ type: "play", entryId: following.id }, authorize(survivor));
  expect(commands.at(-1)).toMatchObject({ type: "load", source: following.source });
});

test("legacy favorite classification commits without leaking resolved credentials and survives restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-radio-retry-"));
  const path = join(directory, "session.sqlite");
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const entry = { ...station, source: "https://public.test/original-stream" };
  const test = setup(() => Promise.resolve({ source: "https://private.test/current-stream", headers: { Authorization: "secret" }, radio: true }), entry, path);
  test.play();
  await flush();
  expect(test.session.state.queue[0]).toEqual({ ...entry, kind: "radio", live: true });
  expect(test.loads()[0]).toMatchObject({ source: "https://private.test/current-stream", radio: true, headers: { Authorization: "secret" } });
  expect(JSON.stringify(test.session.state)).not.toMatch(/private.test|secret/);
  const reopened = openStore(path);
  expect(reopened.queue[0]).toMatchObject({ source: entry.source, kind: "radio" });
  const restarted = createSession(reopened, () => { throw new Error("Restart autoplayed"); }, () => {});
  expect(restarted.state.currentEntryId).toBeNull();
  expect(restarted.state.radioRetry).toBeUndefined();
  reopened.close();
  test.observe({ status: "error" });
  expect(test.session.state.radioRetry?.attempt).toBe(1);
});

test("only thirty seconds of observed advancing playback reset the budget; pauses, stalls and short reconnects do not", () => {
  const test = setup();
  test.play();
  test.observe({ status: "error" });
  advance(1000);
  test.observe({ status: "playing", position: 0 });
  for (let second = 1; second <= 20; second++) { advance(1000); test.observe({ status: "playing", position: second }); }
  test.observe({ status: "paused", position: 20 });
  advance(60_000);
  test.observe({ status: "playing", position: 20 });
  advance(60_000);
  test.observe({ status: "playing", position: 20 });
  test.observe({ status: "error" });
  expect(test.session.state.radioRetry?.attempt).toBe(2);
  advance(2000);
  test.observe({ status: "playing", position: 0 });
  for (let second = 1; second <= 30; second++) { advance(1000); test.observe({ status: "playing", position: second }); }
  test.observe({ status: "error" });
  expect(test.session.state.radioRetry?.attempt).toBe(1);
});

test("wall time alone cannot reset a stalled connection's budget", () => {
  const test = setup();
  test.play();
  test.observe({ status: "error" });
  advance(1000);
  test.observe({ status: "playing", position: 0 });
  advance(30_000);
  test.observe({ status: "playing", position: 1 });
  test.observe({ status: "error" });
  expect(test.session.state.radioRetry?.attempt).toBe(2);
});

test("playlist Play retains radio resolution retries after committing the new queue", () => {
  let attempts = 0;
  const test = setup(entry => { if (entry.source.startsWith("radio:")) { attempts++; throw new Error("Station unavailable"); } return { source: entry.source }; });
  test.session.command({ type: "play", entryId: following.id });
  expect(() => test.session.loadQueue([station], "play")).toThrow("Station unavailable");
  expect(test.session.state.currentEntryId).toBe(test.session.state.queue[0]!.id);
  expect(test.session.state.radioRetry?.attempt).toBe(1);
  advance(1000);
  expect(attempts).toBe(2);
  expect(test.session.state.radioRetry?.attempt).toBe(2);
});

test.each(["stop", "replacement", "next", "remove", "queue replace", "queue play", "shutdown", "player loss", "profile", "reserve"])("%s cancels pending reconnects", transition => {
  const test = setup();
  test.play();
  test.observe({ status: "error" });
  let intent: number | undefined;
  if (transition === "stop") { test.session.command({ type: "stop" }); test.session.command({ type: "stop" }); test.session.observe(idle); expect(test.session.state.player.status).toBe("idle"); }
  if (transition === "replacement") test.session.command({ type: "play", entryId: following.id });
  if (transition === "next") test.session.command({ type: "next", playbackId: test.session.state.player.playbackId! });
  if (transition === "remove") test.session.command({ type: "remove", entryId: station.id });
  if (transition === "queue replace") test.session.loadQueue([following], "replace");
  if (transition === "queue play") test.session.loadQueue([following], "play");
  if (transition === "shutdown") test.session.close();
  if (transition === "player loss") test.session.observe({ ...idle, status: "unavailable" });
  if (transition === "profile") {
    const profile = test.session.createProfile("Guest");
    expect(() => test.session.selectProfile(profile.id)).toThrow("Stop playback");
    test.session.command({ type: "stop" });
    test.session.observe(idle);
    test.session.selectProfile(profile.id);
  }
  if (transition === "reserve") intent = test.session.reservePlay();
  const loaded = test.loads().length;
  advance(60_000);
  expect(test.loads()).toHaveLength(loaded);
  expect(test.session.state.radioRetry).toBeNull();
  if (intent !== undefined) test.session.playIfCurrent(intent, following.id);
});

test("a newer play reservation preserves healthy radio and cannot be overtaken by its subsequent failure", () => {
  const test = setup();
  test.play();
  test.observe({ status: "playing", nowPlaying: { title: "Current song" } });
  const before = test.session.state;
  const sent = test.commands.length;
  const intent = test.session.reservePlay();
  expect(test.session.state).toEqual(before);
  expect(test.commands).toHaveLength(sent);
  test.observe({ status: "ended" });
  advance(10_000);
  expect(test.loads()).toHaveLength(1);
  expect(test.session.state.player.status).toBe("error");
  test.session.playIfCurrent(intent, following.id);
  expect(test.loads().at(-1)).not.toHaveProperty("radio");
});

test.each(["stop", "reserve", "replacement", "shutdown", "player loss"])("%s aborts a retry resolver and ignores its late completion", async transition => {
  const pending = Promise.withResolvers<MediaSource>();
  let signal: AbortSignal | undefined;
  let attempts = 0;
  const test = setup((entry, _id, abort) => { if (entry.id !== station.id || ++attempts === 1) return { source: entry.source }; signal = abort; return pending.promise; });
  test.play();
  test.observe({ status: "error" });
  advance(1000);
  const retryId = test.session.state.player.playbackId;
  if (transition === "stop") test.session.command({ type: "stop" });
  if (transition === "reserve") test.session.reservePlay();
  if (transition === "replacement") test.session.command({ type: "play", entryId: following.id });
  if (transition === "shutdown") test.session.close();
  if (transition === "player loss") test.session.observe({ ...idle, status: "unavailable" });
  expect(signal?.aborted).toBe(true);
  pending.resolve({ source: "https://private.test/stale", radio: true, metadata: { title: "Stale" } });
  await flush();
  test.session.observe({ ...idle, playbackId: retryId, status: "error" });
  advance(60_000);
  expect(test.loads().some(load => load.source.includes("stale"))).toBe(false);
  expect(test.session.state.radioRetry).toBeNull();
});

test("a native connection failure cancels a scheduled retry and publishes unavailability", () => {
  const store = openStore(":memory:");
  let failSend = false;
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => { if (failSend) throw new Error("Closed"); commands.push(command); }, () => {});
  cleanups.push(() => { session.close(); store.close(); });
  session.observe(idle);
  session.command({ type: "enqueue", entry: station, playNow: true });
  failSend = true;
  session.observe({ ...idle, playbackId: session.state.player.playbackId, status: "ended" });
  expect(session.state.player.status).toBe("unavailable");
  expect(session.state.radioRetry).toBeNull();
  advance(10_000);
  expect(commands.filter(command => command.type === "load")).toHaveLength(1);
});

test("non-radio media keeps EOF queue advancement and does not retry failures", () => {
  const test = setup(undefined, { ...station, source: "https://example.test/album.flac", live: true });
  test.play();
  test.observe({ status: "ended" });
  expect(test.session.state.currentEntryId).toBe(following.id);
  test.observe({ status: "error", error: "Movie failed" });
  advance(10_000);
  expect(test.loads()).toHaveLength(2);
  expect(test.session.state.player.error).toBe("Movie failed");
  expect(test.session.state.radioRetry).toBeNull();
});

test("a radio retry that first resolves successfully retains the requesting device", () => {
  let calls = 0;
  const f = setup(entry => { if (++calls === 1) throw new Error("Temporarily unavailable"); return { source: entry.source }; });
  expect(() => f.play()).toThrow("Temporarily unavailable");
  expect(f.session.state.playedBy).toBeUndefined();
  advance(1000);
  expect(f.loads()).toHaveLength(1);
  expect(f.session.state.playedBy).toEqual({ deviceId: "phone", name: "Phone" });
});
