import { strict as assert } from "node:assert";
import type { ControllerIdentity } from "../../src/shared/controllers";
import type { Action, NavigationKey, SessionState } from "../../src/shared/protocol";
import { assertResponsive, keys, type UiDriver, type Wait, type startHttpRemote } from "./ui";

type Remote = { token: string; state: SessionState | null; command: (action: Action) => Promise<void> };
type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = { origin: string; ui: UiDriver; httpRemote: HttpRemote; clients: readonly Remote[]; until: Wait; artifactDir: string };
const settings = '[role="dialog"]:has([aria-label="Settings sections"])';

async function closeSettings(ui: UiDriver, until: Wait) {
  await ui.key(keys.escape);
  await until("Settings closes and restores its entry", () => ui.execute("return !document.querySelector(arguments[0]) && document.activeElement?.getAttribute('aria-label') === 'Settings'", [settings]));
}

async function openSettings(ui: UiDriver, until: Wait) {
  await ui.browse();
  await ui.button("Settings");
  await until("Settings loads General through the real application", () => ui.execute("const dialog = document.querySelector(arguments[0]); return !!dialog && !dialog.textContent.includes('Loading settings…') && !!dialog.querySelector('#tv-name, [data-settings-tv-name]')", [settings]));
}

async function frames(ui: UiDriver) {
  await ui.request(`/session/${ui.session()}/execute/async`, { script: "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(null)));", args: [] });
}

async function navigate(ui: UiDriver, client: Remote, until: Wait, key: NavigationKey) {
  await ui.execute("document.documentElement.removeAttribute('data-keyboard')");
  await client.command({ type: "navigate", key });
  await until(`paired ${key} reaches the native navigation handler`, () => ui.execute("return document.documentElement.hasAttribute('data-keyboard')"));
  // App schedules applyTvNavigation in a frame. Assertions must follow it.
  await frames(ui);
}

async function focusProbe(ui: UiDriver, selector: string) {
  assert.equal(await ui.execute(`
    const button = document.querySelector(arguments[0]);
    if (!button || button.disabled || !button.getClientRects().length) return false;
    window.__claimProbe = { button, clicks: 0, listener: () => window.__claimProbe.clicks++ };
    button.addEventListener('click', window.__claimProbe.listener);
    button.focus();
    return document.activeElement === button;
  `, [selector]), true, "The actual local-only control owns physical keyboard focus before remote input");
}

async function stopProbe(ui: UiDriver) {
  const clicks = await ui.execute("const probe = window.__claimProbe; probe.button.removeEventListener('click', probe.listener); delete window.__claimProbe; return probe.clicks");
  assert.equal(clicks, 0, "Paired navigation does not click the protected native action");
}

async function verifyNavigationBoundary({ ui, clients, until, origin }: Context) {
  const guest = clients[1]!;
  const get = async (path: string) => {
    const response = await fetch(`${origin}${path}`, { headers: { origin, authorization: `Bearer ${guest.token}` } });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  await openSettings(ui, until);
  await ui.button("This screen", '[aria-label="Settings sections"]');
  await ui.execute("document.querySelector('[aria-label=\"Settings sections\"] [data-state=active]').focus()");
  await navigate(ui, guest, until, "right");
  await until("Radix moves remote arrow focus to the protected Sources tab without activating it", () => ui.execute("return document.activeElement?.textContent === 'Sources' && document.querySelector('[aria-label=\"Settings sections\"] [data-state=active]')?.textContent === 'This screen'"));
  await navigate(ui, guest, until, "select");
  assert.equal(await ui.execute("return document.querySelector('[aria-label=\"Settings sections\"] [data-state=active]')?.textContent === 'This screen' && !document.querySelector('[aria-label=\"Jellyfin settings\"]')"), true, "Remote Enter cannot activate Sources after Radix deferred focus reaches its protected trigger");
  await navigate(ui, guest, until, "left");
  assert.equal(await ui.execute("return document.activeElement?.textContent === 'This screen'"), true, "Remote Left recovers the preceding ordinary tab after Sources owns Radix's only tab stop");
  await navigate(ui, guest, until, "right");
  await until("remote Right can focus protected Sources again", () => ui.execute("return document.activeElement?.textContent === 'Sources'"));
  await navigate(ui, guest, until, "right");
  assert.equal(await ui.execute("return document.activeElement?.textContent === 'Connection'"), true, "Remote Right recovers the next ordinary tab without opening Sources");
  await navigate(ui, guest, until, "select");
  await until("ordinary Connection tab still activates after protected-tab recovery", () => ui.execute("return document.querySelector('[aria-label=\"Settings sections\"] [data-state=active]')?.textContent === 'Connection' && !document.querySelector('[aria-label=\"Jellyfin settings\"]')"));
  await closeSettings(ui, until);
  await ui.section("Library");
  await ui.click('[data-action="library-folders"]');
  await until("physical TV input opens the real Library folders dialog", () => ui.execute("return !!document.querySelector('.library-folders button[data-tv-local-only]:not(:disabled)')"));
  const beforeSources = await get("/api/library/sources");
  await focusProbe(ui, ".library-folders button[data-tv-local-only]:not(:disabled)");
  try {
    for (const key of ["select", "down", "right", "select"] as const) await navigate(ui, guest, until, key);
    assert.equal(await ui.execute("return document.activeElement === window.__claimProbe.button"), true, "Remote arrows cannot move focus inside the pre-opened local Library dialog");
    assert.deepEqual(await get("/api/library/sources"), beforeSources, "Remote OK cannot open the folder manager from the existing Library summary");
  } finally { await stopProbe(ui); }

  // The current folder dialog has no nested selector. This DOM regression models
  // Radix's separately portalled listbox and aria-hidden parent while keeping the
  // real protected Library dialog mounted; it does not claim a shipped nested UI.
  await ui.execute(`
    const parent = document.querySelector('.library-folders');
    window.__claimNested = { parent, hidden: parent.getAttribute('aria-hidden'), local: parent.getAttribute('data-tv-local-only'), selections: 0 };
    parent.setAttribute('aria-hidden', 'true');
    const portal = document.createElement('div');
    portal.id = 'claim-nested-portal'; portal.setAttribute('role', 'listbox'); portal.setAttribute('data-state', 'open');
    Object.assign(portal.style, { position: 'fixed', left: '20px', top: '20px', zIndex: '100000' });
    const option = document.createElement('button');
    option.setAttribute('role', 'option'); option.textContent = 'Nested portal regression';
    option.addEventListener('keydown', event => { if (event.key === 'Enter') window.__claimNested.selections++; });
    portal.append(option); document.body.append(portal);
  `);
  try {
    // A real remote positive control proves this simulated option observes the
    // unguarded Enter path, even while Radix retains its parent focus trap.
    assert.notEqual(await ui.execute("return window.__claimNested.local"), null);
    await ui.execute("window.__claimNested.parent.removeAttribute('data-tv-local-only')");
    await navigate(ui, guest, until, "select");
    assert.equal(await ui.execute("return window.__claimNested.selections"), 1, "The simulated portal detects real remote selection when its parent guard is removed");
    await ui.execute("const probe = window.__claimNested; probe.parent.setAttribute('data-tv-local-only', probe.local); probe.selections = 0");
    await navigate(ui, guest, until, "down");
    await navigate(ui, guest, until, "select");
    assert.equal(await ui.execute("return window.__claimNested.selections"), 0, "A simulated separate Radix portal cannot bypass the rendered local-only parent guard");
    assert.deepEqual(await get("/api/library/sources"), beforeSources);
  } finally {
    await ui.execute("const probe = window.__claimNested; probe.parent.setAttribute('data-tv-local-only', probe.local); if (probe.hidden === null) probe.parent.removeAttribute('aria-hidden'); else probe.parent.setAttribute('aria-hidden', probe.hidden); document.querySelector('#claim-nested-portal')?.remove(); delete window.__claimNested");
  }
  await navigate(ui, guest, until, "back");
  await until("paired Back dismisses a protected Library dialog", () => ui.execute("return !document.querySelector('.library-folders')"));

  await ui.section("Jellyfin");
  await ui.click('[data-action="jellyfin-settings"]');
  await until("physical TV input opens the real Jellyfin connection dialog", () => ui.execute("return !!document.querySelector('[role=dialog][data-tv-local-only]')"));
  await until("Jellyfin Sources loads its protected configuration controls", () => ui.execute("return !!document.querySelector('[data-action=jellyfin-disconnect]:not(:disabled), #jellyfin-url:not(:disabled)')"));
  const jellyfin = await get("/api/jellyfin");
  const action = await ui.execute("return document.querySelector('[data-action=jellyfin-disconnect]') ? '[data-action=jellyfin-disconnect]' : '#jellyfin-url'");
  await ui.execute("window.__claimJellyfinValues = JSON.stringify([...document.querySelectorAll('.jellyfin-connect input')].map(input => input.value))");
  await focusProbe(ui, action);
  try {
    for (const key of ["select", "left", "down", "select"] as const) await navigate(ui, guest, until, key);
    assert.equal(await ui.execute("return document.activeElement === window.__claimProbe.button && JSON.stringify([...document.querySelectorAll('.jellyfin-connect input')].map(input => input.value)) === window.__claimJellyfinValues"), true, "Remote arrows and OK leave the pre-opened Jellyfin control and credential form unchanged");
    assert.deepEqual(await get("/api/jellyfin"), jellyfin, "Remote navigation cannot save or disconnect the TV's Jellyfin account");
  } finally {
    await stopProbe(ui);
    await ui.execute("delete window.__claimJellyfinValues");
  }
  await navigate(ui, guest, until, "home");
  await until("paired Home dismisses the protected Jellyfin dialog and returns to TV browsing", () => ui.execute("return !document.querySelector('[role=dialog]') && !!document.querySelector('.tv-browser:not([hidden])')"));

  await ui.section("Radio");
  await focusProbe(ui, '[data-action="radio-settings"]');
  try {
    await navigate(ui, guest, until, "select");
    assert.equal(await ui.execute("return !!document.querySelector('[role=dialog]')"), false, "Paired OK cannot open native radio source administration");
  } finally { await stopProbe(ui); }
  await ui.click('[data-action="radio-settings"]');
  await until("physical TV input opens protected radio Sources", () => ui.execute("return !!document.querySelector('[role=dialog][data-tv-local-only] #radio-source-url:not(:disabled)')"));
  await focusProbe(ui, "#radio-source-url");
  try {
    for (const key of ["select", "left", "down", "select"] as const) await navigate(ui, guest, until, key);
    assert.equal(await ui.execute("return document.activeElement === window.__claimProbe.button && document.querySelector('#radio-source-url').value === ''"), true, "Paired navigation leaves the protected radio source form unchanged");
  } finally { await stopProbe(ui); }
  await navigate(ui, guest, until, "home");
  await until("paired Home dismisses protected radio Sources", () => ui.execute("return !document.querySelector('[role=dialog]')"));

  await ui.section("Queue");
  const openFile = await ui.execute("const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Open file'); if (button) button.id = 'claim-open-file'; return !!button");
  assert.equal(openFile, true);
  await focusProbe(ui, "#claim-open-file");
  try {
    await navigate(ui, guest, until, "select");
    const picker = Bun.spawn(["xdotool", "search", "--onlyvisible", "--name", "^Open media on this player$"], { stdout: "pipe", stderr: "pipe" });
    const windows = (await new Response(picker.stdout).text()).trim();
    await picker.exited;
    assert.equal(windows, "", "Remote OK on a physically focused Open file button does not launch the native picker");
  } finally {
    await stopProbe(ui);
    await ui.execute("document.querySelector('#claim-open-file')?.removeAttribute('id')");
  }
}

export async function verifyClaim(context: Context) {
  const { origin, ui, httpRemote, clients, until, artifactDir } = context;
  assert.ok(clients.length >= 2 && clients.every(client => client.state?.player.status === "idle"), "Claim acceptance starts with two controllers and idle native playback");
  const before = clients[0]!.state!;
  const queue = before.queue.map(entry => entry.id);
  const profile = before.activeProfile;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => !!client.state && predicate(client.state));
  const api = (path: string, token?: string, body?: unknown) => fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await api("/api/settings")).status, 401, "Unpaired HTTP requests cannot read installation settings");
  for (const client of clients) {
    assert.equal((await api("/api/controllers/claim-code", client.token)).status, 403, "Ordinary pairing cannot reveal the TV-only administrator code");
    assert.equal((await api("/api/settings", client.token, { name: "Unauthorized rename" })).status, 403, "Ordinary paired controllers cannot rename the installation directly");
    assert.equal((await (await api("/api/controllers/me", client.token)).json() as ControllerIdentity).authority, "controller");
  }
  await httpRemote.minimize();
  await openSettings(ui, until);
  await until("unclaimed TV Settings displays its separate short-lived administrator code and local QR", () => ui.execute("return /^\\d{10}$/.test(document.querySelector('[data-administrator-code]')?.textContent ?? '') && !!document.querySelector('[role=dialog] svg title')"));
  const code = await ui.execute("return document.querySelector('[data-administrator-code]').textContent");
  const qr = await ui.execute("const svg = [...document.querySelectorAll('[role=dialog] svg')].find(svg => svg.querySelector('title')); return { svg: svg.outerHTML, title: svg.querySelector('title').textContent, links: [...document.querySelectorAll('[role=dialog] a')].map(a => a.href) }");
  assert.match(qr.title, /^Open Couch at https?:\/\//, "The setup QR title identifies its local HTTP address");
  const qrAddress = new URL(qr.title.slice("Open Couch at ".length)).href;
  assert.ok(qr.links.some((url: string) => new URL(url).href === qrAddress), "The setup QR points to one displayed local TV address");
  assert.ok(!qr.svg.includes(code), "The setup QR contains the address without the administrator credential");
  await Bun.write(`${artifactDir}/administrator-setup-qr.svg`, qr.svg);
  await closeSettings(ui, until);
  await openSettings(ui, until);
  assert.equal(await ui.execute("return document.querySelector('[data-administrator-code]')?.textContent"), code, "Abandoned setup resumes using the same still-valid administrator code");

  await httpRemote.restore();
  const phone = httpRemote.ui;
  await openSettings(phone, until);
  await until("ordinary HTTP phone offers the distinct administrator claim form", () => phone.execute("return !!document.querySelector('#administrator-code') && !document.querySelector('#tv-name')"));
  await assertResponsive(phone, "Phone administrator claim");
  await phone.type("#administrator-code", code);
  await phone.button("Claim administrator", settings);
  await until("phone claim commits one administrator and broadcasts claimed state to both WebSocket controllers", async () => all(state => state.administratorClaimed === true && (state.controllerVersion ?? 0) > (before.controllerVersion ?? 0)) && await phone.execute("return !!document.querySelector('#tv-name:not(:disabled)') && !document.querySelector('#administrator-code')"));
  await until("claim consumption removes the administrator code from the TV", () => ui.execute("return !document.querySelector('[data-administrator-code]') && !document.querySelector(arguments[0])?.textContent.includes('Set up your administrator remote')", [settings]));
  assert.equal((await api("/api/controllers/claim", clients[1]!.token, { code })).status, 401, "The consumed TV setup code cannot claim a second administrator");
  const name = "Living room fixture";
  await phone.type("#tv-name", name);
  await phone.button("Save name", settings);
  await until("phone TV-name save reaches native Settings and both current WebSocket snapshots", async () => all(state => state.installationName === name) && await ui.execute("return document.querySelector('[data-settings-tv-name]')?.textContent === arguments[0]", [name]));
  await assertResponsive(phone, "Phone General settings");
  await httpRemote.screenshot("http-administrator-settings");
  await closeSettings(phone, until);
  await openSettings(phone, until);
  await until("reopened HTTP Settings reloads the saved TV name and administrator authority", () => phone.execute("return document.querySelector('#tv-name')?.value === arguments[0]", [name]));
  await closeSettings(phone, until);
  await httpRemote.minimize();
  await closeSettings(ui, until);
  await verifyNavigationBoundary(context);
  assert.ok(all(state => state.player.status === "idle" && state.currentEntryId === before.currentEntryId && JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queue)), "Claim and authorization checks preserve queue and playback state");
  assert.ok(all(state => state.activeProfile.id === profile.id && state.activeProfile.name === profile.name), "Administrator identity remains separate from the watching profile");
  for (const client of clients) assert.equal((await (await api("/api/controllers/me", client.token)).json() as ControllerIdentity).authority, "controller", "Other paired controllers are not promoted by someone else's claim");
  await Bun.write(`${artifactDir}/administrator-claim.json`, JSON.stringify({ name, queuePreserved: true, profilePreserved: profile, nativeLocalDialogsChecked: ["Library folders", "Jellyfin connection", "Open file"], nestedPortal: "DOM regression using the actual open Library dialog; no nested selector is shipped there", qr: "administrator-setup-qr.svg" }, null, 2));
  return {
    name,
    verifyAfterRestart: async (nextClients: readonly Remote[], remote: HttpRemote) => {
      await until("administrator claim and TV name survive restart in both current snapshots", () => nextClients.every(client => client.state?.administratorClaimed === true && client.state.installationName === name && client.state.player.status === "idle"));
      await openSettings(ui, until);
      await until("restarted TV retains its name without issuing another setup code", () => ui.execute("return document.querySelector('[data-settings-tv-name]')?.textContent === arguments[0] && !document.querySelector('[data-administrator-code]')", [name]));
      await closeSettings(ui, until);
      await remote.restore();
      await openSettings(remote.ui, until);
      await until("reconnected HTTP phone retains administrator authority and saved TV name after restart", () => remote.ui.execute("return document.querySelector('#tv-name')?.value === arguments[0] && !document.querySelector('#administrator-code')", [name]));
      await closeSettings(remote.ui, until);
      await remote.minimize();
    },
  };
}
