import { expect, test } from "bun:test";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import { playbackMediaId } from "./progress";
import type { PlaybackCommand, PlayerState, QueueEntry } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
function fixture(changes: Partial<QueueEntry> = {}, player: Partial<PlayerState> = {}) {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const requests: { entry: QueueEntry; signal: AbortSignal; result: ReturnType<typeof Promise.withResolvers<MediaSource>> }[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, {
    resolveSource(entry, _playbackId, signal) {
      if (entry.quality === undefined) return { source: "https://stream.example/original" };
      const result = Promise.withResolvers<MediaSource>();
      requests.push({ entry, signal, result });
      return result.promise;
    },
  });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "one", title: "Original title", source: "web:https://youtube.com/watch?v=one", ...changes } });
  session.command({ type: "enqueue", entry: { id: "two", title: "Next", source: "web:https://youtube.com/watch?v=two" } });
  session.command({ type: "play", entryId: "one" });
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "playing", position: 40, duration: 200, seekable: true, speed: 1.25, ...player });
  commands.length = 0;
  return { store, session, commands, requests, playbackId };
}

test("quality replaces only the current transport at the latest position and keeps pause, queue and preferences", async () => {
  const { store, session, commands, requests, playbackId } = fixture({}, { status: "paused" });
  try {
    const before = session.state;
    const result = session.command({ type: "videoQuality", playbackId, quality: "720p" });
    expect(commands).toEqual([]);
    expect(session.state.player).toEqual(before.player);
    expect(requests[0]!.entry).toMatchObject({ id: "one", quality: "720p" });
    session.observe({ ...before.player, position: 48 });
    requests[0]!.result.resolve({ source: "https://stream.example/private", headers: { Authorization: "secret" }, maxVideoHeight: 720, startPosition: 0 });
    await result;
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "load", startPosition: 48, paused: true, maxVideoHeight: 720, preferences: { speed: 1.25 } });
    expect(session.state.queue).toEqual(before.queue.map(entry => entry.id === "one" ? { ...entry, quality: "720p" } : entry));
    expect(session.state.queueCursorEntryId).toBe(before.queueCursorEntryId);
    expect(session.state.activeProfile).toEqual(before.activeProfile);
    expect(session.state.preferences).toEqual(before.preferences);
    expect(session.state.player.playbackId).not.toBe(playbackId);
    expect(session.state.presentationId).toBe(before.presentationId);
    expect(JSON.stringify(session.state)).not.toContain("secret");
    expect(JSON.stringify(session.state)).not.toContain("stream.example");
    session.observe({ ...before.player, position: 99 });
    expect(session.state.player.status).toBe("loading");
  } finally { session.close(); store.close(); }
});

test("pause intent received during quality resolution wins over an older native observation", async () => {
  const { store, session, commands, requests, playbackId } = fixture();
  try {
    const result = session.command({ type: "videoQuality", playbackId, quality: "480p" });
    session.command({ type: "pause", playbackId, paused: true });
    requests[0]!.result.resolve({ source: "https://stream.example/new" });
    await result;
    expect(commands.at(-1)).toMatchObject({ type: "load", paused: true, startPosition: 40 });
  } finally { session.close(); store.close(); }
});

test("live video quality reloads without a VOD seek", async () => {
  const { store, session, commands, requests, playbackId } = fixture({ live: true }, { seekable: false, position: 900 });
  try {
    const result = session.command({ type: "videoQuality", playbackId, quality: "best" });
    requests[0]!.result.resolve({ source: "https://stream.example/live", startPosition: 42, metadata: { live: true } });
    await result;
    expect(commands.at(-1)).toMatchObject({ type: "load", paused: false });
    expect(commands.at(-1)).not.toHaveProperty("startPosition");
  } finally { session.close(); store.close(); }
});

for (const control of ["stop", "next", "play", "reserve"] as const) test(`a newer ${control} cancels quality resolution without replay or queue mutation`, async () => {
  const { store, session, commands, requests, playbackId } = fixture();
  try {
    const result = Promise.resolve(session.command({ type: "videoQuality", playbackId, quality: "720p" })).catch(error => error);
    if (control === "reserve") session.reservePlay();
    else session.command(control === "stop" ? { type: "stop" } : control === "next" ? { type: "next", playbackId } : { type: "play", entryId: "two" });
    expect(requests[0]!.signal.aborted).toBe(true);
    const before = session.state;
    const count = commands.length;
    requests[0]!.result.resolve({ source: "https://stream.example/stale" });
    expect(await result).toBeInstanceOf(Error);
    expect(session.state).toEqual(before);
    expect(commands).toHaveLength(count);
  } finally { session.close(); store.close(); }
});

test("a newer quality choice supersedes the older resolution", async () => {
  const { store, session, commands, requests, playbackId } = fixture();
  try {
    const old = Promise.resolve(session.command({ type: "videoQuality", playbackId, quality: "480p" })).catch(error => error);
    const fresh = session.command({ type: "videoQuality", playbackId, quality: "1080p" });
    expect(requests[0]!.signal.aborted).toBe(true);
    requests[1]!.result.resolve({ source: "https://stream.example/new" });
    await fresh;
    requests[0]!.result.resolve({ source: "https://stream.example/old" });
    expect(await old).toBeInstanceOf(Error);
    expect(commands).toHaveLength(1);
    expect(session.state.queue[0]!.quality).toBe("1080p");
  } finally { session.close(); store.close(); }
});

for (const failure of ["resolver", "authority"] as const) test(`${failure} failure keeps the original quality and playback`, async () => {
  const { store, session, commands, requests, playbackId } = fixture();
  try {
    let allowed = true;
    const before = session.state;
    const result = Promise.resolve(session.command({ type: "videoQuality", playbackId, quality: "720p" }, () => { if (!allowed) throw new Error("Revoked"); })).catch(error => error);
    if (failure === "resolver") requests[0]!.result.reject(new Error("Unavailable format"));
    else { allowed = false; requests[0]!.result.resolve({ source: "https://stream.example/private" }); }
    expect(await result).toBeInstanceOf(Error);
    expect(commands).toEqual([]);
    expect(session.state).toEqual(before);
  } finally { session.close(); store.close(); }
});

test("quality rejects stale playback, radio, music and VOD without seeking", async () => {
  for (const changes of [{ source: "radio:one", live: true }, { source: "web:https://artist.bandcamp.com/track/one" }, { source: "web:https://media.example/one.mp3" }, {}]) {
    const { store, session, requests, playbackId } = fixture(changes, { seekable: false });
    try {
      await expect(Promise.resolve(session.command({ type: "videoQuality", playbackId, quality: "720p" }))).rejects.toThrow("cannot be changed");
      await expect(Promise.resolve(session.command({ type: "videoQuality", playbackId: "stale", quality: "720p" }))).rejects.toThrow("changed");
      expect(requests).toEqual([]);
    } finally { session.close(); store.close(); }
  }
});

for (const target of [15, 130, 900]) test(`quality honors an unobserved seek to ${target} instead of the older position`, async () => {
  const { store, session, commands, requests, playbackId } = fixture();
  try {
    const result = session.command({ type: "videoQuality", playbackId, quality: "720p" });
    session.command({ type: "seek", playbackId, position: target });
    expect(session.state.player.position).toBe(40);
    requests[0]!.result.resolve({ source: "https://stream.example/new" });
    await result;
    expect(commands.at(-1)).toMatchObject({ type: "load", startPosition: Math.min(target, 200), paused: false });
  } finally { session.close(); store.close(); }
});

test("quality uses newer progress once native playback confirms the pending seek", async () => {
  const { store, session, commands, requests, playbackId } = fixture();
  try {
    session.command({ type: "seek", playbackId, position: 120 });
    const result = session.command({ type: "videoQuality", playbackId, quality: "720p" });
    session.observe({ ...session.state.player, position: 120 });
    session.observe({ ...session.state.player, position: 124 });
    requests[0]!.result.resolve({ source: "https://stream.example/new" });
    await result;
    expect(commands.at(-1)).toMatchObject({ type: "load", startPosition: 124 });
  } finally { session.close(); store.close(); }
});

test("an explicit replay starts a new presentation even when the queue entry is unchanged", () => {
  const { store, session } = fixture();
  try {
    const before = session.state;
    session.command({ type: "play", entryId: "one", fromStart: true });
    expect(session.state.currentEntryId).toBe(before.currentEntryId);
    expect(session.state.presentationId).toBe(session.state.player.playbackId);
    expect(session.state.presentationId).not.toBe(before.presentationId);
    session.command({ type: "stop" });
    expect(session.state.presentationId).toBeNull();
  } finally { session.close(); store.close(); }
});


test("history follows a quality replacement and ignores observations from the retired transport", async () => {
  const { store, session, requests, playbackId } = fixture();
  try {
    const mediaId = playbackMediaId(session.state.queue[0]!)!;
    const result = session.command({ type: "videoQuality", playbackId, quality: "720p" });
    requests[0]!.result.resolve({ source: "https://stream.example/new" });
    await result;
    const replacement = session.state.player.playbackId!;
    session.observe({ ...idle, playbackId: replacement, status: "playing", position: 60, duration: 200, seekable: true });
    session.observe({ ...idle, playbackId, status: "playing", position: 99, duration: 200, seekable: true });
    session.command({ type: "stop" });
    expect(store.progress("household", mediaId)?.position).toBe(60);
    expect(store.historySource(mediaId)).toMatchObject({ id: "one", quality: "720p" });
  } finally { session.close(); store.close(); }
});

for (const outcome of ["failed", "canceled", "loading"] as const) test(`history retains observed progress when quality is ${outcome}`, async () => {
  const { store, session, requests, playbackId } = fixture();
  try {
    const mediaId = playbackMediaId(session.state.queue[0]!)!;
    const result = Promise.resolve(session.command({ type: "videoQuality", playbackId, quality: "720p" })).catch(error => error);
    session.observe({ ...session.state.player, position: 55 });
    if (outcome === "canceled") session.command({ type: "stop" });
    if (outcome === "failed") requests[0]!.result.reject(new Error("Format unavailable"));
    else requests[0]!.result.resolve({ source: "https://stream.example/new" });
    await result;
    if (outcome === "failed") session.observe({ ...session.state.player, position: 65 });
    session.command({ type: "stop" });
    expect(store.progress("household", mediaId)?.position).toBe(outcome === "failed" ? 65 : 55);
    expect(store.historySource(mediaId)?.quality).toBe(outcome === "loading" ? "720p" : undefined);
  } finally { session.close(); store.close(); }
});
