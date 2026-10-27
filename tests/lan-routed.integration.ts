import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockList } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { get } from "node:https";
import { createHub } from "../src/server/hub";
import { selectLan } from "../src/server/lan-listener";

const networks = Object.entries(networkInterfaces()).flatMap(([name, entries]) => {
  try { return [selectLan({ [name]: entries }, name)]; } catch { return []; }
});
const routed = networks.flatMap(target => {
  const subnet = new BlockList();
  const bits = target.netmask.split(".").reduce((count, part) => count + Number(part).toString(2).replaceAll("0", "").length, 0);
  subnet.addSubnet(target.address, bits, "ipv4");
  return networks.filter(source => !subnet.check(source.address, "ipv4")).map(source => ({ target, source }));
})[0] ?? (networks[0] && process.env.COUCH_TEST_ROUTED_SOURCE
  ? { target: networks[0], source: { address: process.env.COUCH_TEST_ROUTED_SOURCE } } : undefined);

test("managed Couch accepts a real HTTPS client from another routed subnet", { skip: !routed, timeout: 10_000 }, async t => {
  const { target, source } = routed!;
  const directory = await mkdtemp(join(tmpdir(), "couch-routed-lan-"));
  const before = [process.env.COUCH_LAN_INTERFACE, process.env.COUCH_LAN_ADDRESS];
  process.env.COUCH_LAN_INTERFACE = target.name;
  process.env.COUCH_LAN_ADDRESS = target.address;
  const hub = await createHub({ managedLan: true, remoteControlEnabled: true, advertisedUrls: [],
    databasePath: join(directory, "couch.sqlite"), hostToken: "h".repeat(64), port: 0 });
  t.after(async () => {
    await hub.close();
    for (const [index, key] of ["COUCH_LAN_INTERFACE", "COUCH_LAN_ADDRESS"].entries()) {
      if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index];
    }
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `https://${target.address}:${hub.server.port}`;
  const deadline = Date.now() + 3000;
  while (!hub.urls.includes(origin)) {
    assert.ok(Date.now() < deadline, "LAN listener did not become available");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(`${origin}/api/connection`, { localAddress: source.address, rejectUnauthorized: false, agent: false }, response => {
      assert.equal(response.socket.localAddress, source.address);
      response.resume(); response.once("end", () => resolve(response.statusCode));
    }).once("error", reject);
  });
  assert.equal(status, 200, `${source.address} must be admitted when Couch listens on ${target.address}`);
});
