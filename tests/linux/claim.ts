import { strict as assert } from "node:assert";
import type { ControllerIdentity } from "../../src/shared/controllers";
import type { Action, NavigationKey, SessionState } from "../../src/shared/protocol";
import { keys, type UiDriver, type Wait, type startHttpRemote } from "./ui";

type Remote = { token: string; state: SessionState | null; command: (action: Action) => Promise<void> };
type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = { origin: string; ui: UiDriver; httpRemote: HttpRemote; clients: readonly Remote[]; until: Wait; artifactDir: string };

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
  await ui.button("Settings");
  await ui.settingsSection("source-folders");
  await ui.execute("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Add TV folder').id = 'claim-add-folder'");
  await focusProbe(ui, "#claim-add-folder");
  await navigate(ui, guest, until, "select");
  await stopProbe(ui);
  assert.equal(await ui.execute("return !!document.querySelector('[aria-label=\"TV folder browser\"]')"), false, "Paired OK cannot launch native folder administration");
  await ui.button("Add TV folder");
  await until("physical input opens the protected folder browser", () => ui.execute("return !!document.querySelector('[aria-label=\"TV folder browser\"]')"));
  await navigate(ui, guest, until, "back");
  await ui.section("Now");
  await ui.addMedia();
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
    await ui.key(keys.escape);
  }
}

export async function verifyClaim(context: Context) {
  const { origin, ui, httpRemote, clients, artifactDir } = context;
  const api = (token: string, path: string, body?: unknown) => fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const roles = await Promise.all(clients.map(async client => (await (await api(client.token, "/api/controllers/me")).json() as ControllerIdentity).authority));
  assert.deepEqual(roles, ["administrator", "controller"]);
  assert.equal((await api(clients[1]!.token, "/api/settings", { name: "Unauthorized rename" })).status, 403);
  const before = clients[0]!.state!;
  await httpRemote.minimize();
  await verifyNavigationBoundary(context);
  await ui.section("Now");
  for (const client of clients) {
    assert.equal(client.state!.player.status, "idle");
    assert.deepEqual(client.state!.queue.map(entry => entry.id), before.queue.map(entry => entry.id));
    assert.deepEqual(client.state!.activeProfile, before.activeProfile);
  }
  await Bun.write(`${artifactDir}/native-authority.json`, JSON.stringify({ roles, protectedActions: ["TV folder browser", "Open file"], queuePreserved: true }, null, 2));
  return { verifyAfterRestart: async (nextClients: readonly Remote[], _remote: HttpRemote) => {
    for (const [index, client] of nextClients.entries()) assert.equal((await (await api(client.token, "/api/controllers/me")).json() as ControllerIdentity).authority, roles[index]);
  } };
}
