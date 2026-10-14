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
    const disabled = await fetch(`${hub.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(disabled.status, 200);
    const rejected = await request(token);
    assert.equal(rejected.status, 503);
    assert.ok(!(await rejected.text()).includes(liveTurn.credential));
  } finally { await hub.close(); await rm(directory, { recursive: true, force: true }); }
});
