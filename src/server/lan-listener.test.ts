import { expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { createLanListener, lanPeer, lanUrls, selectLan } from "./lan-listener";
const entry = (address: string): NetworkInterfaceInfo => ({ address, netmask: "255.255.255.0", cidr: `${address}/24`, family: "IPv4", internal: false, mac: "00:00:00:00:00:00" });
const network = { name: "eth0", address: "192.168.1.20", netmask: "255.255.255.0" };
test("selects a private LAN, excludes virtual/public interfaces and requires an explicit ambiguous choice", () => {
  expect(selectLan({ eth0: [entry(network.address)], docker0: [entry("172.17.0.1")] })).toEqual(network);
  expect(() => selectLan({ eth0: [entry("203.0.113.2")] })).toThrow("No eligible LAN");
  const multiple = { eth0: [entry(network.address)], wlan0: [entry("10.1.2.3")] };
  expect(() => selectLan(multiple)).toThrow("COUCH_LAN_INTERFACE");
  expect(selectLan(multiple, "wlan0").address).toBe("10.1.2.3");
});
test("socket admission requires the selected subnet, independently of Host or Origin", () => {
  expect(lanPeer(network, "192.168.1.25")).toBe(true);
  expect(lanPeer(network, "::ffff:192.168.1.25")).toBe(true);
  for (const address of ["192.168.2.25", "10.1.2.3", "203.0.113.4", "::1", "192.168.1.999"]) expect(lanPeer(network, address)).toBe(false);
});
test("custom names must resolve only to this installation and preserve its direct HTTP port", async () => {
  const resolve = (async () => [{ address: network.address, family: 4 }]) as never;
  expect(await lanUrls(network, 4100, ["http://couch.home:4100"], resolve)).toEqual(["http://couch.home:4100", "http://192.168.1.20:4100"]);
  await expect(lanUrls(network, 4100, ["https://couch.home"], resolve)).rejects.toThrow("HTTP");
  await expect(lanUrls(network, 4100, ["http://couch.home:4100"], (async () => [{ address: "192.168.1.21", family: 4 }]) as never)).rejects.toThrow("does not resolve");
});
test("sharing binds one address, closes on disable/network change and refreshes advertised addresses", async () => {
  let address = network.address, starts = 0, stops = 0;
  const changes: string[][] = [];
  const listener = createLanListener({ port: 4100, enabled: false, advertised: [], interfaces: () => ({ eth0: [entry(address)] }), start: actual => { expect(actual.address).toBe(address); starts++; return { stop: async () => { stops++; } }; }, changed: urls => changes.push(urls) });
  try {
    await listener.refresh(); expect(starts).toBe(0);
    await listener.setEnabled(true); expect(starts).toBe(1);
    address = "192.168.1.21"; await listener.refresh(); expect(starts).toBe(2); expect(stops).toBe(1);
    expect(changes.at(-1)).toEqual(["http://192.168.1.21:4100"]);
    await listener.setEnabled(false); expect(stops).toBe(2);
    await listener.refresh(); expect(starts).toBe(2);
  } finally { await listener.close(); }
});
test("port conflicts reject enabling and cannot silently enable sharing on a later refresh", async () => {
  let conflict = true, starts = 0;
  const listener = createLanListener({ port: 4100, enabled: false, advertised: [], interfaces: () => ({ eth0: [entry(network.address)] }), start: () => { starts++; if (conflict) throw new Error("EADDRINUSE"); return { stop: async () => {} }; }, changed: () => {} });
  try {
    await expect(listener.setEnabled(true)).rejects.toThrow("using the port");
    const attempts = starts; conflict = false; await listener.refresh(); expect(starts).toBe(attempts); expect(listener.server).toBeNull();
  } finally { await listener.close(); }
});
