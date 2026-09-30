import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
import { createDeviceIdentity } from "../app/device-identity";
import { createDevices } from "../src/server/devices";
import { openStore } from "../src/server/store";
import { Database } from "../src/server/sqlite";

test("native identity owns the hosted name and survives Client mode without Core", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-identity-"));
  const path = join(directory, "couch.sqlite");
  const main = createDeviceIdentity(path), anotherWindow = createDeviceIdentity(path);
  const origin = new Map<string, string>();
  const legacy = loadSendspinClientIdentity({ getItem: key => origin.get(key) ?? null, setItem: (key, value) => { origin.set(key, value); } });
  let store: ReturnType<typeof openStore> | undefined;
  try {
    const first = main({ key: origin.get("sendspin-identity-sk") });
    assert.equal(first.name, null);
    assert.deepEqual(first.sharing, { audio: false, video: false, administration: false });
    assert.equal(loadSendspinClientIdentity({ getItem: key => key === "sendspin-identity-sk" ? first.key : null, setItem: () => {} }).clientId, legacy.clientId);
    store = openStore(path);
    store.identify(null, legacy.clientId);
    assert.equal(store.installationName(), "Couch");
    assert.equal(store.hostDevice()?.name, "Couch");
    main({ name: "  Living room  " });
    assert.equal(anotherWindow().name, "Living room");
    assert.equal(createDeviceIdentity(path)({ key: "x".repeat(43) }).key, first.key);
    assert.equal(store.installationName(), "Living room");
    assert.equal(store.hostDevice()?.name, "Living room");
    store.renameDevice(legacy.clientId, "Renamed by an administrator");
    assert.equal(main().name, "Renamed by an administrator");
    anotherWindow({ sharing: { audio: true, video: false, administration: false } });
    assert.equal(main().name, "Renamed by an administrator");
    main({ name: "Office" });
    assert.equal(store.installationName(), "Office");
    assert.equal(store.hostDevice()?.name, "Office");
    assert.deepEqual(main().sharing, { audio: true, video: false, administration: false });
    assert.throws(() => main({ name: "\n" }));
    assert.equal(store.installationName(), "Office");
    store.close(); store = undefined;
    main({ name: "Bedroom" });
    assert.equal(anotherWindow().name, "Bedroom");
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("released headless names survive native setup, and corrupt SDK keys recover with sharing off", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-identity-"));
  const path = join(directory, "couch.sqlite");
  const store = openStore(path, true);
  try {
    store.renameInstallation("Existing Couch");
    const identity = createDeviceIdentity(path);
    assert.equal(identity().name, "Existing Couch");
    const db = new Database(path);
    try { db.query("UPDATE installation SET deviceKey = ?, deviceSharing = ? WHERE id = 1").run("broken", JSON.stringify({ audio: true })); }
    finally { db.close(); }
    const recovered = identity();
    assert.equal(recovered.name, "Existing Couch");
    assert.deepEqual(recovered.sharing, { audio: false, video: false, administration: false });
    assert.match(loadSendspinClientIdentity({ getItem: key => key === "sendspin-identity-sk" ? recovered.key : null, setItem: () => {} }).clientId, /^[\w-]{43}$/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("existing pairing survives a native key migration, and clients own their name", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-identity-"));
  const store = openStore(join(directory, "couch.sqlite"), true);
  try {
    const adminToken = store.pair("a".repeat(43), "Admin");
    const clientToken = store.pair("b".repeat(43), "Laptop");
    assert.equal(store.identify(clientToken, "c".repeat(43)), true);
    assert.equal(store.deviceForToken(clientToken)?.id, "c".repeat(43));
    assert.equal(store.deviceForToken(clientToken)?.name, "Laptop");
    store.identify(null, "h".repeat(43));
    const devices = createDevices({ store, onChange: () => {} });
    const rename = (id: string, name: string, token: string) => devices.handle(new Request(`http://localhost/api/devices/${id}/name`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }), () => {
      const device = store.deviceForToken(token)!;
      return { device, authority: device.role === "administrator" ? "administrator" : "controller", claimAvailable: false };
    });
    assert.equal((await rename("c".repeat(43), "Per-server alias", adminToken)).status, 403);
    assert.equal(store.deviceForToken(clientToken)?.name, "Laptop");
    assert.equal((await rename("c".repeat(43), "Office laptop", clientToken)).status, 200);
    assert.equal(store.deviceForToken(clientToken)?.name, "Office laptop");
    assert.equal((await rename("h".repeat(43), "Living room", adminToken)).status, 200);
    assert.equal(store.installationName(), "Living room");
    assert.equal(createDeviceIdentity(join(directory, "couch.sqlite"))().name, "Living room");
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
