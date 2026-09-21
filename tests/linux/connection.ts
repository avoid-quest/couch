import { strict as assert } from "node:assert";
import type { ControllerIdentity } from "../../src/shared/controllers";
import { assertResponsive, keys, type UiDriver, type Wait, type startHttpRemote } from "./ui";

type Context = { origin: string; ui: UiDriver; httpRemote: Awaited<ReturnType<typeof startHttpRemote>>; until: Wait; artifactDir: string };
const settings = '[role="dialog"]:has([aria-label="Settings sections"])';
const browserToken = (ui: UiDriver) => ui.execute("return localStorage.getItem('couch.remote-token')") as Promise<string>;

async function connection(ui: UiDriver, until: Wait) {
  await ui.browse();
  await ui.button("Settings");
  await ui.settingsSection("connection");
  await until("Connection finishes loading", () => ui.execute("return !!document.querySelector(arguments[0]) && !document.querySelector(arguments[0]).textContent.includes('Loading settings…')", [settings]));
}

function api(origin: string, token: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return fetch(`${origin}${path}`, { method, headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function pairBrowser({ ui, httpRemote, until }: Context, name: string) {
  await until("Pair again closes Settings and returns to the real pairing form", () => httpRemote.ui.execute("return !document.querySelector('[role=dialog]') && !!document.querySelector('#pairing-code') && document.activeElement?.getAttribute('aria-label') === 'Settings'"));
  const code = await ui.execute("return document.querySelector('.pair-shortcut strong').textContent");
  await httpRemote.ui.type("#remote-name", name);
  await httpRemote.ui.type("#pairing-code", code);
  await httpRemote.ui.button("Connect", ".pair-form");
  await until("replacement browser connects as an ordinary controller", () => httpRemote.ui.execute("return !document.querySelector('#pairing-code') && document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  return browserToken(httpRemote.ui);
}

export async function verifyConnection(context: Context) {
  const { origin, ui, httpRemote, until, artifactDir } = context;
  await httpRemote.restore();
  const phone = httpRemote.ui;
  const original = await browserToken(phone);
  const caller = await (await api(origin, original, "/api/controllers/me")).json() as ControllerIdentity;
  assert.equal(caller.authority, "administrator");
  await connection(phone, until);
  assert.equal(await phone.execute("return [...document.querySelectorAll('button')].find(button => button.textContent === 'Pair again')?.disabled"), true, "The sole connected administrator cannot accidentally forget this browser");
  assert.equal((await api(origin, original, `/api/controllers/${caller.controller!.id}`, undefined, "DELETE")).status, 409, "HTTP also protects the last administrator");
  await phone.settingsSection("remotes");
  const code = await ui.execute("return document.querySelector('.pair-shortcut strong').textContent");
  const response = await api(origin, "", "/api/pair", { code, name: "Connection helper" });
  assert.equal(response.status, 200);
  const helper = await response.json() as { token: string };
  const helperIdentity = await (await api(origin, helper.token, "/api/controllers/me")).json() as ControllerIdentity;
  assert.equal(helperIdentity.authority, "controller");
  assert.equal((await api(origin, helper.token, "/api/controllers")).status, 403);
  const row = `[data-controller-id="${helperIdentity.controller!.id}"]`;
  await until("the administrator sees a new named remote without reopening Settings", () => phone.execute("return !!document.querySelector(arguments[0])", [row]));
  await phone.type(`${row} input`, "Kitchen native acceptance");
  await phone.button("Save remote name", row);
  await until("remote rename is committed through the native sidecar", async () => ((await (await api(origin, helper.token, "/api/controllers/me")).json()) as ControllerIdentity).controller?.name === "Kitchen native acceptance");
  await phone.button("Approve administrator", row);
  await phone.button("Approve administrator", `${row} [role=alert]`);
  await until("approved helper gains server-enforced administrator authority", async () => ((await (await api(origin, helper.token, "/api/controllers/me")).json()) as ControllerIdentity).authority === "administrator");
  await assertResponsive(phone, "Connection administrator devices");
  await httpRemote.screenshot("http-paired-remotes");
  await phone.settingsSection("connection");
  await phone.button("Pair again", settings);
  await phone.button("Forget this browser", settings);
  const replacement = await pairBrowser(context, "Connection replacement");
  assert.equal((await api(origin, original, "/api/controllers/me")).status, 200, "Pair again never revokes the original server credential");
  const replacementIdentity = await (await api(origin, replacement, "/api/controllers/me")).json() as ControllerIdentity;
  assert.equal(replacementIdentity.authority, "controller", "Pairing again never inherits former administrator authority");
  await connection(phone, until);
  assert.equal(await phone.execute("return !!document.querySelector('[aria-label=\"Paired remotes\"]')"), false);
  await phone.settingsSection("general");
  assert.equal(await phone.execute("return !!document.querySelector('[role=tab][id$=\"-trigger-remotes\"], [aria-label=\"Paired remotes\"]')"), false, "An ordinary controller cannot reach paired-remote management in TV settings");
  await phone.settingsSection("connection");
  await phone.button("Reconnect", settings);
  await until("Reconnect preserves the browser credential and obtains a fresh snapshot", async () => await browserToken(phone) === replacement && await phone.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  assert.equal((await api(origin, helper.token, `/api/controllers/${replacementIdentity.controller!.id}`, undefined, "DELETE")).status, 200);
  await until("revocation immediately exposes pairing-required Connection in the real HTTP browser", () => phone.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Pairing required' && document.querySelector(arguments[0])?.textContent.includes('rejected this browser')", [settings]));
  for (const path of ["/api/controllers/me", "/api/settings", "/api/radio/favorites", "/api/library/items"]) assert.equal((await api(origin, replacement, path)).status, 401, `Revoked credential cannot request ${path}`);
  await httpRemote.screenshot("http-revoked-connection");
  await phone.button("Pair again", settings);
  const final = await pairBrowser(context, "Connection restored");
  const finalIdentity = await (await api(origin, final, "/api/controllers/me")).json() as ControllerIdentity;
  assert.equal((await api(origin, helper.token, `/api/controllers/${finalIdentity.controller!.id}/role`, { role: "administrator" })).status, 200);
  await connection(phone, until);
  await until("the already connected browser sees its approved role", () => phone.execute("return document.querySelector('[role=dialog]')?.textContent.includes('Administrator')"));
  await phone.settingsSection("remotes");
  await until("an already connected browser sees its approved role and device management", () => phone.execute("return !!document.querySelector('[aria-label=\"Paired remotes\"]')"));
  await phone.key(keys.escape);
  await httpRemote.minimize();
  await Bun.write(`${artifactDir}/connection-management.json`, JSON.stringify({ lastAdministratorProtected: true, pairingAlwaysController: true, renameAndPromotion: true, reconnectRetainedCredential: true, pairAgainOldCredentialStatus: 200, revokeImmediateBrowserState: "Pairing required", laterHttpStatus: 401, liveRoleChange: true }, null, 2));
}

export async function verifyRecovery(context: Context, recoveryCode: string) {
  const { origin, httpRemote, until, artifactDir } = context;
  await httpRemote.restore();
  const phone = httpRemote.ui;
  const before = await browserToken(phone);
  await connection(phone, until);
  await phone.button("Pair again", settings);
  await phone.button("Forget this browser", settings);
  const recovered = await pairBrowser(context, "Recovered administrator");
  await phone.button("Settings");
  await phone.settingsSection("general");
  await until("the replacement browser offers the configured recovery claim", () => phone.execute("return !!document.querySelector('#administrator-code:not(:disabled)')"));
  await phone.type("#administrator-code", recoveryCode);
  await phone.button("Claim administrator", settings);
  await until("local recovery grants administration in the real native and HTTP application", () => phone.execute("return !!document.querySelector('#tv-name:not(:disabled)') && !document.querySelector('#administrator-code')"));
  assert.equal((await (await api(origin, recovered, "/api/controllers/me")).json() as ControllerIdentity).authority, "administrator");
  assert.equal((await api(origin, before, "/api/controllers/me")).status, 200, "Recovery does not revoke the earlier administrator");
  assert.equal((await (await api(origin, recovered, "/api/controllers/me")).json() as ControllerIdentity).claimAvailable, false, "Recovery secret is consumed");
  await httpRemote.screenshot("http-recovered-administrator");
  await phone.key(keys.escape);
  await httpRemote.minimize();
  await Bun.write(`${artifactDir}/administrator-recovery.json`, JSON.stringify({ invocation: "COUCH_ADMIN_RECOVERY_CODE supplied to tauri-driver's native child /work/bin/couch", claimedThrough: "real HTTP browser Settings > General", recoveredRole: "administrator", oldCredentialStatus: 200, secretConsumed: true, limitation: "Local native process fixture. Installed supervisor and physical-target SSH recovery require separate appliance qualification." }, null, 2));
}

export async function preparePublicConnection(context: Context, otherRemote: Context["httpRemote"]) {
  const { origin, httpRemote, until, artifactDir } = context;
  const administrator = await browserToken(httpRemote.ui);
  const revoked = await browserToken(otherRemote.ui);
  const identity = await (await api(origin, revoked, "/api/controllers/me")).json() as ControllerIdentity;
  await otherRemote.restore();
  await connection(otherRemote.ui, until);
  assert.equal((await api(origin, administrator, `/api/controllers/${identity.controller!.id}`, undefined, "DELETE")).status, 200);
  await until("the second HTTP browser enters pairing-required state", () => otherRemote.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Pairing required'"));
  await otherRemote.minimize();
  await httpRemote.restore();
  await connection(httpRemote.ui, until);
  await httpRemote.ui.button("Pair again", settings);
  await httpRemote.ui.button("Forget this browser", settings);
  await until("the first HTTP browser forgets only its local pairing", () => httpRemote.ui.execute("return !document.querySelector('[role=dialog]') && !!document.querySelector('#pairing-code') && !localStorage.getItem('couch.remote-token') && document.activeElement?.getAttribute('aria-label') === 'Settings'"));
  await connection(httpRemote.ui, until);
  await httpRemote.minimize();
  const health = (ui: UiDriver) => ui.execute("return Object.fromEntries([...document.querySelectorAll('[role=dialog] dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]))");
  return {
    async assertOffline() {
      for (const remote of [httpRemote, otherRemote]) await until("unpaired and rejected Connection update public server health after real shutdown", async () => {
        const details = await health(remote.ui);
        return details.Server === "Server unavailable" && details.Player === "Unknown while disconnected";
      });
    },
    async assertAfterRestart() {
      for (const remote of [httpRemote, otherRemote]) await until("unpaired and rejected Connection refresh server and native player availability after restart", async () => {
        const details = await health(remote.ui);
        return details.Server === "Reachable" && details.Player === "Available";
      });
      assert.equal(await browserToken(otherRemote.ui), revoked, "Public health polling does not replace the rejected credential");
      assert.equal((await api(origin, revoked, "/api/controllers/me")).status, 401);
      assert.equal(await httpRemote.ui.execute("return localStorage.getItem('couch.remote-token')"), null);
      await Bun.write(`${artifactDir}/public-connection-health.json`, JSON.stringify({ browsers: ["unpaired", "revoked"], stoppedServer: "Server unavailable", stoppedPlayer: "Unknown while disconnected", restartedServer: "Reachable", restartedPlayer: "Available", revokedCredentialStatus: 401, pairingPreserved: true }, null, 2));
    },
  };
}
