import { afterEach, expect, test } from "bun:test";
import { createPlaybackTargetRegistry } from "./playback-targets";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import type { PlaybackCommand, PlaybackTarget, PlayerState } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 70, seekable: false, error: null };
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function player() {
  let state = { ...idle }, observe = (_state: PlayerState) => {};
  const peer = {
    commands: [] as PlaybackCommand[], loadState: {} as Partial<PlayerState>, holdStop: false, refuseStart: false,
    get state() { return state; },
    connect(callback: typeof observe) { observe = callback; },
    report(next: Partial<PlayerState>) { state = { ...state, ...next }; observe(state); },
    send(command: PlaybackCommand) {
      peer.commands.push(command);
      if (command.type === "load") state = { ...idle, playbackId: command.playbackId, status: command.paused ? "paused" : "playing", duration: 120, seekable: true, position: command.startPosition ?? 0, ...peer.loadState };
      else if (command.type === "pause") state = { ...state, status: !command.paused && peer.refuseStart ? "error" : command.paused ? "paused" : "playing" };
      else if (command.type === "seek") state = { ...state, position: command.position };
      else if (command.type === "stop") { if (peer.holdStop) return; state = { ...idle }; }
      else return;
      const snapshot = { ...state }; queueMicrotask(() => observe(snapshot));
    },
  };
  return peer;
}
function fixture(options: { recoveringReceiver?: boolean; recoveringGroup?: boolean; now?: () => number } = {}) {
  const native = player();
  const registry = createPlaybackTargetRegistry(native.send, { timeout: 40, ...options });
  native.connect(registry.observeNative); registry.observeNative(idle);
  const sessions: ReturnType<typeof createSession>[] = [], stores: ReturnType<typeof openStore>[] = [];
  cleanup.push(() => { registry.close(); for (const session of sessions) session.close(); for (const store of stores) store.close(); });
  const bind = (id: string, defaultNative = false, resolveSource?: () => MediaSource | Promise<MediaSource>) => {
    const store = openStore(":memory:"); stores.push(store);
    const targets = registry.bind(id, () => session, { defaultNative, kind: defaultNative ? "household" : "personal" });
    const session = createSession(store, targets.send, () => {}, { resolveSource, transferBusy: () => targets.busy, nativeTarget: () => targets.nativeAssigned });
    sessions.push(session); targets.publish(); return { targets, session };
  };
  const browser = () => { const peer = player(), endpoint = registry.register("Browser", peer.send); peer.connect(endpoint.observe); return { peer, endpoint }; };
  return { registry, native, bind, browser };
}
async function play(session: ReturnType<typeof createSession>, id: string) {
  session.command({ type: "enqueue", entry: { id, title: `Private ${id}`, source: `https://example.org/${id}.mp4` }, playNow: true });
  await Bun.sleep(0);
}

test("personal bindings start unassigned and independent observations and close never touch household playback", async () => {
  const f = fixture(), household = f.bind("household", true), personal = f.bind("secret-personal-id"), browser = f.browser();
  expect(personal.session.state.targetId).toBeUndefined();
  expect(personal.session.state.targets?.find(target => target.id === "native")).toMatchObject({ occupied: true, sessionKind: "household" });
  await expect(personal.targets.move("native")).rejects.toThrow("occupied");
  await personal.targets.move(browser.endpoint.id);
  await play(household.session, "household-item"); await play(personal.session, "personal-item");
  f.native.report({ position: 11 }); browser.peer.report({ position: 42 });
  expect(household.session.state.player.position).toBe(11); expect(personal.session.state.player.position).toBe(42);
  browser.endpoint.observe({ ...browser.peer.state, playbackId: f.native.state.playbackId, position: 99 });
  expect(household.session.state.player.position).toBe(11); expect(personal.session.state.player.position).toBe(42);
  expect(JSON.stringify(household.session.state.targets)).not.toContain("secret-personal-id");
  expect(JSON.stringify(household.session.state.targets)).not.toContain("personal-item");
  const nativeCommands = f.native.commands.length;
  await personal.targets.close();
  expect(f.native.commands).toHaveLength(nativeCommands); expect(household.session.state.player.status).toBe("playing");
  expect(f.registry.targets.find(target => target.id === browser.endpoint.id)).not.toMatchObject({ occupied: true });
});

test("global reservation precedes asynchronous preparation and retains both source owners", async () => {
  const f = fixture(), gate = Promise.withResolvers<MediaSource>(); let preparing = false;
  const first = f.bind("first", true, () => preparing ? gate.promise : { source: "https://example.org/first.mp4" });
  const second = f.bind("second"), browser = f.browser(), destination = f.browser();
  await second.targets.move(browser.endpoint.id); await play(first.session, "first"); await play(second.session, "second");
  preparing = true;
  const moved = first.targets.move(destination.endpoint.id);
  expect(first.targets.busy).toBe(true);
  await expect(second.targets.move(destination.endpoint.id)).rejects.toThrow("occupied");
  await expect(second.targets.move("native", undefined, { takeover: true })).rejects.toThrow("pending operation");
  expect(f.native.state.status).toBe("playing"); expect(browser.peer.state.status).toBe("playing");
  gate.resolve({ source: "https://example.org/first.mp4" }); await moved;
  expect(first.session.state.targetId).toBe(destination.endpoint.id); expect(second.session.state.targetId).toBe(browser.endpoint.id);
  expect(f.registry.targets.find(target => target.id === "native")).not.toMatchObject({ occupied: true });
});

test("failed destination start rolls back only its session and releases the confirmed silent reservation", async () => {
  const f = fixture(), first = f.bind("first", true), second = f.bind("second"), own = f.browser(), destination = f.browser();
  await second.targets.move(own.endpoint.id); await play(first.session, "first"); await play(second.session, "second");
  f.native.report({ position: 31 }); own.peer.report({ position: 61 }); destination.peer.refuseStart = true;
  await expect(first.targets.move(destination.endpoint.id)).rejects.toThrow();
  expect(first.session.state.player).toMatchObject({ status: "playing", position: 31 });
  expect(second.session.state.player).toMatchObject({ status: "playing", position: 61 });
  destination.peer.refuseStart = false; await second.targets.move(destination.endpoint.id);
  expect(second.session.state.player).toMatchObject({ status: "playing", position: 61 });
  expect(first.targets.owns("native")).toBe(true);
});

test("explicit takeover waits for silence and cancels the old session before granting the output", async () => {
  const f = fixture(), first = f.bind("first", true), second = f.bind("second");
  await play(first.session, "private-first"); f.native.holdStop = true;
  const takeover = second.targets.move("native", undefined, { takeover: true });
  await Bun.sleep(0);
  expect(first.session.state.currentEntryId).toBeNull(); expect(second.session.state.targetId).toBeUndefined();
  expect(first.targets.owns("native")).toBe(true);
  expect(() => second.session.command({ type: "enqueue", entry: { id: "second", title: "Second", source: "https://example.org/second.mp4" }, playNow: true })).toThrow();
  f.native.holdStop = false; f.native.report(idle); await takeover;
  expect(first.session.state.targetId).toBeUndefined(); expect(first.session.state.queue).toHaveLength(1);
  await play(second.session, "second"); expect(second.session.state.player.status).toBe("playing");
  expect(first.session.state.currentEntryId).toBeNull(); expect(first.session.state.player.playbackId).toBeNull();
});

test("an uncertain takeover retains the old claim and a late resolver cannot restart it", async () => {
  const f = fixture(), gate = Promise.withResolvers<MediaSource>();
  const first = f.bind("first", true, () => gate.promise), second = f.bind("second");
  await play(first.session, "pending"); f.native.holdStop = true;
  await expect(second.targets.move("native", undefined, { takeover: true })).rejects.toThrow("confirm readiness");
  expect(first.targets.owns("native")).toBe(true); expect(second.session.state.targetId).toBeUndefined();
  gate.resolve({ source: "https://example.org/obsolete.mp4" }); await Bun.sleep(0);
  expect(f.native.commands.some(command => command.type === "load")).toBe(false);
  f.native.holdStop = false; await second.targets.move("native", undefined, { takeover: true });
  expect(second.targets.owns("native")).toBe(true);
});

test("closing a binding during source preparation cannot load or reclaim a destination now owned by another session", async () => {
  const f = fixture(), gate = Promise.withResolvers<MediaSource>(); let preparing = false;
  const first = f.bind("first", true, () => preparing ? gate.promise : { source: "https://example.org/first.mp4" });
  const second = f.bind("second"), destination = f.browser();
  await play(first.session, "first"); preparing = true;
  const move = first.targets.move(destination.endpoint.id).catch(error => error as Error);
  await first.targets.close(); await second.targets.move(destination.endpoint.id); await play(second.session, "second");
  const commands = destination.peer.commands.length;
  gate.resolve({ source: "https://example.org/obsolete.mp4" });
  expect(await move).toBeInstanceOf(Error);
  expect(destination.peer.commands).toHaveLength(commands);
  expect(second.targets.owns(destination.endpoint.id)).toBe(true);
  expect(second.session.state.player.status).toBe("playing");
});

test("receiver leases and restart fences are global while unrelated session playback remains independent", async () => {
  let now = 0; const f = fixture({ now: () => now, recoveringReceiver: true });
  const first = f.bind("first"), second = f.bind("second"), browser = f.browser(), receiver = player();
  const registration = f.registry.registerReceiver("paired", "Receiver", receiver.send, () => {}, () => {}); receiver.connect(registration.observe);
  await expect(second.targets.move(browser.endpoint.id)).rejects.toThrow("stopping");
  now = 12_500; await first.targets.move(registration.id); await second.targets.move(browser.endpoint.id);
  await play(first.session, "first"); await play(second.session, "second"); registration.renew(); registration.close();
  expect(first.session.state.player.status).toBe("unavailable"); expect(second.session.state.player.status).toBe("playing");
  const destination = f.browser(); await expect(first.targets.move(destination.endpoint.id)).rejects.toThrow("stopping");
  now += 12_500; await first.targets.move(destination.endpoint.id);
  expect(second.session.state.player.status).toBe("playing");
});

test("only canonical members within the same backend conflict, and group mutations check prospective membership", async () => {
  const f = fixture(), first = f.bind("first"), second = f.bind("second");
  const member = (id: string, joined = true) => ({ id, name: id, joined, connected: true, volume: 100, muted: false });
  const group = (id: string, members: ReturnType<typeof member>[]) => {
    const peer = player(), target: PlaybackTarget = { id, name: id, kind: "group", backend: "sendspin", connected: true, handoffSafety: "buffer-drain", members };
    const registration = f.registry.registerGroup(target, peer.send); peer.connect(registration.observe); return target;
  };
  group("one", [member("speaker")]); group("two", [member("native"), member("speaker", false)]); group("overlap", [member("speaker")]);
  await first.targets.move("one"); await second.targets.move("two");
  expect(() => second.targets.assertAvailable("two")).not.toThrow();
  expect(() => second.targets.assertAvailable("two", ["native", "speaker"])).toThrow("occupied");
  await expect(second.targets.move("overlap")).rejects.toThrow("occupied");
  const third = f.bind("third"); await third.targets.move("native");
  expect(third.targets.nativeAssigned).toBe(true);
});

test("unverified outputs allow idle selection but cannot participate in active transfer or takeover", async () => {
  const f = fixture(), first = f.bind("first"), second = f.bind("second"), peer = player(), browser = f.browser();
  const target = { id: "unverified", name: "Unverified output", kind: "group", backend: "sendspin", connected: true, handoffSafety: "unverified" } as unknown as PlaybackTarget;
  const registration = f.registry.registerGroup(target, peer.send); peer.connect(registration.observe);
  await first.targets.move(target.id); await play(first.session, "first");
  await expect(first.targets.move(browser.endpoint.id)).rejects.toThrow("cannot confirm silence");
  await expect(second.targets.move(target.id, undefined, { takeover: true })).rejects.toThrow("cannot confirm silence");
  expect(first.session.state.player.status).toBe("playing"); expect(peer.commands.filter(command => command.type === "stop")).toHaveLength(0);
});

test("group controls reserve current and proposed speakers until the async operation settles", async () => {
  const f = fixture(), first = f.bind("first"), second = f.bind("second");
  const member = (id: string, joined: boolean) => ({ id, name: id, joined, connected: true, volume: 100, muted: false });
  for (const [id, members] of [["changing", [member("old", true), member("new", false)]], ["old-group", [member("old", true)]], ["new-group", [member("new", true)]]] as const) {
    const peer = player();
    const registration = f.registry.registerGroup({ id, name: id, kind: "group", backend: "sendspin", connected: true, members: [...members] }, peer.send);
    peer.connect(registration.observe);
  }
  const gate = Promise.withResolvers<number>();
  const operation = first.targets.control("changing", () => gate.promise, ["new"]);
  expect(first.targets.busy).toBe(true);
  await expect(second.targets.move("new-group")).rejects.toThrow("occupied");
  await expect(second.targets.move("old-group", undefined, { takeover: true })).rejects.toThrow("pending operation");
  await expect(second.targets.control("changing", () => {})).rejects.toThrow("occupied");
  await expect(first.targets.move("native")).rejects.toThrow("Wait");
  gate.resolve(42); expect(await operation).toBe(42);
  expect(first.targets.busy).toBe(false);
  await second.targets.move("new-group");
  expect(second.targets.owns("new-group")).toBe(true);
  await expect(first.targets.control("changing", () => Promise.reject(new Error("RPC failed")))).rejects.toThrow("RPC failed");
  await second.targets.move("old-group");
  expect(second.targets.owns("old-group")).toBe(true);
});

test("closing a browser releases its obsolete claim while retaining the owner's resumable timeline", async () => {
  const f = fixture(), first = f.bind("first"), browser = f.browser();
  await first.targets.move(browser.endpoint.id); await play(first.session, "first");
  browser.endpoint.close();
  expect(first.targets.owns(browser.endpoint.id)).toBe(false);
  expect(first.session.state.player.status).toBe("unavailable");
  expect(first.session.state.currentEntryId).not.toBeNull();
  await first.targets.close();
  expect(f.registry.targets.some(target => target.id === browser.endpoint.id)).toBe(false);
});

for (const [recoveringReceiver, fence] of [[false, 1000], [true, 12_500]] as const) {
  test(`recovery waits for the longest enabled fence (${recoveringReceiver})`, async () => {
    let now = 50;
    const f = fixture({ recoveringReceiver, recoveringGroup: true, now: () => now });
    const session = f.bind("personal"), browser = f.browser();
    now += fence - 1;
    await expect(session.targets.move(browser.endpoint.id)).rejects.toThrow("stopping");
    now += 1;
    await session.targets.move(browser.endpoint.id);
    expect(session.targets.owns(browser.endpoint.id)).toBe(true);
  });
}

test("source invalidation during destination retirement cannot restore or resume the old delivery", async () => {
  const f = fixture(), first = f.bind("first", true), destination = f.browser();
  await play(first.session, "first");
  destination.peer.refuseStart = true; destination.peer.holdStop = true;
  let authorized = true;
  const moving = first.targets.move(destination.endpoint.id, () => { if (!authorized) throw new Error("Source configuration changed"); }).catch(error => error as Error);
  await Bun.sleep(0);
  expect(destination.peer.commands.some(command => command.type === "stop")).toBe(true);
  expect(f.native.state.status).toBe("paused");
  authorized = false;
  destination.peer.holdStop = false; destination.peer.report(idle);
  expect((await moving)?.message).toBe("Source configuration changed");
  expect(f.native.commands.some(command => command.type === "pause" && command.paused === false)).toBe(false);
  expect(f.native.state.status).toBe("idle");
  expect(first.session.state.targetId).toBe(destination.endpoint.id);
  expect(first.session.state.player.playbackId).not.toBe(f.native.commands.find(command => command.type === "load")?.playbackId);
  expect(first.targets.owns("native")).toBe(false);
});

for (const [position, sourceRange, destinationRange, expected] of [
  [33.53, { start: 20, end: 38.53 }, { start: 0, end: 10 }, 5],
  [20, { start: 20, end: 40 }, { start: 5, end: 10 }, 5],
  [42, { start: 20, end: 40 }, { start: 0, end: 10 }, 10],
  [33.53, undefined, { start: 0, end: 10 }, undefined],
  [33.53, { start: 20, end: 40 }, undefined, undefined],
  [33.53, { start: 20, end: 40 }, { start: 10, end: 0 }, undefined],
] as const) {
  test(`live handoff maps offset into destination window (${position}, ${JSON.stringify(destinationRange)}, ${expected})`, async () => {
    const f = fixture(), first = f.bind("first", true), destination = f.browser();
    await play(first.session, "live");
    f.native.report({ live: true, position, seekRange: sourceRange });
    destination.peer.loadState = { live: true, position: 10, seekRange: destinationRange };
    await first.targets.move(destination.endpoint.id);
    const seeks = destination.peer.commands.filter(command => command.type === "seek");
    expect(seeks).toEqual(expected === undefined ? [] : [{ type: "seek", playbackId: destination.peer.state.playbackId!, position: expected }]);
    expect(first.session.state.player.status).toBe("playing");
    expect(first.session.state.player.position).toBe(expected ?? 10);
  });
}
