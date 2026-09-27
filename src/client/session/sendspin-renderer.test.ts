import { expect, mock, test } from "bun:test";
import type { SendspinPlayerConfig } from "@sendspin/sendspin-js";
import { createSendspinRenderer } from "./sendspin-renderer";

function fixture() {
  const events: string[] = [];
  let config: SendspinPlayerConfig;
  let unlock = async () => {};
  let connect = async () => {};
  const player = {
    isConnected: false,
    unlock: mock(() => { events.push("unlock"); return unlock(); }),
    connect: mock(async () => { events.push("connect"); await connect(); player.isConnected = true; }),
    disconnect: mock(() => { events.push("disconnect"); player.isConnected = false; }),
    setVolume: mock((_value: number) => {}), setMuted: mock((_value: boolean) => {}),
    sendCommand: mock((_command: string, _params: unknown) => {}), openPairingWindow: mock(() => {}),
  };
  const callbacks = { state: mock((_state: unknown) => {}), error: mock((_error: Error) => {}), pairingPin: mock((_pin: string | null) => {}) };
  const library = {
    SendspinPlayer: function (value: SendspinPlayerConfig) { config = value; events.push("construct"); return player; },
    loadSendspinClientIdentity: mock(() => ({ clientId: "stable-client" })),
  };
  const loadLibrary = mock(async () => library as unknown as typeof import("@sendspin/sendspin-js"));
  const renderer = createSendspinRenderer({ url: "https://speaker.example", name: "Couch browser" }, callbacks, { loadLibrary });
  return { renderer, player, callbacks, events, loadLibrary, config: () => config!, delayUnlock: (promise: Promise<void>) => { unlock = () => promise; }, delayConnect: (promise: Promise<void>) => { connect = () => promise; } };
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test("idle is lazy; prepare exposes stable enrollment identity without opening audio", async () => {
  const f = fixture();
  expect(f.loadLibrary).not.toHaveBeenCalled();
  await Promise.all([f.renderer.preload(), f.renderer.preload()]);
  expect(f.loadLibrary).toHaveBeenCalledTimes(1);
  expect(f.renderer.clientId).toBe("stable-client");
  expect(f.events).toEqual([]);
  f.renderer.setEnrollment({ serverId: "trusted-server", psk: "private-psk" });
  const connection = f.renderer.connectFromGesture();
  expect(f.events).toEqual(["construct", "unlock"]);
  await connection;
  expect(f.config()).toMatchObject({ baseUrl: "https://speaker.example", suite: "aesgcm", unpairedAccess: false, longTermPsks: [{ serverId: "trusted-server", psk: "private-psk" }] });
  expect(f.events).toEqual(["construct", "unlock", "connect"]);
});

test("protocol connection registers without unlocking audio until an explicit gesture", async () => {
  const f = fixture();
  await f.renderer.preload();
  f.renderer.setEnrollment({ serverId: "trusted-server", psk: "private-psk" });
  await f.renderer.connect();
  expect(f.events).toEqual(["construct", "connect"]);
  await f.renderer.unlockFromGesture();
  expect(f.events).toEqual(["construct", "connect", "unlock"]);
});

test("unprepared gesture fails explicitly rather than awaiting import before unlock", async () => {
  const f = fixture();
  await expect(f.renderer.connectFromGesture()).rejects.toThrow("Wait for Sendspin");
  expect(f.loadLibrary).not.toHaveBeenCalled();
  expect(f.callbacks.error).toHaveBeenCalledTimes(1);
});

test("disconnect during unlock never opens a connection and fences callbacks", async () => {
  const f = fixture(), gate = deferred();
  await f.renderer.preload(); f.delayUnlock(gate.promise);
  const pending = f.renderer.connectFromGesture();
  expect(f.renderer.connectFromGesture()).toBe(pending);
  await f.renderer.disconnect(); gate.resolve(); await pending;
  expect(f.player.connect).not.toHaveBeenCalled();
  f.config().onPairingPin?.("123456");
  expect(f.callbacks.pairingPin.mock.calls).toEqual([[null]]);
  await expect(f.renderer.connectFromGesture()).rejects.toThrow("closed");
});

test("a late connect is disconnected again rather than resurrecting playback", async () => {
  const f = fixture(), gate = deferred();
  await f.renderer.preload(); f.delayConnect(gate.promise);
  const pending = f.renderer.connectFromGesture(); await Promise.resolve();
  await f.renderer.disconnect(); gate.resolve(); await pending;
  expect(f.player.isConnected).toBe(false);
  expect(f.player.disconnect).toHaveBeenCalledTimes(2);
});

test("advertised transport commands, local volume, and pairing use SDK APIs", async () => {
  const f = fixture(); await f.renderer.preload(); await f.renderer.connectFromGesture();
  expect(f.renderer.transport("play")).toBe(false);
  f.config().onStateChange?.({ isPlaying: true, volume: 80, muted: false, playerState: "synchronized", serverState: { metadata: { title: "Song" }, controller: { supported_commands: ["play", "pause"] } }, groupState: {} });
  expect(f.renderer.transport("play")).toBe(true);
  expect(f.renderer.transport("next")).toBe(false);
  expect(f.callbacks.state.mock.calls[0]?.[0]).toMatchObject({ connected: true, metadata: { title: "Song" }, supportedCommands: ["play", "pause"] });
  f.renderer.setVolume(120); f.renderer.setMuted(true); f.renderer.openPairingWindow();
  expect(f.player.setVolume).toHaveBeenCalledWith(100);
  expect(f.player.setMuted).toHaveBeenCalledWith(true);
  expect(f.player.openPairingWindow).toHaveBeenCalledTimes(1);
  f.config().onPairingPin?.("123456");
  expect(f.callbacks.pairingPin).toHaveBeenCalledWith("123456", undefined);
  await f.renderer.disconnect();
  f.renderer.setVolume(50); f.renderer.setMuted(false); f.renderer.openPairingWindow();
  expect(f.renderer.transport("play")).toBe(false);
  expect(f.player.setVolume).toHaveBeenCalledTimes(1);
});

test("failed unlock cleans up and reports an actionable connection error", async () => {
  const f = fixture(); await f.renderer.preload();
  f.delayUnlock(Promise.reject(new Error("Audio permission denied")));
  await expect(f.renderer.connectFromGesture()).rejects.toThrow("Audio permission denied");
  expect(f.player.disconnect).toHaveBeenCalledTimes(1);
  expect(f.callbacks.error).toHaveBeenCalledTimes(1);
});

test("reconnect budget survives socket opens and cached state; terminal state fences controls", async () => {
  const f = fixture(); await f.renderer.preload(); await f.renderer.connectFromGesture();
  for (let attempt = 1; attempt <= 7; attempt++) {
    f.config().reconnect?.onReconnecting?.(1);
    f.config().onStateChange?.({ isPlaying: false, volume: 100, muted: false, playerState: "synchronized", serverState: { controller: { supported_commands: ["play"] } }, groupState: {} });
  }
  expect(f.callbacks.error).not.toHaveBeenCalled();
  f.config().reconnect?.onReconnecting?.(1);
  expect(f.player.disconnect).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(f.player.disconnect).toHaveBeenCalledWith("user_request");
  expect(f.callbacks.error).toHaveBeenCalledTimes(1);
  expect(f.callbacks.error.mock.calls[0]?.[0].message).toBe("Sendspin stopped reconnecting. Leave and join again.");
  expect(f.callbacks.state.mock.calls.at(-1)?.[0]).toMatchObject({ connected: false, isPlaying: false, supportedCommands: [] });
  expect(f.callbacks.pairingPin).toHaveBeenCalledWith(null);
  expect(f.renderer.transport("play")).toBe(false);
  f.renderer.setVolume(30); f.renderer.setMuted(true); f.renderer.openPairingWindow();
  expect(f.player.setVolume).not.toHaveBeenCalled();
  expect(f.player.setMuted).not.toHaveBeenCalled();
  expect(f.player.openPairingWindow).not.toHaveBeenCalled();
  f.config().reconnect?.onExhausted?.();
  f.config().onPairingPin?.("123456");
  f.config().onStateChange?.({ isPlaying: false, volume: 100, muted: false, playerState: "synchronized", serverState: {}, groupState: {} });
  expect(f.callbacks.error).toHaveBeenCalledTimes(1);
  await expect(f.renderer.connectFromGesture()).rejects.toThrow("Leave and join again");
});

test("Leave cancels a queued terminal disconnect", async () => {
  const f = fixture(); await f.renderer.preload(); await f.renderer.connectFromGesture();
  for (let attempt = 0; attempt < 8; attempt++) f.config().reconnect?.onReconnecting?.(1);
  await f.renderer.disconnect();
  await Promise.resolve();
  expect(f.player.disconnect).toHaveBeenCalledTimes(1);
  expect(f.callbacks.error).not.toHaveBeenCalled();
});
