import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, PlaybackCommand, PlayerState, ServerMessage } from "../shared/protocol";
import { createHub, type Hub } from "./hub";
import { createPlaybackTargets } from "./playback-targets";
import { createSession } from "./session";
import { openStore } from "./store";

const hostToken = "native-receiver-host-token-123456789012345678901";
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const api = (hub: Hub, token: string, path: string) => fetch(`${hub.origin}${path}`, { headers: { Origin: hub.origin, Authorization: `Bearer ${token}` } });

class Peer {
  socket: WebSocket;
  messages: ServerMessage[] = [];
  listeners = new Set<() => void>();
  renderer?: Extract<ServerMessage, { type: "rendererRegistered" }>;
  constructor(hub: Hub, token: string) {
    this.socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&clientProtocol=1`, { headers: { Origin: hub.origin } });
    this.socket.addEventListener("message", event => { this.messages.push(JSON.parse(String(event.data))); for (const listener of this.listeners) listener(); });
    cleanup.push(() => this.close());
  }
  wait(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error("Timed out waiting for receiver message")); }, 2000);
      const check = () => { const message = this.messages.findLast(predicate); if (message) { clearTimeout(timer); this.listeners.delete(check); resolve(message); } };
      this.listeners.add(check); check();
    });
  }
  async register() {
    await this.wait(message => message.type === "state");
    const nonce = crypto.randomUUID();
    this.socket.send(JSON.stringify({ type: "registerNativeRenderer", nonce }));
    await this.wait(message => message.type === "nativeLease" && message.nonce === nonce);
    const message = await this.wait(message => message.type === "rendererRegistered");
    if (message.type !== "rendererRegistered") throw new Error("Missing renderer");
    this.renderer = message; return message.targetId;
  }
  command(action: Action) {
    const requestId = crypto.randomUUID(), result = this.wait(message => message.type === "result" && message.requestId === requestId);
    this.socket.send(JSON.stringify({ type: "command", requestId, action })); return result;
  }
  observe(playbackId: string | null, status: PlayerState["status"], position = 0) {
    this.socket.send(JSON.stringify({ type: "rendererObservation", sessionId: this.renderer!.sessionId, state: { ...idle, playbackId, status, position, duration: 90 } }));
  }
  async load() {
    const message = await this.wait(message => message.type === "rendererCommand" && message.command.type === "load");
    if (message.type !== "rendererCommand" || message.command.type !== "load") throw new Error("Missing load");
    return message.command;
  }
  close() { return this.socket.readyState === WebSocket.CLOSED ? Promise.resolve() : new Promise<void>(resolve => { this.socket.addEventListener("close", () => resolve(), { once: true }); this.socket.close(); }); }
}


async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "native-receiver-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "state.sqlite"), hostToken, pairingCode: "123456" });
  cleanup.push(() => hub.close());
  const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
  const { token } = await response.json() as { token: string };
  const identity = await (await api(hub, token, "/api/controllers/me")).json() as { controller: { id: string } };
  const peer = new Peer(hub, token);
  return { hub, token, peer, controllerId: identity.controller.id, databasePath: join(directory, "state.sqlite") };
}
function closed(peer: Peer) { return new Promise<number>(resolve => peer.socket.addEventListener("close", event => resolve(event.code), { once: true })); }

test("paired native receiver enrollment acknowledges its nonce, stays idle, and preserves identity across reconnect", async () => {
  const { hub, token, peer, controllerId } = await fixture();
  const id = await peer.register();
  expect(id).toBe(`receiver-${controllerId}`);
  expect(hub.session.state.targets).toContainEqual(expect.objectContaining({ id, backend: "native", connected: true }));
  expect(peer.messages.some(message => message.type === "rendererCommand")).toBe(false);
  const nonce = crypto.randomUUID();
  peer.socket.send(JSON.stringify({ type: "nativeLease", nonce }));
  await peer.wait(message => message.type === "nativeLease" && message.nonce === nonce);
  const duplicate = new Peer(hub, token);
  await duplicate.wait(message => message.type === "state");
  const rejected = closed(duplicate);
  duplicate.socket.send(JSON.stringify({ type: "registerNativeRenderer", nonce: crypto.randomUUID() }));
  expect(await rejected).toBe(1008);
  await peer.close();
  const replacement = new Peer(hub, token);
  expect(await replacement.register()).toBe(id);
  expect(hub.session.state.targets?.filter(target => target.id === id)).toHaveLength(1);
  expect(hub.session.state.targets?.find(target => target.id === id)?.connected).toBe(true);
  expect(replacement.messages.some(message => message.type === "rendererCommand")).toBe(false);
});

test("native receiver starts only after explicit selection and ignores obsolete attempt observations", async () => {
  const { hub, peer } = await fixture();
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("sample", { headers: { "Content-Type": "audio/mpeg" } }) });
  cleanup.push(() => upstream.stop(true));
  const id = await peer.register();
  expect(await peer.command({ type: "selectTarget", targetId: id })).toMatchObject({ ok: true });
  expect(await peer.command({ type: "enqueue", entry: { id: "sample", title: "Sample", source: `http://127.0.0.1:${upstream.port}/sample.mp3` }, playNow: true })).toMatchObject({ ok: true });
  const load = await peer.load();
  expect(await (await fetch(load.source)).text()).toBe("sample");
  peer.observe(load.playbackId, "playing", 23);
  await peer.wait(message => message.type === "state" && message.state.player.position === 23);
  peer.observe("obsolete-attempt", "ended", 90);
  await peer.command({ type: "volume", volume: 31 });
  expect(hub.session.state.player).toMatchObject({ playbackId: load.playbackId, position: 23, status: "playing" });
});

test("host identity cannot enroll a receiver and browser registration retains its browser backend", async () => {
  const { hub, token } = await fixture();
  const host = new Peer(hub, hostToken);
  await host.wait(message => message.type === "state");
  const rejected = closed(host);
  host.socket.send(JSON.stringify({ type: "registerNativeRenderer", nonce: crypto.randomUUID() }));
  expect(await rejected).toBe(1008);
  const browser = new Peer(hub, token);
  await browser.wait(message => message.type === "state");
  browser.socket.send(JSON.stringify({ type: "registerRenderer", capabilities: { mp4H264Aac: true, mp3: true } }));
  const registered = await browser.wait(message => message.type === "rendererRegistered");
  if (registered.type !== "rendererRegistered") throw new Error("Missing browser registration");
  expect(hub.session.state.targets?.find(target => target.id === registered.targetId)?.backend).toBe("browser");
  expect(registered.targetId).not.toStartWith("receiver-");
});

function targetsFixture(recoveringReceiver = false) {
  let clock = 100;
  const store = openStore(":memory:");
  const targets = createPlaybackTargets(undefined, () => session, { timeout: 50, now: () => clock, recoveringReceiver });
  const session = createSession(store, targets.send, () => {}, { transferBusy: () => targets.busy, nativeTarget: () => targets.nativeAssigned });
  cleanup.push(() => { targets.close(); session.close(); store.close(); });
  const commands: PlaybackCommand[] = [];
  const register = () => targets.registerReceiver("controller", "Receiver", command => {
    commands.push(command);
    if (command.type === "load") queueMicrotask(() => registration.observe({ ...idle, playbackId: command.playbackId, status: command.paused ? "paused" : "playing", position: command.startPosition ?? 0 }));
    if (command.type === "stop") queueMicrotask(() => registration.observe(idle));
  }, () => {}, () => {});
  let registration = register();
  return { targets, session, commands, registration, advance: (ms: number) => { clock += ms; }, reconnect: () => { registration = register(); return registration; } };
}

test("receiver delivery retains HTTP headers and strips Core audio settings while rejecting local paths", async () => {
  const f = targetsFixture();
  await f.targets.move(f.registration.id);
  f.targets.send({ type: "load", playbackId: "first", source: "https://media.example/movie.mp4", headers: { Authorization: "private-provider-token" }, audioOutput: "core-device", preferences: { speed: 1, audioDelay: 2, audioLanguage: "", subtitleLanguage: "", subtitles: "off", replayGain: "off" } });
  expect(f.commands.at(-1)).toMatchObject({ headers: { Authorization: "private-provider-token" }, audioOutput: undefined, preferences: { audioDelay: 0 } });
  for (const source of ["/private/movie.mp4", "file:///private/movie.mp4", "/api/media/12345678-1234-1234-1234-123456789012"]) expect(() => f.targets.send({ type: "load", playbackId: "bad", source })).toThrow("Core's own player");
  expect(() => f.targets.send({ type: "load", playbackId: "bad-subtitle", source: "https://media.example/movie.mp4", subtitles: [{ source: "/private/captions.srt", title: "English" }] })).toThrow("Core's own player");
});

for (const reconnect of [false, true]) test(`disconnected receiver ${reconnect ? "requires explicit selection after confirmed reconnect" : "fences handoff until the shutdown deadline"}`, async () => {
  const f = targetsFixture();
  await f.targets.move(f.registration.id);
  f.session.command({ type: "enqueue", entry: { id: "movie", title: "Movie", source: "https://media.example/movie.mp4" }, playNow: true });
  await Bun.sleep(0);
  const attempt = f.session.state.player.playbackId!;
  f.registration.observe({ ...idle, playbackId: attempt, status: "playing", position: 37 });
  const old = f.registration;
  old.close();
  expect(f.session.state.player).toMatchObject({ status: "unavailable", position: 37 });
  if (reconnect) {
    const replacement = f.reconnect();
    const before = f.commands.length;
    old.close(); old.observe({ ...idle, playbackId: attempt, status: "ended", position: 90 });
    expect(f.session.state.targets?.find(target => target.id === replacement.id)?.connected).toBe(true);
    expect(f.commands).toHaveLength(before);
    expect(f.session.state.player.position).toBe(37);
    await f.targets.move(replacement.id);
  } else {
    let browser: ReturnType<typeof f.targets.register>;
    browser = f.targets.register("Browser", command => { if (command.type === "load") queueMicrotask(() => browser.observe({ ...idle, playbackId: command.playbackId, status: "paused", position: command.startPosition ?? 0 })); });
    await expect(f.targets.move(browser.id)).rejects.toThrow("stopping");
    f.advance(12_499);
    await expect(f.targets.move(browser.id)).rejects.toThrow("stopping");
    f.advance(1);
    await f.targets.move(browser.id);
  }
  expect(f.session.state.player).toMatchObject({ status: "paused", position: 37 });
});

test("Core restart marker fences every new output for the native shutdown window", async () => {
  const f = targetsFixture(true);
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("stopping");
  f.advance(12_499);
  await expect(f.targets.move(f.registration.id)).rejects.toThrow("stopping");
  expect(f.commands).toHaveLength(0);
  f.advance(1);
  await f.targets.move(f.registration.id);
  expect(f.session.state.targetId).toBe(f.registration.id);
});

test("native enrollment persists the Core restart guard across hub instances", async () => {
  const first = await fixture();
  await first.peer.register();
  await first.peer.close();
  await first.hub.close();
  const restarted = createHub({ hostname: "127.0.0.1", port: 0, databasePath: first.databasePath, hostToken, pairingCode: "123456" });
  cleanup.push(() => restarted.close());
  const browser = new Peer(restarted, first.token);
  await browser.wait(message => message.type === "state");
  browser.socket.send(JSON.stringify({ type: "registerRenderer" }));
  const registration = await browser.wait(message => message.type === "rendererRegistered");
  if (registration.type !== "rendererRegistered") throw new Error("Missing browser registration");
  expect(await browser.command({ type: "selectTarget", targetId: registration.targetId })).toMatchObject({ ok: false, error: expect.stringContaining("stopping") });
  expect(browser.messages.some(message => message.type === "rendererCommand")).toBe(false);
});

test("receiver disconnection during destination preparation cannot bypass its shutdown fence", async () => {
  const f = targetsFixture();
  await f.targets.move(f.registration.id);
  f.session.command({ type: "enqueue", entry: { id: "movie", title: "Movie", source: "https://media.example/movie.mp4" }, playNow: true });
  await Bun.sleep(0);
  f.registration.observe({ ...idle, playbackId: f.session.state.player.playbackId, status: "playing", position: 19 });
  const destinationCommands: PlaybackCommand[] = [];
  const browser = f.targets.register("Browser", command => {
    destinationCommands.push(command);
    if (command.type === "load") {
      f.registration.close();
      queueMicrotask(() => browser.observe({ ...idle, playbackId: command.playbackId, status: "paused", position: 19 }));
    }
    if (command.type === "stop") queueMicrotask(() => browser.observe(idle));
  });
  await expect(f.targets.move(browser.id)).rejects.toThrow("disconnected while playback was moving");
  expect(destinationCommands.some(command => command.type === "pause" && !command.paused)).toBe(false);
  expect(f.session.state.targetId).toBe(f.registration.id);
  expect(f.session.state.player.status).toBe("unavailable");
});
