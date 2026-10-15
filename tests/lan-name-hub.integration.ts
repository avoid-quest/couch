import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import os, { networkInterfaces, tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { get } from "node:https";
import { ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createHub } from "../src/server/hub";
import { selectLan } from "../src/server/lan-listener";

const candidate = Object.entries(networkInterfaces()).find(([name, entries]) => { try { selectLan({ [name]: entries }, name); return true; } catch { return false; } });
test("Core admits and certifies its detected name, exposes it in Settings, and preserves customization", { skip: !candidate, timeout: 10000 }, async t => {
  const [name, entries] = candidate!, { address } = selectLan({ [name]: entries }, name);
  const directory = await mkdtemp(join(tmpdir(), "couch-lan-name-"));
  const previous = process.env.COUCH_LAN_INTERFACE, previousAddress = process.env.COUCH_LAN_ADDRESS;
  process.env.COUCH_LAN_INTERFACE = name;
  process.env.COUCH_LAN_ADDRESS = address;
  t.mock.method(os, "hostname", () => "couch.example.home.arpa");
  t.mock.method(dns, "lookup", async (host: string) => { await sleep(20); return ["couch.example.home.arpa", "cinema.example.home.arpa"].includes(host) ? [{ address, family: 4 }] : []; });
  syncBuiltinESMExports();
  const fetchLocal = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => new URL(String(input)).hostname === "127.0.0.1" ? fetchLocal(input, init) : Promise.resolve(new Response("")));
  const hostToken = "h".repeat(64);
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  t.after(async () => {
    await hub?.close(); t.mock.restoreAll(); syncBuiltinESMExports();
    if (previous === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previous;
    if (previousAddress === undefined) delete process.env.COUCH_LAN_ADDRESS; else process.env.COUCH_LAN_ADDRESS = previousAddress;
    await rm(directory, { recursive: true, force: true });
  });
  hub = await createHub({ managedLan: true, databasePath: join(directory, "couch.sqlite"), hostToken, port: 0 });
  const port = hub.server.port, automatic = `https://couch.example.home.arpa:${port}`, suggestion = `http://couch.example.home.arpa:${port}`;
  const settings = (domain?: string, origin?: string) => fetch(`${hub!.origin}/api/settings/origin-domain`, {
    method: domain === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json", ...origin ? { Origin: origin } : {} },
    ...domain === undefined ? {} : { body: JSON.stringify({ domain }) },
  }).then(async response => { assert.equal(response.status, 200); return response.json(); });
  assert.deepEqual(await settings(), { domain: "", suggested: suggestion });
  assert.deepEqual(hub.urls, [automatic, `https://${address}:${port}`]);
  const ca = await readFile(join(directory, "tls/cert.pem"), "utf8");
  const secure = () => new Promise<number | undefined>((resolve, reject) => {
    get(`https://${address}:${port}/api/health`, { ca, allowPartialTrustChain: true, servername: "couch.example.home.arpa", headers: { Host: `couch.example.home.arpa:${port}` }, agent: false }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); }).on("error", reject);
  });
  assert.equal(await secure(), 200);
  const custom = `http://cinema.example.home.arpa:${port}`;
  assert.deepEqual(await settings(custom, automatic), { domain: custom, suggested: "" });
  assert.deepEqual(hub.urls, [`https://cinema.example.home.arpa:${port}`, `https://${address}:${port}`]);
  assert.equal(await secure(), 200, "the administrator's previous automatic address must survive customization");
  assert.deepEqual(await settings(""), { domain: "", suggested: suggestion });
  assert.deepEqual(hub.urls, [automatic, `https://${address}:${port}`]);
});

// A hub with a paired LAN admin, whose detected-name lookup holds LAN refreshes while `holdDns` is on.
async function sharingHub(t: TestContext) {
  const [name, entries] = candidate!, { address } = selectLan({ [name]: entries }, name);
  const directory = await mkdtemp(join(tmpdir(), "couch-sharing-race-")), databasePath = join(directory, "couch.sqlite");
  const previous = process.env.COUCH_LAN_INTERFACE, previousAddress = process.env.COUCH_LAN_ADDRESS;
  process.env.COUCH_LAN_INTERFACE = name;
  process.env.COUCH_LAN_ADDRESS = address;
  let release = () => {}, held = Promise.resolve(), looked = () => {};
  t.mock.method(os, "hostname", () => "couch.example.home.arpa");
  t.mock.method(dns, "lookup", async () => { looked(); await held; return [{ address, family: 4 }]; });
  syncBuiltinESMExports();
  const fetchLocal = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => ["127.0.0.1", address].includes(new URL(String(input)).hostname) ? fetchLocal(input, init) : Promise.resolve(new Response("")));
  const hostToken = "h".repeat(64), open = (port = 0) => createHub({ managedLan: true, allowLanHttp: true, databasePath, hostToken, port, pairingCode: "123456" });
  let hub = await open();
  t.after(async () => {
    release(); await hub.close(); t.mock.restoreAll(); syncBuiltinESMExports();
    if (previous === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previous;
    if (previousAddress === undefined) delete process.env.COUCH_LAN_ADDRESS; else process.env.COUCH_LAN_ADDRESS = previousAddress;
    await rm(directory, { recursive: true, force: true });
  });
  const lan = `http://${address}:${hub.server.port}`;
  const until = async (predicate: () => Promise<boolean>) => { const deadline = Date.now() + 2500; while (!await predicate()) { assert.ok(Date.now() < deadline, "the LAN listener did not reach the expected state"); await sleep(10); } };
  const reachable = () => fetchLocal(`${lan}/api/health`).then(() => true, () => false);
  await until(reachable);
  const paired = await fetchLocal(`${lan}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json", Origin: lan }, body: JSON.stringify({ code: "123456", id: "t".repeat(43), name: "Phone" }) });
  const { token } = await paired.json();
  const sharing = (origin: string, bearer: string, enabled: boolean) => fetchLocal(`${origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
  return {
    address, lan, token, until, reachable,
    get hub() { return hub; },
    remote: (enabled: boolean) => sharing(lan, token, enabled),
    host: (enabled: boolean) => sharing(hub.origin, hostToken, enabled),
    saved: async () => (await fetchLocal(`${hub.origin}/api/connection`).then(response => response.json())).remoteControlEnabled,
    holdDns: () => { held = new Promise(resolve => release = resolve); return new Promise<void>(resolve => looked = resolve); },
    releaseDns: () => release(),
    restart: async () => { const port = hub.server.port; await hub.close(); hub = await open(port); },
  };
}

test("a remote enable held by LAN DNS can't undo an accepted sharing disable", { skip: !candidate, timeout: 10000 }, async t => {
  const f = await sharingHub(t);
  const lookedUp = f.holdDns();
  // The admin's redundant On races its own Off from another tab.
  const stale = f.remote(true).then(response => response.status, () => "cut off");
  await Promise.race([lookedUp, stale]);
  const off = await f.remote(false);
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { enabled: false });
  f.releaseDns();
  await stale;
  await f.until(async () => !await f.reachable());
  assert.equal(await f.saved(), false, "an accepted disable stays saved");
  await f.restart();
  assert.equal(await f.saved(), false, "sharing stays off after a restart");
  assert.equal(await f.reachable(), false);
  assert.equal((await f.host(true)).status, 200, "the host turns sharing back on");
  await f.until(f.reachable);
  assert.equal(await f.saved(), true);
});

test("the host enabling sharing while a remote disable's reply is still closing keeps the LAN listening", { skip: !candidate, timeout: 10000 }, async t => {
  const f = await sharingHub(t);
  // Hold the close of the remote Off's reply: the listener must not stop before it.
  let closed = () => {}, reply = () => {};
  const replied = new Promise<void>(resolve => reply = resolve), emit = ServerResponse.prototype.emit;
  t.mock.method(ServerResponse.prototype, "emit", function (this: ServerResponse, event: string, ...args: unknown[]) {
    if (event !== "close" || this.req.url !== "/api/settings/sharing" || this.req.socket.remoteAddress !== f.address) return emit.call(this, event, ...args);
    closed = () => { closed = () => {}; emit.call(this, event, ...args); };
    reply();
    return true;
  });
  t.after(() => closed());
  const off = f.remote(false);
  await replied;
  assert.equal(await f.saved(), false);
  const lookedUp = f.holdDns();
  const on = f.host(true);
  // Before the fix the enable reaches DNS here; after it, the enable waits behind the held stop.
  await Promise.race([lookedUp, sleep(200)]);
  closed();
  f.releaseDns();
  assert.equal((await off).status, 200);
  assert.deepEqual(await (await on).json(), { enabled: true });
  assert.equal(await f.saved(), true);
  // Before the fix the Off's late stop shuts the listener the host just enabled.
  await f.until(f.reachable);
});
