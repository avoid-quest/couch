import WebSocket from "ws";
import { once } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { Identity } from "@sonn-audio/node-sendspin";
import { liveTurnFromEnvironment } from "../src/server/live-ice";

test("TURN environment configuration is optional and requires a complete TURN URL and credentials", () => {
  assert.equal(liveTurnFromEnvironment({}), undefined);
  assert.deepEqual(liveTurnFromEnvironment({ COUCH_LIVE_TURN_URL: "turn:relay.example:3478?transport=tcp", COUCH_LIVE_TURN_USERNAME: "fixture", COUCH_LIVE_TURN_CREDENTIAL: "fixture-credential" }), { urls: "turn:relay.example:3478?transport=tcp", username: "fixture", credential: "fixture-credential" });
  for (const environment of [{ COUCH_LIVE_TURN_URL: "https://relay.example" }, { COUCH_LIVE_TURN_URL: "turn:relay.example:3478" }, { COUCH_LIVE_TURN_CREDENTIAL: "fixture-credential" }]) {
    assert.throws(() => liveTurnFromEnvironment(environment), error => error instanceof Error && !error.message.includes("fixture-credential"));
  }
});

for (const source of ["environment", "saved"] as const) test(`standalone Core advertises ${source} TURN despite a saved built-in relay preference`, { timeout: 5000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-standalone-relay-"));
  const databasePath = join(directory, "couch.sqlite"), hostToken = "h".repeat(64);
  const liveTurn = { urls: "turn:environment.example:3478?transport=tcp", username: "fixture", credential: "fixture-credential" };
  const relay = source === "saved" ? { ...liveTurn, urls: "turn:saved.example:3478?transport=tcp" } : liveTurn;
  const store = openStore(databasePath, true);
  store.saveLocalRelayEnabled(true);
  if (source === "saved") store.saveLiveRelay(relay);
  const token = store.pair(Identity.generate().peerId, "Receiver");
  store.close();
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0, managedLan: false, liveTurn });
  const request = (path: string, bearer = hostToken, body?: unknown) => fetch(`${hub.origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.deepEqual(await (await request("/api/live/ice-servers", token)).json(), [relay]);
    assert.deepEqual(await (await request("/api/live/ice-servers")).json(), [relay]);
    assert.deepEqual(await (await request("/api/settings/live-relay/local")).json(), { enabled: false, status: "off", error: null, relay: null }, "standalone Core must leave the built-in helper off");
    assert.equal((await request("/api/settings/live-relay/local", hostToken, { enabled: true })).status, 400);
    await hub.close();
    const retained = openStore(databasePath, true);
    try { assert.equal(retained.localRelayEnabled(), true, "standalone Core must preserve the preference for a later managed-LAN run"); }
    finally { retained.close(); }
  } finally { await hub.close(); await rm(directory, { recursive: true, force: true }); }
});

test("TURN credentials reach only admitted paired devices and never public discovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-live-ice-"));
  const databasePath = join(directory, "couch.sqlite"), hostToken = "h".repeat(64);
  const store = openStore(databasePath, true);
  const id = Identity.generate().peerId, token = store.pair(id, "Receiver");
  store.close();
  const liveTurn = { urls: "turn:relay.example:3478?transport=tcp", username: "fixture", credential: "fixture-credential" };
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0, liveTurn });
  const request = (token?: string, origin = hub.origin) => fetch(`${hub.origin}/api/live/ice-servers`, { headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request("invalid")).status, 401);
    assert.equal((await request(token, "https://foreign.example")).status, 403);
    const admitted = await request(token);
    assert.equal(admitted.status, 200);
    assert.equal(admitted.headers.get("cache-control"), "no-store");
    assert.deepEqual(await admitted.json(), [liveTurn]);
    assert.deepEqual(await (await request(hostToken)).json(), [liveTurn]);
    const discovery = await fetch(`${hub.origin}/api/connection`).then(response => response.text());
    assert.ok(!discovery.includes(liveTurn.username));
    assert.ok(!discovery.includes(liveTurn.credential));
    assert.equal((await fetch(`${hub.origin}/api/devices/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${hostToken}`, Origin: hub.origin } })).status, 200);
    assert.equal((await request(token)).status, 401);
    assert.deepEqual(await (await request(hostToken)).json(), [liveTurn], "device removal must not change external relay settings");
    const disabled = await fetch(`${hub.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(disabled.status, 200);
    const rejected = await request(token);
    assert.equal(rejected.status, 503);
    assert.ok(!(await rejected.text()).includes(liveTurn.credential));
  } finally { await hub.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a host can save a relay for paired playback and keep it across a normal restart", { timeout: 5000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-live-relay-"));
  const databasePath = join(directory, "couch.sqlite"), hostToken = "h".repeat(64);
  const store = openStore(databasePath, true);
  const id = Identity.generate().peerId, token = store.pair(id, "Receiver");
  store.close();
  const relay = { urls: "turn:relay.example:3478?transport=tcp", username: "fixture", credential: "fixture-credential" };
  let hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
  const request = (path: string, bearer = hostToken, body?: unknown) => fetch(`${hub.origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const socket = new WebSocket(`${hub.origin.replace("http", "ws")}/api/ws?token=${token}&device=${id}`, { headers: { Origin: hub.origin } });
  const updates: { type: string; iceServers?: RTCIceServer[] }[] = [];
  socket.on("message", data => updates.push(JSON.parse(String(data))));
  const waitUpdate = async (count: number) => {
    const deadline = Date.now() + 1000;
    while (updates.filter(message => message.type === "liveIceServers").length < count) {
      assert.ok(Date.now() < deadline, "connected devices receive current ICE without reloading");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return updates.filter(message => message.type === "liveIceServers").at(-1)!.iceServers;
  };
  try {
    await once(socket, "open");
    assert.deepEqual(await waitUpdate(1), [], "socket admission closes the race after the initial ICE fetch");
    const save = await request("/api/settings/live-relay", hostToken, { relay });
    assert.equal(save.status, 200, "normal packaged settings must configure the proven relay route without launch variables");
    assert.deepEqual(await (await request("/api/live/ice-servers", token)).json(), [relay]);
    assert.deepEqual(await waitUpdate(2), [relay]);
    socket.close();
    await once(socket, "close");
    assert.equal((await request("/api/settings/live-relay", token)).status, 403);
    assert.equal((await request("/api/settings/live-relay", token, { relay: null })).status, 403);
    assert.equal((await request("/api/live/ice-servers", "invalid")).status, 401);
    for (const path of ["/api/connection", "/api/health"]) {
      const body = await fetch(`${hub.origin}${path}`).then(response => response.text());
      assert.ok(!body.includes(relay.credential));
    }
    const invalid = await request("/api/settings/live-relay", hostToken, { relay: { ...relay, urls: "https://invalid.example" } });
    assert.equal(invalid.status, 400);
    assert.ok(!(await invalid.text()).includes(relay.credential));
    await hub.close();
    hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
    assert.deepEqual(await (await request("/api/live/ice-servers", token)).json(), [relay], "restart with no TURN launch configuration retains authenticated ICE");
    assert.deepEqual(await (await request("/api/settings/live-relay")).json(), { relay, source: "saved" });
    assert.equal((await request("/api/settings/live-relay", hostToken, { relay: null })).status, 200);
    await hub.close();
    hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0, liveTurn: relay });
    assert.deepEqual(await (await request("/api/live/ice-servers", token)).json(), [], "saved removal overrides launch defaults");
  } finally { socket.terminate(); await hub.close(); await rm(directory, { recursive: true, force: true }); }
});
