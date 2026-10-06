// Run after bun run build: bun tests/app-diagnostics.native.ts <evidence directory>.
// This launches the checkout's Electron and Main, with a separate profile and Core.
// Reserve COUCH_PORT and offsets +2 (updater), +3 (refused) and +4 (debug).
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

const directory = resolve(process.argv[2] ?? ".artifacts/app-diagnostics");
const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.COUCH_PORT ?? 42850), updaterPort = port + 2, refused = port + 3, debug = port + 4;
for (const probePort of [port, updaterPort, refused, debug]) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(probePort, "127.0.0.1", resolve));
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
const scratch = join(directory, "probe"), data = join(directory, "data");
const logPath = join(data, "logs/couch.log");
const previous = existsSync(logPath) ? readFileSync(logPath, "utf8") : null;
mkdirSync(scratch, { recursive: true });
mkdirSync(data, { recursive: true });
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-diagnostics-probe", version: "0.3.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true }));
const updaterBundle = await Bun.build({ entrypoints: [join(root, "tests/app-diagnostics-updater.fixture.ts")], target: "node", external: ["electron"] });
assert.equal(updaterBundle.success, true, "The native updater fixture must bundle");
await Bun.write(join(scratch, "updater.mjs"), updaterBundle.outputs[0]!);
const rendererCases: [string, string][] = [
  ["windows", "ENOENT: open 'C:\\Users\\reviewer name\\synthetic-windows-file.txt'"],
  ["control", "ENOENT: open /Users/review/private\tsynthetic-control-tail"],
  ["json", `Response: ${JSON.stringify({ token: 'synthetic-json-before"synthetic-json-after' })}`],
  ["escaped-json", `Response: ${JSON.stringify(JSON.stringify({ token: 'synthetic-escaped-before"synthetic-escaped-after' }))}`],
];
for (const separator of [" ", "\t", "\n", "\u2028", "'", "' ", '"', '" ']) {
  try { readFileSync(join(directory, `missing${separator}synthetic-native-path.txt`)); }
  catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
    rendererCases.push([`fs-${JSON.stringify(separator)}`, (error as Error).message]);
  }
}
assert.equal(rendererCases.length, 12);
const rendererMessage = "DIAG native renderer failure Input refused 'https://synthetic-user:synthetic-password@media.example/movie's/private.m3u8?sig=synthetic-signed\tsecret\u2028suffix' token=synthetic-credential /Users/synthetic/private.txt\u0085\u009b\u2028\u2029\n" + "x".repeat(400);
// Main loads Couch origins, never media URLs. Use the same shape for its failure.
const refusedUrl = `http://127.0.0.1:${refused}/`;
writeFileSync(join(scratch, "probe.mjs"), `
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
const evidence = { rendererCases: [], unsandboxedFrame: null, updater: null, electron: process.versions.electron, mainPid: process.pid, corePids: [], mainFrameErrors: 0, childFrameErrors: 0, messageLevel: null };
const record = () => writeFileSync(${JSON.stringify(join(directory, "native-events.json"))}, JSON.stringify(evidence, null, 2));
app.on('child-process-gone', () => record());
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', details => {
    if (details.message.includes('DIAG native renderer failure')) {
      evidence.mainFrameErrors++;
      evidence.messageLevel = details.level;
      evidence.isMainFrame = details.frame === window.webContents.mainFrame;
    }
    if (details.message.includes('DIAG privacy ')) evidence.rendererCases.push({ message: details.message, level: details.level, isMainFrame: details.frame === window.webContents.mainFrame });
    if (details.message === 'DIAG unsandboxed frame') evidence.unsandboxedFrame = { isMainFrame: details.frame === window.webContents.mainFrame, sourceId: details.sourceId, frameUrl: details.frame.url };
    if (details.message.includes('DIAG child frame')) {
      evidence.childFrameErrors++;
      evidence.isChildFrame = details.frame !== window.webContents.mainFrame;
      evidence.childSource = details.sourceId;
      evidence.childFrameUrl = details.frame.url;
    }
    record();
  });
});
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, options) {
  await loadURL.call(this, url, options);
  // A native uncaught renderer error, rather than an emitted mock event.
  await this.webContents.executeJavaScript(${JSON.stringify(`
    console.info('DIAG routine info'); console.warn('DIAG routine warning');
    setTimeout(() => { throw new Error(${JSON.stringify(rendererMessage)}); }, 0);
    //# sourceURL=https://source.example/private.js?token=synthetic-source-secret
  `)});
  await this.webContents.executeJavaScript(${JSON.stringify("new Promise(resolve => { const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts'; frame.onload = resolve; frame.srcdoc = `<script>console.error('DIAG child frame')</script>`; document.body.append(frame); })")});
  await this.webContents.executeJavaScript(${JSON.stringify(`
    for (const [id, message] of ${JSON.stringify(rendererCases)}) setTimeout(() => { throw new Error('DIAG privacy ' + id + ' ' + message); }, 0);
  `)});
  await this.webContents.executeJavaScript(${JSON.stringify("new Promise(resolve => { const frame = document.createElement('iframe'); frame.onload = resolve; frame.srcdoc = `<script>console.error('DIAG unsandboxed frame')</script>`; document.body.append(frame); })")});
  const { exerciseUpdater } = await import(${JSON.stringify(pathToFileURL(join(scratch, "updater.mjs")).href)});
  evidence.updater = await exerciseUpdater(${JSON.stringify(directory)}, ${updaterPort});
  process.stdout.write('DIAG raw tee\\nsecond raw line\\n');
  await new Promise(resolve => setTimeout(resolve, 150));
  evidence.corePids = app.getAppMetrics().filter(metric => metric.name === 'Couch Core').map(metric => metric.pid);
  record();
  // Main's existing load() catches a genuine native ERR_CONNECTION_REFUSED.
  try { return await loadURL.call(this, ${JSON.stringify(refusedUrl)}); }
  finally { setTimeout(() => app.quit(), 200); }
};
await import(${JSON.stringify(pathToFileURL(join(root, "build/main.mjs")).href)});
`);
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const output = Bun.file(join(directory, "electron-output.log"));
const child = Bun.spawn([electron as unknown as string, scratch, `--remote-debugging-port=${debug}`, "--remote-debugging-address=127.0.0.1"], {
  cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output,
});
writeFileSync(join(directory, "launched-pid"), `${child.pid}\n`);
const deadline = setTimeout(() => child.kill("SIGTERM"), 20_000);
let code: number;
try { code = await child.exited; } finally { clearTimeout(deadline); }
assert.equal(code, 0, "Native probe must shut down normally");
const events = JSON.parse(readFileSync(join(directory, "native-events.json"), "utf8"));
assert.equal(events.electron, "44.4.5");
assert.equal(events.corePids.length, 1, "The probe must run its own native Core");
assert.equal(events.mainFrameErrors, 1, "Electron must see a genuine uncaught renderer error");
assert.equal(events.messageLevel, "error");
assert.equal(events.isMainFrame, true);
assert.equal(events.childFrameErrors, 1);
assert.equal(events.isChildFrame, true);
assert.equal(events.rendererCases.length, rendererCases.length);
assert(events.rendererCases.every((event: { level: string; isMainFrame: boolean }) => event.level === "error" && event.isMainFrame));
// Electron 44 attributes unsandboxed same-origin srcdoc output to mainFrame.
// This is a retained limitation, not universal iframe exclusion.
assert.equal(events.unsandboxedFrame.isMainFrame, true);
assert.equal(events.unsandboxedFrame.sourceId, "about:srcdoc");
assert.equal(events.updater.filesystemErrors, 8);
assert.equal(events.updater.cacheReused, true);
assert.deepEqual(events.updater.httpErrors, [{ path: "/plain", statusCode: 401 }, { path: "/json", statusCode: 401 }]);
const log = readFileSync(logPath, "utf8");
if (previous !== null) assert.equal(readFileSync(join(data, "logs/couch.1.log"), "utf8"), previous, "The previous run must rotate intact");
const lines = log.trimEnd().split("\n");
const main = lines.find(line => line.includes("Couldn't load Couch"));
const renderer = lines.find(line => line.includes("DIAG native renderer failure"));
const failures: string[] = [];
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /;
if (!main || !iso.test(main)) failures.push("Main failure lacks ISO timestamp");
if (!renderer || !iso.test(renderer)) failures.push("Renderer failure absent from couch.log");
if (lines.filter(line => line.includes("DIAG native renderer failure")).length !== 1) failures.push("Native error was not recorded exactly once");
for (const line of [main, renderer].filter((line): line is string => !!line)) {
  if (line.length > 420 || /[\p{Cc}\u2028\u2029]/u.test(line)) failures.push("Failure is not bounded and single-line");
  for (const privatePart of ["synthetic-", "movie", "private", "secret", "suffix", "sig=", "token=synthetic", "http://", "https://"]) {
    if (line.includes(privatePart)) failures.push(`Failure contains ${privatePart}`);
  }
}
if (renderer && !renderer.includes("host=localhost")) failures.push("Renderer lacks main-frame host context");
if (renderer && !renderer.includes("media.example")) failures.push("Renderer lost the complete media host");
if (lines.some(line => /DIAG routine|DIAG child frame|synthetic-source-secret/.test(line))) failures.push("Routine/subframe/sourceURL output was forwarded");
const privacyLines = lines.filter(line => line.includes("DIAG privacy "));
if (privacyLines.length !== rendererCases.length) failures.push("Native privacy errors were not all recorded");
const updaterLines = lines.filter(line => line.includes("update error:"));
if (!lines.some(line => line.includes("update info: Update has already been downloaded to [path]"))) failures.push("Real updater cache message was not recorded");
if (updaterLines.length !== 10) failures.push("Updater default error listener did not record every real error");
for (const line of [...privacyLines, ...updaterLines]) {
  if (!iso.test(line) || line.length > 341 || /[\p{Cc}\u2028\u2029]/u.test(line)) failures.push("Privacy record is not timestamped, bounded and single-line");
}
if (!lines.some(line => line.endsWith("renderer error: host=localhost: DIAG unsandboxed frame"))) failures.push("Electron-attributed main-frame limitation changed");
if (!log.includes("DIAG raw tee\nsecond raw line\n")) failures.push("Raw tee changed");
if (log.includes("synthetic-")) failures.push("A private synthetic marker reached couch.log");
writeFileSync(join(directory, "verdict.json"), JSON.stringify({ code, events, failures }, null, 2));
console.log(JSON.stringify({ code, events, failures }, null, 2));
assert.deepEqual(failures, [], "Main and renderer diagnostics must be timestamped, safe and bounded");
