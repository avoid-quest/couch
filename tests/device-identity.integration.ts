import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeviceName } from "../app/device-name";
import { createDevices } from "../src/server/devices";
import { openStore } from "../src/server/store";

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
