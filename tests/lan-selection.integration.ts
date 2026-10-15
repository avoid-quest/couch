import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";
import type { lookup } from "node:dns/promises";
import { setImmediate } from "node:timers/promises";
import { createLanListener } from "../src/server/lan-listener";

const a: NetworkInterfaceInfo = { address: "192.168.1.20", family: "IPv4", internal: false, netmask: "255.255.255.0", cidr: "192.168.1.20/24", mac: "00:11:22:33:44:55" };
const b = { ...a, address: "192.168.2.20", cidr: "192.168.2.20/24" };

function fixture(t: TestContext, options: { enabled?: boolean; selected?: string; address?: string } = {}) {
  let inventory: NodeJS.Dict<NetworkInterfaceInfo[]> = { eth0: [a] };
  let urls: string[] = [], error: string | null = null;
  const starts: { address: string; port: number; stopped: boolean }[] = [];
  const lan = createLanListener({
    port: 4100, enabled: true, ...options, advertised: ["http://couch.home"], interfaces: () => inventory,
    resolve: (async () => [{ address: a.address, family: 4 }]) as typeof lookup,
    start: async (network, port) => {
      const listener = { address: network.address, port, stopped: false };
      starts.push(listener);
      return { stop: async () => { listener.stopped = true; } };
    },
    changed: (next, warning) => { urls = next; error = warning; },
  });
  t.after(() => lan.close());
  return { lan, starts, inventory: (next: typeof inventory) => { inventory = next; }, urls: () => urls, error: () => error };
}

for (const loss of ["interface", "address"]) test(`automatic selection waits for its missing ${loss} across refreshes and polls`, async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  await f.lan.refresh();
  await setImmediate();
  const servers = f.lan.servers;
  assert.equal(servers.length, 2);
  f.inventory({ eth0: [a], eth1: [b] });
  await f.lan.refresh();
  assert.deepEqual(f.lan.servers, servers, "adding B must keep A's listeners");

  f.inventory(loss === "interface" ? { eth1: [b] } : { eth0: [b] });
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.equal(f.lan.server, null, "losing A must not migrate sharing to B");
  assert.equal(f.lan.network, null);
  assert.deepEqual(f.urls(), []);
  assert.match(f.error()!, /No eligible LAN address/);
  assert.ok(f.starts.every(listener => listener.stopped), "both the main and port 80 listeners must close");
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(f.lan.refresh(), /No eligible LAN address/);
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.equal(f.starts.length, 2, "refreshes and polling must not bind B");
  assert.deepEqual(f.urls(), []);

  f.inventory({ eth0: [a], eth1: [b] });
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.equal(f.lan.network?.address, a.address);
  assert.equal(f.lan.servers.length, 2);
  assert.equal(f.starts.length, 4);
  assert.ok(f.starts.every(listener => listener.address === a.address));
  assert.deepEqual(f.urls(), ["https://couch.home:4100", `https://${a.address}:4100`]);
  assert.equal(f.error(), null);
});

test("disabled discovery does not pin a network, but disabling established sharing retains its selection until restart", async t => {
  const f = fixture(t, { enabled: false });
  await f.lan.refresh();
  f.inventory({ eth1: [b] });
  await f.lan.refresh();
  assert.equal(f.starts.length, 0);
  await f.lan.setEnabled(true);
  assert.equal(f.lan.network?.address, b.address);
  await f.lan.setEnabled(false);
  f.inventory({ eth0: [a] });
  await assert.rejects(f.lan.refresh(), /No eligible LAN address/);
  await assert.rejects(f.lan.validateAlias("http://couch.home"), /No eligible LAN address/);
  await assert.rejects(f.lan.setEnabled(true), /No eligible LAN address/);
  assert.equal(f.lan.server, null);
  assert.ok(f.starts.every(listener => listener.stopped));
  await f.lan.close();

  const restarted = fixture(t);
  await restarted.lan.refresh();
  assert.equal(restarted.lan.network?.address, a.address);
  assert.ok(restarted.lan.server);
});

for (const selector of ["interface", "address"]) test(`an explicit ${selector} selector keeps its existing scope`, async t => {
  const f = fixture(t, selector === "interface" ? { selected: "eth0" } : { address: a.address });
  await f.lan.refresh();
  f.inventory(selector === "interface" ? { eth0: [b] } : { eth1: [a] });
  await f.lan.refresh();
  assert.equal(f.lan.network?.address, selector === "interface" ? b.address : a.address);
  assert.equal(f.lan.network?.name, selector === "interface" ? "eth0" : "eth1");
  assert.ok(f.lan.server);
});
