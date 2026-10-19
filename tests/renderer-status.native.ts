// Run after bun run build: bun tests/renderer-status.native.ts <evidence directory>.
// This launches the checkout's Electron and Main, with a separate profile and Core.
// Reserve COUCH_PORT, COUCH_PORT + 1 (refused) and COUCH_PORT + 2 (fixture page).
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

const directory = resolve(process.argv[2] ?? ".artifacts/renderer-status");
const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.COUCH_PORT ?? 42870), refused = port + 1, fixture = port + 2;
for (const probePort of [port, refused, fixture]) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(probePort, "127.0.0.1", resolve));
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
const scratch = join(directory, "probe"), data = join(directory, "data");
rmSync(directory, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
mkdirSync(data, { recursive: true });
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-renderer-probe", version: "0.3.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true }));
const statusPath = join(data, "renderer-status.json");
// Main's own window, preload and handlers; the probe only navigates it and reads the status file.
writeFileSync(join(scratch, "probe.mjs"), `
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const read = () => JSON.parse(readFileSync(${JSON.stringify(statusPath)}, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { mainPid: process.pid, starting: null, ready: null, unmounted: null, failed: null, iframeTried: false };
const record = () => writeFileSync(${JSON.stringify(join(directory, "native-events.json"))}, JSON.stringify(evidence, null, 2));
// HTML whose script throws before any app mounts, with a cross-origin frame that tries to acknowledge.
createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  if (request.url === '/child') response.end("<script>try { (window.couchApp ?? parent.couchApp).shellReady(); } catch {} fetch('/tried')</script>");
  else if (request.url === '/tried') { evidence.iframeTried = true; response.end(); }
  else response.end('<div id="root"></div><iframe src="http://localhost:${fixture}/child"></iframe><script>throw new Error("mount failed")</script>');
}).listen(${fixture}, '127.0.0.1');
app.on('browser-window-created', async (_event, window) => {
  const until = async (state, limit = 20_000) => { const deadline = Date.now() + limit; while (read().state !== state) { if (Date.now() > deadline) return read(); await sleep(50); } return read(); };
  try {
    evidence.ready = await until('ready');
    void window.webContents.loadURL(${JSON.stringify(`http://127.0.0.1:${fixture}/`)}).catch(() => {});
    await until('page-loaded');
    // Give the frame and any acknowledgement time to arrive.
    await sleep(1_500);
    evidence.unmounted = read();
    void window.webContents.loadURL(${JSON.stringify(`http://127.0.0.1:${refused}/`)}).catch(() => {});
    evidence.failed = await until('failed', 5_000);
  } finally { record(); app.quit(); }
});
await import(${JSON.stringify(pathToFileURL(join(root, "build/main.mjs")).href)});
// Main identifies its run before the app is ready or any window exists.
evidence.starting = read();
`);
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const output = Bun.file(join(directory, "electron-output.log"));
const child = Bun.spawn([electron as unknown as string, scratch], { cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output });
writeFileSync(join(directory, "launched-pid"), `${child.pid}\n`);
const deadline = setTimeout(() => child.kill("SIGTERM"), 30_000);
let code: number;
try { code = await child.exited; } finally { clearTimeout(deadline); }
assert.equal(code, 0, "Native probe must shut down normally");
const events = JSON.parse(readFileSync(join(directory, "native-events.json"), "utf8"));
const header = /main info: Couch (\S+) run (\S+) pid (\d+) log 1$/m.exec(readFileSync(join(data, "logs/couch.log"), "utf8"));
assert.ok(header, "couch.log must begin with this run's header");
assert.equal(events.starting.state, "starting");
for (const state of [events.starting, events.ready, events.unmounted, events.failed]) {
  assert.equal(state.run, header[2], "Every status names the run in couch.log");
  assert.equal(state.pid, events.mainPid);
  assert.equal(state.pid, Number(header[3]));
  assert.equal(state.version, header[1]);
  assert.equal(state.page, "local");
}
assert.equal(events.ready.state, "ready", "Couch's mounted shell must acknowledge through the real preload");
assert.equal(events.iframeTried, true, "The fixture frame must have run");
assert.equal(events.unmounted.state, "page-loaded", "Loaded HTML whose app never mounts is not ready");
assert.equal(events.unmounted.navigation, events.ready.navigation + 1);
// Chromium shows its error page after the failure; Main keeps reporting the failure.
assert.equal(events.failed.state, "failed");
assert.equal(events.failed.reason, "-102 ERR_CONNECTION_REFUSED");
console.log(JSON.stringify({ code, events }, null, 2));
