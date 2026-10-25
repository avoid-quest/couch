import { expect, test } from "bun:test";
import { lanPeer } from "../src/server/lan-listener";
const network = { name: "en5", address: "10.10.10.120", netmask: "255.255.255.0" };

test("routed LAN clients require an exact explicit peer allowance", () => {
  expect(lanPeer(network, "10.10.10.11")).toBe(true);
  expect(lanPeer(network, "10.10.2.96")).toBe(false);
  expect(lanPeer(network, "10.10.2.96", ["10.10.2.96"])).toBe(true);
  expect(lanPeer(network, "::ffff:10.10.2.96", ["10.10.2.96"])).toBe(true);
  expect(lanPeer(network, "10.10.2.97", ["10.10.2.96"])).toBe(false);
  expect(lanPeer(network, "10.10.2.96", ["10.10.2.0/24", "*", "10.10.2.999"])).toBe(false);
  expect(lanPeer(network, "invalid", ["invalid"])).toBe(false);
  expect(lanPeer({ ...network, netmask: "invalid" }, "10.10.2.96", ["10.10.2.96"])).toBe(false);
});
