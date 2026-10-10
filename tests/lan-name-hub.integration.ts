import { test } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import os, { networkInterfaces, tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { get } from "node:https";
import { setTimeout as sleep } from "node:timers/promises";
import { createHub } from "../src/server/hub";
import { selectLan } from "../src/server/lan-listener";

const candidate = Object.entries(networkInterfaces()).find(([name, entries]) => { try { selectLan({ [name]: entries }, name); return true; } catch { return false; } });
test("Core admits and certifies its detected name, exposes it in Settings, and preserves customization", { skip: !candidate, timeout: 10000 }, async t => {
  const [name, entries] = candidate!, { address } = selectLan({ [name]: entries }, name);
  const directory = await mkdtemp(join(tmpdir(), "couch-lan-name-"));
  const previous = process.env.COUCH_LAN_INTERFACE;
  process.env.COUCH_LAN_INTERFACE = name;
  t.mock.method(os, "hostname", () => "couch.avoid.local");
  t.mock.method(dns, "lookup", async (host: string) => { await sleep(20); return ["couch.avoid.local", "cinema.avoid.local"].includes(host) ? [{ address, family: 4 }] : []; });
  syncBuiltinESMExports();
  const fetchLocal = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => new URL(String(input)).hostname === "127.0.0.1" ? fetchLocal(input, init) : Promise.resolve(new Response("")));
  const hostToken = "h".repeat(64);
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  t.after(async () => {
    await hub?.close(); t.mock.restoreAll(); syncBuiltinESMExports();
    if (previous === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previous;
    await rm(directory, { recursive: true, force: true });
  });
  hub = await createHub({ managedLan: true, databasePath: join(directory, "couch.sqlite"), hostToken, port: 0 });
  const port = hub.server.port, automatic = `https://couch.avoid.local:${port}`, suggestion = `http://couch.avoid.local:${port}`;
  const settings = (domain?: string, origin?: string) => fetch(`${hub!.origin}/api/settings/origin-domain`, {
    method: domain === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json", ...origin ? { Origin: origin } : {} },
    ...domain === undefined ? {} : { body: JSON.stringify({ domain }) },
  }).then(async response => { assert.equal(response.status, 200); return response.json(); });
  assert.deepEqual(await settings(), { domain: "", suggested: suggestion });
  assert.deepEqual(hub.urls, [automatic, `https://${address}:${port}`]);
  const ca = await readFile(join(directory, "tls/cert.pem"), "utf8");
  const secure = () => new Promise<number | undefined>((resolve, reject) => {
    get(`https://${address}:${port}/api/health`, { ca, allowPartialTrustChain: true, servername: "couch.avoid.local", headers: { Host: `couch.avoid.local:${port}` }, agent: false }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); }).on("error", reject);
  });
  assert.equal(await secure(), 200);
  const custom = `http://cinema.avoid.local:${port}`;
  assert.deepEqual(await settings(custom, automatic), { domain: custom, suggested: "" });
  assert.deepEqual(hub.urls, [`https://cinema.avoid.local:${port}`, `https://${address}:${port}`]);
  assert.equal(await secure(), 200, "the administrator's previous automatic address must survive customization");
  assert.deepEqual(await settings(""), { domain: "", suggested: suggestion });
  assert.deepEqual(hub.urls, [automatic, `https://${address}:${port}`]);
});
