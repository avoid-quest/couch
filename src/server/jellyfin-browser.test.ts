import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, PlaybackCommand, PlayerState, ServerMessage } from "../shared/protocol";
import { createHub, type Hub } from "./hub";

const itemId = "a".repeat(32), hostToken = "jellyfin-browser-host-token-1234567890123456789";
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const api = (hub: Hub, token: string, path: string, method = "GET", body?: unknown) => fetch(`${hub.origin}${path}`, { method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

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
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error("Timed out waiting for browser message")); }, 2000);
      const check = () => { const message = this.messages.findLast(predicate); if (message) { clearTimeout(timer); this.listeners.delete(check); resolve(message); } };
      this.listeners.add(check); check();
    });
  }
  async register() {
    await this.wait(message => message.type === "state");
    this.socket.send(JSON.stringify({ type: "registerRenderer", capabilities: { mp4H264Aac: true, mp3: false } }));
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

async function fixture(container = "mp4") {
  const requests: { path: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" && request.headers.get("content-type")?.includes("application/json") ? await request.json() as Record<string, unknown> : null;
    requests.push({ path, headers: request.headers, body });
    if (path === "/System/Info/Public") return Response.json({ ServerName: "Test", Id: "fixture", Version: "10.11.0" });
    if (path === "/Users/AuthenticateByName") return Response.json({ AccessToken: "private-jellyfin-secret", User: { Id: "b".repeat(32), Name: "test" } });
    if (!request.headers.get("Authorization")?.includes('Token="private-jellyfin-secret"')) return new Response(null, { status: 401 });
    if (path === `/Items/${itemId}`) return Response.json({ Id: itemId, Name: "Test movie", Type: "Movie", RunTimeTicks: 900_000_000, UserData: { PlaybackPositionTicks: 0 } });
    if (path.endsWith("/PlaybackInfo")) return Response.json({ PlaySessionId: crypto.randomUUID(), MediaSources: [{ Id: "media", Container: container, Protocol: "File", SupportsDirectPlay: true, Path: "/private/movie", MediaStreams: [{ Type: "Video", Codec: "h264" }, { Type: "Audio", Codec: "aac" }] }] });
    if (path.startsWith(`/Videos/${itemId}/stream`)) return new Response("0123", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-3/10", "Accept-Ranges": "bytes" } });
    if (path.startsWith("/Sessions/")) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  } });
  cleanup.push(() => upstream.stop(true));
  const directory = mkdtempSync(join(tmpdir(), "jellyfin-browser-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const commands: PlaybackCommand[] = [];
  const native = { onCommand: (_command: PlaybackCommand) => {} };
  const nativeLoad = Promise.withResolvers<Extract<PlaybackCommand, { type: "load" }>>();
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "state.sqlite"), hostToken, pairingCode: "123456", sendPlayer: command => { commands.push(command); native.onCommand(command); if (command.type === "load") nativeLoad.resolve(command); } });
  cleanup.push(() => hub.close()); hub.session.observe(idle);
  expect((await api(hub, hostToken, "/api/jellyfin", "POST", { url: `http://127.0.0.1:${upstream.port}`, username: "test", password: "test" })).status).toBe(200);
  const pair = async () => (await (await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: "123456" }) })).json() as { token: string }).token;
  const ownerToken = await pair(), browserToken = await pair();
  const owner = new Peer(hub, ownerToken), browser = new Peer(hub, browserToken);
  await owner.wait(message => message.type === "state");
  const targetId = await browser.register();
  return { hub, commands, native, nativeLoad: nativeLoad.promise, requests, owner, browser, ownerToken, browserToken, targetId };
}
const enqueue: Action = { type: "enqueueJellyfin", itemId, entryId: "movie", playNow: true };

for (const end of ["stop", "disconnect", "revoke"] as const) test(`browser Jellyfin relay is private, range capable, and expires on ${end}`, async () => {
  const { hub, browser, owner, ownerToken, browserToken, targetId, requests } = await fixture();
  expect(await browser.command({ type: "selectTarget", targetId })).toMatchObject({ ok: true });
  expect(await owner.command(enqueue)).toMatchObject({ ok: true });
  const load = await browser.load();
  expect(load.source).toMatch(/^\/api\/media\/[a-f\d-]{36}$/);
  expect(load.headers).toBeUndefined();
  const publicMessages = JSON.stringify(owner.messages);
  expect(publicMessages).not.toContain(load.source);
  expect(publicMessages).not.toContain("private-jellyfin-secret");
  expect(owner.messages.some(message => message.type === "rendererCommand")).toBe(false);
  expect(requests.find(request => request.path.endsWith("PlaybackInfo"))?.body).toMatchObject({ EnableTranscoding: false, DeviceProfile: { Name: "Couch browser", DirectPlayProfiles: [{ Type: "Video", Container: "mp4,m4v", VideoCodec: "h264", AudioCodec: "aac" }] } });
  const response = await fetch(`${hub.origin}${load.source}`, { headers: { Range: "bytes=0-3" } });
  expect(response.status).toBe(206); expect(await response.text()).toBe("0123");
  const media = requests.find(request => request.path.startsWith("/Videos/"))!;
  expect(media.headers.get("range")).toBe("bytes=0-3");
  expect(media.headers.get("authorization")).toContain("private-jellyfin-secret");
  browser.observe(load.playbackId, "playing", 12);
  await owner.wait(message => message.type === "state" && message.state.player.position === 12);
  if (end === "stop") expect(await owner.command({ type: "stop" })).toMatchObject({ ok: true });
  if (end === "disconnect") { await browser.close(); await owner.wait(message => message.type === "state" && message.state.player.status === "unavailable"); }
  if (end === "revoke") {
    const { controller } = await (await api(hub, browserToken, "/api/controllers/me")).json() as { controller: { id: string } };
    expect((await api(hub, ownerToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
  }
  expect((await fetch(`${hub.origin}${load.source}`)).status).toBe(404);
});

test("incompatible Jellyfin browser negotiation leaves native playback running", async () => {
  const { hub, owner, browser, targetId, commands, requests, nativeLoad } = await fixture("mkv");
  expect(await owner.command(enqueue)).toMatchObject({ ok: true });
  const load = await nativeLoad;
  if (load.type !== "load") throw new Error("Missing native load");
  hub.session.observe({ ...idle, playbackId: load.playbackId, status: "playing", position: 13 });
  expect(await browser.command({ type: "selectTarget", targetId })).toMatchObject({ ok: false });
  expect(commands.some(command => command.type === "pause")).toBe(false);
  expect(hub.session.state.player.playbackId).toBe(load.playbackId);
  const profiles = requests.filter(request => request.path.endsWith("PlaybackInfo")).map(request => request.body?.DeviceProfile as { Name: string });
  expect(profiles[0]?.Name).not.toBe("Couch browser"); expect(profiles.at(-1)?.Name).toBe("Couch browser");
});

for (const rollback of [false, true]) test(`native Jellyfin handoff ${rollback ? "rolls back to the retained source" : "retires the source only after destination starts"}`, async () => {
  const { hub, owner, browser, targetId, nativeLoad, native, requests } = await fixture();
  expect(await owner.command(enqueue)).toMatchObject({ ok: true });
  const original = await nativeLoad;
  hub.session.observe({ ...idle, playbackId: original.playbackId, status: "playing", position: 17 });
  let sourceStopped = false;
  native.onCommand = command => {
    if (command.type === "pause") hub.session.observe({ ...idle, playbackId: original.playbackId, status: command.paused ? "paused" : "playing", position: 17 });
    if (command.type === "stop") { sourceStopped = true; hub.session.observe(idle); }
  };
  const moved = browser.command({ type: "selectTarget", targetId });
  const destination = await browser.load();
  expect(destination.playbackId).not.toBe(original.playbackId);
  expect(destination.source).toMatch(/^\/api\/media\//);
  expect((await fetch(`${hub.origin}${destination.source}`)).status).toBe(206);
  expect(requests.some(request => request.path === "/Sessions/Playing/Stopped" && request.body?.PlaySessionId)).toBe(false);
  browser.observe(destination.playbackId, "paused", 17);
  await browser.wait(message => message.type === "rendererCommand" && message.command.type === "pause" && !message.command.paused);
  expect(sourceStopped).toBe(false);
  expect(requests.some(request => request.path === "/Sessions/Playing/Stopped")).toBe(false);
  if (rollback) {
    browser.observe(destination.playbackId, "error", 17);
    await browser.wait(message => message.type === "rendererCommand" && message.command.type === "stop");
    browser.observe(null, "idle");
    expect(await moved).toMatchObject({ ok: false });
    expect(hub.session.state.player).toMatchObject({ playbackId: original.playbackId, status: "playing", position: 17 });
    expect(sourceStopped).toBe(false);
    expect((await fetch(`${hub.origin}${destination.source}`)).status).toBe(404);
  } else {
    browser.observe(destination.playbackId, "playing", 17);
    expect(await moved).toMatchObject({ ok: true });
    expect(sourceStopped).toBe(true);
    expect(hub.session.state.player.playbackId).toBe(destination.playbackId);
    expect((await fetch(`${hub.origin}${destination.source}`)).status).toBe(206);
  }
});
