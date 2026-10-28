import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockList } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { get } from "node:https";
import type { IncomingMessage } from "node:http";
import { channel } from "node:diagnostics_channel";
import { createHub } from "../src/server/hub";
import { loopbackPeer, selectLan, type LanNetwork } from "../src/server/lan-listener";

const subnetOf = (network: LanNetwork) => {
  const subnet = new BlockList();
  const bits = network.netmask.split(".").reduce((count, part) => count + Number(part).toString(2).replaceAll("0", "").length, 0);
  subnet.addSubnet(network.address, bits, "ipv4");
  return subnet;
};

const networks = Object.entries(networkInterfaces()).flatMap(([name, entries]) => {
  try { return [selectLan({ [name]: entries }, name)]; } catch { return []; }
});
const routed = networks.flatMap(target => {
  const subnet = subnetOf(target);
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
  let peer = "";
  const requests = channel("http.server.request.start");
  const observe = (message: unknown) => {
    const { request } = message as { request: IncomingMessage };
    if (request.url === "/api/connection" && request.headers.host === `${target.address}:${hub.server.port}`) peer = request.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "";
  };
  requests.subscribe(observe);
  t.after(() => { requests.unsubscribe(observe); });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(`${origin}/api/connection`, { localAddress: source.address, rejectUnauthorized: false, agent: false }, response => {
      response.resume(); response.once("end", () => resolve(response.statusCode));
    }).once("error", reject);
  });
  assert.equal(peer, source.address, "the server must observe the routed source without NAT masking it");
  assert.equal(loopbackPeer(peer), false, "the request must not use loopback admission");
  assert.equal(subnetOf(target).check(peer, "ipv4"), false, "the server must observe a source outside its subnet");
  assert.equal(status, 200, `${source.address} must be admitted when Couch listens on ${target.address}`);
});
