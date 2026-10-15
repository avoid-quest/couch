import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { networkInterfaces, tmpdir } from "node:os";
import { createConnection } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import WebSocket from "ws";
import { createLocalRelay } from "../src/server/live-relay";
import { createHub } from "../src/server/hub";
import { selectLan } from "../src/server/lan-listener";
import { openStore } from "../src/server/store";
import type { LiveRelay } from "../src/shared/live-relay";
import { delayedRelay } from "./fixtures/delayed-relay";

const relayExecutable = join(process.cwd(), "build/live-relay", process.platform === "win32" ? "couch-relay.exe" : "couch-relay");
const network = Object.entries(networkInterfaces()).flatMap(([name, entries]) => { try { return [selectLan({ [name]: entries }, name)]; } catch { return []; } })[0];
const reachable = (url: string) => new Promise<boolean>(resolve => {
  const [host, port] = url.slice(5).split("?")[0]!.split(":");
  const socket = createConnection({ host, port: Number(port) });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

test("device removal retires cached TURN credentials and existing allocations, and refreshes surviving devices", { skip: !network, timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-relay-revoke-"));
  const clientExecutable = join(directory, process.platform === "win32" ? "turn-client.exe" : "turn-client");
  const executable = join(directory, process.platform === "win32" ? "relay.exe" : "relay");
  await copyFile(relayExecutable, executable);
  execFileSync("go", ["test", "-c", "-o", clientExecutable, "."], { cwd: "native/live-relay", stdio: "pipe" });
  const previous = process.env.COUCH_LAN_INTERFACE, previousAddress = process.env.COUCH_LAN_ADDRESS;
  process.env.COUCH_LAN_INTERFACE = network!.name; process.env.COUCH_LAN_ADDRESS = network!.address;
  const databasePath = join(directory, "couch.sqlite"), hostToken = "h".repeat(64), removedId = "r".repeat(43), survivorId = "s".repeat(43);
  const store = openStore(databasePath, true);
  store.saveLocalRelayEnabled(true);
  const removedToken = store.pair(removedId, "Removed"), survivorToken = store.pair(survivorId, "Survivor");
  store.close();
  const hub = await createHub({ databasePath, hostToken, port: 0, managedLan: true, advertisedUrls: [], relayExecutable: executable, liveTurn: { urls: "turn:external.invalid:3478", username: "external", credential: "external-test" } });
  t.after(async () => {
    await hub.close();
    if (previous === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previous;
    if (previousAddress === undefined) delete process.env.COUCH_LAN_ADDRESS; else process.env.COUCH_LAN_ADDRESS = previousAddress;
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path: string, token = hostToken, method = "GET") => fetch(`${hub.origin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: hub.origin } });
  const currentRelay = async (token: string) => (await (await request("/api/live/ice-servers", token)).json() as LiveRelay[]).find(value => value.urls.startsWith("turn:"));
  const deadline = Date.now() + 4000;
  let original: LiveRelay | undefined;
  while (!(original = await currentRelay(removedToken))) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  const client = async (relay: LiveRelay) => {
    const child = spawn(clientExecutable, ["-test.run=^TestRevocationClientProcess$"], { env: { ...process.env, COUCH_TEST_REVOCATION_CLIENT: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    const exited = once(child, "close");
    t.after(() => { child.kill(); });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    child.stdin.on("error", () => {});
    child.stdin.write(`${JSON.stringify(relay)}\n`);
    const response = async () => JSON.parse((await lines.next()).value ?? "null") as { allocated?: boolean; released?: boolean };
    const allocated = (await response()).allocated;
    return {
      allocated,
      async released() { child.stdin.end('"released"\n'); assert.equal((await response()).released, true); assert.equal((await exited)[0], 0); },
      async close() { child.stdin.end(); assert.equal((await exited)[0], 0); },
    };
  };
  const existing = await client(original);
  assert.equal(existing.allocated, true, "cached credentials can relay real data before removal");
  const updates: LiveRelay[][] = [];
  const socket = new WebSocket(`${hub.origin.replace("http", "ws")}/api/ws?token=${survivorToken}&device=${survivorId}`, { origin: hub.origin });
  t.after(() => socket.terminate());
  socket.on("message", data => { const message = JSON.parse(String(data)); if (message.type === "liveIceServers") updates.push(message.iceServers.filter((value: LiveRelay) => value.urls.startsWith("turn:"))); });
  await once(socket, "open");
  assert.equal((await request(`/api/devices/${removedId}`, hostToken, "DELETE")).status, 200);
  assert.equal((await request("/api/live/ice-servers", removedToken)).status, 401);
  await existing.released();
  const cached = await client(original);
  assert.equal(cached.allocated, false, "old endpoint must refuse new allocations"); await cached.close();
  const fresh = await currentRelay(survivorToken);
  assert.ok(fresh && fresh.credential !== original.credential, "remaining device receives rotated credentials");
  const replay = await client({ ...original, urls: fresh.urls });
  assert.equal(replay.allocated, false, "cached credentials must also fail against the replacement endpoint"); await replay.close();
  const admitted = await client(fresh);
  assert.equal(admitted.allocated, true, "surviving device can relay real data with fresh credentials");
  const updateDeadline = Date.now() + 2000;
  while (!updates.some(values => values.some(value => value.credential === fresh.credential))) { assert.ok(Date.now() < updateDeadline, "surviving socket must receive fresh ICE"); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(updates.some(values => values.length === 0), "old credentials are withdrawn during rotation");
  // A replacement failure must still retire the previous helper and never use external fallback.
  await rename(executable, `${executable}.retired`);
  assert.equal((await request(`/api/devices/${survivorId}`, hostToken, "DELETE")).status, 200);
  await admitted.released();
  assert.equal((await request("/api/live/ice-servers", survivorToken)).status, 401);
  assert.equal(await currentRelay(hostToken), undefined);
  assert.equal((await (await request("/api/settings/live-relay/local")).json()).status, "error");
});

test("revocation during startup never publishes the retired generation, including overlapping revocations", { skip: !network || process.platform === "win32", timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-relay-start-revoke-")), helper = await delayedRelay(directory);
  const published: string[] = [];
  const relay = createLocalRelay({ executable: helper.executable, enabled: true, changed: () => { const current = relay.state().relay; if (current) published.push(current.urls); } });
  t.after(async () => { await relay.close(); await rm(directory, { recursive: true, force: true }); });
  const starting = relay.setNetwork(network!);
  await helper.started(1);
  const revoked = relay.revoke(), again = relay.revoke();
  assert.equal(relay.state().relay, null);
  await helper.release(1);
  await helper.started(2);
  assert.equal(relay.state().relay, null);
  assert.deepEqual(published, [], "retired startup result must never reach ICE consumers");
  await helper.release(2);
  await Promise.all([starting, revoked, again]);
  assert.equal(relay.state().status, "running");
  assert.ok(published.every(url => url.includes(":40002?")));
});

for (const action of ["off", "network-loss", "close"] as const) test(`revocation racing ${action} during startup leaves no relay`, { skip: !network || process.platform === "win32", timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-relay-stop-revoke-")), helper = await delayedRelay(directory);
  const relay = createLocalRelay({ executable: helper.executable, enabled: true, changed() {} });
  t.after(async () => { await relay.close(); await rm(directory, { recursive: true, force: true }); });
  const starting = relay.setNetwork(network!);
  await helper.started(1);
  const revoked = relay.revoke();
  const stopped = action === "off" ? relay.setEnabled(false) : action === "network-loss" ? relay.setNetwork(null) : relay.close();
  await helper.release(1);
  await Promise.all([starting, revoked, stopped]);
  assert.equal(relay.state().relay, null);
  assert.equal(relay.state().status, action === "off" ? "off" : "waiting");
});

test("the bundled relay is opt-in, persisted, and stops with network sharing and Core", { skip: !network, timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-builtin-relay-"));
  const previousInterface = process.env.COUCH_LAN_INTERFACE;
  process.env.COUCH_LAN_INTERFACE = network!.name;
  const hostToken = "h".repeat(64), databasePath = join(directory, "couch.sqlite");
  const options = { databasePath, hostToken, port: 0, managedLan: true, advertisedUrls: [], relayExecutable };
  let hub = await createHub(options);
  const request = (path: string, body?: unknown, token = hostToken) => fetch(`${hub.origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  t.after(async () => { await hub.close(); if (previousInterface === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previousInterface; await rm(directory, { recursive: true, force: true }); });
  const initial = await request("/api/settings/live-relay/local");
  assert.equal(initial.status, 200, "normal app must offer its own relay without external infrastructure");
  assert.equal((await initial.json()).enabled, false);
  const external = { urls: "turn:external.invalid:3478", username: "external", credential: "external-test" };
  await request("/api/settings/live-relay", { relay: external });
  const state = () => request("/api/settings/live-relay/local").then(response => response.json());
  const ice = () => request("/api/live/ice-servers").then(response => response.json()) as Promise<RTCIceServer[]>;
  const running = async () => {
    const deadline = Date.now() + 3000;
    for (;;) {
      const current = await state();
      if (current.status === "running") return current;
      assert.ok(Date.now() < deadline, "bundled relay must become ready");
      assert.notEqual(current.status, "error", current.error);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  assert.equal((await request("/api/settings/live-relay/local", { enabled: true })).status, 200);
  const first = await running();
  assert.equal(await reachable(first.relay.urls), true);
  assert.ok(first.relay.urls.startsWith(`turn:${network!.address}:`));
  assert.deepEqual((await ice()).filter(value => String(value.urls).startsWith("turn:")), [first.relay], "built-in On never quietly uses external TURN");
  assert.equal((await request("/api/live/ice-servers", undefined, "unpaired")).status, 401);
  assert.equal((await request("/api/settings/sharing", { enabled: false })).status, 200);
  assert.equal(await reachable(first.relay.urls), false, "sharing Off releases helper listener");
  assert.equal((await state()).status, "waiting");
  assert.deepEqual((await ice()).filter(value => String(value.urls).startsWith("turn:")), []);
  await request("/api/settings/sharing", { enabled: true });
  const second = await running();
  assert.notEqual(first.relay.credential, second.relay.credential, "every run gets new private credentials");
  await hub.close();
  assert.equal(await reachable(second.relay.urls), false, "Core close releases helper listener");
  hub = await createHub(options);
  const restarted = await running();
  assert.equal(restarted.enabled, true, "toggle persists across ordinary restart");
  await request("/api/settings/live-relay/local", { enabled: false });
  assert.equal(await reachable(restarted.relay.urls), false, "toggle Off stops helper");
  assert.deepEqual((await ice()).filter(value => String(value.urls).startsWith("turn:")), [external]);
  await hub.close();
  hub = await createHub(options);
  assert.equal((await state()).status, "off", "saved Off persists");
  const paired = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode, id: "p".repeat(43), name: "Receiver" }) }).then(response => response.json());
  assert.ok(paired.token);
  assert.equal((await request("/api/settings/live-relay/local", { enabled: true }, paired.token)).status, 403);
  await hub.close();
  hub = await createHub({ ...options, relayExecutable: "/missing/couch-relay" });
  await request("/api/settings/live-relay/local", { enabled: true });
  const deadline = Date.now() + 2000;
  while ((await state()).status !== "error") { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.match((await state()).error, /could not be launched/);
  assert.deepEqual((await ice()).filter(value => String(value.urls).startsWith("turn:")), [], "failed built-in start must not use external fallback");
  assert.equal((await fetch(`${hub.origin}/api/health`)).status, 200, "relay failure leaves Core available");
});


test("selected LAN loss stops the helper and a missing bundled executable reports failure", { skip: !network, timeout: 10000 }, async () => {
  const relay = createLocalRelay({ executable: relayExecutable, enabled: true, changed() {} });
  try {
    await relay.setNetwork(network!);
    assert.equal(relay.state().status, "running");
    const url = relay.state().relay!.urls;
    await relay.setNetwork(null);
    assert.equal(relay.state().status, "waiting");
    assert.equal(await reachable(url), false);
    await relay.setNetwork(network!);
    assert.equal(relay.state().status, "running");
  } finally { await relay.close(); }
  const missing = createLocalRelay({ executable: "/missing/couch-relay", enabled: true, changed() {} });
  try {
    await missing.setNetwork(network!);
    assert.equal(missing.state().status, "error");
    assert.equal(missing.state().relay, null);
    assert.match(missing.state().error!, /could not be launched/);
  } finally { await missing.close(); }
});
