import { afterEach, expect, test } from "bun:test";
import { createPlaybackTargetRegistry, createPlaybackTargets } from "./playback-targets";
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

test("a group control outage fences transfer until a fresh drained connection is ready", async () => {
  const f = fixture(); await start(f, "paused");
  const group = player(38);
  const target = { id: "sendspin-group", name: "Rooms", kind: "group" as const, backend: "sendspin" as const, connected: true, handoffSafety: "buffer-drain" as const };
  const registration = f.targets.registerGroup(target, group.send); group.connect(registration.observe);
  await f.targets.move(target.id);
  expect(f.session.state).toMatchObject({ targetId: target.id, player: { status: "paused", position: 32, volume: 38 } });
  expect(group.commands.find(command => command.type === "load")).toMatchObject({ duration: 120, paused: true });
  registration.update({ ...target, connected: false });
  group.report({ position: 90, status: "ended" });
  expect(f.session.state.player).toMatchObject({ status: "unavailable", position: 32 });
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("buffered output is uncertain");
  const before = group.commands.length;
  registration.update(target);
  registration.observe(idle);
  expect(f.session.state.player).toMatchObject({ status: "unavailable", position: 32 });
  expect(group.commands).toHaveLength(before);
  await f.targets.move(f.registration.id);
  expect(f.session.state).toMatchObject({ targetId: f.registration.id, player: { status: "paused", position: 32 } });
});

test("group handoff strips Core hardware settings and preserves sole unknown audio", async () => {
  const f = fixture(() => ({ source: "https://example.org/private.mp3", headers: { Authorization: "private" } }));
  await start(f);
  f.native.report({ tracks: [{ id: "a", kind: "audio", index: 1, label: "English", language: "eng", selected: true }] });
  const group = player(38);
  const registration = f.targets.registerGroup({ id: "rooms", name: "Rooms", kind: "group", backend: "sendspin", connected: true, handoffSafety: "buffer-drain" }, command => {
    group.send(command);
    if (command.type === "load") group.report({ audioTracksKnown: false, tracks: [] });
  });
  group.connect(registration.observe);
  await f.targets.move("rooms");
  expect(f.session.state.targetId).toBe("rooms");
  expect(group.commands.find(command => command.type === "load")).toMatchObject({ headers: { Authorization: "private" }, preferences: { audioDelay: 0 } });
  expect(f.native.state.status).toBe("idle");
});

test("Sendspin member claims overlap direct endpoints and proposed membership across sessions", async () => {
  const store = openStore(":memory:");
  const registry = createPlaybackTargetRegistry(undefined, { timeout: 500 });
  let firstSession!: ReturnType<typeof createSession>, secondSession!: ReturnType<typeof createSession>;
  const first = registry.bind("first", () => firstSession), second = registry.bind("second", () => secondSession);
  firstSession = createSession(store, first.send, () => {}, { nativeTarget: () => false });
  secondSession = createSession(store, second.send, () => {}, { nativeTarget: () => false });
  const direct = player(40), group = player(60);
  const directTarget = registry.register("Device", direct.send);
  direct.connect(directTarget.observe);
  const member = { id: "sendspin-client", deviceId: directTarget.id, name: "Device", connected: true, joined: false, volume: 80, muted: false };
  const groupTarget = { id: "sendspin-group", name: "Rooms", kind: "group" as const, backend: "sendspin" as const, connected: true, handoffSafety: "buffer-drain" as const, members: [member] };
  const groupRegistration = registry.registerGroup(groupTarget, group.send);
  group.connect(groupRegistration.observe);
  try {
    await first.move(directTarget.id);
    expect(() => second.assertAvailable(groupTarget.id, [member.id])).toThrow("occupied");
    await expect(second.control(groupTarget.id, async () => { throw new Error("backend reached"); }, [member.id])).rejects.toThrow("occupied");
    groupRegistration.update({ ...groupTarget, members: [{ ...member, joined: true }] });
    await expect(second.move(groupTarget.id)).rejects.toThrow("occupied");
    // The same session may move its direct output into a group containing that device.
    await first.move(groupTarget.id);
    expect(() => second.assertAvailable(directTarget.id)).toThrow("occupied");
  } finally { registry.close(); firstSession.close(); secondSession.close(); store.close(); }
});

test("a Sendspin move reserves its member's direct endpoint during paused preparation", async () => {
  const store = openStore(":memory:"), registry = createPlaybackTargetRegistry(undefined, { timeout: 500 });
  let firstSession!: ReturnType<typeof createSession>, secondSession!: ReturnType<typeof createSession>;
  const first = registry.bind("first", () => firstSession), second = registry.bind("second", () => secondSession);
  firstSession = createSession(store, first.send, () => {}, { nativeTarget: () => false });
  secondSession = createSession(store, second.send, () => {}, { nativeTarget: () => false });
  const source = player(40), direct = player(50), group = player(60);
  const sourceTarget = registry.register("Source", source.send), directTarget = registry.register("Member", direct.send);
  source.connect(sourceTarget.observe); direct.connect(directTarget.observe);
  let heldLoad: Extract<PlaybackCommand, { type: "load" }> | undefined;
  const registration = registry.registerGroup({ id: "sendspin-group", name: "Rooms", kind: "group", backend: "sendspin", connected: true, handoffSafety: "buffer-drain", members: [{ id: "client", deviceId: directTarget.id, name: "Member", connected: true, joined: true, volume: 50, muted: false }] }, command => { if (command.type === "load") heldLoad = command; else group.send(command); });
  group.connect(registration.observe);
  try {
    await first.move(sourceTarget.id);
    firstSession.command({ type: "enqueue", entry: { id: "song", title: "Song", source: "https://example.org/song.mp3" }, playNow: true });
    for (let i = 0; firstSession.state.player.status !== "playing" && i < 100; i++) await Bun.sleep(10);
    expect(firstSession.state.player.status).toBe("playing");
    const moving = first.move("sendspin-group");
    for (let i = 0; !heldLoad && i < 100; i++) await Bun.sleep(10);
    expect(heldLoad?.paused).toBe(true);
    expect(() => second.assertAvailable(directTarget.id)).toThrow("occupied");
    group.send(heldLoad!);
    await moving;
  } finally { registry.close(); firstSession.close(); secondSession.close(); store.close(); }
});

test("Core restart fences buffered output even if its backend is no longer configured", async () => {
  const store = openStore(":memory:");
  expect(store.bufferedOutputUsed()).toBe(false);
  store.markBufferedOutputUsed();
  expect(store.bufferedOutputUsed()).toBe(true);
  let now = 0;
  const targets = createPlaybackTargets(undefined, () => session, { recoveringGroup: store.bufferedOutputUsed(), now: () => now });
  const session = createSession(store, targets.send, () => {}, { nativeTarget: () => false });
  const browser = targets.register("Browser", () => {});
  try {
    await expect(targets.move(browser.id)).rejects.toThrow("stopping");
    now = 1000;
    await targets.move(browser.id);
    expect(session.state.targetId).toBe(browser.id);
  } finally { session.close(); targets.close(); store.close(); }
});

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
