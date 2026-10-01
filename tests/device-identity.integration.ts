import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeviceName, saveDeviceName } from "../app/device-name";
import { createDevices } from "../src/server/devices";
import { openStore } from "../src/server/store";
import { UNNAMED_COUCH } from "../src/shared/devices";

test("the app and the Couch it hosts share one installation name, with or without Core", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-identity-"));
  const path = join(directory, "couch.sqlite");
  let store: ReturnType<typeof openStore> | undefined;
  try {
    // Client mode before Core ever ran: Main reads nothing, then creates the name.
    assert.equal(readDeviceName(path), null);
    assert.equal(saveDeviceName(path, "  Laptop  "), "Laptop");
    assert.equal(readDeviceName(path), "Laptop");
    store = openStore(path);
    assert.equal(store.installationName(), "Laptop");
    store.identify(null, "h".repeat(43));
    assert.equal(store.hostDevice()?.name, "Laptop");
    saveDeviceName(path, "Living room");
    assert.equal(store.hostDevice()?.name, "Living room");
    store.renameInstallation("Renamed by an administrator");
    assert.equal(readDeviceName(path), "Renamed by an administrator");
    assert.throws(() => saveDeviceName(path, "\n"));
    // "Couch", the name Core seeds, counts as unnamed so a pairing name is not replaced by it.
    store.renameInstallation(UNNAMED_COUCH);
    assert.equal(readDeviceName(path), null);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("clients own their name, and administrators name only the host", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-identity-"));
  const store = openStore(join(directory, "couch.sqlite"), true);
  try {
    const adminToken = store.pair("a".repeat(43), "Admin");
    const clientToken = store.pair("b".repeat(43), "Laptop");
    // An existing pairing survives a key change with its name.
    assert.equal(store.identify(clientToken, "c".repeat(43)), true);
    assert.equal(store.deviceForToken(clientToken)?.name, "Laptop");
    const devices = createDevices({ store, onChange: () => {} });
    const send = (path: string, name: string, token: string) => devices.handle(new Request(`http://localhost${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }), () => {
      const device = store.deviceForToken(token)!;
      return { device, authority: device.role === "administrator" ? "administrator" : "controller", claimAvailable: false };
    });
    assert.equal((await send("/api/settings", "Denied", clientToken)).status, 403);
    assert.equal((await send("/api/settings", "Headless Couch", adminToken)).status, 200);
    assert.equal(store.installationName(), "Headless Couch");
    store.identify(null, "h".repeat(43));
    assert.equal(store.hostDevice()?.name, "Headless Couch");
    assert.equal((await send(`/api/devices/${"c".repeat(43)}/name`, "Per-server alias", adminToken)).status, 403);
    assert.equal((await send(`/api/devices/${"h".repeat(43)}/name`, "Second route", adminToken)).status, 403);
    assert.equal((await send(`/api/devices/${"c".repeat(43)}/name`, "Office laptop", clientToken)).status, 200);
    assert.equal(store.deviceForToken(clientToken)?.name, "Office laptop");
    assert.equal(readDeviceName(join(directory, "couch.sqlite")), "Headless Couch");
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
