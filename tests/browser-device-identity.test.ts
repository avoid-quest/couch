import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const check = (source: string) => {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("full storage keeps the SDK identity stable", () =>
  check(`
  import assert from "node:assert/strict";
  const values = new Map();
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: () => { throw new Error("QuotaExceededError"); } };
  const identity = await import("./src/client/session/device-id.ts");
  assert.match(identity.deviceId(), /^[A-Za-z0-9_-]{43}$/);
  const { loadSendspinClientIdentity } = await import("@sendspin/sendspin-js");
  assert.equal(identity.deviceId(), loadSendspinClientIdentity(identity.storage).clientId);
`));

test("the Couch app shares one choice from Main with every Couch it joins", () =>
  check(`
  import assert from "node:assert/strict";
  const values = new Map([["couch.device-sharing", JSON.stringify({ audio: true, video: true })]]);
  let saved = { audio: true, video: false };
  globalThis.window = Object.assign(new EventTarget(), { couchApp: { deviceSharing: async sharing => saved = sharing ?? saved } });
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const identity = await import("./src/client/session/device-id.ts");
  assert.deepEqual(identity.localDeviceSharing(), { audio: false, video: false });
  await identity.loadLocalDeviceSharing();
  assert.deepEqual(identity.localDeviceSharing(), { audio: true, video: false });
  await identity.saveLocalDeviceSharing({ audio: false, video: true });
  assert.deepEqual(saved, { audio: false, video: true });
  assert.equal(values.get("couch.device-sharing"), JSON.stringify({ audio: true, video: true }));
  await assert.rejects(identity.saveLocalDeviceSharing({ audio: true, video: true, extra: true }));
`));
