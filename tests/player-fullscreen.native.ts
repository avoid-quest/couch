// Run serially on macOS after bun run build:
// COUCH_TEST_FFMPEG=/path/to/ffmpeg bun tests/player-fullscreen.native.ts [fresh evidence directory]
// Optional final argument: rapid | native-restore | external-exit | native-exit | escape | combined | tv. Default runs each serially in a fresh app.
// Uses the actual Main, preload, Core and PlayerPage; no network media or Live audio.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

assert.equal(process.platform, "darwin", "This regression requires macOS native fullscreen transitions");
const scenario = process.argv[3] ?? "all";
assert(["all", "combined", "rapid", "native-restore", "external-exit", "native-exit", "escape", "tv"].includes(scenario), "Unknown fullscreen scenario");
const root = resolve(import.meta.dirname, "..");
const directory = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "couch-fullscreen-"));
if (process.argv[2]) assert(!existsSync(directory), "Use a fresh evidence directory; preserve failed runs");
assert(existsSync(join(root, "build/main.mjs")), "Run bun run build first");
mkdirSync(directory, { recursive: true });
if (scenario === "all") {
  const results = [];
  for (const name of ["rapid", "native-restore", "external-exit", "native-exit", "escape", "combined", "tv"]) {
    const evidence = join(directory, name), output = Bun.file(join(directory, `${name}.log`));
    const child = Bun.spawn([process.execPath, import.meta.filename, evidence, name], { cwd: root, env: process.env, stdout: output, stderr: output });
    const exitCode = await child.exited;
    const result = existsSync(join(evidence, "result.json")) ? JSON.parse(readFileSync(join(evidence, "result.json"), "utf8")) : {};
    results.push({ scenario: name, exitCode, passed: result.passed === true, coreStopped: result.coreStopped === true, listenerStopped: result.listenerStopped === true });
  }
  writeFileSync(join(directory, "result.json"), JSON.stringify({ passed: results.every(result => result.passed && result.exitCode === 0), scenarios: results }, null, 2));
  assert(results.every(result => result.passed && result.exitCode === 0), `Fullscreen regression failed; see ${directory}`);
  console.log(`Independent and combined native fullscreen scenarios passed: ${directory}`);
  process.exit(0);
}
const movie = join(directory, "movie.mp4");
const generator = Bun.spawn([process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "90", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-movflags", "+faststart", movie], { stdout: "inherit", stderr: "inherit" });
assert.equal(await generator.exited, 0, "Could not generate local fullscreen fixture");
const listener = createServer();
await new Promise<void>((ok, fail) => listener.once("error", fail).listen(0, "127.0.0.1", ok));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((ok, fail) => listener.close(error => error ? fail(error) : ok()));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  if (new URL(request.url).pathname !== "/movie.mp4") return new Response(null, { status: 404 });
  const file = Bun.file(movie), headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range) return new Response(file, { headers });
  const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : file.size - 1, file.size - 1);
  if (start > end) return new Response(null, { status: 416 });
  return new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) } });
} });
const scratch = join(directory, "probe"), data = join(directory, "data"), resultPath = join(directory, "result.json");
mkdirSync(scratch); mkdirSync(data);
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-fullscreen-probe", version: "0.4.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true, tvPresentation: scenario === "tv" }));
writeFileSync(join(scratch, "probe.mjs"), String.raw`
import assert from 'node:assert/strict';
import { app, BrowserWindow, utilityProcess, ipcMain } from 'electron';
import { writeFileSync } from 'node:fs';
const scenario = ${JSON.stringify(scenario)};
const evidence = { scenario, platform: process.platform, versions: process.versions, events: [], steps: [], passed: false,
  limitations: ['Source-run app with completed local setup and generated silent video.', 'Escape is sent to the real renderer; macOS Space switching and green-button gestures are not automated.'] };
const record = () => writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(evidence, null, 2));
if (scenario === 'external-exit') {
  const handle = ipcMain.handle;
  ipcMain.handle = function(channel, handler) {
    return handle.call(this, channel, (...args) => {
      if (channel === 'couch:player-fullscreen') { evidence.events.push({ event: 'player-fullscreen-request', enter: args[1], at: Date.now() }); record(); }
      return handler(...args);
    });
  };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (window, source) => window.webContents.executeJavaScript(source, true);
const selector = 'button[aria-label="Enter fullscreen"],button[aria-label="Exit fullscreen"]';
const state = window => js(window, '(() => { const button = document.querySelector(' + JSON.stringify(selector) + '); return { html: !!document.fullscreenElement, label: button?.getAttribute("aria-label"), disabled: button?.disabled }; })()');
async function until(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await wait(20); }
  throw new Error('Timed out: ' + label);
}
const count = event => evidence.events.filter(item => item.event === event).length;
const fork = utilityProcess.fork;
utilityProcess.fork = function (...args) {
  const child = fork.apply(this, args);
  child.once('spawn', () => { evidence.corePid = child.pid; record(); });
  child.once('exit', () => { evidence.coreExited = true; record(); });
  return child;
};
app.on('will-quit', () => { evidence.coreExitedBeforeApp = evidence.coreExited === true; record(); });
async function settled(window, html, native = html) {
  await until(async () => {
    const current = await state(window);
    return current.html === html && current.disabled === false && current.label === (html ? 'Exit fullscreen' : 'Enter fullscreen') && window.isFullScreen() === native;
  }, 'HTML, native fullscreen and button settle to ' + html + '/' + native);
}
async function click(window, label) {
  await js(window, 'document.querySelector("[data-player-surface]")?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))');
  await wait(50);
  await until(async () => { const current = await state(window); return current.label === label && current.disabled === false; }, label + ' enabled');
  const point = await js(window, '(() => { const button = document.querySelector(' + JSON.stringify(selector) + '); const b = button.getBoundingClientRect(); return { x: Math.round(b.x+b.width/2), y: Math.round(b.y+b.height/2) }; })()');
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
}
async function toggle(window, enter, repeat = false) {
  const event = enter ? 'enter-full-screen' : 'leave-full-screen';
  const opposite = enter ? 'leave-html-full-screen' : 'enter-html-full-screen';
  const before = count(event), oppositeBefore = count(opposite), at = Date.now();
  await click(window, enter ? 'Enter fullscreen' : 'Exit fullscreen');
  if (repeat) {
    await until(async () => { const current = await state(window); return current.disabled === true; }, 'toggle disabled during native animation');
    assert.equal(count(event), before, 'Disabled control must be observed before the native transition completes');
    // HTMLElement.click honors the real disabled button. Do not wait for it to re-enable.
    await js(window, 'document.querySelector(' + JSON.stringify(selector) + ').click()');
  }
  await until(() => count(event) === before + 1, event);
  await settled(window, enter);
  if (enter) assert.equal(await js(window, 'document.fullscreenElement === document.documentElement'), true, 'Fullscreen the document so playback portals remain available');
  assert.equal(count(opposite), oppositeBefore, 'Rapid repeat must not reverse the pending HTML transition');
  const observations = await js(window, 'window.__fullscreenObservations');
  if (repeat) {
    const disabled = observations.find(item => item.at >= at && item.disabled);
    assert(disabled, 'Record a disabled fullscreen control');
    const completed = evidence.events.find(item => item.event === event && item.at >= at);
    assert(!observations.some(item => item.at >= disabled.at && item.at < completed.at && item.disabled === false), 'Control re-enabled before native fullscreen completed');
  }
  evidence.steps.push({ name: (repeat ? 'rapid repeat ' : 'normal ') + (enter ? 'enter' : 'exit'), native: window.isFullScreen(), ui: await state(window), observations: observations.filter(item => item.at >= at) }); record();
}
async function run(window) {
  await js(window, 'window.__fullscreenSession = () => { const root = document.getElementById("root"), key = Object.keys(root ?? {}).find(key => key.startsWith("__reactContainer")); if (!key) return null; const nodes = [root[key].stateNode.current]; while (nodes.length) { const node = nodes.pop(), value = node?.memoizedProps?.value; if (value?.queryClient && value?.command && value?.state) return value; if (node?.child) nodes.push(node.child); if (node?.sibling) nodes.push(node.sibling); } return null; }; void 0');
  await until(() => js(window, 'window.__fullscreenSession()?.connected === true'), 'real Core session', 30000);
  await js(window, 'window.__fullscreenSession().command(' + JSON.stringify({ type: 'enqueue', entry: { id: 'fullscreen-fixture', title: 'Fullscreen fixture', source: ${JSON.stringify(`http://127.0.0.1:${server.port}/movie.mp4`)} }, playNow: true }) + ')');
  await until(() => js(window, '(() => { const video = document.querySelector(".player-video video"); return video?.readyState >= 3 && !video.paused && video.currentTime > 0 && window.__fullscreenSession().state.player.status === "playing"; })()'), 'real decoded PlayerPage video', 30000);
  await until(() => count('show') > 0 && window.isVisible(), 'native window shown event');
  if (!app.isActive() || !window.isFocused()) { app.focus({ steal: true }); window.focus(); }
  await until(async () => app.isActive() && window.isFocused() && await js(window, 'document.hasFocus()'), 'focused native window and renderer');
  if (scenario === 'tv') {
    await until(() => count('enter-full-screen') > 0 && window.isFullScreen(), 'TV native fullscreen completion');
    assert.equal(await js(window, 'document.fullscreenElement === null && !document.querySelector(' + JSON.stringify(selector) + ')'), true, 'TV stays natively fullscreen without a player toggle');
    evidence.steps.push({ name: 'TV keeps native fullscreen', native: window.isFullScreen(), ui: await state(window) });
    evidence.passed = true; return;
  }
  await settled(window, false);
  await js(window, 'window.__fullscreenObservations = []; const observe = () => { const button = document.querySelector(' + JSON.stringify(selector) + '); window.__fullscreenObservations.push({ at: Date.now(), html: !!document.fullscreenElement, label: button?.getAttribute("aria-label"), disabled: button?.disabled }); }; new MutationObserver(observe).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["disabled", "aria-label"] }); document.addEventListener("fullscreenchange", observe); observe();');
  if (scenario === 'external-exit') {
    await toggle(window, true);
    await toggle(window, false);
    for (let round = 0; round < 3; round++) {
      const entered = count('enter-full-screen');
      window.setFullScreen(true);
      await until(() => count('enter-full-screen') === entered + 1, 'native entry before external exit');
      await settled(window, false, true);
      await until(async () => app.isActive() && window.isFocused() && await js(window, 'document.hasFocus()'), 'focus after native entry');
      await js(window, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const at = Date.now();
      window.setFullScreen(false);
      // Real renderer input reaches the UI guard; do not invoke the fullscreen IPC directly.
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F' });
      await settled(window, true, true);
      const events = evidence.events.filter(event => event.at >= at);
      const request = events.find(event => event.event === 'player-fullscreen-request' && event.enter);
      const exit = events.find(event => event.event === 'leave-full-screen');
      assert(request && exit && request.at < exit.at, 'The player entry request must overlap the unfinished native exit');
      evidence.steps.push({ name: 'player entry overlaps native exit', round, events }); record();
      await click(window, 'Exit fullscreen');
      await settled(window, false, false);
      evidence.steps.push({ name: 'player exit restores the completed native exit', round, native: window.isFullScreen(), ui: await state(window) }); record();
    }
  }
  if (scenario === 'native-exit') {
    // The window's own fullscreen control (setFullScreen is its AppKit toggle) ends player fullscreen too.
    for (const fromNative of [false, true]) {
      if (fromNative) {
        const entered = count('enter-full-screen');
        window.setFullScreen(true);
        await until(() => count('enter-full-screen') === entered + 1, 'OS native fullscreen entry');
        await settled(window, false, true);
        await click(window, 'Enter fullscreen');
        await settled(window, true, true);
      } else await toggle(window, true);
      const left = count('leave-full-screen'), entered = count('enter-full-screen');
      window.setFullScreen(false);
      await until(() => count('leave-full-screen') === left + 1, 'native exit during player fullscreen');
      await settled(window, false, false);
      await wait(750); // Allow an unintended native re-entry to start before asserting the exit holds.
      assert.equal(window.isFullScreen(), false, 'Native exit during player fullscreen must stay windowed');
      assert.equal(count('enter-full-screen'), entered, 'Native exit must not re-enter native fullscreen');
      evidence.steps.push({ name: 'native exit ends player fullscreen', fromNative, native: window.isFullScreen(), ui: await state(window) }); record();
      await toggle(window, true);
      await toggle(window, false);
    }
  }
  if (scenario === 'combined' || scenario === 'rapid') {
    await toggle(window, true, true);
    await js(window, 'document.querySelector(\'button[aria-label="Playback"]\').click()');
    await until(() => js(window, '(() => { const sheet = document.querySelector(\'[data-slot="popover-content"][data-state="open"]\'); return !!sheet && sheet.getBoundingClientRect().height > 0 && document.fullscreenElement?.contains(sheet); })()'), 'portaled playback settings visible in fullscreen');
    await js(window, 'document.querySelector(\'button[aria-label="Playback"]\').click()');
    await until(() => js(window, '!document.querySelector(\'[data-slot="popover-content"][data-state="open"]\')'), 'portaled playback settings closed');
    evidence.steps.push({ name: 'portaled playback settings remain interactive', native: window.isFullScreen(), ui: await state(window) }); record();
    await toggle(window, false, true);
    await toggle(window, true);
    await toggle(window, false);
  }

  if (scenario === 'combined' || scenario === 'escape') {
    await toggle(window, true);
    const escaped = count('leave-full-screen');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until(() => count('leave-full-screen') === escaped + 1, 'Escape native exit completion');
    await settled(window, false);
    evidence.steps.push({ name: 'renderer Escape exits HTML and native fullscreen', native: window.isFullScreen(), ui: await state(window) });
    record();
  }

  if (scenario === 'combined' || scenario === 'native-restore' || scenario === 'escape') {
    for (let round = 0; round < 3; round++) {
      const entered = count('enter-full-screen');
      window.setFullScreen(true);
      await until(() => count('enter-full-screen') === entered + 1, 'OS native fullscreen entry');
      await settled(window, false, true);
      const nativeLeaves = count('leave-full-screen');
      await click(window, 'Enter fullscreen');
      await settled(window, true, true);
      await click(window, 'Exit fullscreen');
      await settled(window, false, true);
      await wait(750); // Allow an unintended native exit animation to complete before asserting preservation.
      assert.equal(window.isFullScreen(), true, 'HTML fullscreen exit must preserve pre-existing native fullscreen');
      assert.equal(count('leave-full-screen'), nativeLeaves);
      evidence.steps.push({ name: 'pre-existing native fullscreen survives HTML enter/exit', native: window.isFullScreen(), ui: await state(window) }); record();
      window.setFullScreen(false);
      await until(() => count('leave-full-screen') === nativeLeaves + 1, 'OS native fullscreen exit');
      await settled(window, false);

      // Re-enter after restoring the original OS-fullscreen window. Keep this
      // assertion strict even if the earlier independent transition cases pass.
      await toggle(window, true);
      await toggle(window, false);
    }
  }
  assert.equal(await js(window, 'window.__fullscreenSession().state.player.status'), 'playing');
  evidence.passed = true;
}
for (const event of ['activate', 'did-become-active', 'did-resign-active']) app.on(event, () => { evidence.events.push({ event, at: Date.now() }); record(); });
app.on('browser-window-created', (_event, window) => {
  for (const event of ['enter-full-screen', 'leave-full-screen', 'enter-html-full-screen', 'leave-html-full-screen', 'show', 'ready-to-show']) window.on(event, () => { evidence.events.push({ event, at: Date.now() }); record(); });
});
const loadURL = BrowserWindow.prototype.loadURL;
let started = false;
BrowserWindow.prototype.loadURL = async function (...args) {
  const result = await loadURL.apply(this, args);
  if (!started) {
    started = true;
    void (async () => {
      await js(this, 'window.couchApp.deviceName("Fullscreen test")');
      await loadURL.apply(this, args);
      await run(this);
    })().catch(async error => {
      evidence.error = String(error.stack ?? error);
      evidence.failureState = { active: app.isActive(), visible: this.isVisible(), focused: this.isFocused(), fullscreenable: this.isFullScreenable(), renderer: await js(this, '({ path: location.pathname, status: window.__fullscreenSession?.()?.state?.player?.status })'), native: this.isFullScreen(), ui: await state(this), observations: await js(this, 'window.__fullscreenObservations') };
    }).finally(() => { record(); app.quit(); });
  }
  return result;
};
await import(${JSON.stringify(pathToFileURL(join(root, "build/main.mjs")).href)});
`);
const { ELECTRON_RUN_AS_NODE: _, COUCH_TV_PRESENTATION: __, ...env } = process.env;
const output = Bun.file(join(directory, "electron-output.log"));
const child = Bun.spawn([electron as unknown as string, scratch], { cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output });
writeFileSync(join(directory, "launched-pid"), `${child.pid}\n`);
let timedOut = false;
const deadline = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, 90_000);
let code;
try { code = await child.exited; } finally { clearTimeout(deadline); server.stop(true); }
const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : { passed: false, error: "No result file" };
const stopped = (pid: number) => { try { process.kill(pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; } };
result.exitCode = code; result.timedOut = timedOut;
result.coreStopped = typeof result.corePid === "number" && stopped(result.corePid);
// Retain the failed observation before cleaning up a Core left by a timed-out app.
writeFileSync(resultPath, JSON.stringify(result, null, 2));
if (typeof result.corePid === "number" && !result.coreStopped) {
  try { process.kill(result.corePid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
result.listenerStopped = await fetch(`http://127.0.0.1:${port}/api/connection`).then(() => false, () => true);
writeFileSync(resultPath, JSON.stringify(result, null, 2));
assert.equal(code, 0, `Native app must quit cleanly; see ${resultPath}`);
assert.equal(timedOut, false, `Fullscreen probe timed out; see ${resultPath}`);
assert.equal(result.passed, true, `Fullscreen regression failed; see ${resultPath}`);
assert.equal(result.coreExitedBeforeApp, true, "Core must exit before the app");
assert.equal(result.coreStopped, true, "No owned Core process remains after Quit");
assert.equal(result.listenerStopped, true, "Owned Core listener must stop");
console.log(`Native fullscreen scenario ${scenario} passed: ${directory}`);
