import { expect, spyOn, test } from "bun:test";
import * as dns from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHub } from "./hub";
import { selectLan } from "./lan-listener";
let available = false;
try { selectLan(networkInterfaces()); available = true; } catch {}
let port80 = false;
try { const probe = Bun.serve({ hostname: "127.0.0.1", port: 80, fetch: () => new Response() }); probe.stop(true); port80 = true; } catch {}

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

test.skipIf(!available)("a saved origin domain admits its LAN hostname and can be cleared", async () => {
  const network = selectLan(networkInterfaces());
  const directory = mkdtempSync(join(tmpdir(), "couch-origin-domain-"));
  const databasePath = join(directory, "state.sqlite");
  const token = "local-host-token-with-at-least-32-characters";
  const lookup = spyOn(dns, "lookup").mockImplementation((async () => [{ address: network.address, family: 4 }]) as never);
  const start = () => {
    const addresses = Promise.withResolvers<string[]>();
    const hub = createHub({ managedLan: true, remoteControlEnabled: true, port: 0, databasePath, hostToken: token, sendPlayer: () => {}, onAddresses: urls => { if (urls.length) addresses.resolve(urls); } });
    return { hub, addresses: addresses.promise };
  };
  let current = start();
  try {
    await current.addresses;
    const endpoint = () => `${current.hub.origin}/api/settings/origin-domain`;
    const get = () => fetch(endpoint(), { headers: { Authorization: `Bearer ${token}` } });
    const save = (domain: unknown) => fetch(endpoint(), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
    expect((await fetch(endpoint())).status).toBe(401);
    expect(await (await get()).json()).toEqual({ domain: "" });
    for (const domain of ["https://couch.home", "couch.home:4100", "192.168.1.20", "bad..home", "bad_home", 42]) expect((await save(domain)).status).toBe(400);
    expect(await (await save("COUCH.home")).json()).toEqual({ domain: "couch.home" });
    const alias = `http://couch.home:${new URL(current.hub.origin).port}`;
    const ip = `http://${network.address}:${new URL(current.hub.origin).port}`;
    expect((await fetch(`${ip}/api/connection`, { headers: { Host: new URL(alias).host, Origin: alias } })).status).toBe(200);
    expect((await fetch(`${ip}/api/connection`, { headers: { Host: "unrelated.home", Origin: alias } })).status).toBe(403);
    await current.hub.close();
    current = start();
    await current.addresses;
    expect(await (await get()).json()).toEqual({ domain: "couch.home" });
    const restoredAlias = `http://couch.home:${new URL(current.hub.origin).port}`;
    const restoredIp = `http://${network.address}:${new URL(current.hub.origin).port}`;
    expect((await fetch(`${restoredIp}/api/connection`, { headers: { Host: new URL(restoredAlias).host, Origin: restoredAlias } })).status).toBe(200);
    expect(await (await save("")).json()).toEqual({ domain: "" });
    expect((await fetch(`${restoredIp}/api/connection`, { headers: { Host: new URL(restoredAlias).host, Origin: restoredAlias } })).status).toBe(403);
    expect((await fetch(`${restoredIp}/api/connection`)).status).toBe(200);
  } finally { await current.hub.close(); lookup.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
});

test.skipIf(!available)("alias DNS failure preserves IP admission and recovery restores only the validated Host and Origin", async () => {
  const network = selectLan(networkInterfaces());
  const token = "local-host-token-with-at-least-32-characters";
  const resolving = Promise.withResolvers<void>(), answer = Promise.withResolvers<{ address: string; family: number }[]>();
  let failure = false;
  const lookup = spyOn(dns, "lookup").mockImplementation((async () => {
    resolving.resolve();
    if (failure) throw new Error("ENOTFOUND");
    return answer.promise;
  }) as never);
  const advertised: string[] = [];
  const hub = createHub({ managedLan: true, remoteControlEnabled: true, port: 0, databasePath: ":memory:", hostToken: token, advertisedUrls: advertised, sendPlayer: () => {} });
  const alias = `http://couch.home:${new URL(hub.origin).port}`;
  const ip = `http://${network.address}:${new URL(hub.origin).port}`;
  advertised.push(alias);
  const refresh = () => fetch(`${hub.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  const connection = (headers?: HeadersInit) => fetch(`${ip}/api/connection`, { headers });
  try {
    await resolving.promise;
    expect((await (await connection()).json()).urls).toEqual([ip]);
    expect((await connection({ Host: new URL(alias).host })).status).toBe(403);
    expect((await connection({ Origin: alias })).status).toBe(403);
    answer.resolve([{ address: network.address, family: 4 }]);
    expect((await refresh()).status).toBe(200);
    expect((await (await connection({ Host: new URL(alias).host, Origin: alias })).json()).urls).toEqual([alias, ip]);
    failure = true;
    expect((await refresh()).status).toBe(200);
    const details = await (await connection({ Origin: ip })).json();
    expect(details.urls).toEqual([ip]);
    expect(details.remoteControlEnabled).toBe(true);
    expect(details.lanError).toContain("ENOTFOUND");
    expect((await connection({ Host: new URL(alias).host })).status).toBe(403);
    expect((await connection({ Origin: alias })).status).toBe(403);
    failure = false;
    expect((await refresh()).status).toBe(200);
    expect(await (await connection({ Host: new URL(alias).host, Origin: alias })).json()).toMatchObject({ urls: [alias, ip], lanError: null });
    for (const origin of ["https://couch.home", "http://unrelated.home", "null"]) expect((await connection({ Origin: origin })).status).toBe(403);
    expect((await connection({ Host: "unrelated.home", "X-Forwarded-Host": new URL(alias).host })).status).toBe(403);
  } finally { answer.resolve([]); await hub.close(); lookup.mockRestore(); }
});

test.skipIf(!available)("a malformed optional alias cannot prevent the managed hub from starting", async () => {
  const addresses = Promise.withResolvers<string[]>();
  const hub = createHub({ managedLan: true, remoteControlEnabled: true, port: 0, databasePath: ":memory:", hostToken: "local-host-token-with-at-least-32-characters", advertisedUrls: ["invalid"], sendPlayer: () => {}, onAddresses: urls => addresses.resolve(urls) });
  try {
    const [ip] = await addresses.promise;
    const response = await fetch(`${ip}/api/connection`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ urls: [ip], lanError: expect.stringContaining("was ignored") });
  } finally { await hub.close(); }
});

test.skipIf(!available || !port80)("a port 80 alias serves navigation and pairing from its own listener and rejects unrelated hosts", async () => {
  const network = selectLan(networkInterfaces());
  const token = "local-host-token-with-at-least-32-characters";
  const alias = "http://couch.home";
  const lookup = spyOn(dns, "lookup").mockImplementation((async () => [{ address: network.address, family: 4 }]) as never);
  const addresses = Promise.withResolvers<string[]>();
  const hub = createHub({ managedLan: true, remoteControlEnabled: true, port: 0, databasePath: ":memory:", hostToken: token, advertisedUrls: [alias], sendPlayer: () => {}, onAddresses: urls => { if (urls.includes(alias)) addresses.resolve(urls); } });
  try {
    const urls = await addresses.promise;
    expect(urls).toContain(alias);
    expect(urls).toContain(`http://${network.address}:${new URL(hub.origin).port}`);
    const connection = await fetch(`http://${network.address}/api/connection`, { headers: { Host: "couch.home" } });
    expect(connection.status).toBe(200);
    expect((await connection.json()).urls).toContain(alias);
    expect((await fetch(`http://${network.address}/api/pair`, { method: "POST", headers: { Host: "couch.home", Origin: alias, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode, name: "Phone" }) })).status).toBe(200);
    for (const origin of ["http://unrelated.home", "null"]) expect((await fetch(`http://${network.address}/api/connection`, { headers: { Host: "couch.home", Origin: origin } })).status).toBe(403);
    expect((await fetch(`http://${network.address}/api/connection`, { headers: { Host: "unrelated.home" } })).status).toBe(403);
  } finally { await hub.close(); lookup.mockRestore(); }
  await expect(fetch(`http://${network.address}/api/connection`, { headers: { Host: "couch.home" } })).rejects.toThrow();
});
