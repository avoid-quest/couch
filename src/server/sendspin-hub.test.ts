import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSendspinClientIdentity, SendspinCore } from "@sendspin/sendspin-js";
import { createHub, type Hub } from "./hub";
import { openSendspinIdentity } from "./sendspin-identity";

const hostToken = "sendspin-hub-host-token-123456789012345678901234";
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type Enrollment = { available: boolean; url: string; name: string; serverId: string; psk: string; softwareOutputQualified: boolean };
function fixture(publicUrl?: string, localNative = false) {
  const directory = mkdtempSync(join(tmpdir(), "sendspin-hub-")), databasePath = join(directory, "state.sqlite");
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const start = () => {
    const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath, hostToken, pairingCode: "123456", ...(localNative ? { sendPlayer: () => {} } : {}), sendspin: { host: "127.0.0.1", port: 0, name: "Rooms", ...(publicUrl ? { publicUrl } : {}) } });
    let closing: Promise<void> | undefined;
    const close = () => closing ??= hub.close();
    cleanup.push(close);
    return { hub, close };
  };
  return { ...start(), start, databasePath };
}
const api = (hub: Hub, token: string, path = "/api/sendspin/enrollment", method = "GET", body?: unknown) => fetch(`${hub.origin}${path}`, { method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
async function pair(hub: Hub) {
  const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
  expect(response.status).toBe(200);
  return (await response.json() as { token: string }).token;
}
function identity() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  return { storage, clientId: loadSendspinClientIdentity(storage).clientId };
}
async function enroll(hub: Hub, token: string, clientId: string) {
  const response = await api(hub, token, undefined, "POST", { clientId });
  expect(response.status).toBe(200);
  return await response.json() as Enrollment;
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Sendspin state did not settle"); await Bun.sleep(10); }
}
async function connected(hub: Hub, token: string, id = identity(), rendererTargetId?: string) {
  const enrollment = rendererTargetId ? await (await api(hub, token, undefined, "POST", { clientId: id.clientId, rendererTargetId })).json() as Enrollment : await enroll(hub, token, id.clientId);
  const client = new SendspinCore({ baseUrl: enrollment.url.replace(/\/sendspin$/, ""), suite: "aesgcm", clientName: "Official JS client", storage: id.storage, codecs: ["pcm"], unpairedAccess: false,
    longTermPsks: [{ psk: enrollment.psk, serverId: enrollment.serverId }], reconnect: { maxAttempts: 0 }, requiredLeadTimeMs: 250, minBufferMs: 250 });
  cleanup.push(() => client.disconnect());
  await client.connect();
  await until(() => client.isConnected);
  return { client, id, enrollment };
}

test("Sendspin discovery requires authentication and reports disabled hosting without enrollment", async () => {
  const { hub } = fixture();
  expect((await fetch(`${hub.origin}/api/sendspin/enrollment`, { headers: { Origin: hub.origin } })).status).toBe(401);
  const token = await pair(hub);
  expect((await api(hub, hostToken, "/api/settings/sendspin", "POST", { enabled: false })).status).toBe(200);
  expect(await (await api(hub, token)).json()).toEqual({ available: false });
  expect((await api(hub, token, undefined, "POST", { clientId: identity().clientId })).status).toBe(503);
});

test("official JS identities enroll idempotently, reject ownership collisions, and retain Core identity across restart", async () => {
  const f = fixture(), owner = await pair(f.hub), other = await pair(f.hub), id = identity();
  const Socket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  const socket = new Socket(`${f.hub.origin.replace("http:", "ws:")}/api/ws?token=${other}&clientProtocol=1`, { headers: { Origin: f.hub.origin } });
  const messages: string[] = [];
  socket.addEventListener("message", event => messages.push(String(event.data)));
  cleanup.push(() => socket.close());
  await until(() => messages.some(message => JSON.parse(message).type === "state"));
  const first = await enroll(f.hub, owner, id.clientId);
  expect(first.available).toBe(true); expect(first.name).toBe("Rooms");
  expect(first.serverId).toMatch(/^[\w-]{43}$/); expect(first.psk).toMatch(/^[\w-]{43}$/);
  expect(new URL(first.url).pathname).toBe("/sendspin");
  expect(Number(new URL(first.url).port)).toBeGreaterThan(0);
  expect(await enroll(f.hub, owner, id.clientId)).toEqual(first);
  expect((await api(f.hub, other, undefined, "POST", { clientId: id.clientId })).status).toBe(400);
  expect((await api(f.hub, owner, undefined, "POST", { clientId: "not-an-identity" })).status).toBe(400);
  expect(JSON.stringify(await (await api(f.hub, other)).json())).not.toContain(first.psk);
  expect(JSON.stringify(f.hub.session.state)).not.toContain(first.psk);
  expect(messages.join("\n")).not.toContain(first.psk);
  await f.close();
  const reopened = f.start();
  const again = await enroll(reopened.hub, owner, id.clientId);
  expect(again.serverId).toBe(first.serverId); expect(again.psk).toBe(first.psk);
});

test("a configured secure public URL is returned without exposing enrollment secrets in discovery", async () => {
  const { hub } = fixture("wss://rooms.example/sendspin"), token = await pair(hub);
  const response = await api(hub, token);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ available: true, url: "wss://rooms.example/sendspin", name: "Rooms", serverId: expect.any(String) });
});

test("only an authenticated controller's live Couch renderer qualifies its enrolled software output", async () => {
  const { hub, databasePath } = fixture(), owner = await pair(hub), other = await pair(hub), managed = identity(), external = identity();
  const Socket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  const socket = new Socket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${owner}&clientProtocol=1`, { headers: { Origin: hub.origin } });
  cleanup.push(() => socket.close());
  const messages: any[] = [];
  socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))));
  await until(() => messages.some(message => message.type === "state"));
  socket.send(JSON.stringify({ type: "registerRenderer" }));
  await until(() => messages.some(message => message.type === "rendererRegistered"));
  const rendererTargetId = messages.find(message => message.type === "rendererRegistered").targetId as string;
  expect((await enroll(hub, owner, external.clientId)).softwareOutputQualified).toBe(false);
  expect((await api(hub, other, undefined, "POST", { clientId: managed.clientId, rendererTargetId })).status).toBe(400);
  expect((await api(hub, owner, undefined, "POST", { clientId: managed.clientId, rendererTargetId: "other" })).status).toBe(400);
  const qualified = await enroll(hub, owner, managed.clientId);
  expect(qualified.softwareOutputQualified).toBe(false);
  const response = await api(hub, owner, undefined, "POST", { clientId: managed.clientId, rendererTargetId });
  expect(response.status).toBe(200);
  expect((await response.json()).softwareOutputQualified).toBe(true);
  const live = await connected(hub, owner, managed, rendererTargetId);
  const { controller } = await (await api(hub, owner, "/api/controllers/me")).json() as { controller: { id: string } };
  expect((await api(hub, owner, `/api/controllers/${controller.id}/name`, "POST", { name: "Living room" })).status).toBe(200);
  expect(live.client.isConnected).toBe(true);
  const saved = openSendspinIdentity(databasePath);
  try { expect(saved.softwareOutputQualified(managed.clientId)).toBe(true); expect(saved.deviceId(managed.clientId)).toBe(rendererTargetId); expect(saved.softwareOutputQualified(external.clientId)).toBe(false); }
  finally { saved.close(); }
  socket.close();
  await until(() => socket.readyState === WebSocket.CLOSED);
  expect((await api(hub, owner, undefined, "POST", { clientId: external.clientId, rendererTargetId })).status).toBe(400);
});

test("native receiver and trusted local native target can associate their own SDK output", async () => {
  const { hub } = fixture(undefined, true), owner = await pair(hub), remote = identity(), local = identity();
  const Socket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  const socket = new Socket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${owner}&clientProtocol=1`, { headers: { Origin: hub.origin } });
  cleanup.push(() => socket.close());
  const messages: any[] = [];
  socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))));
  await until(() => messages.some(message => message.type === "state"));
  socket.send(JSON.stringify({ type: "registerNativeRenderer", nonce: crypto.randomUUID() }));
  await until(() => messages.some(message => message.type === "rendererRegistered"));
  const receiverId = messages.find(message => message.type === "rendererRegistered").targetId as string;
  expect(receiverId).toStartWith("receiver-");
  expect((await api(hub, owner, undefined, "POST", { clientId: remote.clientId, rendererTargetId: receiverId })).status).toBe(200);
  expect((await api(hub, hostToken, undefined, "POST", { clientId: local.clientId, rendererTargetId: receiverId })).status).toBe(400);
  expect((await api(hub, owner, undefined, "POST", { clientId: local.clientId, rendererTargetId: "native" })).status).toBe(400);
  hub.session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
  expect((await api(hub, hostToken, undefined, "POST", { clientId: local.clientId, rendererTargetId: "native" })).status).toBe(200);
});

test("controller revocation deletes its PSK and disconnects only its Noise client, while disabling remotes disconnects all", async () => {
  const { hub, databasePath } = fixture(), owner = await pair(hub), other = await pair(hub);
  const first = await connected(hub, owner), second = await connected(hub, other);
  expect(JSON.stringify(hub.session.state)).not.toContain(first.enrollment.psk);
  expect(JSON.stringify(hub.session.state)).not.toContain(second.enrollment.psk);
  const { controller } = await (await api(hub, owner, "/api/controllers/me")).json() as { controller: { id: string } };
  expect((await api(hub, hostToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
  await until(() => !first.client.isConnected);
  expect(second.client.isConnected).toBe(true);
  const saved = openSendspinIdentity(databasePath);
  try { expect(saved.lookup(first.id.clientId)).toBeNull(); expect(saved.lookup(second.id.clientId)).toBe(second.enrollment.psk); }
  finally { saved.close(); }
  expect((await api(hub, owner, undefined, "POST", { clientId: first.id.clientId })).status).toBe(401);
  expect((await api(hub, hostToken, "/api/settings/sharing", "POST", { enabled: false })).status).toBe(200);
  await until(() => !second.client.isConnected);
});

test("enrollment rechecks controller authority after waiting for the request body", async () => {
  const { hub, databasePath } = fixture(), token = await pair(hub), id = identity();
  const { controller } = await (await api(hub, token, "/api/controllers/me")).json() as { controller: { id: string } };
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const request = new Request(`${hub.origin}/api/sendspin/enrollment`, { method: "POST", headers: { Host: new URL(hub.origin).host, Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: new ReadableStream({ async pull(stream) { entered.resolve(); await release.promise; stream.enqueue(new TextEncoder().encode(JSON.stringify({ clientId: id.clientId }))); stream.close(); } }, { highWaterMark: 0 }) });
  try {
    const pending = hub.server.fetch(request);
    await entered.promise;
    expect((await api(hub, hostToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
    release.resolve();
    expect((await pending).status).toBe(401);
    const saved = openSendspinIdentity(databasePath);
    try { expect(saved.lookup(id.clientId)).toBeNull(); } finally { saved.close(); }
  } finally { release.resolve(); }
});
