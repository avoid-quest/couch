import { expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { createHub } from "./hub";
import { selectLan } from "./lan-listener";
let available = false;
try { selectLan(networkInterfaces()); available = true; } catch {}

test.skipIf(!available)("the native hub keeps loopback while sharing opens and closes a separate LAN listener", async () => {
  const token = "local-host-token-with-at-least-32-characters";
  const addresses = Promise.withResolvers<string[]>();
  const hub = createHub({ managedLan: true, remoteControlEnabled: false, port: 0, databasePath: ":memory:", hostToken: token, sendPlayer: () => {}, onAddresses: urls => { if (urls.length) addresses.resolve(urls); } });
  const sharing = (enabled: boolean) => fetch(`${hub.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
  try {
    const urls = await addresses.promise;
    expect(new URL(hub.origin).hostname).toBe("127.0.0.1");
    await expect(fetch(`${urls[0]}/api/connection`)).rejects.toThrow();
    expect((await sharing(true)).status).toBe(200);
    const connection = await fetch(`${urls[0]}/api/connection`);
    expect(connection.status).toBe(200);
    expect((await connection.json()).urls).toEqual(urls);
    expect((await fetch(`${urls[0]}/api/controllers/me`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await sharing(false)).status).toBe(200);
    await expect(fetch(`${urls[0]}/api/connection`)).rejects.toThrow();
    expect((await fetch(`${hub.origin}/api/health`)).status).toBe(200);
  } finally { await hub.close(); }
});
