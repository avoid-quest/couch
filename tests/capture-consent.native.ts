// Run after bun run build: bun tests/capture-consent.native.ts [evidence directory].
// Real Main and preload in Client mode, showing a page from "another Couch" that asks for
// the microphone, a screen or this computer's audio without the owner's sharing choice:
// nothing opens unless this computer allows it in Main's prompt. The probe answers the prompt
// for the owner (test-only), except where the real native prompt is shown and then closed by
// Couch itself. Displays are synthetic: Main lists Chromium's fake display (test-only), and the
// probe records Main's answer but keeps system audio from Chromium, so nothing real is captured.
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";
import { certificate } from "../src/server/certificate";

const root = resolve(import.meta.dirname, "..");
const directory = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "couch-capture-consent-"));
const freePort = async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
};
const port = await freePort(), remotePort = await freePort();
const scratch = join(directory, "probe"), data = join(directory, "data"), evidencePath = join(directory, "events.json");
mkdirSync(scratch, { recursive: true });
mkdirSync(data, { recursive: true });
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
const remote = `https://127.0.0.1:${remotePort}`;
const tls = await certificate(join(directory, "remote-tls"), ["127.0.0.1"]);
const pin = createHash("sha256").update(new X509Certificate(tls.cert).publicKey.export({ type: "spki", format: "der" })).digest("base64");
writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "remote", address: remote, targets: [remote], localSetupComplete: true, pins: { "127.0.0.1": pin } }));
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-capture-consent-probe", version: "0.3.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
writeFileSync(join(scratch, "probe.mjs"), `
import assert from 'node:assert/strict';
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, systemPreferences } from 'electron';
import { createServer } from 'node:https';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const evidence = { platform: process.platform, steps: [] };
const record = () => writeFileSync(${JSON.stringify(evidencePath)}, JSON.stringify(evidence, null, 2));
const step = (name, value) => { evidence.steps.push({ name, ...value }); record(); return value; };
// Synthetic media only: Chromium's fake microphone, and no macOS privacy prompt.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
systemPreferences.askForMediaAccess = async () => true;
BrowserWindow.prototype.show = function () { this.showInactive(); };
BrowserWindow.prototype.focus = function () {};
// Chromium's fake display stands in for this computer's screens.
desktopCapturer.getSources = async () => [{ id: 'screen:-3:0', name: 'Couch test display' }];
// Main's answer to each display request, as given; its system audio never reaches Chromium.
const displays = [];
// Registered before Main's own whenReady, so this wraps its handler.
app.whenReady().then(() => {
  const setDisplayMediaRequestHandler = session.defaultSession.setDisplayMediaRequestHandler.bind(session.defaultSession);
  session.defaultSession.setDisplayMediaRequestHandler = handler => setDisplayMediaRequestHandler((request, callback) => {
    const answer = { gesture: request.userGesture, streams: undefined };
    displays.push(answer);
    handler(request, streams => { answer.streams = streams; const { audio: _, ...picture } = streams ?? {}; callback(streams && picture); });
  });
});
// The other Couch: a page that asks for capture by itself. Its Share button prepares
// and opens a display in one click, as the Couch client does.
const page = '<!doctype html><title>Other Couch</title><button id=share style="position:fixed;inset:0">Share</button><script>'
  + 'document.getElementById("share").onclick = () => { window.__shared = couchApp.prepareCapture(window.__selection)'
  + '.then(() => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }))'
  + '.then(stream => { const [video] = stream.getVideoTracks(); stream.getTracks().forEach(track => track.stop()); return { display: video.getSettings().deviceId, audio: stream.getAudioTracks().length }; }, error => error.name); };'
  + '</script>';
await new Promise(resolve => createServer(${JSON.stringify(tls)}, (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' }).end(page);
}).listen(${remotePort}, '127.0.0.1', resolve));
// Records Main's prompts. answer(options) stands in for the owner; null shows the real prompt.
let win = null, answer = null;
const prompts = [];
const showMessageBox = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = (parent, options) => {
  const prompt = { parent: parent === win, message: options.message, detail: options.detail, buttons: options.buttons, cancelId: options.cancelId, signal: options.signal };
  prompts.push(prompt);
  const reply = answer ? answer(options) : showMessageBox(parent, options);
  return reply.then(result => (prompt.response = result.response, result));
};
// Main's answer to every capture preparation, whichever page asked.
const prepared = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, run) => handle(channel, channel !== 'couch:prepare-capture' ? run : async (event, selection) => {
  const result = await run(event, selection);
  if (selection) prepared.push(result.error ?? 'prepared');
  return result;
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
const until = async (test, label) => { for (const deadline = Date.now() + 10000; !test(); await sleep(25)) if (Date.now() > deadline) throw new Error('Timed out: ' + label); };
async function run(w, url) {
  assert.equal(new URL(url).origin, ${JSON.stringify(remote)}, 'Client mode shows the other Couch');
  // No user gesture anywhere: the page acts by itself.
  const js = code => w.webContents.executeJavaScript(code, false);
  const microphone = () => js("navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'granted'; }, error => error.name)");
  const prepare = () => js("couchApp.prepareCapture({ kind: 'microphone' }).then(() => 'prepared', error => error.message)");
  const start = () => js("window.__preparing = couchApp.prepareCapture({ kind: 'microphone' }).then(() => 'prepared', error => error.message), 1");
  const held = () => { let reply; answer = () => new Promise(resolve => { reply = resolve; }); return { allow: () => reply({ response: 1 }), deny: () => reply({ response: 0 }) }; };
  const settled = async count => { await until(() => prepared.length >= count, 'Main answering the preparation'); return prepared[count - 1]; };

  step('unprepared', { microphone: await microphone() });
  assert.equal(evidence.steps.at(-1).microphone, 'NotAllowedError');

  answer = async () => ({ response: 0 });
  const denied = step('denied', { prepare: await prepare(), microphone: await microphone(), prompt: { ...prompts.at(-1), signal: undefined } });
  assert.match(denied.prepare, /wasn't allowed/);
  assert.equal(denied.microphone, 'NotAllowedError');
  assert.equal(denied.prompt.parent, true, 'the prompt belongs to the Couch window');
  assert.equal(denied.prompt.message, "Allow ${remote} to use this computer's microphone?");
  assert.deepEqual(denied.prompt.buttons, ["Don't Allow", "Allow"]);

  answer = async () => ({ response: 1 });
  const allowed = step('allowed', { prepare: await prepare(), microphone: await microphone() });
  assert.deepEqual([allowed.prepare, allowed.microphone], ['prepared', 'granted'], 'an allowed request still shares');
  await js("couchApp.prepareCapture(null)");
  step('cancelled after allowing', { microphone: await microphone() });
  assert.equal(evidence.steps.at(-1).microphone, 'NotAllowedError');

  // An answer that arrives after Couch stopped asking grants nothing.
  const stale = async (name, revoke) => {
    const owner = held(), before = prepared.length, asked = prompts.length;
    await start();
    await until(() => prompts.length > asked, name + ' prompting');
    await revoke();
    const prompt = prompts[asked];
    owner.allow();
    const result = step('allowed after ' + name, { aborted: prompt.signal.aborted, prepare: await settled(before + 1), microphone: await microphone() });
    assert.equal(result.aborted, true, name + ' closes the prompt');
    assert.notEqual(result.prepare, 'prepared', name + ' cancels the preparation');
    assert.equal(result.microphone, 'NotAllowedError', name + ' leaves no grant');
  };
  await stale('cancel', () => js("couchApp.prepareCapture(null)"));
  await stale('Close', async () => { w.close(); assert(!w.isDestroyed()); });
  app.emit('second-instance');
  await stale('navigation', async () => { const loaded = new Promise(resolve => w.webContents.once('did-finish-load', resolve)); w.webContents.reload(); await loaded; });
  let replacement;
  await stale('a new request', async () => { const asked = prompts.length; replacement = held(); await start(); await until(() => prompts.length > asked, 'the new request prompting'); });
  replacement.deny();
  assert.match(await settled(prepared.length + 1), /wasn't allowed/);
  assert.equal(await microphone(), 'NotAllowedError');

  // The real native prompt, closed by Couch when the page cancels and when the window closes.
  for (const [name, revoke] of [['cancel', () => js("couchApp.prepareCapture(null)")], ['Close', async () => { w.close(); }]]) {
    app.emit('second-instance');
    answer = null;
    const before = prepared.length, asked = prompts.length;
    await start();
    await until(() => prompts.length > asked, 'the native prompt');
    await sleep(500);
    await revoke();
    const result = step('native prompt closed by ' + name, { aborted: prompts[asked].signal.aborted, prepare: await settled(before + 1), response: prompts[asked].response, microphone: await microphone() });
    assert.equal(result.aborted, true);
    assert.equal(result.response, 0, 'the native prompt closes as Don\\'t Allow');
    assert.notEqual(result.prepare, 'prepared');
    assert.equal(result.microphone, 'NotAllowedError');
  }

  // Displays. A real click on the page's Share button: Chromium's own user activation.
  const click = async selection => {
    await js('window.__shared = undefined; window.__selection = ' + JSON.stringify(selection) + '; 1');
    for (const type of ['mouseDown', 'mouseUp']) w.webContents.sendInputEvent({ type, x: 40, y: 40, button: 'left', clickCount: 1 });
  };
  const share = async (selection, name) => {
    const asked = prompts.length, requested = displays.length;
    await click(selection);
    const result = await js('new Promise(resolve => { const wait = () => window.__shared ? window.__shared.then(resolve) : setTimeout(wait, 25); wait(); })');
    const display = displays[requested];
    return step(name, { result, gesture: display?.gesture, granted: display?.streams, prompt: prompts[asked] && { ...prompts[asked], signal: undefined } });
  };
  const screen = { kind: 'screen', sourceId: 'screen:-3:0', audio: true };
  const picture = { id: 'screen:-3:0', name: 'Couch test display', kind: 'screen' };
  app.emit('second-instance');
  answer = null;

  step('display without preparing', { display: await js("navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => 'granted', error => error.name)", true) });
  assert.notEqual(evidence.steps.at(-1).display, 'granted');
  await js("couchApp.captureSources()");
  await js("couchApp.prepareCapture(" + JSON.stringify(screen) + ")");
  const before = prompts.length;
  step('prepared display without a click', { display: await js("navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(() => 'granted', error => error.name)"), prompted: prompts.length > before });
  assert.notEqual(evidence.steps.at(-1).display, 'granted');
  assert.equal(evidence.steps.at(-1).prompted, false, 'no prompt without a click');

  // The page lists sources and chooses one itself, naming it whatever it likes.
  answer = async () => ({ response: 0 });
  const refused = await share({ ...screen, name: 'Harmless preview' }, 'display denied');
  assert.equal(refused.prompt?.parent, true, 'the display prompt belongs to the Couch window');
  assert.equal(refused.prompt.message, "Allow ${remote} to see the screen \u201cCouch test display\u201d and hear this computer's audio?");
  assert.deepEqual(refused.prompt.buttons, ["Don't Allow", "Allow"]);
  assert.equal(refused.granted, null);
  assert.notEqual(typeof refused.result, 'object', 'a denied display reaches no page');

  // A person reads the prompt for longer than the click's activation lasts.
  let active;
  answer = async () => { await sleep(6500); active = await js('navigator.userActivation.isActive'); return { response: 1 }; };
  const slow = await share(screen, 'display allowed after 6.5 s');
  step('activation when the owner answered', { active });
  assert.equal(slow.gesture, true);
  assert.equal(active, false, "the click's activation had ended");
  assert.deepEqual(slow.granted, { video: picture, audio: 'loopback' });
  assert.deepEqual(slow.result, { display: 'screen:-3:0', audio: 0 }, 'the allowed display opened');

  answer = async () => ({ response: 1 });
  const silent = await share({ ...screen, audio: false }, 'picture only');
  assert.equal(silent.prompt.message, "Allow ${remote} to see the screen \u201cCouch test display\u201d?");
  assert.deepEqual(silent.granted, { video: picture }, "the page's audio request adds no sound");
  const audio = await share({ kind: 'system-audio', sourceId: 'screen:-3:0' }, 'system audio');
  assert.equal(audio.prompt.message, "Allow ${remote} to hear this computer's audio?");
  assert.match(audio.prompt.detail, /also gets the picture of the screen \u201cCouch test display\u201d/);
  assert.deepEqual(audio.granted, { video: picture, audio: 'loopback' });

  // An answer that arrives after Couch stopped asking grants nothing.
  const staleDisplay = async (name, revoke) => {
    const owner = held(), asked = prompts.length, requested = displays.length;
    await click(screen);
    await until(() => prompts.length > asked, name + ' prompting for a display');
    await revoke();
    owner.allow();
    await until(() => displays[requested]?.streams !== undefined, 'Main answering ' + name);
    const result = step('display allowed after ' + name, { aborted: prompts[asked].signal.aborted, granted: displays[requested].streams, result: await js('window.__shared') });
    assert.equal(result.aborted, true, name + ' closes the prompt');
    assert.equal(result.granted, null, name + ' leaves no display');
  };
  await staleDisplay('cancel', () => js("couchApp.prepareCapture(null)"));
  await staleDisplay('Close', async () => { w.close(); assert(!w.isDestroyed()); });
  app.emit('second-instance');
  await staleDisplay('a new request', () => js("couchApp.prepareCapture(" + JSON.stringify(screen) + ").catch(() => {})"));
  await staleDisplay('navigation', async () => { const loaded = new Promise(resolve => w.webContents.once('did-finish-load', resolve)); w.webContents.reload(); await loaded; });
  await js("couchApp.captureSources()");

  // The real native prompt, closed by Couch when the window closes.
  answer = null;
  const asked = prompts.length, requested = displays.length;
  await click(screen);
  await until(() => prompts.length > asked, 'the native display prompt');
  await sleep(500);
  w.close();
  await until(() => displays[requested]?.streams !== undefined, 'Main answering the closed prompt');
  const closed = step('native display prompt closed by Close', { aborted: prompts[asked].signal.aborted, response: prompts[asked].response, granted: displays[requested].streams, result: await js('window.__shared') });
  assert.equal(closed.aborted, true);
  assert.equal(closed.response, 0, "the native prompt closes as Don't Allow");
  assert.equal(closed.granted, null);
}
await import(${JSON.stringify(pathToFileURL(join(root, "build/main.mjs")).href)});
`);
const { ELECTRON_RUN_AS_NODE: _, COUCH_TV_PRESENTATION: __, ...env } = process.env;
const output = Bun.file(join(directory, "electron-output.log"));
const child = Bun.spawn([electron as unknown as string, scratch], {
  cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output,
});
writeFileSync(join(directory, "launched-pid"), `${child.pid}\n`);
const deadline = setTimeout(() => child.kill("SIGTERM"), 120_000);
let code: number;
try { code = await child.exited; } finally { clearTimeout(deadline); }
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
assert.equal(evidence.error, undefined, evidence.error);
assert.equal(evidence.passed, true, `See ${directory}`);
assert.equal(code, 0, `Native app must quit cleanly; see ${directory}`);
console.log(`Another Couch's page got the microphone only after this computer allowed it, and never from a stale answer: ${directory}`);
