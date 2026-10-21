// After bun run build: bun tests/tv-presentation.native.ts <evidence directory>.
// Real Main, preload, renderer and Core; only relaunch is recorded instead of spawning.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

const root = resolve(import.meta.dirname, ".."), directory = resolve(process.argv[2] ?? ".artifacts/tv-presentation");
const scratch = join(directory, "probe"), data = join(directory, "data");
mkdirSync(scratch, { recursive: true }); mkdirSync(data, { recursive: true });
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-tv-probe", version: "0.3.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
const modePath = join(data, "operating-mode.json");
writeFileSync(modePath, JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true }));

for (const [name, enabled, override, requested] of [
  ["enable", false, false, true], ["disable", true, false, false], ["launcher", true, true, null], ["desktop", false, false, null],
] as const) {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const evidencePath = join(directory, `${name}.json`);
  writeFileSync(join(scratch, "probe.mjs"), `
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
const evidence = { corePids: [], relaunches: 0 };
const record = () => writeFileSync(${JSON.stringify(evidencePath)}, JSON.stringify(evidence, null, 2));
app.relaunch = () => { evidence.relaunches++; record(); };
// Keep the test's own fullscreen window hidden, without altering the owner's app.
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, options) {
  try {
    await loadURL.call(this, url, options);
    const js = code => this.webContents.executeJavaScript(code);
    // TV mode changes through Core's admin route, which asks Main to save it and restart.
    const tvMode = (body, auth = true) => js(\`couchApp.connection().then(info => fetch('/api/settings/tv-mode', { method: 'POST', headers: { 'Content-Type': 'application/json', \${auth ? "Authorization: 'Bearer ' + info.token" : ""} }, body: \${JSON.stringify(JSON.stringify(body))} })).then(async r => ({ status: r.status, ...await r.json() }))\`);
    evidence.bridge = await js('({ tv: couchApp.tvPresentation })');
    evidence.fullscreen = this.isFullScreen();
    evidence.connection = await js('fetch("/api/connection").then(r => r.json())');
    assert.equal(evidence.bridge.tv, ${enabled});
    assert.equal(evidence.connection.tvPresentation, ${enabled});
    assert.equal(evidence.connection.tvAppliance, ${override});
    assert.equal(evidence.connection.tvModeChangeable, !${override});
    evidence.updates = await js('couchApp.updates()');
    if (!${override}) assert.equal(evidence.updates.automatic, undefined, 'Desktop TV keeps desktop updates');
    evidence.corePids = app.getAppMetrics().filter(metric => metric.name === 'Couch Core').map(metric => metric.pid);
    assert.equal(evidence.corePids.length, 1);
    evidence.invalid = await tvMode({ enabled: "yes" });
    assert.match(evidence.invalid.error, /Choose whether/);
    if (${override}) {
      evidence.lockedError = await tvMode({ enabled: false });
      assert.equal(evidence.lockedError.status, 409);
      assert.match(evidence.lockedError.error, /launcher/);
    }
    // Without the host's private token or a paired admin's, Core refuses before asking Main (503 while sharing is off).
    evidence.unpaired = await tvMode({ enabled: true }, false);
    assert.ok([401, 503].includes(evidence.unpaired.status), String(evidence.unpaired.status));
    await js('couchApp.deviceName("Test Couch")');
    await loadURL.call(this, new URL('/settings/couch/tv', url).href, options);
    // The switch is enabled once this window is connected to its Core.
    for (let attempts = 0; await js('Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "TV mode")?.disabled ?? "missing"') !== ${override}; attempts++) {
      assert(attempts < 50, 'TV settings must expose TV mode');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    evidence.setting = await js('({ checked: Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "TV mode").getAttribute("aria-checked"), disabled: Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "TV mode").disabled, text: document.body.innerText })');
    assert.equal(evidence.setting.checked, String(${enabled}));
    assert.equal(evidence.setting.disabled, ${override});
    if (!${override}) assert(!evidence.setting.text.includes('Start on boot'), 'Desktop TV does not expose appliance startup');
    writeFileSync(${JSON.stringify(join(directory, `${name}.png`))}, (await this.webContents.capturePage()).toPNG());
    if (!${override}) {
      await js('Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "TV mode").click()');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert(await js('document.body.innerText.includes("Restart Couch")'), 'Switch requires restart confirmation');
      await js('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Cancel").click()');
      assert.equal(evidence.relaunches, 0, 'Cancel never restarts');
    }
    // Real websocket registration uses the actual preload's presentation flag.
    evidence.tvDevice = await js(\`(async () => {
      const info = await couchApp.connection();
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(info.origin.replace('http:', 'ws:') + '/api/ws?token=' + info.token + '&device=' + 't'.repeat(43) + (couchApp.tvPresentation ? '&tv=1' : ''));
        const timer = setTimeout(() => { socket.close(); reject(new Error('No device state')); }, 3000);
        socket.onmessage = event => { const message = JSON.parse(event.data); if (message.type === 'state') {
          clearTimeout(timer); resolve(message.state.devices.find(device => device.id === 't'.repeat(43))?.tv); socket.close();
        }};
      });
    })()\`);
    assert.equal(evidence.tvDevice, ${enabled});
    record();
    if (${requested !== null}) assert.equal((await tvMode({ enabled: ${requested} })).status, 200);
    else app.quit();
  } catch (error) { evidence.error = error.stack; record(); app.quit(); }
};
await import(${JSON.stringify(pathToFileURL(join(root, "build/main.mjs")).href)});
`);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const output = Bun.file(join(directory, `${name}.log`));
  const child = Bun.spawn([electron as unknown as string, scratch], { cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port), COUCH_TV_PRESENTATION: override ? "1" : "0", COUCH_ADVERTISE_URLS: "" }, stdout: output, stderr: output });
  const deadline = setTimeout(() => child.kill("SIGTERM"), 30_000);
  let code: number;
  try { code = await child.exited; } finally { clearTimeout(deadline); }
  assert.equal(code, 0, `${name} must quit normally`);
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.error, undefined, evidence.error);
  assert.equal(evidence.relaunches, requested === null ? 0 : 1);
  for (const pid of evidence.corePids) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "Core exited before Main");
  assert.equal(JSON.parse(readFileSync(modePath, "utf8")).tvPresentation, requested ?? false);
  console.log(`${name}: passed (preload, Core, TV registration, admin route, persistence and shutdown)`);
}
