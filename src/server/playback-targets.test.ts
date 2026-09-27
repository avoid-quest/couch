import { afterEach, expect, test } from "bun:test";
import { createPlaybackTargets } from "./playback-targets";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { playbackMediaId } from "./progress";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 75, seekable: false, error: null };
function player(volume: number) {
  let state = { ...idle, volume };
  let observe = (_state: PlayerState) => {};
  const commands: PlaybackCommand[] = [];
  const peer = {
    commands, deduplicate: false, refuse: false, silentStop: false, onLoad: () => {},
    get state() { return state; },
    report(next: Partial<PlayerState>) { state = { ...state, ...next }; observe(state); },
    connect(callback: typeof observe) { observe = callback; },
    send(command: PlaybackCommand) {
      const previous = JSON.stringify(state);
      commands.push(command);
      if (command.type === "load") { peer.onLoad(); state = { ...idle, volume: state.volume, playbackId: command.playbackId, status: peer.refuse ? "error" : command.paused ? "paused" : "playing", position: command.startPosition ?? 0, duration: 120, seekable: true, speed: command.preferences?.speed ?? 1, error: peer.refuse ? "Refused" : null }; }
      else if (command.type === "pause") state = { ...state, status: command.paused ? "paused" : "playing" };
      else if (command.type === "seek") state = { ...state, position: command.position };
      else if (command.type === "stop") { if (peer.silentStop) return; state = { ...idle, volume: state.volume }; }
      else if (command.type === "volume") state = { ...state, volume: command.volume };
      else return;
      if (!peer.deduplicate || previous !== JSON.stringify(state)) queueMicrotask(() => observe({ ...state }));
    },
  };
  return peer;
}
function fixture(resolveSource?: () => MediaSource | Promise<MediaSource>) {
  const store = openStore(":memory:");
  const native = player(75), browser = player(23);
  const targets = createPlaybackTargets(native.send, () => session, { timeout: 50, observeNative: () => queueMicrotask(() => targets.observeNative(native.state)) });
  const session = createSession(store, targets.send, () => {}, { resolveSource, transferBusy: () => targets.busy, nativeTarget: () => targets.nativeAssigned });
  native.connect(targets.observeNative); targets.observeNative(idle);
  const registration = targets.register("Laptop", browser.send); browser.connect(registration.observe);
  cleanups.push(() => { session.close(); store.close(); });
  return { store, native, browser, session, targets, registration };
}
async function start(f: ReturnType<typeof fixture>, status: "paused" | "playing" = "playing") {
  f.session.command({ type: "enqueue", entry: { id: "first", title: "Remote", source: "https://example.org/media.mp4" }, playNow: true });
  f.session.command({ type: "enqueue", entry: { id: "repeat", title: "Remote again", source: "https://example.org/media.mp4" } });
  await Bun.sleep(0);
  f.native.report({ position: 32, status, speed: 1.5 });
}

test.each(["playing", "paused"] as const)("handoff both directions preserves %s timeline, queue, speed, progress and destination volume", async status => {
  const f = fixture(); await start(f, status);
  const before = f.session.state;
  f.browser.onLoad = () => f.native.report({ position: 35 });
  await f.targets.move(f.registration.id);
  expect(f.session.state).toMatchObject({ sessionId: before.sessionId, currentEntryId: "first", targetId: f.registration.id, player: { status, position: 35, speed: 1.5, volume: 23 } });
  expect(f.session.state.queue).toEqual(before.queue);
  expect(f.session.state.player.playbackId).not.toBe(before.player.playbackId);
  f.targets.observeNative({ ...before.player, position: 110, status: "ended" });
  expect(f.session.state.currentEntryId).toBe("first");
  expect(f.session.state.player.position).toBe(35);
  f.browser.report({ position: 42 });
  await f.targets.move("native");
  expect(f.session.state.player).toMatchObject({ position: 42, status, speed: 1.5, volume: 80 });
  expect(f.browser.state.status).toBe("idle");
  f.session.checkpoint();
  expect(f.store.sharedProgress(playbackMediaId(before.queue[0]!)!)?.position).toBe(42);
});

test("destination refusal and incompatible access leave the source playing", async () => {
  const f = fixture(); await start(f);
  f.browser.refuse = true;
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("Refused");
  expect(f.native.state.status).toBe("playing");
  expect(f.session.state.targetId).toBe("native");
  const g = fixture(() => ({ source: "https://example.org/private.mp4", headers: { Authorization: "secret" } })); await start(g);
  await expect(g.targets.move(g.registration.id)).rejects.toThrow("media delivery");
  expect(g.browser.commands).toHaveLength(0);
  expect(g.native.state.status).toBe("playing");
});

test("disconnect retains resumable timeline, fences old browser, and never starts TV", async () => {
  const f = fixture(); await start(f); await f.targets.move(f.registration.id);
  f.browser.report({ position: 48 });
  f.registration.close();
  expect(f.session.state.player).toMatchObject({ status: "unavailable", position: 48 });
  f.registration.observe({ ...f.browser.state, position: 99, status: "ended" });
  expect(f.session.state.player.position).toBe(48);
  expect(f.native.state.status).toBe("idle");
  await f.targets.move("native");
  expect(f.session.state.player).toMatchObject({ status: "paused", position: 48 });
});

test("handoff rejects concurrent transfers and normal commands while preparing", async () => {
  const f = fixture(); await start(f);
  f.browser.connect(() => {});
  const transfer = f.targets.move(f.registration.id);
  await expect(f.targets.move("native")).rejects.toThrow("moving");
  expect(() => f.session.command({ type: "stop" })).toThrow("moving");
  await expect(transfer).rejects.toThrow("confirm readiness");
  expect(f.session.state.player.status).toBe("playing");
  expect(f.native.state.status).toBe("playing");
});

test("renderer presence changes preserve the in-progress handoff until it finishes", async () => {
  const f = fixture(); await start(f);
  f.browser.connect(() => {});
  const transfer = f.targets.move(f.registration.id);
  const other = f.targets.register("Another browser", () => {});
  expect(f.session.state.handoff).toEqual({ targetId: f.registration.id });
  other.close();
  expect(f.session.state.handoff).toEqual({ targetId: f.registration.id });
  await expect(transfer).rejects.toThrow("confirm readiness");
  expect(f.session.state.handoff).toBeNull();
});

test("semantic track incompatibility fails before pausing the source", async () => {
  const f = fixture(); await start(f);
  f.native.report({ tracks: [{ id: "sub", index: 3, kind: "subtitle", label: "English", language: "en", selected: true }] });
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("subtitle track");
  expect(f.native.state.status).toBe("playing");
  expect(f.browser.state.status).toBe("idle");
});

test("a pending Play intent survives immediate handoff before its observation", async () => {
  const f = fixture(); await start(f, "paused");
  f.session.command({ type: "pause", playbackId: f.session.state.player.playbackId!, paused: false });
  await f.targets.move(f.registration.id);
  expect(f.session.state.player.status).toBe("playing");
});

test("destination loss after source pause never starts TV automatically", async () => {
  const f = fixture(); await start(f);
  // Close the destination on the observed checkpoint, before assignment/start.
  f.native.connect(state => { f.targets.observeNative(state); if (state.status === "paused") f.registration.close(); });
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("disconnected");
  expect(f.native.state.status).toBe("paused");
  expect(f.session.state.queue).toHaveLength(2);
  expect(f.native.commands.filter(command => command.type === "pause" && !command.paused)).toHaveLength(0);
});

test("shutdown cancels a prepared handoff and ignores late readiness", async () => {
  const f = fixture(); await start(f);
  f.browser.connect(() => {});
  const transfer = f.targets.move(f.registration.id);
  await Bun.sleep(0);
  f.targets.close();
  await expect(transfer).rejects.toThrow("shutting down");
  expect(f.targets.busy).toBe(false);
  expect(f.native.commands.at(-1)?.type).toBe("stop");
});

test("autoplay refusal keeps the destination paused for a local click and releases the source", async () => {
  const f = fixture(); await start(f);
  f.browser.connect(state => f.registration.observe(state.status === "playing" ? { ...state, status: "paused", requiresGesture: true, error: "Playback needs a click. Press Play here on this browser." } : state));
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("needs a click");
  expect(f.session.state).toMatchObject({ targetId: f.registration.id, player: { status: "paused" } });
  expect(f.native.state.status).toBe("idle");
  f.browser.connect(f.registration.observe);
  f.browser.report({ status: "playing", error: null });
  expect(f.session.state.player.status).toBe("playing");
});

test("an already-paused native source confirms a fresh checkpoint even when it suppresses unchanged snapshots", async () => {
  const f = fixture(); await start(f, "paused"); f.native.deduplicate = true;
  await f.targets.move(f.registration.id);
  expect(f.session.state.player).toMatchObject({ status: "paused", position: 32 });
  await f.targets.move("native");
  expect(f.session.state.player).toMatchObject({ status: "paused", position: 32 });
});

test("unsupported browser calibration cannot overwrite the native device delay", async () => {
  const f = fixture(); await start(f); await f.targets.move(f.registration.id);
  const before = f.session.state.preferences;
  expect(() => f.session.command({ type: "audioDelay", playbackId: f.session.state.player.playbackId!, delay: 1 })).toThrow("not supported");
  expect(f.session.state.preferences).toEqual(before);
});

test("each committed handoff recovers its own fresh delivery, including the return trip", async () => {
  let delivery = 0;
  const recovered: number[] = [];
  const f = fixture(() => { const id = ++delivery; return { source: `https://example.org/media${id}.mp4`, expiry: { at: 0, recover: async () => { recovered.push(id); return { source: `https://example.org/recovered${id}.mp4` }; } } }; });
  await start(f);
  await f.targets.move(f.registration.id);
  const load = f.browser.commands.find(command => command.type === "load")!;
  expect(load).not.toHaveProperty("expiry");
  f.browser.report({ status: "error", error: "Expired" });
  await Bun.sleep(0);
  expect(recovered).toEqual([2]);
  await f.targets.move("native");
  f.native.report({ status: "error", error: "Expired" });
  await Bun.sleep(0);
  expect(recovered).toEqual([2, 3]);
});

test("failed destination start restores the source delivery recovery", async () => {
  let delivery = 0;
  const recovered: number[] = [];
  const f = fixture(() => { const id = ++delivery; return { source: `https://example.org/media${id}.mp4`, expiry: { at: 0, recover: async () => { recovered.push(id); return { source: `https://example.org/recovered${id}.mp4` }; } } }; });
  await start(f);
  f.browser.connect(state => f.registration.observe(state.status === "playing" ? { ...state, status: "error", error: "Start failed" } : state));
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("Start failed");
  expect(f.session.state.targetId).toBe("native");
  f.native.report({ status: "error", error: "Expired" });
  await Bun.sleep(0);
  expect(recovered).toEqual([1]);
});

test("video-only playback can move to browser and back without requiring an audio track", async () => {
  const f = fixture(); await start(f);
  const tracks: NonNullable<PlayerState["tracks"]> = [{ id: "video", kind: "video", index: 0, label: "Video", language: "", selected: true }];
  f.native.report({ tracks });
  f.browser.connect(state => f.registration.observe({ ...state, tracks }));
  f.native.connect(state => f.targets.observeNative({ ...state, tracks }));
  await f.targets.move(f.registration.id);
  await f.targets.move("native");
  expect(f.session.state).toMatchObject({ targetId: "native", player: { status: "playing", position: 32 } });
});

test("destination without an audio match cannot silently discard an explicit source choice", async () => {
  const f = fixture(); await start(f);
  f.native.report({ tracks: [{ id: "audio", kind: "audio", index: 1, label: "Italian", language: "it", selected: true }] });
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("selected audio track");
  expect(f.session.state.targetId).toBe("native");
  expect(f.native.state.status).toBe("playing");
});

test("rollback preserves an already-used source recovery allowance", async () => {
  let delivery = 0;
  const recovered: number[] = [];
  const f = fixture(() => { const id = ++delivery; return { source: `https://example.org/media${id}.mp4`, expiry: { at: 0, recover: async () => { recovered.push(id); return { source: `https://example.org/recovered${id}.mp4` }; } } }; });
  await start(f);
  f.native.report({ status: "error", error: "Expired" });
  await Bun.sleep(0);
  expect(recovered).toEqual([1]);
  f.browser.connect(state => f.registration.observe(state.status === "playing" ? { ...state, status: "error", error: "Start failed" } : state));
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("Start failed");
  f.native.report({ status: "error", error: "Expired again" });
  await Bun.sleep(0);
  expect(recovered).toEqual([1]);
  expect(f.session.state.player.error).toContain("after one attempt");
});


test("native sole audio track can move to a browser with unknown audio metadata", async () => {
  const f = fixture(); await start(f);
  f.native.report({ tracks: [{ id: "audio", kind: "audio", index: 1, label: "English", language: "en", selected: true }] });
  f.browser.connect(state => f.registration.observe({ ...state, tracks: [], audioTracksKnown: false }));
  await f.targets.move(f.registration.id);
  expect(f.session.state).toMatchObject({ targetId: f.registration.id, player: { status: "playing", tracks: [], audioTracksKnown: false } });
});

test("unknown browser audio metadata cannot preserve a selection among multiple source tracks", async () => {
  const f = fixture(); await start(f);
  f.native.report({ tracks: [
    { id: "en", kind: "audio", index: 1, label: "English", language: "en", selected: false },
    { id: "it", kind: "audio", index: 2, label: "Italian", language: "it", selected: true },
  ] });
  f.browser.connect(state => f.registration.observe({ ...state, tracks: [], audioTracksKnown: false }));
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("selected audio track");
  expect(f.native.state.status).toBe("playing");
});

test("known-empty browser audio metadata cannot preserve even a sole source audio track", async () => {
  const f = fixture(); await start(f);
  f.native.report({ tracks: [{ id: "audio", kind: "audio", index: 1, label: "English", language: "en", selected: true }] });
  f.browser.connect(state => f.registration.observe({ ...state, tracks: [], audioTracksKnown: true }));
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("selected audio track");
  expect(f.native.state.status).toBe("playing");
});
