import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSendspinClientIdentity, SendspinCore } from "@sendspin/sendspin-js";
import { createHub, type Hub } from "./hub";
import { openSendspinIdentity } from "./sendspin-identity";
import type { SendspinHostingState } from "../shared/sendspin";

const hostToken = "sendspin-settings-host-token-12345678901234567890";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "sendspin-settings-"));
  const databasePath = join(directory, "state.sqlite");
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const start = (options: { sendspin?: { host: string; port: number; name: string }; sendspinConfigError?: string } = {}) => {
    const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath, hostToken, pairingCode: "123456", ...options });
    cleanup.push(() => hub.close());
    return hub;
  };
  return { start, databasePath };
}
const api = (hub: Hub, token: string, method = "GET", body?: unknown) => fetch(`${hub.origin}/api/settings/sendspin`, {
  method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const state = async (hub: Hub) => await (await api(hub, hostToken)).json() as SendspinHostingState;
const until = async (predicate: () => Promise<boolean>) => { const end = Date.now() + 2000; while (!await predicate()) { if (Date.now() > end) throw new Error("Sendspin did not settle."); await Bun.sleep(10); } };
async function pair(hub: Hub) {
  const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
  expect(response.status).toBe(200);
  return (await response.json() as { token: string }).token;
}

test("hosting settings require an administrator and validate the bounded body", async () => {
  const hub = fixture().start(), admin = await pair(hub), controller = await pair(hub);
  expect((await api(hub, controller)).status).toBe(403);
  expect((await api(hub, controller, "POST", { enabled: true })).status).toBe(403);
  expect((await api(hub, admin, "POST", { enabled: "yes" })).status).toBe(400);
  expect((await api(hub, hostToken, "PUT")).status).toBe(405);
  expect(await state(hub)).toEqual({ enabled: false, active: false, restartRequired: false, configuredExternally: false, error: null });
});

test("enabling persists for restart and disabling closes hosting until a later restart", async () => {
  const f = fixture(), first = f.start();
  expect(await (await api(first, hostToken, "POST", { enabled: true })).json()).toEqual({ enabled: true, active: false, restartRequired: true, configuredExternally: false, error: null });
  expect(await (await fetch(`${first.origin}/api/sendspin/enrollment`, { headers: { Origin: first.origin, Authorization: `Bearer ${hostToken}` } })).json()).toEqual({ available: false });
  await first.close();
  const config = { host: "127.0.0.1", port: 0, name: "Rooms" };
  const second = f.start({ sendspin: config });
  await until(async () => (await state(second)).active);
  expect((await state(second)).restartRequired).toBe(false);
  const response = await api(second, hostToken, "POST", { enabled: false });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: false, active: false, restartRequired: false, configuredExternally: true, error: null });
  expect(await (await fetch(`${second.origin}/api/sendspin/enrollment`, { headers: { Origin: second.origin, Authorization: `Bearer ${hostToken}` } })).json()).toEqual({ available: false });
  expect((await api(second, hostToken, "POST", { enabled: true })).status).toBe(200);
  expect((await state(second)).restartRequired).toBe(true);
  await second.close();
  const third = f.start({ sendspin: config });
  await until(async () => (await state(third)).active);
  expect((await state(third)).restartRequired).toBe(false);
});

test("external configuration remains the inherited default and a saved false overrides it", async () => {
  const f = fixture(), config = { host: "127.0.0.1", port: 0, name: "Rooms" };
  const first = f.start({ sendspin: config });
  await until(async () => (await state(first)).active);
  expect(await state(first)).toEqual({ enabled: true, active: true, restartRequired: false, configuredExternally: true, error: null });
  await api(first, hostToken, "POST", { enabled: false });
  await first.close();
  const second = f.start({ sendspin: config });
  expect(await state(second)).toEqual({ enabled: false, active: false, restartRequired: false, configuredExternally: true, error: null });
});

test("an invalid external configuration is reported without starting the default listener", async () => {
  const hub = fixture().start({ sendspinConfigError: "Invalid COUCH_SENDSPIN_CONFIG." });
  expect(await state(hub)).toEqual({ enabled: true, active: false, restartRequired: false, configuredExternally: true, error: "Invalid COUCH_SENDSPIN_CONFIG." });
  expect((await fetch(`${hub.origin}/api/sendspin/enrollment`, { method: "POST", headers: { Origin: hub.origin, Authorization: `Bearer ${hostToken}` } })).status).toBe(503);
});

test("listener address failure is visible and enrollment remains unavailable", async () => {
  const occupied = createServer();
  await new Promise<void>(resolve => occupied.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => occupied.close(() => resolve())));
  const port = (occupied.address() as { port: number }).port;
  const hub = fixture().start({ sendspin: { host: "127.0.0.1", port, name: "Rooms" } });
  await until(async () => !!(await state(hub)).error);
  expect(await state(hub)).toEqual({ enabled: true, active: false, restartRequired: false, configuredExternally: true, error: "Sendspin could not listen on the configured address." });
  expect(await (await fetch(`${hub.origin}/api/sendspin/enrollment`, { headers: { Origin: hub.origin, Authorization: `Bearer ${hostToken}` } })).json()).toEqual({ available: false });
});

test("settings POST rechecks administrator authority after reading the body", async () => {
  const hub = fixture().start(), token = await pair(hub);
  const me = await fetch(`${hub.origin}/api/controllers/me`, { headers: { Origin: hub.origin, Authorization: `Bearer ${token}` } });
  const { controller } = await me.json() as { controller: { id: string } };
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const request = new Request(`${hub.origin}/api/settings/sendspin`, { method: "POST", headers: { Host: new URL(hub.origin).host, Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: new ReadableStream({ async pull(stream) { entered.resolve(); await release.promise; stream.enqueue(new TextEncoder().encode('{"enabled":true}')); stream.close(); } }, { highWaterMark: 0 }) });
  try {
    const pending = hub.server.fetch(request);
    await entered.promise;
    const revoke = await fetch(`${hub.origin}/api/controllers/${controller.id}`, { method: "DELETE", headers: { Origin: hub.origin, Authorization: `Bearer ${hostToken}` } });
    expect(revoke.status).toBe(200);
    release.resolve();
    expect((await pending).status).toBe(403);
    expect((await state(hub)).enabled).toBe(false);
  } finally { release.resolve(); }
});

test("disabling terminates transport sockets and rejects later admissions", async () => {
  const hub = fixture().start({ sendspin: { host: "127.0.0.1", port: 0, name: "Rooms" } });
  await until(async () => (await state(hub)).active);
  const enrollment = await fetch(`${hub.origin}/api/sendspin/enrollment`, { headers: { Origin: hub.origin, Authorization: `Bearer ${hostToken}` } });
  const { url } = await enrollment.json() as { url: string };
  const socket = new WebSocket(url);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error("Socket did not open.")), { once: true }); });
  const closed = new Promise<void>(resolve => socket.addEventListener("close", () => resolve(), { once: true }));
  expect((await api(hub, hostToken, "POST", { enabled: false })).status).toBe(200);
  await closed;
  expect((await state(hub)).active).toBe(false);
  expect(hub.session.state.targets?.find(target => target.id === "sendspin-group")?.connected).toBe(false);
  expect((await fetch(`${hub.origin}/api/sendspin/enrollment`, { method: "POST", headers: { Origin: hub.origin, Authorization: `Bearer ${hostToken}` } })).status).toBe(503);
});

test("controller revocation removes a saved PSK while hosting is disabled", async () => {
  const f = fixture(), config = { host: "127.0.0.1", port: 0, name: "Rooms" };
  const first = f.start({ sendspin: config }), owner = await pair(first);
  await until(async () => (await state(first)).active);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const clientId = loadSendspinClientIdentity(storage).clientId;
  const enrollment = await fetch(`${first.origin}/api/sendspin/enrollment`, { method: "POST", headers: { Origin: first.origin, Authorization: `Bearer ${owner}`, "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) });
  expect(enrollment.status).toBe(200);
  const { psk, serverId } = await enrollment.json() as { psk: string; serverId: string };
  expect((await api(first, hostToken, "POST", { enabled: false })).status).toBe(200);
  await first.close();

  const second = f.start({ sendspin: config });
  const me = await fetch(`${second.origin}/api/controllers/me`, { headers: { Origin: second.origin, Authorization: `Bearer ${owner}` } });
  const { controller } = await me.json() as { controller: { id: string } };
  const revoked = await fetch(`${second.origin}/api/controllers/${controller.id}`, { method: "DELETE", headers: { Origin: second.origin, Authorization: `Bearer ${hostToken}` } });
  expect(revoked.status).toBe(200);
  const identity = openSendspinIdentity(f.databasePath);
  try { expect(identity.lookup(clientId)).toBeNull(); } finally { identity.close(); }
  expect((await api(second, hostToken, "POST", { enabled: true })).status).toBe(200);
  await second.close();

  const third = f.start({ sendspin: config });
  await until(async () => (await state(third)).active);
  const discovery = await fetch(`${third.origin}/api/sendspin/enrollment`, { headers: { Origin: third.origin, Authorization: `Bearer ${hostToken}` } });
  const { url } = await discovery.json() as { url: string };
  const client = new SendspinCore({ baseUrl: url.replace(/\/sendspin$/, ""), suite: "aesgcm", clientName: "Revoked client", storage, codecs: ["pcm"], unpairedAccess: false,
    longTermPsks: [{ psk, serverId }], reconnect: { maxAttempts: 0 }, requiredLeadTimeMs: 250, minBufferMs: 250 });
  cleanup.push(() => client.disconnect());
  await client.connect();
  await until(async () => !client.isConnected);
  expect(client.isConnected).toBe(false);
  expect(third.session.state.targets?.find(target => target.id === "sendspin-group")?.members?.some(member => member.id === clientId && member.connected)).toBe(false);
});
