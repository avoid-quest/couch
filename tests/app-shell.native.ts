// xvfb-run -a bun tests/app-shell.native.ts
// A real service worker retains an old release while its update is unavailable.
import electron from "electron";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "couch-app-shell-"));
const bundle = await Bun.build({
  entrypoints: ["src/client/register-sw.ts"],
  target: "browser",
  format: "esm",
  define: { "import.meta.env.DEV": "false" },
});
if (!bundle.success) throw new AggregateError(bundle.logs, "App shell build failed");
const source = await bundle.outputs[0]!.text();
let release = "old";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/switch") {
      release = "new";
      return new Response("ok");
    }
    if (path === "/shell.js")
      return new Response(source, { headers: { "Content-Type": "text/javascript" } });
    if (path === "/sw.js") {
      if (release === "new") return new Response(null, { status: 503 });
      return new Response(
        `self.addEventListener('install', event => event.waitUntil(caches.open('old-shell').then(cache => cache.addAll(['/', '/shell.js'])).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(caches.match('/'));
  else if (new URL(event.request.url).pathname === '/shell.js') event.respondWith(caches.match('/shell.js'));
});`,
        { headers: { "Content-Type": "text/javascript" } },
      );
    }
    return new Response(
      `<script type="module">import * as shell from '/shell.js'; window.shell = shell; window.release = ${JSON.stringify(release)}; shell.registerAppShellWorker();</script>`,
      { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } },
    );
  },
});
const probe = join(directory, "probe.cjs");
writeFileSync(
  probe,
  `const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { once } = require('node:events');
app.setPath('userData', ${JSON.stringify(join(directory, "data"))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  const read = source => window.webContents.executeJavaScript(source);
  try {
    await window.loadURL(${JSON.stringify(server.url.href)});
    await read('navigator.serviceWorker.ready');
    await read('new Promise(resolve => { if (navigator.serviceWorker.controller) resolve(); else navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }); })');
    await read('localStorage.setItem("couch.remote-token", "existing-pairing"); localStorage.setItem("couch.device-name", "Phone")');
    await fetch(${JSON.stringify(new URL("switch", server.url).href)});
    let loaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload();
    await loaded;
    assert.equal(await read('window.release'), 'old', 'Ordinary reload must reproduce the stale shell');
    loaded = once(window.webContents, 'did-finish-load');
    await read('void window.shell.reloadAppShell()');
    await loaded;
    assert.equal(await read('window.release'), 'new', 'Recovery must bypass the stale worker');
    assert.equal(await read('localStorage.getItem("couch.remote-token")'), 'existing-pairing');
    assert.equal(await read('localStorage.getItem("couch.device-name")'), 'Phone');
    console.log('PASS: stale shell recovered while pairing and device name were preserved');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn([electron, probe], { env, stdout: "inherit", stderr: "inherit" });
// A stuck navigation must not leave a test Electron process behind.
const timeout = setTimeout(() => child.kill(), 30_000);
try {
  process.exitCode = await child.exited;
} finally {
  clearTimeout(timeout);
  server.stop(true);
  rmSync(directory, { recursive: true, force: true });
}
