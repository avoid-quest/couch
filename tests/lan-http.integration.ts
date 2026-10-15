import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:https";
import { get as getPlain } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { httpOrigin, selectLan } from "../src/server/lan-listener";

const candidate = Object.entries(networkInterfaces()).find(([name, entries]) => {
  try { selectLan({ [name]: entries }, name); return true; } catch { return false; }
});
const hostToken = "h".repeat(64), device = "t".repeat(43);
test("HTTP aliases keep Couch's port when HTTPS omits its default port", () => {
  assert.equal(httpOrigin("https://couch.home", 443), "http://couch.home:443");
  assert.equal(httpOrigin("https://192.168.1.20:443", 443), "http://192.168.1.20:443");
  assert.equal(httpOrigin("https://couch.home:4100", 4100), "http://couch.home:4100");
  assert.equal(httpOrigin("https://couch.home:80", 80), "http://couch.home");
});
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2500;
  while (!predicate()) { assert.ok(Date.now() < deadline, "LAN listener did not become ready"); await sleep(10); }
}
async function fixture(t: TestContext, allowLanHttp = false) {
  const [name, entries] = candidate!;
  const { address } = selectLan({ [name]: entries }, name);
  const directory = await mkdtemp(join(tmpdir(), "couch-lan-http-"));
  const previous = process.env.COUCH_LAN_INTERFACE, previousAddress = process.env.COUCH_LAN_ADDRESS;
  process.env.COUCH_LAN_INTERFACE = name;
  process.env.COUCH_LAN_ADDRESS = address;
  t.after(() => {
    if (previous === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previous;
    if (previousAddress === undefined) delete process.env.COUCH_LAN_ADDRESS; else process.env.COUCH_LAN_ADDRESS = previousAddress;
  });
  // Keep provider discovery offline without mocking local transport or the LAN inventory.
  const fetchLocal = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => ["127.0.0.1", "localhost", address].includes(new URL(String(input)).hostname) ? fetchLocal(input, init) : Promise.resolve(new Response("")));
  let hub = await createHub({ managedLan: true, allowLanHttp, advertisedUrls: [], databasePath: join(directory, "couch.sqlite"), port: 0, hostToken, pairingCode: "123456" });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await hub.close(); await rm(directory, { recursive: true, force: true }); });
  const http = `http://${address}:${hub.server.port}`, https = http.replace("http:", "https:");
  await until(() => hub.urls.includes(https));
  const ca = await readFile(join(directory, "tls/cert.pem"), "utf8");
  const secure = () => new Promise<number | undefined>((resolve, reject) => {
    const request = get(`${https}/api/health`, { ca, allowPartialTrustChain: true, agent: false }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject); request.setTimeout(1000, () => request.destroy(new Error("TLS request timed out")));
  });
  const ws = (token: string, origin = http, id = device, tls = false) => {
    const socket = new WebSocket(`${(tls ? https : http).replace(/^http/, "ws")}/api/ws?token=${token}&device=${id}`, { origin, ca, allowPartialTrustChain: true });
    sockets.push(socket); socket.on("error", () => {}); return socket;
  };
  const pair = (code: string, origin: string | null = http, id = device) => fetch(`${http}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }) }, body: JSON.stringify({ code, id, name: "TV browser" }) });
  const settings = (value?: unknown, path = "http") => fetch(`${hub.origin}/api/settings/${path}`, {
    method: value === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify({ enabled: value }) }),
  });
  const restart = async (allowLanHttp = false) => {
    const port = hub.server.port;
    await hub.close();
    hub = await createHub({ managedLan: true, allowLanHttp, advertisedUrls: [], databasePath: join(directory, "couch.sqlite"), port, hostToken, pairingCode: "123456" });
    await until(() => hub.urls.includes(https));
  };
  return { get hub() { return hub; }, http, https, secure, ws, pair, settings, restart };
}

test("default LAN transport keeps HTTPS and refuses plaintext WebSockets", { skip: !candidate, timeout: 8000 }, async t => {
  const f = await fixture(t);
  assert.deepEqual(f.hub.urls, [f.https]);
  const response = await fetch(`${f.http}/api/health?probe=1`, { redirect: "manual" });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), `${f.https}/api/health?probe=1`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await assert.rejects(once(f.ws("unpaired"), "open"));
  assert.equal(await f.secure(), 200);
});

test("opt-in HTTP preserves pairing, origin checks, host isolation and sharing shutdown", { skip: !candidate, timeout: 10000 }, async t => {
  const f = await fixture(t, true);
  assert.deepEqual(f.hub.urls, [f.https, f.http]);
  const connection = await fetch(`${f.http}/api/connection`).then(response => response.json());
  assert.deepEqual(connection.urls, [f.https, f.http]);
  assert.equal(await f.secure(), 200);
  assert.equal((await f.pair("wrong")).status, 401);
  assert.equal((await f.pair("123456", null)).status, 403);
  assert.equal((await f.pair("123456", "http://foreign.example")).status, 403);
  for (const path of ["/", "/api/health", "/api/subtitles/example.vtt", `${f.https}/`]) {
    for (const headers of [{ Host: "foreign.example" }, { Origin: "http://foreign.example" }]) {
      // Node's fetch replaces Host; send the actual hostile header over the wire.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        getPlain(f.http, { path, headers, agent: false }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); }).on("error", reject);
      });
      assert.equal(status, 403, `${path} with ${JSON.stringify(headers)}`);
    }
  }
  for (const token of ["unpaired", hostToken]) await assert.rejects(once(f.ws(token), "open"), /401/);
  const paired = await f.pair("123456"); assert.equal(paired.status, 200);
  const { token } = await paired.json();
  await assert.rejects(once(f.ws(token, "http://foreign.example"), "open"), /403/);
  const socket = f.ws(token);
  const [data] = await once(socket, "message"); assert.equal(JSON.parse(String(data)).type, "state");
  // Only the local host may disable sharing. Doing so closes the real LAN socket.
  assert.equal((await fetch(`${f.http}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: '{"enabled":false}' })).status, 403);
  const closed = once(socket, "close");
  const response = await fetch(`${f.hub.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: '{"enabled":false}' });
  assert.equal(response.status, 200); await closed;
  assert.equal((await fetch(`${f.hub.origin}/api/connection`).then(response => response.json())).remoteControlEnabled, false);
  await assert.rejects(fetch(`${f.http}/api/health`));
  await assert.rejects(f.secure());
  assert.equal((await fetch(`${f.hub.origin}/api/health`)).status, 200);
});

test("HTTP compatibility cannot opt an unrestricted listener into plaintext", async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-http-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(async () => {
    const hub = await createHub({ allowLanHttp: true, databasePath: join(directory, "couch.sqlite"), hostname: "127.0.0.1", port: 0, hostToken });
    await hub.close();
  }, /managed LAN listener/);
});

test("saved HTTP setting applies live, closes plaintext only and overrides the startup flag", { skip: !candidate, timeout: 15000 }, async t => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.settings()).json(), { enabled: false });
  assert.equal((await f.settings("true")).status, 400);
  assert.equal((await fetch(`${f.hub.origin}/api/settings/http`)).status, 401);
  assert.equal((await f.settings(true)).status, 200);
  assert.deepEqual(f.hub.urls, [f.https, f.http]);
  assert.equal((await fetch(`${f.http}/api/health`, { redirect: "manual" })).status, 200);
  assert.equal(await f.secure(), 200);
  const { token } = await (await f.pair("123456")).json();
  // A remote administrator cannot weaken the host's transport policy.
  assert.equal((await fetch(`${f.http}/api/settings/http`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: '{"enabled":false}' })).status, 403);
  const plain = f.ws(token);
  await once(plain, "message");
  const secureId = "u".repeat(43);
  const secureToken = (await (await f.pair("123456", f.http, secureId)).json()).token;
  const secure = f.ws(secureToken, f.https, secureId, true);
  await once(secure, "message");
  const closed = once(plain, "close");
  assert.equal((await f.settings(false)).status, 200);
  await closed;
  assert.deepEqual(f.hub.urls, [f.https]);
  assert.equal((await fetch(`${f.http}/api/health`, { redirect: "manual" })).status, 308);
  await assert.rejects(once(f.ws(token), "open"));
  assert.equal(await f.secure(), 200);
  const pong = once(secure, "pong"); secure.ping(); await pong;
  assert.equal(secure.readyState, WebSocket.OPEN);
  // Persisted off wins over a legacy launch flag; persisted on needs no flag.
  await f.restart(true);
  assert.deepEqual(await (await f.settings()).json(), { enabled: false });
  assert.equal((await fetch(`${f.http}/api/health`, { redirect: "manual" })).status, 308);
  assert.equal((await f.settings(true)).status, 200);
  await f.restart();
  assert.deepEqual(await (await f.settings()).json(), { enabled: true });
  assert.equal((await fetch(`${f.http}/api/health`, { redirect: "manual" })).status, 200);
  // Choosing HTTP while sharing is off must not expose either LAN transport.
  assert.equal((await f.settings(false, "sharing")).status, 200);
  assert.equal((await f.settings(false)).status, 200);
  assert.equal((await f.settings(true)).status, 200);
  await assert.rejects(fetch(`${f.http}/api/health`));
  await assert.rejects(f.secure());
  assert.equal((await f.settings(true, "sharing")).status, 200);
  assert.equal((await fetch(`${f.http}/api/health`)).status, 200);
});
