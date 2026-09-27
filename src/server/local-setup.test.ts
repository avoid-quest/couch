import { expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { createHub } from "./hub";
import { lanNetworks } from "./lan-listener";

test("a fresh independent Core grants its first local browser a normal admin pairing once", async () => {
  const hub = createHub({ hostname: "0.0.0.0", port: 0, databasePath: ":memory:", hostToken: "local-setup-host-token-at-least-32-characters", pairingCode: "123456" });
  const setup = (url: string, headers: Record<string, string> = {}) => fetch(`${url}/api/setup-local`, { method: "POST", headers: { Origin: url, "Content-Type": "application/json", ...headers }, body: JSON.stringify({ name: "Study browser" }) });
  try {
    const connection = await (await fetch(`${hub.origin}/api/connection`)).json() as { localSetupAvailable: boolean; urls: string[] };
    expect(connection.localSetupAvailable).toBe(true);
    expect((await setup(hub.origin, { Origin: "https://other.example" })).status).toBe(403);
    expect((await setup(hub.origin, { Host: "attacker.example" })).status).toBe(403);
    expect((await setup(hub.origin, { "X-Forwarded-Host": "couch.home", "X-Forwarded-Proto": "https" })).status).toBe(403);
    const address = lanNetworks(networkInterfaces())[0]?.address;
    if (address) {
      const lan = `http://${address}:${new URL(hub.origin).port}`;
      expect(connection.urls[0]).toBe(lan);
      expect((await setup(lan)).status).toBe(403);
      expect((await (await fetch(`${lan}/api/connection`)).json() as { localSetupAvailable?: boolean }).localSetupAvailable).toBeUndefined();
    }
    const created = await setup(hub.origin);
    expect(created.status).toBe(200);
    const first = await created.json() as { token: string; controller: { role: string; name: string }; installationId: string };
    expect(first.controller).toMatchObject({ name: "Study browser", role: "administrator" });
    expect(first.token).not.toBe("local-setup-host-token-at-least-32-characters");
    expect((await fetch(`${hub.origin}/api/controllers/me`, { headers: { Authorization: `Bearer ${first.token}` } })).status).toBe(200);
    expect((await setup(hub.origin)).status).toBe(409);
    expect((await (await fetch(`${hub.origin}/api/connection`)).json() as { localSetupAvailable: boolean }).localSetupAvailable).toBe(false);
  } finally { await hub.close(); }
});

test("an existing remote pairing prevents local first-owner setup", async () => {
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: ":memory:", hostToken: "local-setup-host-token-at-least-32-characters", pairingCode: "123456" });
  try {
    const paired = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: "123456", name: "Phone" }) });
    expect(paired.status).toBe(200);
    const setup = await fetch(`${hub.origin}/api/setup-local`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Browser" }) });
    expect(setup.status).toBe(409);
  } finally { await hub.close(); }
});
