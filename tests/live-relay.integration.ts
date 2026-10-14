import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { networkInterfaces, tmpdir } from "node:os";
import { createConnection } from "node:net";
import { createLocalRelay } from "../src/server/live-relay";
import { createHub } from "../src/server/hub";
import { selectLan } from "../src/server/lan-listener";

const relayExecutable = join(process.cwd(), "build/live-relay", process.platform === "win32" ? "couch-relay.exe" : "couch-relay");
const network = Object.entries(networkInterfaces()).flatMap(([name, entries]) => { try { return [selectLan({ [name]: entries }, name)]; } catch { return []; } })[0];
const reachable = (url: string) => new Promise<boolean>(resolve => {
  const [host, port] = url.slice(5).split("?")[0]!.split(":");
  const socket = createConnection({ host, port: Number(port) });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
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
