import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { seedConfiguredFixture } from "./configured-fixture";

const origin = "http://127.0.0.1:4100";
const driverOrigin = "http://127.0.0.1:4444";
const binary = process.env.COUCH_NATIVE_BINARY ?? "/work/bin/couch";
const sidecar = process.env.COUCH_NATIVE_SIDECAR ?? "/work/bin/couch-server";
const checks: string[] = [];

async function until(description: string, check: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    assert.ok(Date.now() < deadline, description);
    await Bun.sleep(50);
  }
  checks.push(description);
  console.log(`PASS ${description}`);
}

async function command(...args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert.equal(code, 0, `${args.join(" ")}: ${error}`);
  return output.trim();
}

async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(driverOrigin + path, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json() as { value: any };
  assert.ok(response.ok && !result.value?.error, `WebDriver ${path}: ${JSON.stringify(result.value)}`);
  return result.value;
}

async function health() {
  try { return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
}

async function processIds(name: string) {
  const process = Bun.spawn(["pgrep", "-x", name], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(process.stdout).text();
  await process.exited;
  return output.trim().split("\n").filter(Boolean);
}

async function windowId() {
  const output = await command("xdotool", "search", "--onlyvisible", "--name", "^Couch$");
  for (const id of output.split("\n")) {
    if ((await command("xprop", "-id", id, "WM_PROTOCOLS")).includes("WM_DELETE_WINDOW")) return id;
  }
  throw new Error("No Couch window accepts the desktop Close action");
}

async function closeWindow(id: string) {
  await command("xdotool", "windowactivate", "--sync", id);
  await command("xdotool", "key", "alt+F4");
}

async function quitShortcut(id: string) {
  await command("xdotool", "windowactivate", "--sync", id);
  await command("xdotool", "key", "ctrl+q");
}

async function role(session: string, xpath: string) {
  const elements = await request(`/session/${session}/elements`, { using: "xpath", value: xpath }).catch(() => []) as Array<Record<string, string>>;
  for (const element of elements) {
    try {
      if (await request(`/session/${session}/element/${element["element-6066-11e4-a52e-4f735466cecf"]}/displayed`)) return true;
    } catch { /* The app can replace a matched control between lookup and display check. */ }
  }
  return false;
}

async function click(session: string, xpath: string) {
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const elements = await request(`/session/${session}/elements`, { using: "xpath", value: xpath }) as Array<Record<string, string>>;
      assert.ok(elements.length <= 1, `Expected one control for ${xpath}`);
      if (elements.length === 1) {
        await request(`/session/${session}/element/${elements[0]!["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
        return;
      }
    } catch (error) { if (!/stale element reference|no such element/.test(String(error))) throw error; }
    assert.ok(Date.now() < deadline, `Control did not settle: ${xpath}`);
    await Bun.sleep(50);
  }
}

async function typeByLabel(session: string, label: string, value: string) {
  const elements = await request(`/session/${session}/elements`, { using: "xpath", value: `//label[normalize-space(.)="${label}"]/following::input[1]` }) as Array<Record<string, string>>;
  assert.equal(elements.length, 1, `Expected one ${label} input`);
  const id = elements[0]!["element-6066-11e4-a52e-4f735466cecf"];
  await request(`/session/${session}/element/${id}/click`, {});
  await request(`/session/${session}/element/${id}/clear`, {});
  await request(`/session/${session}/element/${id}/value`, { text: value });
}

async function open(presentation: "0" | "1", directory: string) {
  const driver = Bun.spawn(["tauri-driver"], {
    env: { ...process.env, COUCH_DATA_DIR: directory, COUCH_TV_PRESENTATION: presentation, COUCH_DEV_BUN: Bun.which("bun") ?? "/usr/local/bin/bun" },
    stdout: Bun.file(`/artifacts/lifecycle-${presentation}-driver.log`),
    stderr: Bun.file(`/artifacts/lifecycle-${presentation}-native.log`),
  });
  await until("native WebDriver starts", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  const session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: binary } } } })).sessionId as string;
  return { driver, session, directory };
}

async function closeDriver(native: Awaited<ReturnType<typeof open>>) {
  await request(`/session/${native.session}`, undefined, "DELETE").catch(() => {});
  native.driver.kill();
  await native.driver.exited;
}

const local = await mkdtemp("/tmp/couch-lifecycle-local-");
seedConfiguredFixture(local);
let native = await open("0", local);
try {
  try { await until("desktop local host starts", health, 30_000); }
  catch (error) {
    const messages = await request(`/session/${native.session}/elements`, { using: "xpath", value: '//*[@role="status" or @role="alert"]' }) as Array<Record<string, string>>;
    for (const message of messages) console.error(await request(`/session/${native.session}/element/${message["element-6066-11e4-a52e-4f735466cecf"]}/text`).catch(() => ""));
    throw error;
  }
  await until("desktop navigation has a readable label", () => role(native.session, '//nav[@aria-label="Main navigation"]'));
  const firstApp = await processIds("couch"), firstHost = await processIds("couch-server");
  assert.equal(firstApp.length, 1);
  assert.equal(firstHost.length, 1);
  const window = await windowId();
  await closeWindow(window);
  await until("Close minimizes without a tray watcher", async () => (await command("xprop", "-id", window, "WM_STATE")).includes("Iconic"));
  assert.equal(await health(), true, "Close retains the owned host");
  const second = Bun.spawn([binary], { env: { ...process.env, COUCH_DATA_DIR: local, COUCH_TV_PRESENTATION: "0" }, stdout: "pipe", stderr: "pipe" });
  assert.equal(await second.exited, 0, "a second launch returns to the first instance");
  await until("launcher restores the minimized window", async () => (await command("xprop", "-id", window, "WM_STATE")).includes("Normal"));
  assert.deepEqual(await processIds("couch"), firstApp, "launcher creates no second app");
  assert.deepEqual(await processIds("couch-server"), firstHost, "launcher creates no second host");
  await command("xdotool", "windowmove", window, "3000", "3000");
  await closeWindow(window);
  await until("offscreen Close still minimizes", async () => (await command("xprop", "-id", window, "WM_STATE")).includes("Iconic"));
  const reopen = Bun.spawn([binary], { env: { ...process.env, COUCH_DATA_DIR: local, COUCH_TV_PRESENTATION: "0" }, stdout: "pipe", stderr: "pipe" });
  assert.equal(await reopen.exited, 0);
  await until("launcher recovers an offscreen window", async () => {
    const geometry = await command("xwininfo", "-id", window);
    const x = Number(geometry.match(/Absolute upper-left X:\s*(-?\d+)/)?.[1]);
    const y = Number(geometry.match(/Absolute upper-left Y:\s*(-?\d+)/)?.[1]);
    return (await command("xprop", "-id", window, "WM_STATE")).includes("Normal") && x >= 0 && x < 1600 && y >= 0 && y < 1000;
  });
  await quitShortcut(window);
  await until("Quit with sharing asks for confirmation", async () => (await command("xdotool", "search", "--onlyvisible", "--name", "Quit Couch\\?").catch(() => "")).length > 0);
  await command("xdotool", "key", "Escape");
  await until("Cancel keeps the host running", health);
  assert.deepEqual(await processIds("couch"), firstApp);
  await quitShortcut(window);
  await until("Quit confirmation returns", async () => (await command("xdotool", "search", "--onlyvisible", "--name", "Quit Couch\\?").catch(() => "")).length > 0);
  await command("xdotool", "key", "Return");
  await until("confirmed Quit stops the app and owned host", async () => !(await health()) && (await processIds("couch")).length === 0 && (await processIds("couch-server")).length === 0);
} finally { await closeDriver(native); }

const watcherOnly = Bun.spawn(["/usr/bin/python3", "tests/linux/watcher-without-host.py"], {
  stdout: Bun.file("/artifacts/lifecycle-watcher-only.log"), stderr: Bun.file("/artifacts/lifecycle-watcher-only-error.log"),
});
try {
  await until("watcher without a tray host starts", async () => (await command("gdbus", "call", "--session", "--dest", "org.kde.StatusNotifierWatcher", "--object-path", "/StatusNotifierWatcher", "--method", "org.freedesktop.DBus.Properties.Get", "org.kde.StatusNotifierWatcher", "IsStatusNotifierHostRegistered").catch(() => "")).includes("false"));
  const fallback = await mkdtemp("/tmp/couch-lifecycle-watcher-only-");
  seedConfiguredFixture(fallback);
  native = await open("0", fallback);
  try {
    await until("watcher-only desktop starts its host", health, 30_000);
    const window = await windowId();
    await closeWindow(window);
    await until("Close minimizes when watcher has no tray host", async () => (await command("xprop", "-id", window, "WM_STATE")).includes("Iconic"));
    assert.equal(await health(), true, "watcher-only Close keeps the local host");
    const second = Bun.spawn([binary], { env: { ...process.env, COUCH_DATA_DIR: fallback, COUCH_TV_PRESENTATION: "0" }, stdout: "pipe", stderr: "pipe" });
    assert.equal(await second.exited, 0);
    await until("launcher restores watcher-only fallback", async () => (await command("xprop", "-id", window, "WM_STATE")).includes("Normal"));
  } finally { await closeDriver(native); }
} finally { watcherOnly.kill(); await watcherOnly.exited; }

const unavailable = await mkdtemp("/tmp/couch-lifecycle-remote-");
seedConfiguredFixture(unavailable);
await writeFile(`${unavailable}/operating-mode.json`, JSON.stringify({ mode: "remote", address: "http://127.0.0.1:49999", targets: ["http://127.0.0.1:49999"], localSetupComplete: true }));
native = await open("0", unavailable);
try {
  await until("unavailable selected host exposes Retry", () => role(native.session, '//button[normalize-space(.)="Retry"]'), 30_000);
  await until("unavailable selected host exposes Use this computer", () => role(native.session, '//button[normalize-space(.)="Use this computer"]'));
  assert.equal(await health(), false, "remote selection does not start a local playback host");
  const window = await windowId();
  await closeWindow(window);
  await until("remote recovery Close minimizes", async () => (await command("xprop", "-id", window, "WM_STATE")).includes("Iconic"));
  const second = Bun.spawn([binary], { env: { ...process.env, COUCH_DATA_DIR: unavailable, COUCH_TV_PRESENTATION: "0" }, stdout: "pipe", stderr: "pipe" });
  assert.equal(await second.exited, 0);
  await until("launcher restores remote recovery", async () => (await command("xprop", "-id", window, "WM_STATE")).includes("Normal") && await role(native.session, '//button[normalize-space(.)="Use this computer"]'));
  assert.equal(await health(), false, "remote recovery never creates a local playback host");
} finally { await closeDriver(native); }

const selectedHost = "http://127.0.0.1:4201";
const hostData = await mkdtemp("/tmp/couch-lifecycle-selected-host-");
seedConfiguredFixture(hostData);
const startSelectedHost = () => Bun.spawn([sidecar], {
  cwd: "/work",
  env: { ...process.env, COUCH_NATIVE: "0", COUCH_HOST: "127.0.0.1", COUCH_PORT: "4201", COUCH_ADVERTISE_URLS: selectedHost, COUCH_DATA_DIR: hostData },
  stdout: Bun.file("/artifacts/lifecycle-selected-host.log"), stderr: Bun.file("/artifacts/lifecycle-selected-host-error.log"),
});
let remoteHost = startSelectedHost();
const hostHealth = async () => { try { return (await fetch(`${selectedHost}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } };
try {
  await until("selected remote host starts", hostHealth, 30_000);
  const selected = await mkdtemp("/tmp/couch-lifecycle-selected-client-");
  seedConfiguredFixture(selected);
  await writeFile(`${selected}/operating-mode.json`, JSON.stringify({ mode: "remote", address: selectedHost, targets: [selectedHost], localSetupComplete: true }));
  native = await open("0", selected);
  try {
    await until("selected remote uses the bundled Couch window", () => role(native.session, '//button[contains(normalize-space(.),"Play on: http://127.0.0.1:4201")]'), 30_000);
    assert.equal((await request(`/session/${native.session}/window/handles`) as string[]).length, 1, "WebDriver exposes one app window");
    assert.equal((await request(`/session/${native.session}/elements`, { using: "xpath", value: '//header[.//button[contains(normalize-space(.),"Play on:")]]' }) as unknown[]).length, 1, "Couch shows one app header");
    assert.equal(await command("xdotool", "search", "--onlyvisible", "--name", "^Couch remote$").catch(() => ""), "", "No second remote OS window exists");
    const selectedWindow = await windowId();
    await command("xdotool", "windowmove", selectedWindow, "280", "180");
    await command("xdotool", "windowsize", selectedWindow, "1200", "780");
    await until("selected remote moves and resizes the same OS window", async () => {
      const geometry = await command("xwininfo", "-id", selectedWindow);
      return /Width:\s*1200/.test(geometry) && /Height:\s*780/.test(geometry);
    });
    await until("selected remote offers pairing in the shared shell", () => role(native.session, '//button[normalize-space(.)="Connect"]'));
    const pairingCode = (await Bun.file("/artifacts/lifecycle-selected-host-error.log").text()).match(/Pairing code: (\d{6})/)?.[1];
    assert.ok(pairingCode, "selected host prints a pairing code");
    await typeByLabel(native.session, "Device name", "Native restart remote");
    await typeByLabel(native.session, "Pairing code", pairingCode);
    await click(native.session, '//button[normalize-space(.)="Connect"]');
    await until("paired desktop client connects to the selected host", () => role(native.session, '//nav[@aria-label="Main navigation"]'));
    const paired = await request(`/session/${native.session}/execute/sync`, { script: "return localStorage.getItem('couch.pairing:' + arguments[0]);", args: [selectedHost] }) as string;
    assert.ok(paired, "native pairing is stored for the selected origin");
    const selectedToken = (JSON.parse(paired) as { token: string }).token;
    const selectedIdentity = async () => {
      const response = await fetch(`${selectedHost}/api/controllers/me`, { headers: { Origin: selectedHost, Authorization: `Bearer ${selectedToken}` } });
      assert.equal(response.status, 200, "the saved pairing belongs to the selected host");
      return response.json() as Promise<{ authority: string; controller: { name: string } | null }>;
    };
    assert.equal((await selectedIdentity()).authority, "administrator", "first paired desktop remote is the selected host administrator");
    assert.equal((await selectedIdentity()).controller?.name, "Native restart remote", "selected host retains the paired device name");
    remoteHost.kill();
    await remoteHost.exited;
    await until("selected host outage keeps recovery in the shared shell", () => role(native.session, '//*[@role="status" and contains(normalize-space(.),"selected Couch is offline")]'), 30_000);
    assert.equal(await role(native.session, '//button[normalize-space(.)="Update this app"]'), true, "local update access survives selected host outage");
    await click(native.session, '//button[normalize-space(.)="Update this app"]');
    await until("local updater loads while selected host is offline", () => role(native.session, '//div[@role="dialog"]//button[normalize-space(.)="Check this app for updates"]'), 30_000);
    await command("xdotool", "key", "Escape");
    await until("local updater closes without changing playback device", async () => !await role(native.session, '//div[@role="dialog"]'));
    remoteHost = startSelectedHost();
    await until("selected host restarts", hostHealth, 30_000);
    await until("selected host recovery clears the offline notice", async () => !await role(native.session, '//*[@role="status" and contains(normalize-space(.),"selected Couch is offline")]'), 30_000);
    assert.equal(await health(), false, "selected remote creates no local playback host");
    await click(native.session, '//button[contains(normalize-space(.),"Play on: http://127.0.0.1:4201")]');
    await click(native.session, '//button[normalize-space(.)="This computer"]');
    await until("remote to local starts this computer", health, 30_000);
    await click(native.session, '//button[contains(normalize-space(.),"Play on: This computer")]');
    await click(native.session, '//button[normalize-space(.)="http://127.0.0.1:4201"]');
    await click(native.session, '//button[normalize-space(.)="Stop and switch"]');
    await until("local to remote stops this computer", async () => !await health(), 30_000);
    await until("local to remote restores the paired shell", () => role(native.session, '//nav[@aria-label="Main navigation"]'));
    assert.equal((await request(`/session/${native.session}/window/handles`) as string[]).length, 1, "Switching keeps one OS window");
    await until("client-only coordinator starts beside selected host", async () => (await processIds("couch-server")).length === 2, 30_000);
    const appPid = await processIds("couch"), hostPid = await processIds("couch-server");
    assert.equal(appPid.length, 1);
    assert.equal(hostPid.length, 2, "selected host and client-only coordinator each have one process");
    assert.ok(hostPid.includes(String(remoteHost.pid)));
    const mainWindow = await windowId();
    await closeWindow(mainWindow);
    await until("selected remote Close minimizes the sole window", async () => (await command("xprop", "-id", mainWindow, "WM_STATE").catch(() => "")).includes("Iconic"));
    assert.equal(await hostHealth(), true, "client-only Close keeps selected host running");
    const second = Bun.spawn([binary], { env: { ...process.env, COUCH_DATA_DIR: selected, COUCH_TV_PRESENTATION: "0" }, stdout: "pipe", stderr: "pipe" });
    assert.equal(await second.exited, 0);
    await until("launcher restores the same selected remote window", async () => (await command("xwininfo", "-id", mainWindow)).includes("IsViewable"));
    await until("reopened selected remote retains the shared shell", () => role(native.session, '//nav[@aria-label="Main navigation"]'));
    assert.deepEqual(await processIds("couch"), appPid);
    assert.deepEqual(await processIds("couch-server"), hostPid);
    await quitShortcut(mainWindow);
    await until("client-only Quit closes app but keeps selected host", async () => (await processIds("couch")).length === 0 && (await processIds("couch-server")).join() === String(remoteHost.pid) && await hostHealth());
    await closeDriver(native);
    native = await open("0", selected);
    await until("full relaunch retains the selected playback address", () => role(native.session, '//button[normalize-space(.)="Play on: http://127.0.0.1:4201"]'), 30_000);
    assert.equal(await request(`/session/${native.session}/execute/sync`, { script: "return localStorage.getItem('couch.pairing:' + arguments[0]);", args: [selectedHost] }), paired, "native pairing data survives full app restart");
    const restoredIdentity = await selectedIdentity();
    assert.equal(restoredIdentity.authority, "administrator", "selected host authority survives app restart");
    assert.equal(restoredIdentity.controller?.name, "Native restart remote", "selected host device name survives app restart");
    await click(native.session, '//nav[@aria-label="Main navigation"]//a[@aria-label="Settings"]');
    await click(native.session, '//nav[@aria-label="Settings pages"]//a[normalize-space(.)="Updates"]');
    await until("restarted administrator sees selected-host update target", () => role(native.session, '//label[normalize-space(.)="Release channel for selected host"]'));
    assert.equal(await role(native.session, '//button[normalize-space(.)="Update this app"]'), true, "local update access stays separate after relaunch");
  } finally { await closeDriver(native); }
} finally { remoteHost.kill(); await remoteHost.exited; }

const television = await mkdtemp("/tmp/couch-lifecycle-tv-");
seedConfiguredFixture(television);
native = await open("1", television);
try {
  await until("TV presentation starts its host", health, 30_000);
  await until("TV keeps its labelled navigation", () => role(native.session, '//nav[@aria-label="Main navigation"]'));
  const window = await windowId();
  assert.match(await command("xprop", "-id", window, "_NET_WM_STATE"), /_NET_WM_STATE_FULLSCREEN/, "TV stays fullscreen");
  await closeWindow(window);
  await until("TV Close retains its exit behavior", async () => !(await health()) && (await processIds("couch")).length === 0);
} finally { await closeDriver(native); }

const tray = Bun.spawn(["gtk-sni-tray-standalone", "--watcher", "--top", "--end", "--size", "40"], {
  stdout: Bun.file("/artifacts/lifecycle-tray.log"), stderr: Bun.file("/artifacts/lifecycle-tray-error.log"),
});
try {
  await until("Linux tray watcher starts", async () => (await command("gdbus", "call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", "org.kde.StatusNotifierWatcher").catch(() => "")).includes("true"));
  const trayData = await mkdtemp("/tmp/couch-lifecycle-tray-");
  seedConfiguredFixture(trayData);
  native = await open("0", trayData);
  try {
    await until("tray desktop starts its local host", health, 30_000);
    await until("tray desktop retains labelled navigation", () => role(native.session, '//nav[@aria-label="Main navigation"]'));
    const appPid = await processIds("couch"), hostPid = await processIds("couch-server");
    const registration = await command("gdbus", "call", "--session", "--dest", "org.kde.StatusNotifierWatcher", "--object-path", "/StatusNotifierWatcher", "--method", "org.freedesktop.DBus.Properties.Get", "org.kde.StatusNotifierWatcher", "RegisteredStatusNotifierItems");
    const item = registration.match(/:[0-9.]+/)?.[0];
    assert.ok(item, "Couch registers a StatusNotifier item");
    const itemInfo = await command("gdbus", "introspect", "--session", "--recurse", "--dest", item, "--object-path", "/");
    assert.match(itemInfo, /tray-icon tray app couch-desktop/, "registered item belongs to Couch");
    const menuPath = itemInfo.match(/readonly o Menu = '([^']+)'/)?.[1];
    assert.ok(menuPath, "Couch exposes a native tray menu");
    const menu = await command("gdbus", "call", "--session", "--dest", item, "--object-path", menuPath, "--method", "com.canonical.dbusmenu.GetLayout", "0", "1", "[]");
    const showId = menu.match(/\((\d+), \{'label': <'Show Couch'>/)?.[1];
    const quitId = menu.match(/\((\d+), \{'label': <'Quit Couch'>/)?.[1];
    assert.ok(showId && quitId, "tray menu labels offer Show Couch and Quit Couch");
    const menuAction = (id: string) => command("gdbus", "call", "--session", "--dest", item, "--object-path", menuPath, "--method", "com.canonical.dbusmenu.Event", id, "clicked", "<int32 0>", "0");
    const window = await windowId();
    await closeWindow(window);
    await until("Close hides Couch with a usable tray", async () => (await command("xwininfo", "-id", window)).includes("IsUnMapped"));
    assert.equal(await health(), true, "the hidden tray app retains its host");
    await menuAction(showId);
    await until("Show Couch restores the hidden window", async () => (await command("xwininfo", "-id", window)).includes("IsViewable"));
    assert.deepEqual(await processIds("couch"), appPid);
    assert.deepEqual(await processIds("couch-server"), hostPid);
    await closeWindow(window);
    await until("tray Close hides again", async () => (await command("xwininfo", "-id", window)).includes("IsUnMapped"));
    await menuAction(quitId);
    await until("tray Quit confirms sharing", async () => (await command("xdotool", "search", "--onlyvisible", "--name", "Quit Couch\\?").catch(() => "")).length > 0);
    await command("xdotool", "key", "Escape");
    await until("tray Quit cancel retains the host", health);
    await menuAction(quitId);
    await until("tray Quit confirmation returns", async () => (await command("xdotool", "search", "--onlyvisible", "--name", "Quit Couch\\?").catch(() => "")).length > 0);
    await command("xdotool", "key", "Return");
    await until("confirmed tray Quit stops app and host", async () => !(await health()) && (await processIds("couch")).length === 0 && (await processIds("couch-server")).length === 0);
  } finally { await closeDriver(native); }
} finally { tray.kill(); await tray.exited; }

await writeFile("/artifacts/desktop-lifecycle.json", JSON.stringify({ revision: process.env.COUCH_SOURCE_REVISION, checks, limitations: "Xvfb/Openbox and a standalone StatusNotifier tray exercise native desktop behavior without physical display, audio hardware, or an installed package." }, null, 2));
