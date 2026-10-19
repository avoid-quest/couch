// Run after bun run build: bun tests/renderer-status.native.ts <evidence directory>.
// This launches the checkout's Electron and Main, with a separate profile and Core.
// Reserve COUCH_PORT and COUCH_PORT + 1 (refused).
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

const directory = resolve(process.argv[2] ?? ".artifacts/renderer-status");
const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.COUCH_PORT ?? 42870), refused = port + 1;
for (const probePort of [port, refused]) {
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
// Main's own window and handlers; the probe only reads the status file it writes.
writeFileSync(join(scratch, "probe.mjs"), `
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
const read = () => JSON.parse(readFileSync(${JSON.stringify(statusPath)}, 'utf8'));
const evidence = { mainPid: process.pid, starting: null, ready: null, failed: null };
const record = () => writeFileSync(${JSON.stringify(join(directory, "native-events.json"))}, JSON.stringify(evidence, null, 2));
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', () => setTimeout(() => {
    if (evidence.ready) return;
    evidence.ready = read();
    // A genuine Chromium load failure in the same window, as an unreachable page would be.
    void window.webContents.loadURL(${JSON.stringify(`http://127.0.0.1:${refused}/`)}).catch(() => {});
    setTimeout(() => { evidence.failed = read(); record(); app.quit(); }, 1_500);
  }, 200));
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
for (const state of [events.starting, events.ready, events.failed]) {
  assert.equal(state.run, header[2], "Every status names the run in couch.log");
  assert.equal(state.pid, events.mainPid);
  assert.equal(state.pid, Number(header[3]));
  assert.equal(state.version, header[1]);
  assert.equal(state.page, "local");
}
assert.equal(events.ready.state, "ready", "Main's own window must report its loaded page");
// Chromium shows its error page after the failure; Main keeps reporting the failure.
assert.equal(events.failed.state, "failed");
assert.equal(events.failed.reason, "-102 ERR_CONNECTION_REFUSED");
console.log(JSON.stringify({ code, events }, null, 2));
