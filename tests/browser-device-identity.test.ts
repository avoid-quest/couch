import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const check = (source: string) => {
  const result = spawnSync(process.execPath, ["-e", source], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("full storage keeps Couch and Sendspin on one key and accepts later cross-tab changes", () => check(`
  import assert from "node:assert/strict";
  import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
  const values = new Map();
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: () => { throw new Error("QuotaExceededError"); } };
  const identity = await import("./src/client/session/device-id.ts");
  assert.equal(identity.deviceId(), loadSendspinClientIdentity(identity.storage).clientId);
  await identity.saveLocalDeviceName("Laptop");
  assert.equal(identity.storage.getItem("couch.device-name"), "Laptop");
  const unsubscribe = identity.subscribeDeviceIdentity(() => {});
  values.set("couch.device-name", "Office laptop");
  window.dispatchEvent(Object.assign(new Event("storage"), { key: "couch.device-name" }));
  assert.equal(identity.localDeviceName(), "Office laptop");
  await identity.saveLocalDeviceName("Temporary name");
  values.clear();
  window.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
  assert.equal(identity.localDeviceName(), null);
  unsubscribe();
`));

test("an older native bridge keeps the name in browser storage", () => check(`
  import assert from "node:assert/strict";
  const values = new Map([["couch.device-name", "Laptop"]]);
  globalThis.window = Object.assign(new EventTarget(), { couchApp: {} });
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const identity = await import("./src/client/session/device-id.ts");
  await identity.loadLocalDeviceName();
  assert.equal(identity.localDeviceName(), "Laptop");
  await identity.saveLocalDeviceName("Office laptop");
  assert.equal(values.get("couch.device-name"), "Office laptop");
`));

test("the Couch app's name comes from Main, not the origin's storage", () => check(`
  import assert from "node:assert/strict";
  const values = new Map([["couch.device-name", "Stale origin alias"]]);
  let saved = "Canonical laptop";
  globalThis.window = Object.assign(new EventTarget(), { couchApp: { deviceName: async name => saved = name ?? saved } });
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const identity = await import("./src/client/session/device-id.ts");
  assert.equal(identity.localDeviceName(), null);
  let notifications = 0;
  const unsubscribe = identity.subscribeDeviceIdentity(() => notifications++);
  await identity.loadLocalDeviceName();
  assert.equal(identity.localDeviceName(), "Canonical laptop");
  await identity.saveLocalDeviceName("Laptop");
  assert.equal(saved, "Laptop");
  assert.equal(values.get("couch.device-name"), "Stale origin alias");
  window.dispatchEvent(Object.assign(new Event("storage"), { key: "couch.device-name" }));
  assert.equal(identity.localDeviceName(), "Laptop");
  saved = "Renamed by an administrator";
  await identity.loadLocalDeviceName();
  assert.equal(identity.localDeviceName(), saved);
  assert.equal(notifications, 3);
  unsubscribe();
`));
