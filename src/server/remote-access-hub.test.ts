import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "../shared/protocol";
import { createHub, type Hub } from "./hub";

const origin = "https://couch.example", hostToken = "remote-access-host-token-123456789012345678901";
const forwarded = { Host: "couch.example", "X-Forwarded-Host": "couch.example", "X-Forwarded-Proto": "https", Origin: origin };
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };

function fixture(remoteAccess: Parameters<typeof createHub>[0]["remoteAccess"] | null = { origin, trustedProxyIps: ["127.0.0.1"] }) {
  const directory = mkdtempSync(join(tmpdir(), "remote-access-hub-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "state.sqlite"), pairingCode: "123456", hostToken, remoteAccess: remoteAccess ?? undefined });
  cleanup.push(() => hub.close());
  return hub;
}
function request(hub: Hub, path: string, options: { external?: boolean; headers?: Record<string, string>; token?: string; method?: string; body?: unknown } = {}) {
  return fetch(`${hub.origin}${path}`, { method: options.method ?? "GET", headers: { ...(options.external ? forwarded : { Origin: hub.origin }), "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}
async function pair(hub: Hub, external = false) {
  const response = await request(hub, "/api/pair", { external, method: "POST", body: { code: hub.pairingCode } });
  expect(response.status).toBe(200);
  return (await response.json() as { token: string }).token;
}
class Peer {
  socket: WebSocket;
  messages: ServerMessage[] = [];
  listeners = new Set<() => void>();
  constructor(hub: Hub, token: string) {
    this.socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&clientProtocol=1`, { headers: forwarded });
    this.socket.addEventListener("message", event => { this.messages.push(JSON.parse(String(event.data))); for (const listener of this.listeners) listener(); });
    cleanup.push(() => this.close());
  }
  wait(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error("Timed out waiting for external WebSocket message")); }, 2000);
      const check = () => { const message = this.messages.findLast(predicate); if (message) { clearTimeout(timer); this.listeners.delete(check); resolve(message); } };
      this.listeners.add(check); check();
    });
  }
  closed() { return new Promise<number>(resolve => this.socket.addEventListener("close", event => resolve(event.code), { once: true })); }
  close() { if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(); const closed = this.closed(); this.socket.close(); return closed; }
}

test("external discovery publishes only the canonical URL and external pairing is opt-in", async () => {
  const hub = fixture();
  const response = await request(hub, "/api/connection", { external: true });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ urls: [origin], remoteControlEnabled: true });
  expect((await request(hub, "/api/pair", { external: true, method: "POST", body: { code: hub.pairingCode } })).status).toBe(403);
  const token = await pair(hub);
  expect((await request(hub, "/api/controllers/me", { external: true, token })).status).toBe(200);
  const direct = await request(hub, "/api/connection");
  expect(direct.status).toBe(200);
  expect((await direct.json() as { urls: string[] }).urls).toContain(hub.origin);
  expect((await request(hub, "/api/settings/sharing", { token: hostToken })).status).toBe(200);
});

test("explicit external pairing authenticates controller HTTP and renderer registration on WebSocket", async () => {
  const hub = fixture({ origin, trustedProxyIps: ["127.0.0.1"], pairing: true });
  const token = await pair(hub, true);
  expect((await request(hub, "/api/controllers/me", { external: true, token })).status).toBe(200);
  const peer = new Peer(hub, token);
  await peer.wait(message => message.type === "state");
  peer.socket.send(JSON.stringify({ type: "registerRenderer", capabilities: { mp4H264Aac: true, mp3: true } }));
  expect(await peer.wait(message => message.type === "rendererRegistered")).toMatchObject({ type: "rendererRegistered", targetId: expect.any(String) });
  peer.socket.send(JSON.stringify({ type: "command", requestId: "volume", action: { type: "volume", volume: 42 } }));
  expect(await peer.wait(message => message.type === "result" && message.requestId === "volume")).toMatchObject({ ok: true });
});

test("the private host token cannot authenticate through the trusted proxy", async () => {
  const hub = fixture();
  for (const path of ["/api/controllers/me", `/api/ws?token=${hostToken}&clientProtocol=1`]) expect((await request(hub, path, { external: true, token: hostToken })).status).toBe(401);
  expect((await request(hub, "/api/controllers/me", { token: hostToken })).status).toBe(200);
});

for (const headers of [
  { Host: "attacker.example" },
  { "X-Forwarded-Host": "attacker.example" },
  { "X-Forwarded-Proto": "http" },
  { "X-Forwarded-Host": "couch.example, attacker.example" },
  { Origin: "https://attacker.example" },
] as Record<string, string>[]) test(`external admission rejects mismatched proxy headers ${JSON.stringify(headers)}`, async () => {
  const hub = fixture();
  const token = await pair(hub);
  expect((await request(hub, "/api/controllers/me", { external: true, token, headers })).status).toBe(403);
});

test("forwarded headers require both configured remote access and a trusted transport peer", async () => {
  for (const remoteAccess of [null, { origin, trustedProxyIps: ["192.0.2.10"] }]) {
    const hub = fixture(remoteAccess);
    expect((await request(hub, "/api/connection", { external: true })).status).toBe(403);
  }
});

for (const operation of ["sharing", "revoke"] as const) test(`${operation} closes an authenticated external socket and blocks reuse`, async () => {
  const hub = fixture(), token = await pair(hub), peer = new Peer(hub, token);
  await peer.wait(message => message.type === "state");
  const closed = peer.closed();
  if (operation === "sharing") expect((await request(hub, "/api/settings/sharing", { token: hostToken, method: "POST", body: { enabled: false } })).status).toBe(200);
  else {
    const identity = await (await request(hub, "/api/controllers/me", { token })).json() as { controller: { id: string } };
    expect((await request(hub, `/api/controllers/${identity.controller.id}`, { token: hostToken, method: "DELETE" })).status).toBe(200);
  }
  expect(await closed).toBe(operation === "sharing" ? 4003 : 4001);
  expect((await request(hub, "/api/controllers/me", { external: true, token })).status).toBe(operation === "sharing" ? 403 : 401);
  expect((await request(hub, `/api/ws?token=${token}`, { external: true })).status).toBe(operation === "sharing" ? 403 : 401);
});
