import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "../shared/protocol";
import { desktopClientProtocol } from "../shared/desktop-protocol";
import { createHub, type Hub } from "./hub";

const origin = "https://couch.home.arpa", hostToken = "https-proxy-host-token-123456789012345678901";
const forwarded = { Host: "couch.home.arpa", "X-Forwarded-Host": "couch.home.arpa", "X-Forwarded-Proto": "https", Origin: origin };
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };

function fixture(httpsProxy: Parameters<typeof createHub>[0]["httpsProxy"] | null = { origin, trustedProxyIps: ["127.0.0.1"] }) {
  const directory = mkdtempSync(join(tmpdir(), "https-proxy-hub-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "state.sqlite"), pairingCode: "123456", hostToken, httpsProxy: httpsProxy ?? undefined });
  cleanup.push(() => hub.close());
  return hub;
}
function request(hub: Hub, path: string, options: { proxied?: boolean; headers?: Record<string, string>; token?: string; method?: string; body?: unknown } = {}) {
  return fetch(`${hub.origin}${path}`, { method: options.method ?? "GET", headers: { ...(options.proxied ? forwarded : { Origin: hub.origin }), "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}
async function pair(hub: Hub, proxied = false) {
  const response = await request(hub, "/api/pair", { proxied, method: "POST", body: { code: hub.pairingCode } });
  expect(response.status).toBe(200);
  return (await response.json() as { token: string }).token;
}
class Peer {
  socket: WebSocket;
  messages: ServerMessage[] = [];
  listeners = new Set<() => void>();
  constructor(hub: Hub, token: string) {
    this.socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&clientProtocol=${desktopClientProtocol}`, { headers: forwarded });
    this.socket.addEventListener("message", event => { this.messages.push(JSON.parse(String(event.data))); for (const listener of this.listeners) listener(); });
    cleanup.push(() => this.close());
  }
  wait(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error("Timed out waiting for proxied WebSocket message")); }, 2000);
      const check = () => { const message = this.messages.findLast(predicate); if (message) { clearTimeout(timer); this.listeners.delete(check); resolve(message); } };
      this.listeners.add(check); check();
    });
  }
  closed() { return new Promise<number>(resolve => this.socket.addEventListener("close", event => resolve(event.code), { once: true })); }
  close() { if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(); const closed = this.closed(); this.socket.close(); return closed; }
}

test("local HTTPS discovery publishes its canonical URL and uses ordinary Couch pairing", async () => {
  const hub = fixture();
  const response = await request(hub, "/api/connection", { proxied: true });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ urls: [origin], remoteControlEnabled: true });
  const token = await pair(hub, true);
  expect((await request(hub, "/api/controllers/me", { proxied: true, token })).status).toBe(200);
  const direct = await request(hub, "/api/connection");
  expect(direct.status).toBe(200);
  expect((await direct.json() as { urls: string[] }).urls).toContain(hub.origin);
  expect((await request(hub, "/api/settings/sharing", { token: hostToken })).status).toBe(200);
});

test("local HTTPS pairing authenticates controller HTTP and renderer registration on WebSocket", async () => {
  const hub = fixture({ origin, trustedProxyIps: ["127.0.0.1"] });
  const token = await pair(hub, true);
  expect((await request(hub, "/api/controllers/me", { proxied: true, token })).status).toBe(200);
  const peer = new Peer(hub, token);
  await peer.wait(message => message.type === "state");
  peer.socket.send(JSON.stringify({ type: "registerRenderer" }));
  const registered = await peer.wait(message => message.type === "rendererRegistered");
  if (registered.type !== "rendererRegistered") throw new Error("Missing renderer registration");
  peer.socket.send(JSON.stringify({ type: "command", requestId: "target", action: { type: "selectTarget", targetId: registered.targetId } }));
  expect(await peer.wait(message => message.type === "result" && message.requestId === "target")).toMatchObject({ ok: true });
  const source = "https://provider.example/movie.mp4";
  peer.socket.send(JSON.stringify({ type: "command", requestId: "play", action: { type: "enqueue", entry: { id: "movie", title: "Movie", source }, playNow: true } }));
  expect(await peer.wait(message => message.type === "result" && message.requestId === "play")).toMatchObject({ ok: true });
  expect(await peer.wait(message => message.type === "rendererCommand" && message.command.type === "load")).toMatchObject({ command: { type: "load", source } });
  peer.socket.send(JSON.stringify({ type: "command", requestId: "volume", action: { type: "volume", volume: 42 } }));
  expect(await peer.wait(message => message.type === "result" && message.requestId === "volume")).toMatchObject({ ok: true });
});

test("the private host token cannot authenticate through the trusted proxy", async () => {
  const hub = fixture();
  for (const path of ["/api/controllers/me", `/api/ws?token=${hostToken}&clientProtocol=${desktopClientProtocol}`]) expect((await request(hub, path, { proxied: true, token: hostToken })).status).toBe(401);
  expect((await request(hub, "/api/controllers/me", { token: hostToken })).status).toBe(200);
});

for (const headers of [
  { Host: "attacker.example" },
  { "X-Forwarded-Host": "attacker.example" },
  { "X-Forwarded-Proto": "http" },
  { "X-Forwarded-Host": "couch.home.arpa, attacker.example" },
  { Origin: "https://attacker.example" },
] as Record<string, string>[]) test(`proxied admission rejects mismatched proxy headers ${JSON.stringify(headers)}`, async () => {
  const hub = fixture();
  const token = await pair(hub);
  expect((await request(hub, "/api/controllers/me", { proxied: true, token, headers })).status).toBe(403);
});

test("forwarded headers require both configured HTTPS proxy access and a trusted transport peer", async () => {
  for (const httpsProxy of [null, { origin, trustedProxyIps: ["192.0.2.10"] }]) {
    const hub = fixture(httpsProxy);
    expect((await request(hub, "/api/connection", { proxied: true })).status).toBe(403);
  }
});

for (const operation of ["sharing", "revoke"] as const) test(`${operation} closes an authenticated proxied socket and blocks reuse`, async () => {
  const hub = fixture(), token = await pair(hub), peer = new Peer(hub, token);
  await peer.wait(message => message.type === "state");
  const closed = peer.closed();
  if (operation === "sharing") expect((await request(hub, "/api/settings/sharing", { token: hostToken, method: "POST", body: { enabled: false } })).status).toBe(200);
  else {
    const identity = await (await request(hub, "/api/controllers/me", { token })).json() as { controller: { id: string } };
    expect((await request(hub, `/api/controllers/${identity.controller.id}`, { token: hostToken, method: "DELETE" })).status).toBe(200);
  }
  expect(await closed).toBe(operation === "sharing" ? 4003 : 4001);
  expect((await request(hub, "/api/controllers/me", { proxied: true, token })).status).toBe(operation === "sharing" ? 403 : 401);
  expect((await request(hub, `/api/ws?token=${token}`, { proxied: true })).status).toBe(operation === "sharing" ? 403 : 401);
});
