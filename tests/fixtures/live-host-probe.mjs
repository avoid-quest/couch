// Test-only Electron entry: imports the built Main and observes its real capture windows.
import assert from "node:assert/strict";
import { app, BrowserWindow, ipcMain, session, systemPreferences, utilityProcess } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const evidence = { platform: process.platform, steps: [], pids: [process.pid], helpers: [], commands: [], events: [] };
const record = () => writeFileSync(config.evidence, JSON.stringify(evidence, null, 2));
const step = (name, value = {}) => { evidence.steps.push({ name, ...value }); record(); return value; };
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", config.wave);
systemPreferences.askForMediaAccess = async () => true;
BrowserWindow.prototype.show = function () { this.showInactive(); };
BrowserWindow.prototype.focus = function () {};
let owner, helper, intercept, closeAtMicrophone = false, coreExited = false;
app.once("ready", () => {
  const setRequest = session.defaultSession.setPermissionRequestHandler.bind(session.defaultSession);
  session.defaultSession.setPermissionRequestHandler = handler => setRequest((contents, permission, allow, details) => {
    if (permission === "media" && closeAtMicrophone && contents === helper?.webContents) {
      closeAtMicrophone = false; owner.close();
    }
    handler(contents, permission, allow, details);
  });
});
const fork = utilityProcess.fork;
utilityProcess.fork = function (...args) {
  const child = fork.apply(this, args);
  child.once("spawn", () => { evidence.pids.push(child.pid); record(); });
  child.once("exit", () => { coreExited = true; record(); });
  const postMessage = child.postMessage.bind(child);
  child.postMessage = value => {
    if (value.type === "shutdown") {
      evidence.captureStoppedBeforeCore = evidence.helpers.every(helper => helper.destroyed);
      record();
    }
    return postMessage(value);
  };
  return child;
};
app.on("will-quit", () => { evidence.coreExitedBeforeApp = coreExited; record(); });
const until = async (test, label, timeout = 10000) => {
  for (const deadline = Date.now() + timeout; ; await sleep(25)) {
    const value = await test(); if (value) return value;
    if (Date.now() > deadline) throw new Error("Timed out: " + label);
  }
};
const js = (window, code) => window.webContents.executeJavaScript(code, true);
// No frame or clock fabrication: wrap the browser APIs to count owned resources.
function observe() {
  const probe = window.__host = { captures: [], workers: [], requests: 0, frames: [] };
  const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  probe.microphone = () => media({ audio: true });
  navigator.mediaDevices.getUserMedia = async constraints => {
    probe.requests++;
    const stream = await media(constraints); probe.captures.push(stream); return stream;
  };
  const NativeWorker = Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); probe.workers.push(this); this.stopped = false; }
    terminate() { this.stopped = true; return super.terminate(); }
  };
  const Processor = window.MediaStreamTrackProcessor;
  if (Processor) window.MediaStreamTrackProcessor = class {
    constructor(options) {
      this.readable = new Processor(options).readable.pipeThrough(new TransformStream({ transform(frame, controller) {
        if (!probe.frames.length) probe.frames.push({ channels: frame.numberOfChannels, rate: frame.sampleRate, frames: frame.numberOfFrames });
        controller.enqueue(frame);
      } }));
    }
  };
  probe.session = () => {
    const root = document.getElementById("root");
    const container = root?.[Object.keys(root).find(key => key.startsWith("__reactContainer"))];
    const nodes = [container?.stateNode.current];
    while (nodes.length) {
      const node = nodes.pop(), value = node?.memoizedProps?.value;
      if (value?.startLive && value?.queryClient) return value;
      if (node?.child) nodes.push(node.child); if (node?.sibling) nodes.push(node.sibling);
    }
  };
  probe.state = () => {
    const session = probe.session();
    return { requests: probe.requests, tracks: probe.captures.flatMap(stream => stream.getTracks().map(track => track.readyState)),
      workers: probe.workers.filter(worker => !worker.stopped).length, frames: probe.frames,
      connected: session?.connected, local: session?.localLiveSourceId, sources: session?.state?.liveSources.filter(source => source.deviceId === session.identity?.device?.id) };
  };
  return true;
}
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, options) {
  const capture = new URL(url).pathname === "/capture-audio.html";
  await loadURL.call(this, url, options);
  if (capture) {
    helper = this;
    const snapshot = { url, id: this.id, pid: this.webContents.getOSProcessId(), visible: this.isVisible(), destroyed: false };
    evidence.helpers.push(snapshot); evidence.pids.push(snapshot.pid);
    this.once("closed", () => { snapshot.destroyed = true; record(); });
    await js(this, `(${observe.toString()})()`);
    const send = this.webContents.send.bind(this.webContents);
    this.webContents.send = (channel, value) => {
      if (channel !== "couch:audio-capture-command") return send(channel, value);
      evidence.commands.push({ op: value.op, id: value.id, request: value.request }); record();
      if (value.op === "prepare" && intercept) {
        const run = intercept; intercept = undefined;
        void run(this).then(() => { if (!this.isDestroyed()) send(channel, value); }).catch(fail);
      } else send(channel, value);
    };
    return;
  }
  if (owner) return;
  owner = this;
  try { await run(); evidence.passed = true; }
  catch (error) { evidence.error ??= error.stack; }
  finally { record(); app.quit(); }
};
const fail = error => { evidence.error ??= error.stack; record(); app.quit(); };
ipcMain.on("couch:audio-capture-event", (event, value) => {
  evidence.events.push({ sender: event.sender.id, id: value.id, request: value.request, ready: value.ready, error: value.error, format: value.format }); record();
});
const state = window => js(window, "__host.state()");
const ended = async label => {
  await until(() => evidence.helpers.every(value => value.destroyed), label + " destroying hidden capture");
  await until(async () => { const value = await state(owner); return value.connected && !value.local && !value.sources?.length; }, label + " ending publication");
  assert.equal(await microphone(owner), "NotAllowedError", label + " revokes the grant");
  step(label, await state(owner));
};
const microphone = window => js(window, "(window.__host?.microphone() ?? navigator.mediaDevices.getUserMedia({ audio: true })).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'granted'; }, error => error.name)");
async function installOwner() {
  await js(owner, `(${observe.toString()})()`);
  await until(() => js(owner, "!!__host.session()?.connected"), "Couch connection", 30000);
}
const start = async () => {
  const result = await js(owner, `(async () => {
    const before = __host.requests;
    const result = await __host.session().startLive({ kind: 'microphone', intent: 'live', audioDeviceId: window.__device }).then(() => 'started', error => error.message);
    return { result, before, after: __host.requests };
  })()`);
  assert.equal(result.after, result.before, "Live never acquires a duplicate microphone in the owner renderer");
  if (result.result === "started") {
    const captured = await state(helper);
    assert.equal(captured.requests, 1, "one acquisition per hidden capture");
    assert.equal(captured.tracks.length, 1);
    assert(captured.tracks.every(value => value === "live"));
    assert.equal(evidence.helpers.filter(value => !value.destroyed).length, 1, "one hidden capture lifetime");
  }
  return result.result;
};
async function run() {
  await installOwner();
  // Enumerate through the real Share picker path, then release its permission probe.
  const inputs = await js(owner, "__host.session().liveAudioInputs(true).then(inputs => inputs.map(({ deviceId, label }) => ({ deviceId, label })))");
  const input = inputs.find(value => !["default", "communications"].includes(value.deviceId) && !value.deviceId.startsWith("native:"));
  assert(input, "Chromium must expose an explicit synthetic input");
  await js(owner, `window.__device = ${JSON.stringify(input.deviceId)}`);
  const baseline = await state(owner);
  assert(baseline.tracks.every(value => value === "ended"), "the picker releases its probe microphone");
  const prepare = () => start();
  const boundary = async hidden => {
    const narrow = await js(hidden, "({ bridge: Object.keys(window.couchAudioCapture).sort(), app: typeof window.couchApp, require: typeof window.require })");
    assert.deepEqual(narrow, { bridge: ["event", "onCommand"], app: "undefined", require: "undefined" });
    assert.notEqual(hidden.webContents.getOSProcessId(), owner.webContents.getOSProcessId());
    assert.equal(hidden.isVisible(), false);
    assert.equal(hidden.webContents.opener, null);
    // An unrelated same-origin page and a same-origin child of the delegated helper
    // must not inherit the helper main frame's temporary microphone grant.
    const other = new BrowserWindow({ show: false, webPreferences: { session: owner.webContents.session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await loadURL.call(other, new URL("/manifest.webmanifest", owner.webContents.getURL()).href);
      const result = step("unrelated same-origin microphone", { result: await microphone(other) });
      assert.equal(result.result, "NotAllowedError");
    } finally { other.destroy(); }
    const child = await js(hidden, `new Promise(resolve => {
      const frame = document.createElement('iframe'); frame.src = '/manifest.webmanifest';
      frame.onload = async () => {
        const bridge = typeof frame.contentWindow.couchAudioCapture;
        const result = await frame.contentWindow.navigator.mediaDevices.getUserMedia({audio:true}).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'granted'; }, error => error.name);
        frame.remove(); resolve({ bridge, result });
      }; document.body.append(frame);
    })`);
    assert.deepEqual(child, { bridge: "undefined", result: "NotAllowedError" });
    step("exact delegated frame and narrow bridge", narrow);
  };
  intercept = boundary;
  const result = await prepare();
  assert.equal(result, "started", result);
  const shared = await until(async () => { const value = await state(owner); return value.local && value.sources?.length === 1 && value; }, "Live publication");
  assert.equal(shared.sources[0].intent, "live"); assert.equal(shared.sources[0].audioDelivery, "pcm");
  const captured = step("hidden stereo capture", await until(async () => { const value = await state(helper); return value.workers === 1 && value; }, "PCM upload worker", 60000));
  assert.equal(captured.requests, 1); assert(captured.tracks.length && captured.tracks.every(value => value === "live"));
  assert.equal(captured.frames[0].channels, 2); assert([44100, 48000, 96000].includes(captured.frames[0].rate));
  assert.equal(evidence.events.find(value => value.format)?.format.sampleRate, captured.frames[0].rate);
  assert.equal(await microphone(helper), "NotAllowedError", "preparation revokes the helper grant after acquiring its one input");
  await js(owner, "__host.session().endLive()"); await ended("Stop sharing");

  // Replacement is explicit: old Main resources must retire before the new input starts.
  assert.equal(await prepare(), "started");
  const send = owner.webContents.send.bind(owner.webContents);
  let notification;
  owner.webContents.send = (channel, ...args) => {
    if (channel === "couch:window-closed") notification = () => send(channel, ...args);
    else send(channel, ...args);
  };
  owner.close(); assert(!owner.isDestroyed());
  assert(notification, "Main notified its owner about Close");
  await until(() => evidence.helpers.every(value => value.destroyed), "Main stopping capture before the renderer receives Close");
  owner.webContents.send = send;
  notification();
  await ended("Close before renderer notification");
  assert((await fetch(`http://127.0.0.1:${config.port}/api/connection`)).ok, "Close keeps Core hosting");
  app.emit("second-instance");
  assert.equal(await prepare(), "started");
  await loadURL.call(owner, new URL("/settings/device", owner.webContents.getURL()).href);
  await installOwner();
  await ended("owner navigation");
  await js(owner, `window.__device = ${JSON.stringify(input.deviceId)}`);

  // Stop/Close/navigation while preparation is outstanding must reject stale work.
  for (const reason of ["stop", "Close", "microphone", "navigation", "helper navigation"]) {
    intercept = async hidden => {
      if (reason === "stop") {
        const id = evidence.commands.at(-1).id;
        await js(owner, `couchApp.liveAudio({ op: 'stop', id: ${JSON.stringify(id)} })`);
      } else if (reason === "Close") owner.close();
      else if (reason === "microphone") closeAtMicrophone = true;
      else if (reason === "navigation") await loadURL.call(owner, new URL("/settings/device", owner.webContents.getURL()).href);
      else await loadURL.call(hidden, new URL("/capture-audio.html?changed", owner.webContents.getURL()).href).catch(() => {});
    };
    const pending = prepare();
    if (reason === "navigation") {
      // Navigating destroys the renderer promise; Main cancellation is observed below.
      await pending.catch(() => "navigated");
      await installOwner(); await js(owner, `window.__device = ${JSON.stringify(input.deviceId)}`);
    } else assert.notEqual(await pending, "started", reason + " cancels preparation");
    assert.equal(closeAtMicrophone, false, "the real microphone permission callback ran");
    await ended("preparation canceled by " + reason);
    app.emit("second-instance");
    assert.equal(await prepare(), "started", "a canceled preparation permits a replacement");
    await js(owner, "__host.session().endLive()"); await ended("replacement after " + reason);
  }
  assert.equal(await prepare(), "started");
  // Quit is Main-owned too; the utility-process observer checks capture has
  // already stopped when Main requests Core's graceful shutdown.
  step("Quit with active hidden capture");
}
await import(config.main);
