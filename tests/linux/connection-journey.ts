import { strict as assert } from "node:assert";
import type { ControllerIdentity } from "../../src/shared/controllers";
import { seedConfiguredFixture } from "./configured-fixture";
import { keys, startHttpRemote, type UiDriver, type Wait } from "./ui";

seedConfiguredFixture();

const origin = "http://127.0.0.1:4100", artifacts = "/artifacts";
const recoveryCode = "0123456789abcdef0123456789abcdef";
const checks: string[] = [];
const until: Wait = async (description, predicate, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, description);
    await Bun.sleep(50);
  }
  checks.push(description); console.log(`PASS ${description}`);
};

const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/connection-driver.log`), stderr: Bun.file(`${artifacts}/connection-native.log`) });
let session = "", primary: Awaited<ReturnType<typeof startHttpRemote>> | undefined, ordinary: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(`http://127.0.0.1:4444${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as { value: any };
  assert.ok(response.ok && !result.value?.error, `Tauri WebDriver ${path} succeeds`);
  return result.value;
};
const token = (ui: UiDriver) => ui.execute("return localStorage.getItem('couch.remote-token')") as Promise<string>;
const api = (credential: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => fetch(`${origin}${path}`, { method, headers: { origin, authorization: `Bearer ${credential}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function openNative() {
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  const { UiDriver } = await import("./ui");
  return new UiDriver(request, () => session);
}

async function connections(ui: UiDriver, description: string) {
  if (!await ui.execute("return location.pathname.startsWith('/settings')")) {
    await until("native or browser navigation is ready", () => ui.execute("return !!document.querySelector('.section-nav a[href^=\"/settings\"]')"));
    await ui.section("Settings");
  }
  if (!await ui.execute("return document.querySelector('[aria-label=\"Settings pages\"] [data-settings-page=connection]')?.getAttribute('aria-current') === 'page'")) await ui.settingsSection("connection");
  await until(description, () => ui.execute("return !!document.querySelector('[aria-label=\"Connected devices\"]') && !document.body.textContent.includes('Loading settings…')"));
}

async function rePair(ui: UiDriver, code: string, name: string) {
  await until("revoked browser displays the real pairing form", () => ui.execute("return !!document.querySelector('#pairing-code') && document.querySelector('.header-status [role=status]')?.textContent === 'Pairing required'"));
  await ui.type("#remote-name", name); await ui.type("#pairing-code", code); await ui.button("Connect", ".pair-form");
  await until("replacement browser connects with a new credential", () => ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected' && !document.querySelector('#pairing-code')"));
}

try {
  await until("connection native driver starts", async () => { try { return (await fetch("http://127.0.0.1:4444/status")).ok; } catch { return false; } });
  let tv = await openNative();
  await connections(tv, "configured native Connections loads its setup controls");
  await tv.button("Pair a remote", ".app-header");
  await until("native pairing dialog exposes its current code", () => tv.execute("return /^\\d{6}$/.test(document.querySelector('[role=dialog] .pairing-display strong')?.textContent ?? '')"));
  const pairingCode = await tv.execute("return document.querySelector('[role=dialog] .pairing-display strong').textContent") as string;
  await tv.key(keys.escape);

  primary = await startHttpRemote(`${origin}/settings/connection`, pairingCode, artifacts, until);
  const phone = primary.ui;
  await primary.screenshot("connection-claim-deep-link");
  const primaryToken = await token(phone);
  const primaryIdentity = await (await api(primaryToken, "/api/controllers/me")).json() as ControllerIdentity;
  await until("administrator deep link survives identity loading after real browser pairing", () => phone.execute("return location.pathname === '/settings/connection' && !!document.querySelector('[aria-label=\"Connected devices\"]')"));
  assert.equal(primaryIdentity.authority, "administrator", "the current first paired browser starts as the administrator");

  ordinary = await startHttpRemote(`${origin}/settings/connection`, pairingCode, artifacts, until, 4447);
  const helper = ordinary.ui, helperToken = await token(helper);
  await until("ordinary deep link cannot expose connection management", () => helper.execute("return !document.querySelector('[aria-label=\"Connected devices\"] ul') && document.body.textContent.includes('Claim administration to manage devices.')"));
  assert.equal((await api(helperToken, "/api/controllers")).status, 403, "ordinary browser cannot list controllers");

  await connections(phone, "administrator Connections reloads the paired browser");
  await phone.button("Make administrator", "[aria-label='Connected devices']");
  await until("administrator promotion reaches the paired browser", async () => (await (await api(helperToken, "/api/controllers/me")).json() as ControllerIdentity).authority === "administrator");
  await connections(helper, "promoted browser receives live connection authority");
  await connections(phone, "original administrator retains device management");
  await phone.button("Make controller", "[aria-label='Connected devices']");
  await until("administrator demotion removes ordinary browser management", async () => (await (await api(helperToken, "/api/controllers/me")).json() as ControllerIdentity).authority === "controller" && !await helper.execute("return !!document.querySelector('[aria-label=\"Connected devices\"] ul')"));

  await connections(phone, "administrator reloads before revocation");
  await phone.button("Remove", "[aria-label='Connected devices']");
  await until("revocation visibly requires pairing in the real browser", () => helper.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Pairing required' && !!document.querySelector('[role=alert]')"));
  assert.equal((await api(helperToken, "/api/controllers/me")).status, 401, "revoked credentials cannot read identity");
  await ordinary.screenshot("connection-revoked");

  await rePair(helper, pairingCode, "Connection replacement");
  const replacementToken = await token(helper);
  assert.notEqual(replacementToken, helperToken, "replacement pairing gets new credentials");
  await ordinary.refresh();
  await until("browser refresh reconnects with replacement credentials", async () => await token(helper) === replacementToken && await helper.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));

  await request(`/session/${session}`, undefined, "DELETE"); session = "";
  await until("native sidecar stops before recovery restart", async () => { try { return !(await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return true; } });
  tv = await openNative();
  await connections(tv, "restarted native Connections reloads durable state");
  await ordinary.restore();
  await until("replacement browser reconnects after native restart", () => helper.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"), 30_000);
  await connections(helper, "reconnected controller sees recovery claim");
  await until("recovery claim is offered after restart", () => helper.execute("return !!document.querySelector('#administrator-code:not(:disabled)')"));
  await helper.type("#administrator-code", recoveryCode); await helper.button("Claim administrator", "[aria-label='Claim administrator']");
  await until("recovery claim after restart grants administration", async () => (await (await api(replacementToken, "/api/controllers/me")).json() as ControllerIdentity).authority === "administrator" && !await helper.execute("return !!document.querySelector('#administrator-code')"));
  await ordinary.screenshot("connection-recovery");
  await Bun.write(`${artifacts}/connection-journey.json`, JSON.stringify({ checks, clientStateProof: "src/client/session/connection-lifetime.test.tsx covers cache retirement and same-address installation replacement", physicalHardware: false }, null, 2));
} finally {
  await primary?.close(); await ordinary?.close();
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill(); await driver.exited;
}
