import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Identity } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";

// Admins manage the shared Couch from any paired device; controllers and unpaired devices can't.
const hostToken = "h".repeat(64);
async function fixture(options: { nativeTvMode?: (enabled: boolean) => Promise<void> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "couch-settings-authority-"));
  const databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  // The first paired device is the admin; the next is a controller.
  const adminId = Identity.generate().peerId, admin = store.pair(adminId, "Phone");
  const controller = store.pair(Identity.generate().peerId, "Laptop");
  store.close();
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0, ...options });
  const post = (path: string, bearer: string, body: unknown) => fetch(`${hub.origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { hub, admin, adminId, controller, post, close: async () => { await hub.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("an admin switches TV mode through the Couch app; others can't", async () => {
  const requests: boolean[] = [];
  const f = await fixture({ nativeTvMode: async enabled => { requests.push(enabled); } });
  try {
    assert.equal((await fetch(`${f.hub.origin}/api/connection`).then(response => response.json())).tvModeChangeable, true);
    assert.equal((await f.post("/api/settings/tv-mode", "unpaired", { enabled: true })).status, 401);
    assert.equal((await f.post("/api/settings/tv-mode", f.controller, { enabled: true })).status, 403);
    assert.equal((await f.post("/api/settings/tv-mode", f.admin, { enabled: "yes" })).status, 400);
    assert.deepEqual(requests, [], "refused requests never reach the app");
    const admitted = await f.post("/api/settings/tv-mode", f.admin, { enabled: true });
    assert.equal(admitted.status, 200);
    assert.deepEqual(await admitted.json(), { enabled: true });
    assert.equal((await f.post("/api/settings/tv-mode", hostToken, { enabled: false })).status, 200);
    assert.deepEqual(requests, [true, false]);
  } finally { await f.close(); }
});

test("TV mode reports why it can't change: the app's own refusal, no app, or a TV launcher", async () => {
  const refused = await fixture({ nativeTvMode: async () => { throw new Error("Couch is restarting or closing."); } });
  try {
    const response = await refused.post("/api/settings/tv-mode", refused.admin, { enabled: true });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /restarting/);
  } finally { await refused.close(); }
  const standalone = await fixture();
  try {
    assert.equal((await fetch(`${standalone.hub.origin}/api/connection`).then(response => response.json())).tvModeChangeable, false);
    assert.equal((await standalone.post("/api/settings/tv-mode", standalone.admin, { enabled: true })).status, 409);
  } finally { await standalone.close(); }
  const previous = process.env.COUCH_TV_APPLIANCE;
  process.env.COUCH_TV_APPLIANCE = "1";
  const appliance = await fixture({ nativeTvMode: async () => assert.fail("a launcher-locked TV must not switch") });
  try {
    const details = await fetch(`${appliance.hub.origin}/api/connection`).then(response => response.json());
    assert.equal(details.tvAppliance, true);
    assert.equal(details.tvModeChangeable, false);
    const response = await appliance.post("/api/settings/tv-mode", appliance.admin, { enabled: false });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /launcher/);
  } finally {
    await appliance.close();
    if (previous === undefined) delete process.env.COUCH_TV_APPLIANCE; else process.env.COUCH_TV_APPLIANCE = previous;
  }
});

test("Share on network is admin-managed, and a demoted admin loses it", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await (await fetch(`${f.hub.origin}/api/settings/sharing`, { headers: { Authorization: `Bearer ${f.controller}` } })).json(), { enabled: true }, "every paired device reads it");
    assert.equal((await f.post("/api/settings/sharing", f.controller, { enabled: false })).status, 403);
    assert.equal((await f.post(`/api/devices/${f.adminId}/role`, hostToken, { role: "controller" })).status, 200);
    assert.equal((await f.post("/api/settings/sharing", f.admin, { enabled: false })).status, 403);
    assert.equal((await f.post(`/api/devices/${f.adminId}/role`, hostToken, { role: "administrator" })).status, 200);
    const off = await f.post("/api/settings/sharing", f.admin, { enabled: false });
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { enabled: false });
    assert.equal((await f.post("/api/settings/sharing", f.admin, { enabled: true })).status, 503, "only the host turns sharing back on");
    assert.equal((await f.post("/api/settings/sharing", hostToken, { enabled: true })).status, 200);
  } finally { await f.close(); }
});

test("advanced audio settings require administrator authority and validate before saving", async () => {
  const f = await fixture();
  const path = "/api/settings/audio";
  try {
    assert.equal((await f.post(path, "unpaired", { liveAudioLeadMs: 150 })).status, 401);
    assert.equal((await f.post(path, f.controller, { liveAudioLeadMs: 150 })).status, 403);
    for (const [token, status] of [["unpaired", 401], [f.controller, 403]] as const)
      assert.equal((await fetch(`${f.hub.origin}${path}`, { headers: { Authorization: `Bearer ${token}` } })).status, status);
    for (const value of ["55", 54, null, -1]) assert.equal((await f.post(path, f.admin, { liveAudioLeadMs: value })).status, 400);
    const read = () => fetch(`${f.hub.origin}${path}`, { headers: { Authorization: `Bearer ${f.admin}` } }).then(r => r.json());
    assert.deepEqual(await read(), { liveAudioLeadMs: 100 });
    assert.equal((await f.post(path, f.admin, { liveAudioLeadMs: 150 })).status, 200);
    assert.deepEqual(await read(), { liveAudioLeadMs: 150 });
  } finally { await f.close(); }
});
