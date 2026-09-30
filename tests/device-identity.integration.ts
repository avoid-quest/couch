import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevices } from "../src/server/devices";
import { openStore } from "../src/server/store";

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
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
