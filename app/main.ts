import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, MenuItem, nativeImage, nativeTheme, net, screen, session, shell, Tray, utilityProcess, type IpcMainInvokeEvent, type Rectangle, type UtilityProcess } from "electron";
import { desktopNavigation, loadCouch } from "./navigation";
import { createHash, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { connect as connectTls } from "node:tls";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { DisplayAction, DisplayState } from "../src/shared/display";
import type { AppMode } from "../src/shared/app-bridge";
import type { AppMessage, CoreMessage } from "../src/shared/protocol";
import { startUpdates } from "./update";
import { readDeviceName, saveDeviceName } from "./device-name";
import { defaultDeviceSharing, isDeviceSharing } from "../src/shared/device-sharing";
import { diagnosticHost, logAppError } from "./diagnostics";
import { createCapture } from "./capture";
import { createLiveAudio } from "./live-audio";
import { startLog } from "./log-file";
import { rendererStatus } from "./renderer-status";

// Couch keeps the Tauri app's data directory: <platform data dir>/<identifier>.
// Development runs use .data unless COUCH_DATA_DIR says otherwise.
// Couch Preview packages name their own window and tray icon (scripts/package.ts).
const { identifier, icon: appIcon = "packaging/icons/icon.png" } = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")) as { identifier: string; icon?: string };
if (process.platform === "win32") app.setAppUserModelId(identifier);
const base = process.platform === "linux" ? process.env.XDG_DATA_HOME?.startsWith("/") ? process.env.XDG_DATA_HOME : join(homedir(), ".local/share") : app.getPath("appData");
const dataDir = resolve(process.env.COUCH_DATA_DIR ?? (app.isPackaged ? join(base, identifier) : ".data"));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
// Chromium's profile, and with it the single-instance lock, lives beside Core's data.
app.setPath("userData", join(dataDir, "app"));
// One Couch per data directory. A second launch only shows the first's window and
// quits, so it leaves the first's log and window status alone.
const primary = app.requestSingleInstanceLock();
// What Main and Core print, for this run and the one before: the newest 5–10 MB of each.
// The run ID also names this run in renderer-status.json.
const run = randomUUID();
const logPath = join(dataDir, "logs/couch.log");
mkdirSync(dirname(logPath), { recursive: true });
const log = !primary ? () => {} : startLog(logPath, 5_000_000, file => `${new Date().toISOString()} main info: Couch ${app.getVersion()} run ${run} pid ${process.pid} log ${file}\n`);
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => { log(chunk); return write(chunk, ...rest); }) as typeof stream.write;
}
const appliance = process.env.COUCH_TV_PRESENTATION === "1";
const port = Number(process.env.COUCH_PORT ?? 4100);
// Twitch rejects Origin 127.0.0.1 but accepts localhost (#644 ticket 1).
const localOrigin = `http://localhost:${port}`;
const icons = join(app.getAppPath(), "packaging/icons");

const readJson = (path: string) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; } };
const readText = (path: string) => { try { return readFileSync(path, "utf8").trim() || null; } catch { return null; } };
const write = (path: string, text: string) => { writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path); };

// Full mode ("local") runs Core here; Client mode ("remote") shows another Couch.
// pins: each Couch's certificate key (SHA-256 of its SPKI) by hostname.
type Choice = AppMode & { pins?: Record<string, string>; tvPresentation?: boolean };
const modePath = join(dataDir, "operating-mode.json");
let choice: Choice = { mode: null, address: null, targets: [], localSetupComplete: false, ...readJson(modePath) };
const tv = appliance || choice.tvPresentation === true;
const renderer = !primary ? null : rendererStatus(join(dataDir, "renderer-status.json"), { run, version: app.getVersion() }, () => choice.mode === "remote" ? "remote" : "local");
// Desktop controls sit in the page's header; the TV stays frameless (index.css).
const macChrome = process.platform === "darwin" && !tv;
const save = (next: Choice) => {
  next.targets = [...new Set([...next.targets, ...next.address ? [next.address] : []])];
  write(modePath, JSON.stringify(next));
  return choice = next;
};

let window: BrowserWindow | null = null;
const capture = createCapture(() => window?.webContents ?? null, () => choice.mode === "remote" ? choice.address : localOrigin, localOrigin);
const liveAudio = createLiveAudio(() => window?.webContents ?? null, capture, localOrigin, () => core?.token,
  process.platform === "darwin" ? join(app.isPackaged ? process.resourcesPath : import.meta.dirname, "live-audio", "couch-capture") : undefined);
let tray: Tray | null = null;
let quitting = false;
let updating = false;
let stopped = false;
let updatePlayback = "unavailable";
const reportPlayback = () => { if (appliance) write(join(dataDir, "update-playback"), `${Math.floor(Date.now() / 1000)} ${updatePlayback}\n`); };

type Ready = Extract<CoreMessage, { type: "ready" }>;
let core: { child: UtilityProcess; token: string; ready: Promise<Ready>; stopping: boolean } | null = null;
let urls: string[] = [];

function startCore() {
  if (core) return core.ready;
  const token = randomBytes(32).toString("hex");
  const child = utilityProcess.fork(join(import.meta.dirname, "core.mjs"), [], {
    serviceName: "Couch Core",
    stdio: "pipe",
    env: { ...process.env,
      ...(app.isPackaged && process.platform === "darwin" ? { COUCH_QJS_PATH: join(process.resourcesPath, "quickjs", "qjs") } : {}),
      COUCH_RELAY_PATH: join(app.isPackaged ? process.resourcesPath : import.meta.dirname, "live-relay", process.platform === "win32" ? "couch-relay.exe" : "couch-relay"), COUCH_AIRPLAY_PATH: join(app.isPackaged ? process.resourcesPath : import.meta.dirname, "airplay", "uxplay"), COUCH_HOST_TOKEN: token, COUCH_DATA_DIR: dataDir, COUCH_PORT: String(port), COUCH_TV_PRESENTATION: tv ? "1" : "0", COUCH_TV_APPLIANCE: appliance ? "1" : "0" },
  });
  child.stdout?.pipe(process.stdout, { end: false });
  child.stderr?.pipe(process.stderr, { end: false });
  const current = { child, token, stopping: false, ready: new Promise<Ready>((resolve, reject) => {
    child.on("message", (message: CoreMessage) => {
      if (message.type === "ready") { urls = message.urls; resolve(message); }
      else if (message.type === "addresses") { urls = message.urls; window?.webContents.send("couch:addresses", urls); }
      else if (message.type === "display") void display(message.action).then(
        state => child.postMessage({ type: "display", requestId: message.requestId, state } satisfies AppMessage),
        (error: Error) => child.postMessage({ type: "display", requestId: message.requestId, error: error.message } satisfies AppMessage));
      else if (message.type === "updates") void updates.action(message.action, 250).then(
        state => child.postMessage({ type: "updates", requestId: message.requestId, state } satisfies AppMessage),
        (error: Error) => child.postMessage({ type: "updates", requestId: message.requestId, error: error.message } satisfies AppMessage));
      else if (message.type === "tvMode") {
        try { setTvPresentation(message.enabled); child.postMessage({ type: "tvMode", requestId: message.requestId } satisfies AppMessage); }
        catch (error) { child.postMessage({ type: "tvMode", requestId: message.requestId, error: error instanceof Error ? error.message : String(error) } satisfies AppMessage); }
      }
    });
    child.once("exit", code => {
      reject(new Error(`Couch stopped with code ${code}.`));
      if (core === current) core = null;
      if (current.stopping || quitting) return;
      // An unexpected stop ends the app, like the Tauri host did; the TV's service restarts it.
      logAppError("main", `Couch Core exited with code ${code}`);
      if (!tv) dialog.showErrorBox("Couch stopped", `Couch stopped unexpectedly (code ${code}). Open Couch again.`);
      app.exit(1);
    });
  }) };
  core = current;
  return current.ready;
}

// Core asks for TV mode on behalf of an admin (POST /api/settings/tv-mode); only Core runs here in Full mode.
let restarting = false;
function setTvPresentation(enabled: unknown) {
  if (choice.mode !== "local") throw new Error("Change TV mode on the Couch this computer hosts.");
  if (typeof enabled !== "boolean") throw new Error("Choose whether to use TV mode.");
  if (appliance) throw new Error("TV mode is set by this app's launcher.");
  if (restarting || quitting) throw new Error("Couch is restarting or closing.");
  if (enabled === tv) return;
  save({ ...choice, tvPresentation: enabled });
  restarting = true;
  // Let Core's reply leave before the normal shutdown stops Core and its players.
  setTimeout(() => { app.relaunch(); app.quit(); }, 250);
}

async function stopCore() {
  const current = core;
  if (!current) return;
  current.stopping = true;
  const exited = new Promise(resolve => current.child.once("exit", resolve));
  current.child.postMessage({ type: "shutdown" } satisfies AppMessage);
  await Promise.race([exited, sleep(10_000)]);
  current.child.kill();
}

// What stopping Core would interrupt, as the Tauri host asked before switching to Client mode.
async function interruption() {
  if (!core) return null;
  const details = await (await fetch(`http://127.0.0.1:${port}/api/connection`, { signal: AbortSignal.timeout(3_000) })).json() as { player: string; remoteControlEnabled: boolean };
  const playing = !["idle", "stopped", "ended", "error", "unavailable"].includes(details.player);
  return playing && details.remoteControlEnabled ? "playback,sharing" : playing ? "playback" : details.remoteControlEnabled ? "sharing" : null;
}

const lan = (ip: string) => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip.replace(/^::ffff:/i, "")) || /^(::1$|f[cd]|fe[89ab])/i.test(ip);
async function lanOrigin(input: unknown) {
  const text = typeof input === "string" ? input.trim() : "";
  let url: URL;
  try { url = new URL(text.includes("://") ? text : `http://${text}`); } catch { throw new Error("Enter the LAN address shown on that Couch."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use a Couch LAN address without a path, password or query.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await Promise.race([lookup(host, { all: true }).then(found => found.map(entry => entry.address)), sleep(4_000).then(() => null)])
    .catch(() => { throw new Error("Can't find that address. Check the current address on that Couch."); });
  if (!addresses) throw new Error("Finding that Couch timed out.");
  if (!addresses.length || !addresses.every(lan)) throw new Error("App remote control is available only for LAN addresses. Custom domains must resolve to your LAN.");
  return url.origin;
}

// Another Couch serves its LAN over HTTPS with a self-signed certificate (#644 ticket 8). Its
// plain HTTP, such as an address saved earlier or a bare name on port 80, redirects there.
// The app pins the certificate's key the first time it reaches that Couch and whenever the
// user chooses it, then trusts only that key, so the window shows no warning.
const spki = (certificate: X509Certificate) => createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");
function served(origin: string) {
  const { hostname, port } = new URL(origin);
  const host = hostname.replace(/^\[|\]$/g, "");
  return new Promise<string>((resolve, reject) => {
    const socket = connectTls({ host, port: Number(port || 443), ...isIP(host) ? {} : { servername: host }, rejectUnauthorized: false, timeout: 4_000 }, () => {
      resolve(spki(socket.getPeerX509Certificate()!));
      socket.end();
    });
    socket.once("error", reject).once("timeout", () => socket.destroy(new Error("Finding that Couch timed out.")));
  });
}
async function trust(address: string, again: boolean) {
  let origin = address;
  if (address.startsWith("http:")) {
    const location = (await fetch(address, { redirect: "manual", signal: AbortSignal.timeout(4_000) })).headers.get("location");
    origin = new URL(location?.startsWith("https://") ? location : address.replace(/^http:/, "https:")).origin;
  }
  const { hostname } = new URL(origin);
  const pin = again || !choice.pins?.[hostname] ? await served(origin) : choice.pins[hostname]!;
  if (origin !== address || pin !== choice.pins?.[hostname]) save({ ...choice, address: choice.address === address ? origin : choice.address, targets: choice.targets.map(target => target === address ? origin : target), pins: { ...choice.pins, [hostname]: pin } });
  return origin;
}

// Full mode loads Core's own UI; Client mode loads the other Couch's own UI, so versions always match.
async function load(newConnection = false) {
  if (!window) return;
  if (choice.mode !== "remote") {
    if (!await startCore().catch(() => null)) return;
    await loadCouch(window, `${localOrigin}/`, newConnection).catch(error => logAppError("main", `Couldn't load Couch: ${error.message}`));
    return;
  }
  await stopCore();
  let address = choice.address!;
  for (;;) {
    try { return void await loadCouch(window, address = await trust(address, false), newConnection); } catch (error) {
      if (!window || choice.address !== address || choice.mode !== "remote") return;
      renderer?.unreachable();
      logAppError("main", `Couldn't reach Couch host=${diagnosticHost(address)}: ${error instanceof Error ? error.message : error}`);
      // Keep trying in the background; a successful probe closes the prompt and loads the page.
      const reachable = new AbortController();
      let answered = false;
      void (async () => {
        while (!answered) {
          await sleep(5_000);
          if (!answered && await trust(address, false).then(origin => net.fetch(new URL("/api/connection", origin).href, { signal: AbortSignal.timeout(3_000) })).then(response => response.ok, () => false)) return reachable.abort();
        }
      })();
      show();
      const { response } = await dialog.showMessageBox(window, { type: "warning", message: `Can't reach ${new URL(address).host}`, detail: `${(error as Error).message}\nCouch keeps trying.`, buttons: ["Try again", "Change address", "Use this computer"], defaultId: 0, cancelId: 0, signal: reachable.signal });
      answered = true;
      // Change address returns to the chooser, which keeps the address to correct or forget.
      if (response === 1) { save({ ...choice, mode: null }); return load(true); }
      if (response === 2) { save({ ...choice, mode: "local" }); return load(true); }
    }
  }
}

// TV presentation: the fullscreen window stays on the saved screen, else the first external one.
const displayPath = join(dataDir, "display-output");
let preview: { token: string; previous: string | null; expiresAt: number; timer: NodeJS.Timeout } | null = null;
let notice: string | null = null;
const currentDisplay = () => window ? String(screen.getDisplayMatching(window.getBounds()).id) : null;
function present(id?: string | null) {
  if (!window) return;
  const displays = screen.getAllDisplays();
  const target = displays.find(display => String(display.id) === id) ?? displays.find(display => String(display.id) === readText(displayPath))
    ?? displays.find(display => !display.internal) ?? screen.getPrimaryDisplay();
  window.setFullScreen(false);
  window.setBounds(target.bounds);
  window.setFullScreen(true);
}
async function display(action: DisplayAction): Promise<DisplayState> {
  if (!tv || !window) throw new Error("Only in Couch's TV presentation.");
  if (action.op === "preview") {
    if (preview) throw new Error("Finish the current display preview first.");
    if (!screen.getAllDisplays().some(display => String(display.id) === action.output)) throw new Error("That screen is disconnected or disabled.");
    const previous = currentDisplay();
    preview = { token: randomUUID(), previous, expiresAt: Date.now() + 20_000, timer: setTimeout(() => { preview = null; notice = "Preview ended. Restored the previous screen."; present(previous); }, 20_000) };
    notice = null;
    present(action.output);
  } else if (action.op !== "read") {
    if (preview?.token !== action.token) throw new Error("This preview has ended. Choose a screen to try again.");
    clearTimeout(preview.timer);
    if (action.op === "confirm") write(displayPath, currentDisplay()!);
    else present(preview.previous);
    notice = action.op === "cancel" ? "Restored the previous screen." : null;
    preview = null;
  }
  return {
    outputs: screen.getAllDisplays().map((display, index) => ({ id: String(display.id), name: display.label || `Screen ${index + 1}`, connected: true,
      width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor), x: display.bounds.x, y: display.bounds.y,
      refresh: display.displayFrequency ? Math.round(display.displayFrequency) : null })),
    saved: readText(displayPath), current: currentDisplay(), notice, preview: preview && { token: preview.token, expiresAt: preview.expiresAt },
  };
}

// window-state.json keeps Tauri's physical pixels.
const statePath = join(dataDir, "window-state.json");
function savedBounds(): Rectangle | undefined {
  const saved = readJson(statePath).main as Rectangle | undefined;
  if (!saved?.width || !saved.height) return;
  for (const display of screen.getAllDisplays()) {
    const [x, y, width, height] = [saved.x, saved.y, saved.width, saved.height].map(value => Math.round(value / display.scaleFactor)) as [number, number, number, number];
    const { bounds } = display;
    if (x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height) return { x, y, width, height };
  }
}
function saveBounds() {
  if (!window || tv) return;
  const bounds = window.getNormalBounds();
  const scale = screen.getDisplayMatching(bounds).scaleFactor;
  write(statePath, JSON.stringify({ main: { ...Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value * scale)])), maximized: window.isMaximized() } }));
}

function show() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

const interfaceSizePath = join(dataDir, "desktop-interface-size");
const interfaceSizes = [1, 1.15, 1.3];
const interfaceSize = () => interfaceSizes.find(value => value === Number(readText(interfaceSizePath))) ?? 1;
// Centre the 14pt controls in the 56px header, which scales with the interface size.
const controlsPosition = () => ({ x: 16, y: Math.round(28 * interfaceSize() - 7) });
// Match t3code: #00000000 does not work correctly on Linux.
// Omit height so native caption buttons keep the platform's size at any page zoom.
const titleBarOverlay = { color: "#01000000", symbolColor: "#ffffff" };

function createWindow() {
  window = new BrowserWindow({
    ...tv ? { fullscreen: true, frame: false } : { width: 1280, height: 800, ...savedBounds() },
    ...tv ? {} : { titleBarStyle: "hidden", ...macChrome ? { trafficLightPosition: controlsPosition() } : { titleBarOverlay } },
    minWidth: 800, minHeight: 600, show: false, title: app.getName(), backgroundColor: "#000000", autoHideMenuBar: true,
    ...process.platform !== "darwin" ? { icon: join(app.getAppPath(), process.platform === "win32" ? appIcon.replace(/\.png$/, ".ico") : appIcon) } : {},
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
      additionalArguments: tv ? ["--couch-tv-presentation"] : [],
    },
  });
  if (!tv && readJson(statePath).main?.maximized) window.maximize();
  if (tv) present();
  window.once("ready-to-show", show);
  window.on("leave-full-screen", () => { if (tv) window?.setFullScreen(true); });
  if (!tv) {
    // Fullscreen hides the window controls, so the header drops their space.
    const fullScreen = () => window?.webContents.send("couch:full-screen", window.isFullScreen());
    window.on("enter-full-screen", fullScreen);
    window.on("leave-full-screen", fullScreen);
    window.webContents.on("dom-ready", fullScreen);
  }
  window.on("close", event => {
    saveBounds();
    if (quitting || updating || tv) return;
    // Couch keeps hosting in the background; the tray, dock or a second launch shows it again.
    event.preventDefault();
    // Closing still ends this window's sharing, and any capture it is starting, as unloading would.
    void liveAudio.stop();
    void capture.prepare(null).catch(() => {});
    window?.webContents.send("couch:window-closed");
    if (process.platform === "linux") window?.minimize(); else window?.hide();
  });
  window.on("closed", () => { window = null; });
  const contents = window.webContents;
  renderer?.watch(contents);
  contents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => { if (mainFrame) capture.clear(); });
  // Electron-attributed main-frame errors only; Electron 44 can attribute
  // unsandboxed same-origin srcdoc output to mainFrame too.
  contents.on("console-message", details => {
    if (details.level === "error" && details.frame === contents.mainFrame) {
      logAppError("renderer", `host=${diagnosticHost(contents.mainFrame.url)}: ${details.message}`);
    }
  });
  contents.on("did-start-loading", () => { updatePlayback = "loading"; });
  // A page that dies, usually out of memory on a long session, loads again, at most 3 times a minute.
  let gone: number[] = [];
  contents.on("render-process-gone", (_event, { reason }) => {
    updatePlayback = "unavailable";
    logAppError("main", `Couch's page stopped: ${reason}`);
    gone = [...gone.filter(at => Date.now() - at < 60_000), Date.now()];
    if (["crashed", "oom", "abnormal-exit"].includes(reason) && gone.length <= 3) void load();
  });
  contents.on("will-navigate", (event, url) => { if (new URL(url).origin !== new URL(contents.getURL()).origin) { event.preventDefault(); renderer?.cancelled(); } });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void load();
}

// The preload bridge (app/preload.ts). Only this window's top frame may call it.
function handle(name: string, run: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
  ipcMain.handle(`couch:${name}`, async (event, ...args) => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Only the Couch window can do this.");
      return { value: await run(event, ...args) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  });
}
handle("mode", () => choice);
handle("capture-sources", () => capture.sources());
handle("prepare-capture", (_event, selection) => capture.prepare(selection));
handle("live-audio", (_event, action) => liveAudio.action(action));
handle("native-audio-inputs", () => liveAudio.inputs());
handle("capture-access", (_event, kind) => capture.access(kind));
handle("capture-settings", (_event, kind) => capture.openSettings(kind));
// Opened per call, after the single-instance lock, so couch.sqlite never holds up startup.
handle("device-name", (_event, name) => {
  if (name === undefined) return readDeviceName(join(dataDir, "couch.sqlite"));
  const saved = saveDeviceName(join(dataDir, "couch.sqlite"), name);
  if (core && !core.stopping) core.child.postMessage({ type: "renamed" } satisfies AppMessage);
  return saved;
});
// One sharing choice for this computer, whichever Couch it joins.
const sharingPath = join(dataDir, "device-sharing.json");
handle("device-sharing", (_event, sharing) => {
  if (sharing === undefined) { const saved: unknown = readJson(sharingPath); return isDeviceSharing(saved) ? saved : defaultDeviceSharing; }
  if (!isDeviceSharing(sharing)) throw new Error("Choose which outputs to share.");
  write(sharingPath, JSON.stringify(sharing));
  return sharing;
});
handle("choose", async (event, mode, address, confirm) => {
  if (mode === "remote") {
    const origin = await lanOrigin(address);
    const reason = confirm ? null : await interruption().catch(() => "unknown");
    if (reason) throw new Error(`confirmation-required:${reason}`);
    // Choosing a Couch trusts the key it serves now; one that can't be reached is pinned when it answers.
    const secured = await trust(origin, true).catch(() => origin);
    save({ ...choice, mode, address: secured });
  } else if (mode === "local") {
    const here = choice.mode !== "remote" && new URL(event.senderFrame!.url).origin === localOrigin;
    save({ ...choice, mode });
    if (here) return choice;
  } else throw new Error("Choose This computer or another Couch.");
  // The window loads the chosen Couch; the page asking goes away.
  void load(true);
  return null;
});
handle("forget", async (_event, address) => {
  if (typeof address !== "string") throw new Error("Choose a Couch to forget.");
  const current = choice.address === address;
  const { [new URL(address).hostname]: _pin, ...pins } = choice.pins ?? {};
  save({ ...choice, pins, targets: choice.targets.filter(target => target !== address), ...current ? { address: null, mode: choice.mode === "remote" ? null : choice.mode } : {} });
  // Its pairing lives in that origin's storage.
  await session.defaultSession.clearStorageData({ origin: address, storages: ["localstorage"] }).catch(() => {});
  if (!current || choice.mode !== null) return choice;
  void load(true);
  return null;
});
handle("complete-local-setup", () => {
  if (choice.mode !== "local") throw new Error("Choose This computer first.");
  return save({ ...choice, localSetupComplete: true });
});
handle("connection", async event => {
  if (choice.mode === "remote" || new URL(event.senderFrame!.url).origin !== localOrigin) throw new Error("Only this computer's Couch can connect as its host.");
  const ready = await startCore();
  return { origin: localOrigin, token: core!.token, pairingCode: ready.pairingCode, urls };
});
// Set when the app is ready, in the same turn that creates the window.
let updates: ReturnType<typeof startUpdates>;
handle("updates", () => updates.state());
handle("update-action", (_event, action) => updates.action(action, 250));
handle("check-for-updates", () => updates.check());
handle("set-update-channel", (_event, channel) => updates.action({ op: "channel", channel }));
// Older remote renderers send no expected version. Snapshot and reserve it in
// this turn; newer renderers always send their selected version through action.
handle("install-update", (_event, version) => updates.action({ op: "install", version: version === undefined ? updates.state().available : version }, 250));
handle("show-logs", () => shell.showItemInFolder(logPath));
// The page's app shell mounted (renderer-status.json); handle() admits only the main frame.
handle("shell-ready", () => renderer?.acknowledge() ?? false);
handle("quit", () => { setImmediate(() => app.quit()); });
handle("update-playback", (_event, status) => {
  if (typeof status !== "string" || !["unavailable", "idle", "loading", "playing", "paused", "ended", "error"].includes(status)) throw new Error("Invalid playback status.");
  if (updatePlayback !== status) { updatePlayback = status; reportPlayback(); }
});
handle("interface-size", (_event, size) => {
  if (size === undefined) return interfaceSize();
  if (!interfaceSizes.includes(size as number)) throw new Error("Choose a supported interface size.");
  write(interfaceSizePath, String(size));
  if (macChrome) window?.setWindowButtonPosition(controlsPosition());
  return size;
});

// Quit is deliberate (closing the window only hides it), and a SIGTERM from
// systemd or logout arrives here too, so nothing asks for confirmation.
async function quit() {
  if (quitting) return;
  quitting = true;
  await liveAudio.stop();
  saveBounds();
  await stopCore();
  stopped = true;
  app.quit();
}

if (!primary) app.quit();
else {
  app.on("second-instance", show);
  app.on("activate", show);
  // Updates close windows before before-quit. Let the updater finish that step;
  // before-quit still owns Core's graceful shutdown, so don't mark quitting yet.
  autoUpdater.on("before-quit-for-update", () => { updating = true; });
  app.on("before-quit", event => { if (!stopped) { event.preventDefault(); void quit(); } });
  void app.whenReady().then(() => {
    // Couch is black everywhere, so native title bars, menus and dialogs are dark too.
    nativeTheme.themeSource = "dark";
    const menu = process.platform !== "darwin" ? tv ? null : Menu.buildFromTemplate([
      { label: "File", submenu: [{ role: "quit", label: "Quit Couch", accelerator: "Control+Q" }] },
      { role: "editMenu" },
    ]) : Menu.buildFromTemplate([
      { role: "appMenu", submenu: [{ role: "about" }, { label: "Show Couch", click: show }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "togglefullscreen" }] },
      { role: "windowMenu" },
    ]);
    if (!tv) {
      const icon = process.platform === "darwin"
        ? nativeImage.createFromBuffer(readFileSync(join(icons, "tray-template.png")), { scaleFactor: 2 })
        : nativeImage.createFromPath(join(app.getAppPath(), appIcon)).resize({ width: 32, height: 32 });
      icon.setTemplateImage(process.platform === "darwin");
      tray = new Tray(icon);
      tray.setToolTip("Couch");
      tray.setContextMenu(Menu.buildFromTemplate([{ label: "Show Couch", click: show }, { label: "Quit Couch", click: () => app.quit() }]));
      if (process.platform !== "darwin") tray.on("click", show);
    }
    screen.on("display-added", () => { if (tv && !preview) present(); });
    screen.on("display-removed", () => { if (tv && !preview) present(); });
    // YouTube in the window (#644 ticket 4). googlevideo sends open-ended ranges at about
    // playback speed and bounded ones at full speed, so ask for 10 MB at a time. It allows
    // only youtube.com's origin, and Chromium's opaque response blocking drops some of its
    // no-cors media responses, so the window fetches it in CORS mode and Couch allows it.
    // Keep fullscreen available; capture is prepared by this computer's owner for one request.
    capture.install();
    session.defaultSession.setCertificateVerifyProc(({ hostname, certificate }, callback) => {
      const pin = choice.pins?.[hostname];
      callback(pin && pin === spki(new X509Certificate(certificate.data)) ? 0 : -3);
    });
    const googlevideo = { urls: ["https://*.googlevideo.com/*"] };
    session.defaultSession.webRequest.onBeforeSendHeaders(googlevideo, ({ requestHeaders }, callback) => {
      const start = /^bytes=(\d+)-$/.exec(requestHeaders.Range ?? "")?.[1];
      callback({ requestHeaders: start === undefined ? requestHeaders : { ...requestHeaders, Range: `bytes=${start}-${Number(start) + 10_485_759}` } });
    });
    session.defaultSession.webRequest.onHeadersReceived(googlevideo, ({ responseHeaders = {} }, callback) => {
      const headers = Object.fromEntries(Object.entries(responseHeaders).filter(([name]) => !/^access-control-allow-origin$/i.test(name)));
      callback({ responseHeaders: { ...headers, "Access-Control-Allow-Origin": ["*"] } });
    });
    createWindow();
    if (!tv) menu?.insert(2, new MenuItem(desktopNavigation(window!)));
    Menu.setApplicationMenu(menu);
    if (appliance) setInterval(() => { try { reportPlayback(); } catch (error) { logAppError("main", `Couldn't report playback for updates: ${error instanceof Error ? error.message : error}`); } }, 5_000).unref();
    updates = startUpdates({
      channelPath: join(dataDir, "update-channel"),
      tv: appliance,
      playing: async () => ["loading", "playing", "paused"].includes(updatePlayback) || !!(await interruption())?.includes("playback"),
      onState: state => window?.webContents.send("couch:updates", state),
    });
  });
}
