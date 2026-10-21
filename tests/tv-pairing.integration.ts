import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Identity } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { TV_PAIRING_TTL } from "../src/server/tv-pairing";

// A TV shows a code; an admin approves it from a paired device; the TV collects its credentials.
const hostToken = "h".repeat(64);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "couch-tv-pairing-"));
  const databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  // The first paired device is the admin; the next is a controller.
  const admin = store.pair(Identity.generate().peerId, "Phone");
  const controller = store.pair(Identity.generate().peerId, "Laptop");
  store.close();
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
  const post = (path: string, body: unknown) => fetch(`${hub.origin}${path}`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ask = async (id = Identity.generate().peerId, name = "Living room TV") => {
    const response = await post("/api/pair/tv", { id, name });
    assert.equal(response.status, 200);
    return { id, ...await response.json() as { code: string; secret: string; expiresAt: number } };
  };
  const approve = (code: string, token?: string, method = "POST") => fetch(`${hub.origin}/api/pair/tv/${code}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const poll = (code: string, secret: string) => post("/api/pair/tv/poll", { code, secret });
  return { hub, admin, controller, post, ask, approve, poll, close: async () => { await hub.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("an admin approves a TV's code and the TV collects its credentials once", async () => {
  const f = await fixture();
  try {
    const request = await f.ask();
    assert.match(request.code, /^\d{6}$/);
    assert.deepEqual(await (await f.poll(request.code, request.secret)).json(), { waiting: true });
    assert.deepEqual(await (await f.approve(request.code, f.admin, "GET")).json(), { name: "Living room TV" });
    const approved = await f.approve(request.code, f.admin);
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).device.name, "Living room TV");
    assert.equal((await f.approve(request.code, f.admin)).status, 409, "a code is approved once");
    const credentials = await (await f.poll(request.code, request.secret)).json() as { token: string; installationId: string; device: { id: string; role: string } };
    assert.equal(credentials.device.id, request.id);
    assert.equal(credentials.device.role, "controller");
    assert.ok(credentials.installationId);
    const me = await fetch(`${f.hub.origin}/api/devices/me`, { headers: { Authorization: `Bearer ${credentials.token}` } });
    assert.equal(me.status, 200, "the collected token is a paired device's");
    assert.equal((await f.poll(request.code, request.secret)).status, 404, "credentials are handed over once");
    // The host approves too; a paired device can't ask again.
    const second = await f.ask();
    assert.equal((await f.approve(second.code, hostToken)).status, 200);
    assert.equal((await f.post("/api/pair/tv", { id: request.id, name: "Again" })).status, 409);
  } finally { await f.close(); }
});

test("a request expires after ten minutes", async () => {
  const f = await fixture();
  try {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const request = await f.ask();
    mock.timers.tick(TV_PAIRING_TTL + 1);
    assert.equal((await f.approve(request.code, f.admin)).status, 404);
    assert.equal((await f.poll(request.code, request.secret)).status, 404);
  } finally { mock.timers.reset(); await f.close(); }
});

test("a wrong secret collects nothing", async () => {
  const f = await fixture();
  try {
    const request = await f.ask();
    assert.equal((await f.approve(request.code, f.admin)).status, 200);
    for (const secret of ["", "x".repeat(request.secret.length), `${request.secret}x`, null]) {
      const response = await f.poll(request.code, secret as string);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).token, undefined);
    }
    assert.ok((await (await f.poll(request.code, request.secret)).json()).token, "the TV still collects its own");
  } finally { await f.close(); }
});

test("requests are rate-limited like pairing codes", async () => {
  const f = await fixture();
  try {
    for (let attempt = 0; attempt < 20; attempt++) await f.ask();
    const refused = await f.post("/api/pair/tv", { id: Identity.generate().peerId, name: "One too many" });
    assert.equal(refused.status, 429);
  } finally { await f.close(); }
});

test("only a paired admin approves", async () => {
  const f = await fixture();
  try {
    const request = await f.ask();
    assert.equal((await f.approve(request.code)).status, 401);
    assert.equal((await f.approve(request.code, "not-a-token")).status, 401);
    assert.equal((await f.approve(request.code, f.controller)).status, 403);
    assert.equal((await f.approve(request.code, f.controller, "GET")).status, 403);
    assert.deepEqual(await (await f.poll(request.code, request.secret)).json(), { waiting: true });
    // Unpaired, without this Couch's origin, a request can't even be made.
    assert.equal((await fetch(`${f.hub.origin}/api/pair/tv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
  } finally { await f.close(); }
});
