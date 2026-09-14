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
test("an explicit local address resolves same-interface ambiguity and preserves its subnet", () => {
  const second = { ...entry("10.1.2.3"), netmask: "255.255.0.0" };
  const interfaces = { eth0: [entry(network.address), second], wlan0: [entry("192.168.2.20")] };
  expect(() => selectLan(interfaces, "eth0")).toThrow("COUCH_LAN_ADDRESS");
  const selected = selectLan(interfaces, "eth0", second.address);
  expect(selected).toEqual({ name: "eth0", address: second.address, netmask: second.netmask });
  expect(selectLan(interfaces, undefined, second.address)).toEqual(selected);
  expect(lanPeer(selected, "10.1.3.4")).toBe(true);
  expect(lanPeer(selected, "192.168.1.25")).toBe(false);
  for (const address of ["192.168.2.20", "10.1.2.4", "0.0.0.0", "127.0.0.1"]) expect(() => selectLan(interfaces, "eth0", address)).toThrow("assigned locally");
  expect(() => selectLan({ eth0: [entry("203.0.113.2")] }, "eth0", "203.0.113.2")).toThrow("private IPv4");
});
test("socket admission requires the selected subnet, independently of Host or Origin", () => {
  expect(lanPeer(network, "192.168.1.25")).toBe(true);
  expect(lanPeer(network, "::ffff:192.168.1.25")).toBe(true);
  for (const address of ["192.168.2.25", "10.1.2.3", "203.0.113.4", "::1", "192.168.1.999"]) expect(lanPeer(network, address)).toBe(false);
});
test("custom names must resolve only to this installation and preserve its direct HTTP port", async () => {
  const resolve = (async () => [{ address: network.address, family: 4 }]) as never;
  expect(await lanUrls(network, 4100, ["http://COUCH.home:4100/", "http://couch.home:4100"], resolve)).toEqual({ urls: ["http://couch.home:4100", "http://192.168.1.20:4100"], error: null });
  for (const value of ["https://couch.home", "http://couch.home", "http://couch.home:4101", "http://user:secret@couch.home:4100", "http://couch.home:4100/path", "http://couch.home:4100?query", "http://couch.home:4100#fragment", " http://couch.home:4100", "http://couch.home:4100\\", "invalid"]) {
    const result = await lanUrls(network, 4100, [value], resolve);
    expect(result.urls).toEqual(["http://192.168.1.20:4100"]);
    expect(result.error).toContain("was ignored");
    expect(result.error).not.toContain("secret");
  }
});
test("failed or mixed DNS answers omit only invalid aliases and preserve the recovery IP", async () => {
  const result = await lanUrls(network, 4100, ["http://good.home:4100", "http://missing.home:4100", "http://mixed.home:4100", "http://empty.home:4100"], (async (name: string) => {
    if (name === "missing.home") throw new Error("ENOTFOUND");
    if (name === "empty.home") return [];
    return [{ address: network.address, family: 4 }, ...(name === "mixed.home" ? [{ address: "192.168.1.21", family: 4 }] : [])];
  }) as never);
  expect(result.urls).toEqual(["http://good.home:4100", "http://192.168.1.20:4100"]);
  expect(result.error).toContain("ENOTFOUND");
  expect(result.error).toContain("does not resolve only");
  expect(result.error).toContain("Direct IP access remains available");
});
test("a DNS timeout leaves the direct IP available", async () => {
  const result = await lanUrls(network, 4100, ["http://slow.home:4100"], (() => new Promise(() => {})) as never);
  expect(result.urls).toEqual(["http://192.168.1.20:4100"]);
  expect(result.error).toContain("timed out");
}, 7_000);
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
test("a missing selected address closes LAN access and recovers only when that address returns", async () => {
  let present = true, starts = 0, stops = 0;
  const changes: { urls: string[]; error: string | null }[] = [];
  const listener = createLanListener({
    port: 4100, enabled: true, selected: "eth0", address: network.address, advertised: [],
    interfaces: () => ({ eth0: [...(present ? [entry(network.address)] : []), entry("192.168.1.21")] }),
    start: actual => { expect(actual).toEqual(network); starts++; return { stop: async () => { stops++; } }; }, changed: (urls, error) => changes.push({ urls, error }),
  });
  try {
    await listener.refresh();
    present = false; await expect(listener.refresh()).rejects.toThrow("assigned locally");
    expect(listener.server).toBeNull(); expect(listener.network).toBeNull();
    expect(changes.at(-1)?.urls).toEqual([]);
    expect(changes.at(-1)?.error).toContain("COUCH_LAN_ADDRESS");
    present = true; await listener.refresh();
    expect(changes.at(-1)).toEqual({ urls: ["http://192.168.1.20:4100"], error: null });
    expect(starts).toBe(2); expect(stops).toBe(1);
  } finally { await listener.close(); }
});
test("DNS failure and recovery refresh aliases without stopping a valid IP listener", async () => {
  let failure = false, starts = 0, stops = 0;
  const changes: { urls: string[]; error: string | null }[] = [];
  const listener = createLanListener({
    port: 4100, enabled: true, advertised: ["http://couch.home:4100"], interfaces: () => ({ eth0: [entry(network.address)] }),
    resolve: (async () => { if (failure) throw new Error("ENOTFOUND"); return [{ address: network.address, family: 4 }]; }) as never,
    start: () => { starts++; return { stop: async () => { stops++; } }; }, changed: (urls, error) => changes.push({ urls, error }),
  });
  try {
    await listener.refresh();
    const server = listener.server;
    expect(changes.at(-1)).toEqual({ urls: ["http://couch.home:4100", "http://192.168.1.20:4100"], error: null });
    failure = true; await listener.refresh();
    expect(listener.server).toBe(server);
    expect(listener.network).toEqual(network);
    expect(changes.at(-1)?.urls).toEqual(["http://192.168.1.20:4100"]);
    expect(changes.at(-1)?.error).toContain("ENOTFOUND");
    failure = false; await listener.refresh();
    expect(changes.at(-1)).toEqual({ urls: ["http://couch.home:4100", "http://192.168.1.20:4100"], error: null });
    expect(starts).toBe(1); expect(stops).toBe(0);
  } finally { await listener.close(); }
});
test("the selected IP starts before DNS finishes and disabling cannot be undone by a late answer", async () => {
  const resolving = Promise.withResolvers<void>(), answer = Promise.withResolvers<{ address: string; family: number }[]>();
  let starts = 0, stops = 0;
  const changes: string[][] = [];
  const listener = createLanListener({
    port: 4100, enabled: true, selected: "eth0", address: network.address, advertised: ["http://couch.home:4100"],
    interfaces: () => ({ eth0: [entry(network.address), entry("192.168.1.21")] }),
    resolve: (() => { resolving.resolve(); return answer.promise; }) as never,
    start: actual => { expect(actual).toEqual(network); starts++; return { stop: async () => { stops++; } }; }, changed: urls => changes.push(urls),
  });
  try {
    await resolving.promise;
    expect(starts).toBe(1);
    expect(changes).toEqual([["http://192.168.1.20:4100"]]);
    await listener.setEnabled(false);
    answer.resolve([{ address: network.address, family: 4 }]);
    await listener.refresh();
    expect(starts).toBe(1); expect(stops).toBe(1); expect(listener.server).toBeNull();
  } finally { answer.resolve([]); await listener.close(); }
});
test("closing during a network change cannot start a replacement listener", async () => {
  const stopping = Promise.withResolvers<void>(), stopped = Promise.withResolvers<void>();
  let address = network.address, starts = 0;
  const listener = createLanListener({
    port: 4100, enabled: true, advertised: [], interfaces: () => ({ eth0: [entry(address)] }),
    start: () => { starts++; return { stop: async () => { stopping.resolve(); await stopped.promise; } }; }, changed: () => {},
  });
  try {
    await listener.refresh();
    address = "192.168.1.21";
    const refresh = listener.refresh();
    await stopping.promise;
    const close = listener.close();
    stopped.resolve();
    await Promise.all([refresh, close]);
    expect(starts).toBe(1); expect(listener.server).toBeNull();
  } finally { stopped.resolve(); await listener.close(); }
});
test("port conflicts reject enabling and cannot silently enable sharing on a later refresh", async () => {
  let conflict = true, starts = 0;
  const listener = createLanListener({ port: 4100, enabled: false, advertised: [], interfaces: () => ({ eth0: [entry(network.address)] }), start: () => { starts++; if (conflict) throw new Error("EADDRINUSE"); return { stop: async () => {} }; }, changed: () => {} });
  try {
    await expect(listener.setEnabled(true)).rejects.toThrow("using the port");
    const attempts = starts; conflict = false; await listener.refresh(); expect(starts).toBe(attempts); expect(listener.server).toBeNull();
  } finally { await listener.close(); }
});
