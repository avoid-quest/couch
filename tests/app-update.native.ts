// Run after bun run build: COUCH_PORT=43210 xvfb-run -a bun tests/app-update.native.ts [evidence directory].
// Real Main, preload, renderer, Core and MacUpdater; only the native installer is simulated.
// This checks Electron's documented windows-before-before-quit ordering without installing anything.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import electron from "electron";

const root = resolve(import.meta.dirname, "..");
const directory = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "couch-update-"));
const port = Number(process.env.COUCH_PORT ?? 43210);
const probe = createServer();
await new Promise<void>((resolve, reject) => probe.once("error", reject).listen(port, "127.0.0.1", resolve));
await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const updaterPath = import.meta.resolve("electron-updater");
// Keep the updater external so the probe and Main share its real singleton.
const bundle = await Bun.build({ entrypoints: [join(root, "app/main.ts")], target: "node", external: ["electron"], plugins: [{
  name: "shared-updater",
  setup(build) { build.onResolve({ filter: /^electron-updater$/ }, () => ({ path: updaterPath, external: true })); },
}] });
assert(bundle.success);
for (const pending of [false, true]) {
  const scenario = pending ? "pending" : "ready";
  const evidenceDir = join(directory, scenario), scratch = join(evidenceDir, "probe"), data = join(evidenceDir, "data");
  mkdirSync(join(scratch, "build"), { recursive: true });
  mkdirSync(data, { recursive: true });
  cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
  for (const file of ["core.mjs", "preload.cjs"]) symlinkSync(join(root, "build", file), join(scratch, "build", file));
  symlinkSync(join(root, "dist"), join(scratch, "dist"));
  await Bun.write(join(scratch, "build/main.mjs"), bundle.outputs[0]!);
  writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-update-probe", version: "0.3.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
  writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true }));
  writeFileSync(join(scratch, "probe.mjs"), `
import assert from 'node:assert/strict';
import { app, autoUpdater as nativeUpdater, BrowserWindow, utilityProcess } from 'electron';
import { writeFileSync } from 'node:fs';
import updater from ${JSON.stringify(updaterPath)};
const evidence = { platform: process.platform, shutdowns: 0, coreExited: false, corePid: null, updaterCompleted: false, buttonClicked: false, ordinaryCloseKeptWindow: false, repeatedQuitBlocked: false };
const record = () => writeFileSync(${JSON.stringify(join(evidenceDir, "events.json"))}, JSON.stringify(evidence, null, 2));
const mac = new updater.MacUpdater();
// The installed MacUpdater controls pending Squirrel completion, not a mock quitAndInstall.
updater.autoUpdater.quitAndInstall = (...args) => mac.quitAndInstall(...args);
mac.autoInstallOnAppQuit = true;
nativeUpdater.quitAndInstall = () => {
  nativeUpdater.emit('before-quit-for-update');
  // Electron only reaches Squirrel's relaunchToInstallUpdate after all windows close.
  app.once('window-all-closed', () => {
    evidence.updaterCompleted = true;
    record();
    app.quit();
  });
  for (const window of BrowserWindow.getAllWindows()) window.close();
  setTimeout(() => {
    if (evidence.updaterCompleted) return;
    app.removeAllListeners('window-all-closed');
    record();
    console.error('Update hid Couch instead of closing its window');
    app.quit(); // Clean up a failing reproduction without manually quitting Couch.
  }, 1000);
};
const fork = utilityProcess.fork;
utilityProcess.fork = function (...args) {
  const child = fork.apply(this, args);
  child.once('spawn', () => { evidence.corePid = child.pid; record(); });
  child.once('exit', () => { evidence.coreExited = true; record(); });
  const postMessage = child.postMessage.bind(child);
  child.postMessage = message => {
    if (message.type !== 'shutdown') return postMessage(message);
    evidence.shutdowns++;
    setTimeout(() => postMessage(message), 150);
    setImmediate(() => {
      app.quit();
      evidence.repeatedQuitBlocked = !evidence.coreExited;
      record();
    });
  };
  return child;
};
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, options) {
  await loadURL.call(this, url, options);
  await this.webContents.executeJavaScript('window.couchApp.deviceName("Update test")');
  updater.autoUpdater.emit('update-downloaded', { version: '0.3.1' });
  if (!${pending}) nativeUpdater.emit('update-downloaded');
  this.close();
  evidence.ordinaryCloseKeptWindow = !this.isDestroyed();
  assert(evidence.ordinaryCloseKeptWindow);
  this.show();
  await loadURL.call(this, new URL('/settings/updates', url).href, options);
  await this.webContents.executeJavaScript(
    'new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const check = () => { const button = [...document.querySelectorAll("button")].find(button => button.textContent === "Restart to update"); if (button) resolve(); else if (Date.now() > deadline) reject(new Error("Update button missing")); else setTimeout(check, 50); }; check(); })'
  );
  await this.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(button => button.textContent === "Restart to update").click()');
  evidence.buttonClicked = true;
  record();
  if (${pending}) setTimeout(() => {
    assert(!evidence.updaterCompleted, 'Must wait for Squirrel to finish staging');
    assert(!this.isDestroyed(), 'Must not quit before Squirrel finishes staging');
    nativeUpdater.emit('update-downloaded');
  }, 500);
};
app.on('will-quit', () => { evidence.coreExitedBeforeApp = evidence.coreExited; record(); });
await import('./build/main.mjs');
`);
  const { ELECTRON_RUN_AS_NODE: _, COUCH_TV_PRESENTATION: __, ...env } = process.env;
  const output = Bun.file(join(evidenceDir, "electron-output.log"));
  const child = Bun.spawn([electron as unknown as string, scratch], {
    cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output,
  });
  writeFileSync(join(evidenceDir, "launched-pid"), `${child.pid}\n`);
  const deadline = setTimeout(() => child.kill("SIGTERM"), 20_000);
  let code: number;
  try { code = await child.exited; } finally { clearTimeout(deadline); }
  assert.equal(code, 0, `Native update must quit cleanly; see ${evidenceDir}`);
  const evidence = JSON.parse(readFileSync(join(evidenceDir, "events.json"), "utf8"));
  assert.equal(evidence.buttonClicked, true);
  assert.equal(evidence.ordinaryCloseKeptWindow, true);
  assert.equal(evidence.shutdowns, 1);
  assert.equal(evidence.repeatedQuitBlocked, true);
  assert.equal(evidence.coreExitedBeforeApp, true);
  assert.equal(typeof evidence.corePid, "number");
  assert.throws(() => process.kill(evidence.corePid, 0), /ESRCH/, "No Core remains after update");
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/connection`), /fetch failed|Unable to connect/);
  assert.equal(evidence.updaterCompleted, true, `Update must close the window and complete, rather than hide to tray; see ${evidenceDir}`);
  console.log(`Update button, ${scenario} Squirrel completion, close-to-tray and graceful Core exit passed: ${evidenceDir}`);
}
