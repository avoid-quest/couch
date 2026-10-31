import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as https from "node:https";
import { createServer } from "node:net";
import type { lookup } from "node:dns/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { certificate } from "../src/server/certificate";
import { createLanListener, selectLan } from "../src/server/lan-listener";
import { serve } from "../src/server/http";

// Change only the OS inventory boundary; bind and request the real private IP.
const interfaces = networkInterfaces();
const candidate = (() => {
  try { const network = selectLan(interfaces); return [network.name, interfaces[network.name]] as const; }
  catch { return undefined; }
})();
const port = Number(process.env.COUCH_PORT ?? 42640);

async function fixture(t: TestContext, { enabled = true, available = false, automatic = false, advertised = [], resolve, beforeStart }: {
  enabled?: boolean; available?: boolean; automatic?: boolean; advertised?: string[]; resolve?: typeof lookup; beforeStart?: () => Promise<void>;
} = {}) {
  const [name, entries] = candidate!;
  const network = selectLan({ [name]: entries }, name);
  const directory = await mkdtemp(join(tmpdir(), "couch-lan-readiness-"));
  const tls = await certificate(directory, [network.address]);
  const agent = new https.Agent({ ca: tls.cert, allowPartialTrustChain: true });
  let inventory: typeof interfaces = available ? { [name]: entries } : {};
  let reads = 0;
  const lan = createLanListener({
    port, enabled, selected: automatic ? undefined : name, advertised, resolve, interfaces: () => { reads++; return inventory; },
    start: async (next, port) => { await beforeStart?.(); return serve({
      hostname: next.address, port, tls, maxRequestBodySize: 4096,
      fetch: async () => Response.json({ ok: true }),
      websocket: { maxPayload: 4096, open() {}, message() {}, close() {} },
    }); },
    changed() {},
  });
  t.after(async () => {
    agent.destroy();
    await lan.close();
    await rm(directory, { recursive: true, force: true });
  });
  const ready = async () => {
    const deadline = performance.now() + 2_500;
    while (!lan.server && performance.now() < deadline) await sleep(20);
    assert.ok(lan.server, "DHCP is ready, but the LAN listener still has no socket after 2.5 seconds");
    await new Promise<void>((resolve, reject) => {
      const request = https.get(`https://${network.address}:${port}/api/health`, { agent }, response => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { body += chunk; });
        response.once("error", reject);
        response.once("end", () => {
          try { assert.equal(response.statusCode, 200); assert.deepEqual(JSON.parse(body), { ok: true }); resolve(); }
          catch (error) { reject(error); }
        });
      });
      request.setTimeout(1_000, () => request.destroy(new Error("TLS API response timed out")));
      request.once("error", reject);
    });
  };
  return { lan, network, ready, arrive: () => { inventory = { [name]: entries }; }, depart: () => { inventory = {}; }, reads: () => reads,
    addNetwork: () => { inventory["vEthernet zz fixture"] = [{ ...entries!.find(entry => entry.family === "IPv4")!, address: "192.168.254.1", internal: false }]; },
  };
}

test("an additional interface preserves the active automatically selected LAN listener", { skip: !candidate }, async t => {
  const f = await fixture(t, { available: true, automatic: true });
  await f.ready();
  const server = f.lan.server;
  f.addNetwork();
  await assert.doesNotReject(f.lan.refresh());
  assert.equal(f.lan.server, server, "an unrelated interface restarted the active listener");
  await f.ready();
});

test("automatic selection starts sharing with several initial networks", { skip: !candidate }, async t => {
  const f = await fixture(t, { automatic: true });
  await assert.rejects(f.lan.refresh(), /No eligible LAN address/);
  f.arrive();
  f.addNetwork();
  await f.lan.refresh();
  assert.equal(f.lan.network?.address, f.network.address);
  await f.ready();
});

test("LAN HTTPS becomes ready promptly when IPv4 arrives after Core starts", { skip: !candidate }, async t => {
  const f = await fixture(t);
  await assert.rejects(f.lan.refresh(), /No eligible LAN address/);
  f.arrive();
  await f.ready();
});

for (const automatic of [false, true]) test(`a vanished ${automatic ? "automatic" : "explicit"} selection closes LAN access and a returning address recovers it`, { skip: !candidate }, async t => {
  const f = await fixture(t, { available: true, automatic });
  await f.ready();
  f.depart();
  const deadline = performance.now() + 2_500;
  while (f.lan.server && performance.now() < deadline) await sleep(20);
  assert.equal(f.lan.server, null, "LAN access survived the loss of its selected address");
  // Rebinding the same socket proves that the real listener was closed.
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => { blocker.once("error", reject); blocker.listen(port, f.network.address, resolve); });
  await new Promise<void>((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()));
  f.arrive();
  await f.ready();
});

test("LAN binding retries promptly after another process releases the port", { skip: !candidate }, async t => {
  const [name, entries] = candidate!;
  const network = selectLan({ [name]: entries }, name);
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => { blocker.once("error", reject); blocker.listen(port, network.address, resolve); });
  t.after(() => { blocker.close(); });
  const f = await fixture(t, { available: true });
  await assert.rejects(f.lan.refresh(), /cannot listen/);
  await new Promise<void>((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()));
  await f.ready();
});

test("interface arrival while sharing is disabled stays private and close cancels polling", { skip: !candidate }, async t => {
  const f = await fixture(t, { enabled: false });
  await assert.rejects(f.lan.refresh(), /No eligible LAN address/);
  f.arrive();
  await sleep(1_200);
  assert.equal(f.lan.server, null);
  await f.lan.setEnabled(true);
  await f.ready();
  await f.lan.setEnabled(false);
  assert.equal(f.lan.server, null);
  await f.lan.close();
  const reads = f.reads();
  await sleep(1_200);
  assert.equal(f.reads(), reads, "closed listener still polls the OS inventory");
});

test("slow DNS does not accumulate refreshes and close drains the in-flight listener", { skip: !candidate }, async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let answer: ((value: { address: string; family: number }[]) => void) | undefined;
  const resolve = (() => new Promise<{ address: string; family: number }[]>(done => { answer = done; })) as unknown as typeof lookup;
  const f = await fixture(t, { available: true, advertised: [`https://couch.test:${port}`], resolve });
  await f.ready();
  assert.ok(answer);
  f.depart();
  t.mock.timers.tick(61_000);
  const closing = f.lan.close();
  answer([{ address: f.network.address, family: 4 }]);
  await closing;
  assert.equal(f.lan.server, null);
  const reads = f.reads();
  t.mock.timers.tick(61_000);
  assert.equal(f.reads(), reads);
});

test("disabling sharing during interface recovery drains the pending bind", { skip: !candidate }, async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let starting = false;
  const f = await fixture(t, { beforeStart: () => { starting = true; return gate; } });
  await assert.rejects(f.lan.refresh(), /No eligible LAN address/);
  f.arrive();
  const deadline = performance.now() + 2_500;
  while (!starting && performance.now() < deadline) await sleep(20);
  assert.ok(starting);
  const disabling = f.lan.setEnabled(false);
  release();
  await disabling;
  await sleep(50);
  assert.equal(f.lan.server, null, "a pending bind exposed LAN access after sharing was disabled");
});

test("a failed enable doesn't turn off sharing that a later enable requested", { skip: !candidate }, async t => {
  let release!: () => void, starts = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, { enabled: false, available: true, beforeStart: async () => { if (++starts === 1) { await gate; throw new Error("busy"); } } });
  await f.lan.refresh();
  const failing = f.lan.setEnabled(true);
  const deadline = performance.now() + 2_500;
  while (!starts && performance.now() < deadline) await sleep(20);
  assert.equal(starts, 1);
  const enabling = f.lan.setEnabled(true);
  release();
  await assert.rejects(failing, /cannot listen/);
  await enabling;
  await f.ready();
});

test("a remote disable stops only after its reply, even behind queued refreshes and a host disable", { skip: !candidate }, async t => {
  const { address } = selectLan({ [candidate![0]]: candidate![1] }, candidate![0]);
  let held = Promise.resolve(), looked = () => {};
  const resolve = (async () => { looked(); await held; return [{ address, family: 4 }]; }) as unknown as typeof lookup;
  const f = await fixture(t, { available: true, advertised: [`https://couch.test:${port}`], resolve });
  await f.ready();
  let releaseDns!: () => void, closeReply!: () => void;
  held = new Promise(resolve => { releaseDns = resolve; });
  const lookedUp = new Promise<void>(resolve => { looked = resolve; });
  // One refresh waits on DNS, and another, such as a Settings read, queues behind it.
  const refreshes = Promise.all([f.lan.refresh(), f.lan.refresh()]);
  await lookedUp;
  const remoteOff = f.lan.setEnabled(false, new Promise<void>(resolve => { closeReply = resolve; }));
  const hostOff = f.lan.setEnabled(false);
  releaseDns();
  await refreshes;
  try { await f.ready(); } finally { closeReply(); }
  await Promise.all([remoteOff, hostOff]);
  assert.equal(f.lan.server, null);
  await f.lan.refresh();
  assert.equal(f.lan.server, null, "a refresh restarted the listener after sharing was disabled");
  await f.lan.setEnabled(true);
  await f.ready();
});
