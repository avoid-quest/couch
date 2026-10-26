// Run after bun run build: bun tests/live-close.native.ts [evidence directory].
// Real Main, preload, renderer and Core in an isolated Electron app, sharing
// Chromium's synthetic microphone: closing the window ends sharing, and nothing else.
// Hidden desktop Live capture is covered by tests/live-host.native.ts.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

const root = resolve(import.meta.dirname, "..");
const directory = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "couch-live-close-"));
const server = createServer();
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const port = address.port;
await new Promise<void>(resolve => server.close(() => resolve()));
const scratch = join(directory, "probe"), data = join(directory, "data"), evidencePath = join(directory, "events.json");
mkdirSync(scratch, { recursive: true });
mkdirSync(data, { recursive: true });
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-live-close-probe", version: "0.3.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true }));
writeFileSync(join(scratch, "probe.mjs"), `
import assert from 'node:assert/strict';
import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const evidence = { platform: process.platform, steps: [] };
const record = () => writeFileSync(${JSON.stringify(evidencePath)}, JSON.stringify(evidence, null, 2));
// Synthetic media only: Chromium's fake microphone, and no macOS privacy prompt.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
systemPreferences.askForMediaAccess = async () => true;
// The test window never takes focus from the owner.
BrowserWindow.prototype.show = function () { this.showInactive(); };
BrowserWindow.prototype.focus = function () {};
// Closes the window at a chosen point while sharing starts: when Main prepares
// the capture, or when Chromium asks to open the microphone.
let closeOn = null, win = null;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, run) => handle(channel, channel !== 'couch:prepare-capture' ? run : (event, selection) => {
  if (selection && closeOn === 'prepare') { closeOn = null; win.close(); }
  return run(event, selection);
});
app.once('ready', () => {
  const setRequest = session.defaultSession.setPermissionRequestHandler.bind(session.defaultSession);
  session.defaultSession.setPermissionRequestHandler = handler => setRequest((contents, permission, allow, details) => {
    if (permission === 'media' && closeOn === 'microphone') { closeOn = null; win.close(); }
    handler(contents, permission, allow, details);
  });
});
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, options) {
  await loadURL.call(this, url, options);
  if (win) return;
  win = this;
  try { await run(this, url); evidence.passed = true; }
  catch (error) { evidence.error = error.stack; }
  finally { record(); app.quit(); }
};
const step = (name, value) => { evidence.steps.push({ name, ...value }); record(); return value; };
async function run(w, url) {
  await loadURL.call(w, new URL('/settings/device', url).href);
  const js = (code, gesture = false) => w.webContents.executeJavaScript(code, gesture);
  // Observes capture lifetimes and the commands this page sends Core.
  await js(\`(() => {
    const probe = window.__close = { recorders: [], captures: [], workers: [], ends: 0 };
    probe.wait = (test, label, timeout = 10000) => new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      const tick = () => { let value; try { value = test(); } catch {} if (value) resolve(value); else if (Date.now() > deadline) reject(new Error('Timed out: ' + label + ' ' + JSON.stringify({ ...probe.state(), trace: probe.trace, adding: document.body.textContent.includes('Adding'), alert: document.querySelector('[role=alert]')?.textContent }))); else setTimeout(tick, 50); };
      tick();
    });
    probe.button = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text);
    probe.session = () => {
      const root = document.getElementById('root'), container = root[Object.keys(root).find(key => key.startsWith('__reactContainer'))];
      const nodes = [container.stateNode.current];
      while (nodes.length) {
        const node = nodes.pop(), value = node?.memoizedProps?.value;
        if (value?.startLive && value?.queryClient) return value;
        if (node?.child) nodes.push(node.child);
        if (node?.sibling) nodes.push(node.sibling);
      }
    };
    probe.state = () => {
      const session = probe.session(), recorder = probe.recorders.at(-1);
      if (!session?.state) return { mounted: false, page: document.body.innerText.slice(0, 600) };
      return { visibility: document.visibilityState, connected: session.connected, sources: session.state.liveSources.filter(source => source.deviceId === session.identity?.device?.id).length,
        local: !!session.localLiveSourceId, recorder: recorder?.state ?? null, tracks: probe.captures.flatMap(stream => stream.getTracks().map(track => track.readyState)), activeWorkers: probe.workers.filter(worker => !worker.stopped).length, captureCount: probe.captures.length, ends: probe.ends };
    };
    probe.ended = () => { const state = probe.state(); return !state.sources && !state.local && state.recorder !== 'recording' && state.activeWorkers === 0 && state.tracks.length > 0 && state.tracks.every(track => track === 'ended') && state; };
    probe.connectedPage = () => probe.session()?.connected && document.querySelector('button[aria-label="Share screen or sound"]');
    probe.sharing = () => { const state = probe.state(); return state.sources === 1 && state.local && state.tracks.some(track => track === 'live') && (state.activeWorkers > 0 || state.recorder === 'recording') && state; };
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, ...args) { super(url, ...args); if (String(url).includes('capture-audio-worker')) { this.stopped = false; probe.workers.push(this); } }
      terminate() { this.stopped = true; return super.terminate(); }
    };
    const Recorder = MediaRecorder;
    window.MediaRecorder = class extends Recorder { constructor(...args) { super(...args); probe.recorders.push(this); } };
    const send = WebSocket.prototype.send;
    probe.trace = [];
    WebSocket.prototype.send = function (data) { if (typeof data === 'string' && data.includes('"endLive"')) probe.ends++; if (typeof data === 'string' && /publishLive|endLive/.test(data)) probe.trace.push(JSON.parse(data).action?.type); return send.call(this, data); };
    const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => { probe.trace.push('getUserMedia'); return media(constraints).then(stream => (probe.trace.push('captured'), probe.captures.push(stream), stream), error => { probe.trace.push(error.name); throw error; }); };
    return true;
  })()\`);
  const state = () => js('__close.state()');
  const until = (test, label, timeout) => js(\`__close.wait(() => __close.\${test}(), \${JSON.stringify(label)}, \${timeout ?? 10000})\`);
  const hosting = async () => (await fetch('http://127.0.0.1:${port}/api/connection')).ok;
  const reopen = () => app.emit('second-instance');
  const share = () => js("__close.session().startLive({ kind: 'microphone' }).then(() => 'started', error => error.message)", true);

  // Exercise the real capture lifecycle with a user gesture. Share's visual
  // journey is covered separately; this probe needs no screen enumeration.
  await until('connectedPage', 'the page connecting to Couch', 30000);
  assert.equal(await share(), 'started');
  // Core's first Publish may wait for its FFmpeg lookup.
  const shared = step('shared', await until('sharing', 'sharing the synthetic microphone', 60000));
  assert(shared.captureCount > 0 && shared.tracks.length > 0, 'the probe observed actual capture, not an empty recorder fallback');
  assert(shared.activeWorkers > 0, 'the supported Electron audio input uploads through its PCM worker');

  // Minimizing keeps sharing, as does the window never having focus.
  const visible = w.isVisible();
  const minimizing = new Promise(resolve => w.once('minimize', resolve));
  w.minimize();
  const event = await Promise.race([minimizing.then(() => true), sleep(5000).then(() => false)]);
  await sleep(1500);
  const minimized = step('minimized', { visible, event, window: w.isMinimized(), ...await state() });
  assert(minimized.window, 'the window minimized');
  assert.equal(minimized.sources, 1, 'Minimize keeps the source');
  assert(minimized.tracks.some(track => track === 'live'), 'Minimize keeps the actual input track');
  assert(minimized.activeWorkers > 0 || minimized.recorder === 'recording', 'Minimize keeps its actual upload engine');
  w.restore();

  // Close hides the window, ends its capture and source, and keeps Couch hosting.
  w.close();
  assert(!w.isDestroyed(), 'Close keeps the window for the background host');
  assert.equal(w.isVisible() && !w.isMinimized(), false, 'Close hides the window');
  const closed = step('closed', await until('ended', 'Close ending sharing'));
  assert.equal(closed.ends, 1, 'Close ends the source once');
  assert(closed.connected, 'the hidden window stays connected to Couch');
  assert(await hosting(), 'Couch keeps hosting after Close');
  step('lease', { microphone: await js("navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'granted'; }, error => error.name)") });
  assert.equal(evidence.steps.at(-1).microphone, 'NotAllowedError', 'no capture grant stays armed after Close');

  // Closing again while nothing is shared sends nothing; each reopen can share and Close ends it.
  reopen();
  w.close();
  await sleep(500);
  assert.equal((await state()).ends, 1, 'a Close without sharing ends nothing');
  for (const round of [1, 2]) {
    reopen();
    assert(w.isVisible(), 'the dock, tray or a second launch shows the same window');
    assert.equal(await share(), 'started');
    step(\`reshared \${round}\`, await until('sharing', \`sharing again \${round}\`));
    w.close();
    const ended = step(\`closed again \${round}\`, await until('ended', \`Close ending sharing \${round}\`));
    assert.equal(ended.ends, 1 + round, 'one end per Close, however often the window reopens');
  }

  // A Close while sharing is starting cancels it.
  for (const point of ['prepare', 'microphone']) {
    reopen();
    closeOn = point;
    const result = await share();
    assert.equal(closeOn, null, \`the window closed at \${point}\`);
    assert.notEqual(result, 'started', \`Close at \${point} cancels sharing\`);
    await sleep(1000);
    step(\`canceled at \${point}\`, { result, ...await until('ended', \`no sharing after Close at \${point}\`) });
  }
  assert(await hosting(), 'Couch keeps hosting at the end');
  assert(!w.isDestroyed());
}
await import(${JSON.stringify(pathToFileURL(join(root, "build/main.mjs")).href)});
`);
const { ELECTRON_RUN_AS_NODE: _, COUCH_TV_PRESENTATION: __, ...env } = process.env;
const output = Bun.file(join(directory, "electron-output.log"));
const child = Bun.spawn([electron as unknown as string, scratch], {
  cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output,
});
writeFileSync(join(directory, "launched-pid"), `${child.pid}\n`);
const deadline = setTimeout(() => child.kill("SIGTERM"), 180_000);
let code: number;
try { code = await child.exited; } finally { clearTimeout(deadline); }
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
assert.equal(evidence.error, undefined, evidence.error);
assert.equal(evidence.passed, true, `See ${directory}`);
assert.equal(code, 0, `Native app must quit cleanly; see ${directory}`);
await assert.rejects(fetch(`http://127.0.0.1:${port}/api/connection`), /fetch failed|Unable to connect/);
console.log(`Close ended active and starting capture, kept minimize, reopen and hosting: ${directory}`);
