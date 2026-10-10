// Run after bun run build: bun tests/app-quit.native.ts [evidence directory].
// Exercises the real renderer, preload, Main and Core in an isolated Electron app.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

const root = resolve(import.meta.dirname, "..");
const directory = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "couch-quit-"));
const port = Number(process.env.COUCH_PORT ?? 42930);
const probe = createServer();
await new Promise<void>((resolve, reject) => probe.once("error", reject).listen(port, "127.0.0.1", resolve));
await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const scratch = join(directory, "probe"), data = join(directory, "data");
mkdirSync(scratch, { recursive: true });
mkdirSync(data, { recursive: true });
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-quit-probe", version: "0.3.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true }));
writeFileSync(join(scratch, "probe.mjs"), `
import assert from 'node:assert/strict';
import { app, BrowserWindow, Menu, utilityProcess } from 'electron';
import { writeFileSync } from 'node:fs';
const evidence = { platform: process.platform, shutdowns: 0, coreExited: false, corePid: null, repeatedQuitBlocked: false, buttonClicked: false, menu: null };
const record = () => writeFileSync(${JSON.stringify(join(directory, "events.json"))}, JSON.stringify(evidence, null, 2));
const fork = utilityProcess.fork;
utilityProcess.fork = function (...args) {
  const child = fork.apply(this, args);
  child.once('spawn', () => { evidence.corePid = child.pid; record(); });
  child.once('exit', () => { evidence.coreExited = true; record(); });
  const postMessage = child.postMessage.bind(child);
  child.postMessage = message => {
    if (message.type !== 'shutdown') return postMessage(message);
    evidence.shutdowns++;
    // Keep Core alive briefly to expose a second Quit bypassing graceful shutdown.
    setTimeout(() => postMessage(message), 150);
    setImmediate(() => {
      app.quit();
      evidence.repeatedQuitBlocked = !evidence.coreExited && BrowserWindow.getAllWindows().length === 1;
      record();
    });
  };
  return child;
};
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, options) {
  await loadURL.call(this, url, options);
  await this.webContents.executeJavaScript('window.couchApp.deviceName("Quit test")');
  await loadURL.call(this, new URL('/settings/tv', url).href, options);
  await this.webContents.executeJavaScript(
    'new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const check = () => { const button = [...document.querySelectorAll("button")].find(button => button.textContent === "Quit Couch"); if (button) resolve(); else if (Date.now() > deadline) reject(new Error("Quit button missing")); else setTimeout(check, 50); }; check(); })'
  );
  if (process.platform !== 'darwin') {
    const item = Menu.getApplicationMenu()?.items.find(item => item.label === 'File')?.submenu?.items.find(item => item.role === 'quit');
    assert(item, 'File menu must offer Quit independently of the renderer and tray');
    assert.equal(item.accelerator, 'Control+Q');
    evidence.menu = item.label;
  }
  writeFileSync(${JSON.stringify(join(directory, "settings.png"))}, (await this.webContents.capturePage()).toPNG());
  // Ordinary window close still hosts Couch in the background.
  this.close();
  assert(!this.isDestroyed());
  this.show();
  await this.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(button => button.textContent === "Quit Couch").click()');
  evidence.buttonClicked = true;
  record();
};
app.on('will-quit', () => { evidence.coreExitedBeforeApp = evidence.coreExited; record(); });
await import(${JSON.stringify(pathToFileURL(join(root, "build/main.mjs")).href)});
`);
const { ELECTRON_RUN_AS_NODE: _, COUCH_TV_PRESENTATION: __, ...env } = process.env;
const output = Bun.file(join(directory, "electron-output.log"));
const child = Bun.spawn([electron as unknown as string, scratch], {
  cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output,
});
writeFileSync(join(directory, "launched-pid"), `${child.pid}\n`);
const deadline = setTimeout(() => child.kill("SIGTERM"), 20_000);
let code: number;
try { code = await child.exited; } finally { clearTimeout(deadline); }
assert.equal(code, 0, `Native app must quit cleanly; see ${directory}`);
const evidence = JSON.parse(readFileSync(join(directory, "events.json"), "utf8"));
assert.equal(evidence.buttonClicked, true);
assert.equal(evidence.shutdowns, 1);
assert.equal(evidence.repeatedQuitBlocked, true);
assert.equal(evidence.coreExitedBeforeApp, true);
assert.equal(typeof evidence.corePid, "number");
assert.throws(() => process.kill(evidence.corePid, 0), /ESRCH/, "No Core process remains after Quit");
await assert.rejects(fetch(`http://127.0.0.1:${port}/api/connection`), /fetch failed|Unable to connect/);
console.log(`Quit button, repeated Quit, graceful Core exit and released listener passed: ${directory}`);
