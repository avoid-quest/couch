import assert from "node:assert/strict";
import { test } from "node:test";
import { openStore } from "../src/server/store";
import { authorityFixture, until } from "./hub-authority.fixture";

test("code-authorized re-pair replaces the token without inheriting administrator authority", { timeout: 15_000 }, async t => {
  const f = await authorityFixture(); t.after(() => f.close());
  const admin = f.devices[0]!, controller = f.devices[1]!;
  const connected = await f.connect(admin);
  const listed = await f.api("/api/devices", controller.token);
  assert.equal(listed.status, 200);
  const visible = (await listed.json() as { devices: { id: string; role: string }[] }).devices.find(device => device.role === "administrator")!;
  assert.equal(visible.id, admin.id);
  const pair = await f.api("/api/pair", controller.token, { code: f.hub.pairingCode, id: visible.id, name: "Paired again" });
  assert.equal(pair.status, 200, "a valid pairing code intentionally permits token replacement");
  const replacement = await pair.json() as { token: string; device: { role: string } };
  assert.equal((await f.api("/api/devices/me", admin.token)).status, 401, "the previous token is revoked");
  await until(() => connected.socket.readyState === connected.socket.CLOSED);
  assert.equal((await f.api("/api/settings", replacement.token, { name: "Unauthorized rename" })).status, 403, "public re-pair cannot grant admin-only settings access");
  assert.equal(replacement.device.role, "controller");
  assert.equal((await f.api("/api/devices/me", replacement.token)).status, 200, "legitimate re-pair retains Controller access");
  const host = await f.connect(f.host);
  const refused = await f.api("/api/pair", controller.token, { code: f.hub.pairingCode, id: host.id });
  assert.equal(refused.status, 409, "the host ID remains unavailable for public pairing");
  const setup = await f.api("/api/devices/claim-code");
  assert.equal(setup.status, 200);
  const { code } = await setup.json() as { code: string };
  assert.equal((await f.api("/api/devices/claim", replacement.token, { code })).status, 200, "the explicit one-use no-admin recovery path remains available");
  assert.equal((await f.api("/api/settings", replacement.token, { name: "Recovered Couch" })).status, 200);
});

test("first pairing and explicit recovery retain their existing admin semantics", { timeout: 15_000 }, async t => {
  const recoveryCode = "abc123".repeat(8);
  const f = await authorityFixture({ adminRecoveryCode: recoveryCode }); t.after(() => f.close());
  const store = openStore(f.databasePath);
  try {
    for (const device of store.devices()) store.revokeDevice(device.id);
  } finally { store.close(); }
  const first = await f.api("/api/pair", f.host.token, { code: f.hub.pairingCode, id: "f".repeat(43), name: "First" });
  assert.equal(first.status, 200);
  const initial = await first.json() as { token: string; device: { role: string } };
  assert.equal(initial.device.role, "administrator");
  const later = await f.api("/api/pair", f.host.token, { code: f.hub.pairingCode, id: "s".repeat(43), name: "Second" });
  const second = await later.json() as { token: string; device: { role: string } };
  assert.equal(second.device.role, "controller");
  assert.equal((await f.api("/api/devices/claim", second.token, { code: recoveryCode })).status, 200);
  assert.equal((await f.api("/api/settings", second.token, { name: "Recovered" })).status, 200);
  const thirdPair = await f.api("/api/pair", f.host.token, { code: f.hub.pairingCode, id: "r".repeat(43), name: "Third" });
  const third = await thirdPair.json() as { token: string };
  assert.equal((await f.api("/api/devices/claim", third.token, { code: recoveryCode })).status, 401, "the consumed recovery code cannot promote another Controller");
});
