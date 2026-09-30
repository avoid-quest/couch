import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const check = (source: string) => {
  const result = spawnSync(process.execPath, ["-e", `
    import assert from "node:assert/strict";
    const values = new Map();
    globalThis.window = new EventTarget();
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    globalThis.location = new URL("http://one.local:4100/");
    globalThis.history = { state: null, replaceState: (_state, _title, value) => { globalThis.location = new URL(value, location); } };
    const details = name => ({ name, urls: [], player: "idle" });
    ${source}
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("the browser retains known server labels and migrates its old current connection", () => check(`
  values.set("couch.connection", JSON.stringify({ origin: location.origin, details: details("Living room") }));
  const connections = await import("./src/client/session/connection.ts");
  assert.deepEqual(connections.knownConnections(), [{ origin: location.origin, name: "Living room" }]);
  connections.rememberConnection("http://two.local:4100", details("Kitchen"));
  assert.deepEqual(connections.knownConnections(), [{ origin: location.origin, name: "Living room" }, { origin: "http://two.local:4100", name: "Kitchen" }]);
  assert.equal(connections.knownConnection().details.name, "Kitchen");
  connections.forgetConnection(location.origin);
  assert.deepEqual(connections.knownConnections(), [{ origin: "http://two.local:4100", name: "Kitchen" }]);
  connections.forgetConnection("http://two.local:4100");
  assert.equal(connections.knownConnection(), null);
  assert.deepEqual(connections.knownConnections(), []);
`));

test("a deliberate switch carries only public labels, leaving credentials and keys in storage", () => check(`
  values.set("couch.remote-token", "pairing-secret");
  values.set("sendspin-identity-sk", "device-secret");
  values.set("couch.device-name", "Laptop");
  const identity = await import("./src/client/session/device-id.ts");
  const connections = await import("./src/client/session/connection.ts");
  connections.rememberConnection(location.origin, { ...details("Living room"), token: "discovery-secret" });
  const fragment = connections.connectionHash(identity.deviceNameHash(), { origin: location.origin, name: "Living room" });
  assert.equal(new URLSearchParams(fragment.slice(1)).get("device-name"), "Laptop");
  assert.deepEqual(JSON.parse(new URLSearchParams(fragment.slice(1)).get("couches")), [{ origin: location.origin, name: "Living room" }]);
  for (const secret of ["pairing-secret", "device-secret", "discovery-secret"]) assert.equal(fragment.includes(secret), false);
  assert.equal(values.get("couch.remote-token"), "pairing-secret");
  assert.equal(values.get("sendspin-identity-sk"), "device-secret");
`));

test("the destination adopts a shared name and return addresses without replacing its pairing", () => check(`
  values.set("couch.device-name", "Old alias");
  values.set("couch.remote-token", "destination-pairing");
  const labels = [{ origin: "http://two.local:4100", name: "Kitchen" }, { origin: "http://one.local:4100", name: "Living room" }];
  location.hash = new URLSearchParams({ couches: JSON.stringify(labels), "device-name": "Laptop", pair: "123456" }).toString();
  const identity = await import("./src/client/session/device-id.ts");
  const connections = await import("./src/client/session/connection.ts");
  assert.equal(identity.localDeviceName(), "Laptop");
  assert.deepEqual(connections.knownConnections(), labels);
  assert.equal(location.hash, "#pair=123456");
  assert.equal(values.get("couch.remote-token"), "destination-pairing");
`));

test("malformed server hints cannot add credentials, paths or non-HTTP destinations", () => check(`
  const labels = [null, { origin: "javascript:alert(1)", name: "Bad" }, { origin: "http://user:password@one.local:4100", name: "Bad" }, { origin: "http://one.local:4100/path", name: "Bad" }, { origin: "http://two.local:4100", name: "Kitchen", token: "discarded" }];
  location.hash = new URLSearchParams({ couches: JSON.stringify(labels) }).toString();
  const connections = await import("./src/client/session/connection.ts");
  assert.deepEqual(connections.knownConnections(), [{ origin: "http://two.local:4100", name: "Kitchen" }]);
  assert.equal(location.hash, "");
  assert.equal(values.get("couch.connections").includes("discarded"), false);
`));
