import { expect, test } from "bun:test";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import type { Action, PlaybackCommand, PlayerState } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
function fixture() {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const pending = Promise.withResolvers<MediaSource | null>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const source: MediaSource = { source: "https://private.example/old?token=secret", metadata: { title: "Original", duration: 120 }, expiry: { at: 1, recover: cancellation => { calls++; signal = cancellation; return pending.promise; } } };
  const session = createSession(store, command => commands.push(command), () => {}, { resolveSource: () => source });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "web:https://artist.bandcamp.com/track/one", quality: "480p", automaticTitle: true } });
  session.command({ type: "enqueue", entry: { id: "two", title: "Two", source: "https://media.example/two" } });
  session.command({ type: "play", entryId: "one" });
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "paused", position: 47.25, duration: 120, seekable: true, speed: 1.25, replayGain: "track" });
  const fail = () => session.observe({ ...idle, playbackId, status: "error", error: "Native transport failed" });
  const fresh: MediaSource = { ...source, source: "https://private.example/new?token=new-secret", metadata: { title: "Changed", duration: 120 } };
  return { store, session, commands, pending, fail, fresh, playbackId, calls: () => calls, signal: () => signal };
}

test("one private recovery preserves observed position, settings, queue metadata and paused choice", async () => {
  const f = fixture();
  const queue = f.session.state.queue;
  f.fail();
  f.fail();
  await Bun.sleep(0);
  expect(f.calls()).toBe(1);
  expect(f.session.state.webRetry).toEqual({ paused: true });
  f.pending.resolve(f.fresh);
  await Bun.sleep(0);
  expect(f.commands.at(-1)).toMatchObject({ type: "load", source: f.fresh.source, startPosition: 47.25, paused: true, preferences: { speed: 1.25, replayGain: "track", audioDelay: 0 } });
  expect(f.commands.at(-1)).not.toHaveProperty("expiry");
  expect(f.commands.at(-1)).not.toHaveProperty("metadata");
  expect(f.session.state.queue).toEqual(queue);
  expect(JSON.stringify(f.session.state)).not.toContain("secret");
  const playbackId = f.session.state.player.playbackId;
  f.session.observe({ ...idle, playbackId, status: "playing", position: 50 });
  f.session.observe({ ...idle, playbackId, status: "error", error: "Second failure" });
  await Bun.sleep(0);
  expect(f.calls()).toBe(1);
  expect(f.session.state.player.error).toContain("after one attempt");
  const restarted = createSession(f.store, () => {}, () => {});
  expect(restarted.state.currentEntryId).toBeNull();
  expect(restarted.state.webRetry).toBeUndefined();
  f.store.close();
});

for (const cancel of ["stop", "play", "next", "enqueue", "move", "remove", "loadQueue", "reserve", "close", "quiesce", "disconnect"] as const) {
  for (const reject of [false, true]) test(`${cancel} cancels a late recovery ${reject ? "failure" : "success"}`, async () => {
    const f = fixture();
    f.fail();
    await Bun.sleep(0);
    const playbackId = f.session.state.player.playbackId!;
    if (cancel === "loadQueue") f.session.loadQueue([{ id: "new", title: "New", source: "https://media.example/new" }], "append");
    else if (cancel === "reserve") f.session.reservePlay();
    else if (cancel === "close" || cancel === "quiesce") f.session[cancel]();
    else if (cancel === "disconnect") f.session.observe({ ...idle, status: "unavailable" });
    else {
      const actions: Record<string, Action> = {
        stop: { type: "stop" }, play: { type: "play", entryId: "two" }, next: { type: "next", playbackId },
        enqueue: { type: "enqueue", entry: { id: "new", title: "New", source: "https://media.example/new" } },
        move: { type: "move", entryId: "two", beforeEntryId: "one" }, remove: { type: "remove", entryId: "two" },
      };
      f.session.command(actions[cancel]!);
    }
    const commands = structuredClone(f.commands);
    const state = f.session.state;
    expect(f.signal()?.aborted).toBe(true);
    if (reject) f.pending.reject(new Error("Late failure")); else f.pending.resolve(f.fresh);
    await Bun.sleep(0);
    expect(f.commands).toEqual(commands);
    expect(f.session.state).toEqual(state);
    f.store.close();
  });
}

test("new pause intent before or during recovery controls the replacement load", async () => {
  for (const during of [false, true]) {
    const f = fixture();
    if (!during) f.session.command({ type: "pause", playbackId: f.playbackId, paused: false });
    f.fail();
    if (during) f.session.command({ type: "pause", playbackId: f.session.state.player.playbackId!, paused: false });
    f.pending.resolve(f.fresh);
    await Bun.sleep(0);
    expect(f.commands.at(-1)).toMatchObject({ type: "load", paused: false });
    f.store.close();
  }
});

test("a rejected queue write or stale command does not cancel recovery", async () => {
  const f = fixture();
  f.fail();
  await Bun.sleep(0);
  expect(() => f.session.command({ type: "remove", entryId: "missing" })).toThrow();
  expect(() => f.session.command({ type: "pause", playbackId: "stale", paused: false })).toThrow();
  f.store.close();
  expect(() => f.session.command({ type: "move", entryId: "two", beforeEntryId: "one" })).toThrow();
  expect(f.signal()?.aborted).toBe(false);
  f.pending.resolve(f.fresh);
  await Bun.sleep(0);
  expect(f.commands.at(-1)).toMatchObject({ type: "load", paused: true });
});

test("unconfirmed expiry remains terminal without a replacement load", async () => {
  const f = fixture();
  f.fail();
  f.pending.resolve(null);
  await Bun.sleep(0);
  expect(f.commands.filter(command => command.type === "load")).toHaveLength(1);
  expect(f.session.state.player.status).toBe("error");
  expect(f.session.state.webRetry).toBeNull();
  f.store.close();
});

test("recovery controls reflect both pause choices while the replacement native load settles", async () => {
  const f = fixture();
  f.fail();
  f.pending.resolve(f.fresh);
  await Bun.sleep(0);
  const playbackId = f.session.state.player.playbackId!;
  for (const paused of [false, true]) {
    f.session.command({ type: "pause", playbackId, paused });
    expect(f.session.state.webRetry).toEqual({ paused });
    expect(f.commands.at(-1)).toEqual({ type: "pause", playbackId, paused });
  }
  f.store.close();
});

test("a premature native EOF confirms expiry before retrying, while normal EOF advances the queue", async () => {
  for (const premature of [false, true]) {
    const f = fixture();
    f.session.observe({ ...idle, playbackId: f.playbackId, status: "ended", duration: 120, position: premature ? 47.25 : 120 });
    await Bun.sleep(0);
    expect(f.calls()).toBe(premature ? 1 : 0);
    if (premature) {
      f.pending.resolve(f.fresh);
      await Bun.sleep(0);
      f.session.observe({ ...idle, playbackId: f.session.state.player.playbackId, status: "ended", duration: 120, position: 50 });
      expect(f.session.state.player.status).toBe("error");
      expect(f.session.state.player.error).toContain("after one attempt");
      expect(f.session.state.currentEntryId).toBe("one");
    } else expect(f.session.state.currentEntryId).toBe("two");
    f.store.close();
  }
});
