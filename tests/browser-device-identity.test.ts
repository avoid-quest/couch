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
  assert.equal(identity.deviceId(), loadSendspinClientIdentity(identity.deviceStorage()).clientId);
  await identity.saveLocalDeviceName("Laptop");
  assert.equal(identity.deviceStorage().getItem("couch.device-name"), "Laptop");
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

test("an older native bridge can bootstrap, pair and save sharing through browser storage", () => check(`
  import assert from "node:assert/strict";
  import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
  const values = new Map();
  globalThis.window = Object.assign(new EventTarget(), { couchApp: {} });
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const identity = await import("./src/client/session/device-id.ts");
  await identity.initializeDeviceIdentity();
  assert.equal(identity.deviceId(), loadSendspinClientIdentity(identity.deviceStorage()).clientId);
  await identity.saveLocalDeviceName("Laptop");
  const sharing = { audio: true, video: false, administration: false };
  await identity.saveLocalDeviceSharing(sharing);
  assert.equal(identity.localDeviceName(), "Laptop");
  assert.deepEqual(identity.localDeviceSharing(), sharing);
  assert.equal(values.get("couch.device-name"), "Laptop");
  assert.deepEqual(JSON.parse(values.get("couch.device-sharing")), sharing);
  const unsubscribe = identity.subscribeDeviceIdentity(() => {});
  values.set("couch.device-name", "Another window");
  values.set("couch.device-sharing", JSON.stringify({ audio: false, video: true, administration: false }));
  window.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
  assert.equal(identity.localDeviceName(), "Another window");
  assert.equal(identity.localDeviceSharing().video, true);
  unsubscribe();
`));

test("native identity ignores origin caches and refreshes administrator renames from Main", () => check(`
  import assert from "node:assert/strict";
  const staleSharing = { audio: true, video: true, administration: true };
  const values = new Map([["couch.device-name", "Stale origin alias"], ["couch.device-sharing", JSON.stringify(staleSharing)]]);
  const canonical = { key: "a".repeat(43), name: "Canonical laptop", sharing: { audio: false, video: false, administration: false } };
  globalThis.window = Object.assign(new EventTarget(), { couchApp: { deviceIdentity: async update => { Object.assign(canonical, update); return { ...canonical }; } } });
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const identity = await import("./src/client/session/device-id.ts");
  await identity.initializeDeviceIdentity();
  let notifications = 0;
  const unsubscribe = identity.subscribeDeviceIdentity(() => notifications++);
  await identity.saveLocalDeviceName("Laptop");
  const sharing = { audio: true, video: false, administration: false };
  await identity.saveLocalDeviceSharing(sharing);
  assert.equal(canonical.name, "Laptop");
  assert.deepEqual(canonical.sharing, sharing);
  assert.equal(values.get("couch.device-name"), "Stale origin alias");
  assert.deepEqual(JSON.parse(values.get("couch.device-sharing")), staleSharing);
  for (const key of ["couch.device-name", "couch.device-sharing", null]) window.dispatchEvent(Object.assign(new Event("storage"), { key }));
  assert.equal(identity.localDeviceName(), "Laptop");
  assert.deepEqual(identity.localDeviceSharing(), sharing);
  assert.equal(notifications, 2);
  canonical.name = "Renamed by an administrator";
  await identity.initializeDeviceIdentity();
  assert.equal(identity.localDeviceName(), canonical.name);
  assert.equal(notifications, 3);
  unsubscribe();
`));
