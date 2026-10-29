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
import { app, ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
const read = () => JSON.parse(readFileSync(${JSON.stringify(statusPath)}, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Linux exposes the process identity used by TV diagnosis; other platforms omit it.
const stat = process.platform === 'linux' ? readFileSync('/proc/self/stat', 'utf8') : null;
const kernel = stat ? { bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), processStart: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]) } : {};
const evidence = { mainPid: process.pid, kernel, starting: null, ready: null, second: null, gates: {}, unmounted: null, failed: null, iframeTried: false };
const record = () => writeFileSync(${JSON.stringify(join(directory, "native-events.json"))}, JSON.stringify(evidence, null, 2));
app.on('browser-window-created', async (_event, window) => {
  // Only the primary instance creates this listener; a second launch must reach Main's lock.
  // Its broken HTML and cross-origin frame cannot acknowledge that the app mounted.
  createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/child') response.end("<script>try { (window.couchApp ?? parent.couchApp).shellReady(); } catch {} fetch('/tried')</script>");
    else if (request.url === '/tried') { evidence.iframeTried = true; response.end(); }
    else response.end('<div id="root"></div><iframe src="http://localhost:${fixture}/child"></iframe><script>throw new Error("mount failed")</script>');
  }).listen(${fixture}, '127.0.0.1');
  const until = async (state, limit = 20_000) => { const deadline = Date.now() + limit; while (read().state !== state) { if (Date.now() > deadline) return read(); await sleep(50); } return read(); };
  // Reloads Couch's page with Main's answers replaced, and reads the status once that
  // navigation settles: ready, or loaded and given time to acknowledge.
  const gate = async (name, answers) => {
    for (const [channel, answer] of Object.entries(answers)) { ipcMain.removeHandler('couch:' + channel); ipcMain.handle('couch:' + channel, answer); }
    const navigation = read().navigation;
    window.webContents.reload();
    const deadline = Date.now() + 20_000;
    while (!(read().navigation > navigation && ['page-loaded', 'ready'].includes(read().state)) && Date.now() < deadline) await sleep(50);
    if (read().state !== 'ready') await sleep(2_000);
    evidence.gates[name] = { ...read(), text: await window.webContents.executeJavaScript('document.getElementById("root").innerText') };
  };
  let shown = false;
  app.on('second-instance', () => { shown = true; });
  try {
    evidence.ready = await until('ready');
    // Couch launched again on this data directory: it shows this window and quits, and
    // leaves this run's window status and log alone.
    const log = () => readFileSync(${JSON.stringify(join(data, "logs/couch.log"))}, 'utf8').split('\\n')[0];
    const header = log();
    const second = spawn(process.execPath, process.argv.slice(1), { stdio: 'ignore' });
    const [code] = await once(second, 'exit');
    await sleep(500);
    evidence.second = { pid: second.pid, code, shown, status: read(), header: log() === header, focused: window.isVisible() };
    // The startup gate before the shell: its loading, error and a render failure are not ready.
    await gate('held', { mode: () => new Promise(() => {}) });
    await gate('rejected', { mode: () => ({ error: "Couch couldn't read its mode." }) });
    await gate('malformed', { mode: () => ({ value: { mode: null, address: null, targets: null } }) });
    // The mode chooser and the shell after it are.
    await gate('chooser', { mode: () => ({ value: { mode: null, address: null, targets: [], localSetupComplete: false } }) });
    const local = () => ({ value: { mode: 'local', address: null, targets: [], localSetupComplete: true } });
    await gate('shell', { mode: local });
    // This computer's Core still starting, or failing to, is not a started shell either.
    await gate('connection-held', { mode: local, connection: () => new Promise(() => {}) });
    await gate('connection-rejected', { mode: local, connection: () => ({ error: 'Core did not start.' }) });
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
const deadline = setTimeout(() => child.kill("SIGTERM"), 90_000);
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
  assert.equal(state.bootId, events.kernel.bootId, "Every status preserves the platform's boot identity");
  assert.equal(state.processStart, events.kernel.processStart, "Every status preserves the platform's process identity");
  assert.equal(state.pid, Number(header[3]));
  assert.equal(state.version, header[1]);
  assert.equal(state.page, "local");
}
assert.equal(events.ready.state, "ready", "Couch's mounted shell must acknowledge through the real preload");
assert.equal(events.second.code, 0, "A second launch quits normally");
assert.equal(events.second.shown, true, "It shows the running Couch's window");
assert.deepEqual(events.second.status, events.ready, "It leaves the running window's status as it was");
assert.equal(events.second.header, true, "It leaves the running log as it was");
assert.equal(events.second.focused, true, "The running window stays shown");
let navigation = events.ready.navigation;
for (const [name, state, text] of [["held", "page-loaded", /Loading/], ["rejected", "page-loaded", /couldn't read its mode[\s\S]*Try again/], ["malformed", "page-loaded", /^$/], ["chooser", "ready", /Where is your Couch\?/], ["shell", "ready", /./], ["connection-held", "page-loaded", /Starting…/], ["connection-rejected", "page-loaded", /Couldn't start Couch[\s\S]*Try again/]] as const) {
  const gate = events.gates[name];
  assert.equal(gate.state, state, `${name}: ${JSON.stringify(gate)}`);
  assert.match(gate.text, text, name);
  assert.equal(gate.navigation, ++navigation, `${name} is the next navigation`);
  assert.equal(gate.run, header[2]);
}
navigation++;
assert.equal(events.iframeTried, true, "The fixture frame must have run");
assert.equal(events.unmounted.state, "page-loaded", "Loaded HTML whose app never mounts is not ready");
assert.equal(events.unmounted.navigation, navigation);
// Chromium shows its error page after the failure; Main keeps reporting the failure.
assert.equal(events.failed.state, "failed");
assert.equal(events.failed.reason, "-102 ERR_CONNECTION_REFUSED");
console.log(JSON.stringify({ code, events }, null, 2));
