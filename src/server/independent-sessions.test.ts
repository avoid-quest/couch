import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, PlaybackCommand, PlayerState, ServerMessage, SessionState } from "../shared/protocol";
import * as sessionModule from "./session";
import * as storeModule from "./store";
import { createHub, type Hub } from "./hub";
import { parseRendererMessage } from "./renderer-validation";

const hostToken = "independent-sessions-host-token-12345678901234567890";
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const BunSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
function fixture(options: Partial<Parameters<typeof createHub>[0]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "independent-sessions-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const start = () => {
    const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "state.sqlite"), pairingCode: "123456", hostToken, ...options });
    let closed = false;
    const close = () => { if (!closed) { closed = true; return hub.close(); } };
    cleanup.push(close);
    return { hub, close };
  };
  return { ...start(), start };
}
function request(hub: Hub, token: string, path: string, mode = "personal", method = "GET", body?: unknown) {
  return fetch(`${hub.origin}${path}`, { method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Couch-Session": mode }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function pair(hub: Hub) {
  const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
  expect(response.status).toBe(200);
  return (await response.json() as { token: string }).token;
}
class Peer {
  socket: WebSocket;
  messages: ServerMessage[] = [];
  listeners = new Set<() => void>();
  sessionId = "";
  targetId = "";
  player = { ...idle };
  holdEcho?: PlaybackCommand["type"];
  constructor(hub: Hub, token: string, mode?: string) {
    this.socket = new BunSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&clientProtocol=1${mode ? `&session=${mode}` : ""}`, { headers: { Origin: hub.origin } });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.messages.push(message);
      if (message.type === "rendererRegistered") { this.sessionId = message.sessionId; this.targetId = message.targetId; }
      if (message.type === "rendererCommand") {
        const command = message.command;
        if (command.type === "load") this.player = { ...idle, playbackId: command.playbackId, status: command.paused ? "paused" : "playing", position: command.startPosition ?? 0, duration: 300, seekable: true };
        else if (command.type === "pause") this.player = { ...this.player, status: command.paused ? "paused" : "playing" };
        else if (command.type === "speed") this.player = { ...this.player, speed: command.speed };
        else if (command.type === "seek") this.player = { ...this.player, position: command.position };
        else if (command.type === "stop") this.player = { ...idle };
        if (command.type !== this.holdEcho) this.send({ type: "rendererObservation", sessionId: message.sessionId, state: this.player });
      }
      for (const listener of this.listeners) listener();
    });
    cleanup.push(() => this.close());
  }
  send(message: unknown) { this.socket.send(JSON.stringify(message)); }
  wait(predicate: (message: ServerMessage) => boolean, from = 0): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error(`Timed out: ${JSON.stringify(this.messages.slice(-3))}`)); }, 3000);
      const check = () => { const message = this.messages.slice(from).findLast(predicate); if (message) { clearTimeout(timer); this.listeners.delete(check); resolve(message); } };
      this.listeners.add(check); check();
    });
  }
  get state(): SessionState { const message = this.messages.findLast(message => message.type === "state"); if (message?.type !== "state") throw new Error("Missing state"); return message.state; }
  async command(action: Action) { const requestId = crypto.randomUUID(); this.send({ type: "command", requestId, action }); return this.wait(message => message.type === "result" && message.requestId === requestId); }
  async register() { await this.wait(message => message.type === "state"); this.send({ type: "registerRenderer" }); await this.wait(message => message.type === "rendererRegistered"); expect(await this.command({ type: "selectTarget", targetId: this.targetId })).toMatchObject({ ok: true }); }
  async play(id: string, position: number) {
    expect(await this.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}.mp4` }, playNow: true })).toMatchObject({ ok: true });
    await this.wait(message => message.type === "state" && message.state.currentEntryId === id && message.state.player.status === "playing");
    this.player = { ...this.player, position };
    this.send({ type: "rendererObservation", sessionId: this.sessionId, state: this.player });
    await this.wait(message => (message.type === "clock" && message.position === position) || (message.type === "state" && message.state.player.position === position));
  }
  close() { if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(); return new Promise<void>(resolve => { this.socket.addEventListener("close", () => resolve(), { once: true }); this.socket.close(); }); }
}
async function setup() {
  const f = fixture(), aToken = await pair(f.hub), bToken = await pair(f.hub);
  const a = new Peer(f.hub, aToken, "personal"), b = new Peer(f.hub, bToken, "personal"), household = new Peer(f.hub, aToken);
  await Promise.all([a.register(), b.register(), household.wait(message => message.type === "state")]);
  return { ...f, aToken, bToken, a, b, household };
}

test("paired controllers play independently without leaking queue, clocks, or activity into other sessions", async () => {
  const { a, b, household } = await setup();
  await a.play("alice", 41); await b.play("bob", 83);
  expect(a.sessionId).not.toBe(b.sessionId);
  expect(a.state.queue.map(entry => entry.id)).toEqual(["alice"]);
  expect(b.state.queue.map(entry => entry.id)).toEqual(["bob"]);
  expect(household.state.queue).toEqual([]);
  for (const [peer, foreign] of [[a, b], [b, a], [household, a], [household, b]] as const) {
    expect(peer.messages.some(message => message.type === "clock" && message.playbackId === foreign.player.playbackId)).toBe(false);
    expect(peer.messages.some(message => message.type === "state" && message.state.currentEntryId === foreign.state.currentEntryId)).toBe(false);
    expect(peer.messages.some(message => message.type === "state" && message.state.activity?.id === foreign.state.activity?.id && !!foreign.state.activity)).toBe(false);
  }
});

test("HTTP playlist capture and load, progress, and for-later lookup use the authenticated personal session", async () => {
  const { hub, aToken, bToken, a, b, household } = await setup();
  await a.play("alice", 41); await b.play("bob", 83);
  expect((await request(hub, bToken, "/api/for-later", "personal", "POST", { reference: { kind: "queue", id: "alice" } })).status).toBe(404);
  const saved = await request(hub, aToken, "/api/playlists", "personal", "POST", { name: "Alice queue" });
  expect(saved.status).toBe(201);
  const { playlist } = await saved.json() as { playlist: { id: string; revision: number; entries: { title: string }[] } };
  expect(playlist.entries.map(entry => entry.title)).toEqual(["alice"]);
  expect((await request(hub, bToken, `/api/playlists/${playlist.id}/load`, "personal", "POST", { mode: "append", revision: playlist.revision })).status).toBe(200);
  await b.wait(message => message.type === "state" && message.state.queue.length === 2);
  expect(a.state.queue).toHaveLength(1); expect(household.state.queue).toEqual([]);
  expect((await request(hub, aToken, "/api/for-later", "personal", "POST", { reference: { kind: "queue", id: "alice" } })).status).toBe(201);
  await a.command({ type: "stop" }); await b.command({ type: "stop" });
  for (const [token, mode, titles] of [[aToken, "personal", ["alice"]], [bToken, "personal", ["bob"]], [aToken, "household", []]] as const) {
    const history = await request(hub, token, "/api/progress/history", mode);
    expect(history.status).toBe(200);
    const { items } = await history.json() as { items: { title: string; position: number }[] };
    expect(items.map(item => item.title)).toEqual([...titles]);
    if (mode === "personal") expect(items[0]?.position).toBe(token === aToken ? 41 : 83);
  }
});

test("invalid session selectors and unpaired host personal sessions are rejected", async () => {
  const { hub } = fixture(), token = await pair(hub);
  for (const mode of ["other", "personal:someone-else", ""]) {
    expect((await request(hub, token, "/api/progress/history", mode)).status).toBe(400);
    expect((await fetch(`${hub.origin}/api/ws?token=${token}&session=${encodeURIComponent(mode)}`, { headers: { Origin: hub.origin } })).status).toBe(400);
  }
  expect((await request(hub, hostToken, "/api/progress/history")).status).toBe(403);
  expect((await fetch(`${hub.origin}/api/ws?token=${hostToken}&session=personal`, { headers: { Origin: hub.origin } })).status).toBe(403);
});

test("an occupied browser target cannot be implicitly taken over by another session", async () => {
  const { a, b } = await setup(); await a.play("alice", 41); await b.play("bob", 83);
  const results = await Promise.all([b.command({ type: "selectTarget", targetId: a.targetId }), a.command({ type: "selectTarget", targetId: b.targetId })]);
  expect(results).toEqual([expect.objectContaining({ ok: false }), expect.objectContaining({ ok: false })]);
  expect(a.state.targetId).toBe(a.targetId); expect(b.state.targetId).toBe(b.targetId);
  expect(a.player.status).toBe("playing"); expect(b.player.status).toBe("playing");
});

test("restart restores each private checkpoint without autoplay or household contamination", async () => {
  const f = await setup(); await f.a.play("alice", 41); await f.b.play("bob", 83);
  await f.close(); const restarted = f.start();
  const a = new Peer(restarted.hub, f.aToken, "personal"), b = new Peer(restarted.hub, f.bToken, "personal"), household = new Peer(restarted.hub, f.aToken);
  await Promise.all([a.wait(message => message.type === "state"), b.wait(message => message.type === "state"), household.wait(message => message.type === "state")]);
  expect(a.state.player).toMatchObject({ status: "unavailable", position: 41 });
  expect(b.state.player).toMatchObject({ status: "unavailable", position: 83 });
  expect(a.messages.some(message => message.type === "rendererCommand")).toBe(false);
  expect(b.messages.some(message => message.type === "rendererCommand")).toBe(false);
  await Promise.all([a.register(), b.register()]);
  expect(a.state.currentEntryId).toBe("alice"); expect(b.state.currentEntryId).toBe("bob");
  expect(a.player).toMatchObject({ status: "paused", position: 41 }); expect(b.player).toMatchObject({ status: "paused", position: 83 });
  expect(household.state.currentEntryId).toBeNull();
});

test("revoking one controller closes its private playback while another personal session keeps playing", async () => {
  const { hub, aToken, a, b, household } = await setup(); await a.play("alice", 41); await b.play("bob", 83);
  const { controller } = await (await request(hub, aToken, "/api/controllers/me")).json() as { controller: { id: string } };
  const closed = new Promise<void>(resolve => a.socket.addEventListener("close", () => resolve(), { once: true }));
  expect((await request(hub, hostToken, `/api/controllers/${controller.id}`, "household", "DELETE")).status).toBe(200);
  await closed;
  expect(a.messages.some(message => message.type === "rendererCommand" && message.command.type === "stop")).toBe(true);
  expect((await request(hub, aToken, "/api/progress/history")).status).toBe(401);
  expect(b.player).toMatchObject({ status: "playing", position: 83 });
  expect(b.socket.readyState).toBe(WebSocket.OPEN);
  expect(household.state.queue).toEqual([]);
});

test("live browser seek commands clamp to the renderer's observed seekable window", async () => {
  const { a } = await setup(); await a.play("live", 150);
  a.player = { ...a.player, live: true, duration: null, seekable: true, seekRange: { start: 100, end: 200 } };
  a.send({ type: "rendererObservation", sessionId: a.sessionId, state: a.player });
  await a.wait(message => message.type === "state" && message.state.player.seekRange?.start === 100);
  for (const [requested, expected] of [[0, 100], [999, 200]] as const) {
    const from = a.messages.length;
    expect(await a.command({ type: "seek", playbackId: a.player.playbackId!, position: requested })).toMatchObject({ ok: true });
    expect(await a.wait(message => message.type === "rendererCommand" && message.command.type === "seek", from)).toMatchObject({ command: { type: "seek", position: expected } });
  }
});

test("browser observations reject reversed or nonfinite seekable windows", () => {
  for (const seekRange of [{ start: 200, end: 100 }, { start: Number.NaN, end: 200 }, { start: 100, end: Infinity }]) {
    expect(() => parseRendererMessage({ type: "rendererObservation", sessionId: "personal:test", state: { ...idle, seekRange } })).toThrow("Invalid renderer observation");
  }
});

test("household diagnostics redact personal renderer errors while preserving the owner's error", async () => {
  const { hub, a, household } = await setup(); await a.play("private-diagnostics", 41);
  const secret = "private-backend-item-confidential-73019";
  a.player = { ...a.player, status: "error", error: secret };
  a.send({ type: "rendererObservation", sessionId: a.sessionId, state: a.player });
  await a.wait(message => message.type === "state" && message.state.player.error === secret);
  expect(a.state.player.error).toBe(secret);
  expect(JSON.stringify(household.messages)).not.toContain(secret);
  expect(await a.command({ type: "enqueueRadio", entryId: "missing", stationId: "missing", playNow: true })).toMatchObject({ ok: false });
  for (const path of ["/api/diagnostics", "/api/diagnostics/export"]) {
    const response = await request(hub, hostToken, path, "household");
    expect(response.status).toBe(200);
    const report = await response.text();
    expect(report).not.toContain(secret);
    expect(report).toContain("Personal playback reported an error.");
    expect(report).toContain("A personal playback command failed.");
  }
});

test("retiring the only playing personal session allows the household update idle window to expire", async () => {
  let now = 0;
  const { hub } = fixture({ idleNow: () => now, sendPlayer: () => {} });
  hub.session.observe(idle);
  const token = await pair(hub), peer = new Peer(hub, token, "personal");
  await peer.register(); await peer.play("private-idle", 41);
  expect(hub.idleReason()).toBe("Waiting for playback to stop.");
  const { controller } = await (await request(hub, token, "/api/controllers/me")).json() as { controller: { id: string } };
  const closed = new Promise<void>(resolve => peer.socket.addEventListener("close", () => resolve(), { once: true }));
  expect((await request(hub, hostToken, `/api/controllers/${controller.id}`, "household", "DELETE")).status).toBe(200);
  await closed;
  expect((await request(hub, hostToken, "/api/controllers/me", "household")).status).toBe(200);
  expect(hub.session.state.player.status).toBe("idle");
  now += 10 * 60_000 + 1;
  expect(hub.idleReason()).toBeNull();
});

test("a shared source change cancels a busy handoff and still stops another affected personal session", async () => {
  const sessions: ReturnType<typeof sessionModule.createSession>[] = [];
  const original = sessionModule.createSession;
  const creation = spyOn(sessionModule, "createSession").mockImplementation((...args) => { const session = original(...args); sessions.push(session); return session; });
  cleanup.push(() => creation.mockRestore());
  const { hub, aToken, bToken, a, b } = await setup();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (new URL(request.url).pathname === "/list.m3u") return new Response('#EXTM3U\n#EXTINF:-1 tvg-id="one",One\nhttps://media.example/live.mp4\n');
    return new Response('<tv><channel id="one"/><programme channel="one" start="20260927000000 +0000" stop="20260928000000 +0000"><title>One</title></programme></tv>');
  } });
  cleanup.push(() => server.stop(true));
  const response = await request(hub, aToken, "/api/iptv/sources", "personal", "POST", { name: "Test guide", playlistUrl: `http://127.0.0.1:${server.port}/list.m3u`, guideUrl: `http://127.0.0.1:${server.port}/guide.xml` });
  expect(response.status).toBe(201);
  const { source } = await response.json() as { source: { id: string } };
  const { channels } = await (await request(hub, aToken, "/api/iptv/guide")).json() as { channels: { id: string }[] };
  for (const [token, peer] of [[aToken, a], [bToken, b]] as const) {
    expect((await request(hub, token, `/api/iptv/channels/${channels[0]!.id}/play`, "personal", "POST")).status).toBe(200);
    await peer.wait(message => message.type === "state" && message.state.player.status === "playing");
  }
  const destination = new Peer(hub, aToken, "personal");
  destination.holdEcho = "seek";
  await destination.wait(message => message.type === "state");
  destination.send({ type: "registerRenderer" });
  await destination.wait(message => message.type === "rendererRegistered");
  const moving = a.command({ type: "selectTarget", targetId: destination.targetId });
  await destination.wait(message => message.type === "rendererCommand" && message.command.type === "seek");
  const before = a.messages.length;
  const affected = sessions.find(session => session.state.sessionId === a.sessionId)!;
  const stop = affected.stopForSourceChange;
  const failure = spyOn(affected, "stopForSourceChange").mockImplementation(() => { stop(); throw new Error("Simulated output cleanup failure"); });
  try {
    expect((await request(hub, aToken, `/api/iptv/sources/${source.id}`, "personal", "DELETE")).status).toBe(204);
    destination.send({ type: "rendererObservation", sessionId: destination.sessionId, state: destination.player });
    expect(await moving).toMatchObject({ ok: false });
    await b.wait(message => message.type === "state" && message.state.currentEntryId === null);
    expect(a.state.currentEntryId).toBeNull();
    expect(b.state.currentEntryId).toBeNull();
    expect(a.messages.slice(before).some(message => message.type === "rendererCommand" && message.command.type === "pause" && !message.command.paused)).toBe(false);
    expect(destination.player.status).toBe("idle");
  } finally { failure.mockRestore(); }
});


test("an in-memory Core keeps personal playback stores in memory", async () => {
  const paths: string[] = [], original = storeModule.openStore;
  const opening = spyOn(storeModule, "openStore").mockImplementation((path, ...args) => { paths.push(path); return original(path, ...args); });
  try {
    const { hub } = fixture({ databasePath: ":memory:" });
    for (let index = 0; index < 2; index++) {
      const token = await pair(hub);
      expect((await request(hub, token, "/api/profiles")).status).toBe(200);
    }
    expect(paths).toEqual([":memory:", ":memory:", ":memory:"]);
  } finally { opening.mockRestore(); }
});


test("changing controlled playback preserves the renderer, private progress and queue", async () => {
  const { hub, aToken, a, b } = await setup();
  await a.play("private-audio", 28);
  const attachment = a.targetId;
  const playbackId = a.player.playbackId!;
  const from = a.messages.length;
  a.send({ type: "selectSession", mode: "household" });
  await a.wait(message => message.type === "state" && message.state.sessionMode === "household", from);
  expect(a.state.queue).toEqual([]);
  expect(a.player.status).toBe("playing");
  expect(a.messages.slice(from).some(message => message.type === "rendererCommand" && message.command.type === "stop")).toBe(false);
  a.player = { ...a.player, position: 54 };
  a.send({ type: "rendererObservation", sessionId: a.sessionId, state: a.player });
  const personalController = new Peer(hub, aToken, "personal");
  await personalController.wait(message => message.type === "state" && message.state.player.position === 54);
  expect(personalController.state.targetId).toBe(attachment);
  expect(await personalController.command({ type: "pause", playbackId, paused: true })).toMatchObject({ ok: true });
  await personalController.wait(message => message.type === "state" && message.state.player.status === "paused");
  expect(a.player.status).toBe("paused");
  expect(b.state.queue).toEqual([]);
  const back = a.messages.length;
  a.send({ type: "selectSession", mode: "personal" });
  await a.wait(message => message.type === "state" && message.state.sessionMode === "personal", back);
  expect(a.state.currentEntryId).toBe("private-audio");
  expect(a.state.player.position).toBe(54);
  expect(a.targetId).toBe(attachment);
  expect(a.messages.filter(message => message.type === "rendererRegistered")).toHaveLength(1);
});
