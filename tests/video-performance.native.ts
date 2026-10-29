// COUCH_PERF_MEDIA=/absolute/1080p60.mp4 bun tests/video-performance.native.ts .artifacts/video [--modes=playback,controls,live] [--fps=60] [--quality=1080p] [--seconds=10] [--rounds=3] [--assert-fps=55]
// Use a real display to qualify hardware. xvfb-run measures software playback and capture only.
// --screen captures the test display; otherwise prefer the generated-video window. Experimental --codec=h264, --hint=motion and --bare are benchmark-only.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { extname, join, resolve } from "node:path";
import { build, mergeConfig } from "vite";
import electron from "electron";
import config from "../vite.config";

const directory = resolve(process.argv[2] ?? ".artifacts/video"), outDir = join(directory, "dist");
const argument = (name: string, fallback: number) => Number(process.argv.find(value => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const seconds = argument("seconds", 10), warmup = argument("warmup", 3), rounds = argument("rounds", 3), assertFps = argument("assert-fps", 0);
const maxDropped = argument("max-dropped", assertFps ? 1 : 100);
const frameRate = argument("fps", 60);
if (![30, 60, 120].includes(frameRate)) throw new Error("Choose --fps=30, 60 or 120");
const quality = process.argv.find(value => value.startsWith("--quality="))?.slice(10) ?? "1080p";
if (!["720p", "1080p", "original"].includes(quality)) throw new Error("Unknown capture quality");
const codec = process.argv.find(value => value.startsWith("--codec="))?.slice(8);
const hint = process.argv.find(value => value.startsWith("--hint="))?.slice(7);
const modes = (process.argv.find(value => value.startsWith("--modes="))?.slice(8) ?? "playback,controls,live").split(",");
if (modes.some(mode => !["playback", "controls", "live"].includes(mode))) throw new Error("Unknown video mode");
const media = process.env.COUCH_PERF_MEDIA;
if (!media) throw new Error("Set COUCH_PERF_MEDIA to a local video fixture");
const mediaFile = `/benchmark${extname(media)}`;
mkdirSync(directory, { recursive: true });
const entry = resolve(`src/client/__video-performance-${process.pid}.html`);
writeFileSync(entry, `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"></div><script type="module">import './index.css'; import { prepareVideo } from '../../tests/video-performance.browser'; window.prepareVideo = mode => prepareVideo(mode, ${JSON.stringify(mediaFile)}, ${frameRate}, ${JSON.stringify(quality)}, ${JSON.stringify(codec)}, ${JSON.stringify(hint)});</script></body></html>`);
try { await build(mergeConfig(config({ command: "build", mode: "production" }), { build: { outDir, rollupOptions: { input: entry } }, logLevel: "error" })); }
finally { rmSync(entry); }
copyFileSync(media, join(outDir, mediaFile));
writeFileSync(join(outDir, "source.html"), `<!doctype html><title>Couch benchmark source</title><style>html,body{margin:0;background:black}video{width:100vw;height:100vh;object-fit:fill}</style><video src="${mediaFile}" muted autoplay loop></video>`);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = resolve(outDir, "." + decodeURIComponent(new URL(request.url).pathname));
  if (!path.startsWith(outDir + "/")) return new Response(null, { status: 404 });
  const file = Bun.file(path); return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} });
const origin = `http://127.0.0.1:${server.port}`;
const probe = join(directory, "probe.cjs");
writeFileSync(probe, `
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const { writeFileSync } = require('node:fs');
app.setPath('userData', ${JSON.stringify(join(directory, "data"))});
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const window = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { backgroundThrottling: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => {
    done(new URL(request.url).origin === ${JSON.stringify(origin)} ? {} : request.resourceType === 'image' ? { redirectURL: ${JSON.stringify(origin)} + '/icons/pwa-512.png' } : { cancel: true });
  });
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  const result = { revision: ${JSON.stringify(process.env.COUCH_PERF_REVISION ?? Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim())}, versions: process.versions,
    hardware: ${JSON.stringify({ cpu: cpus()[0]?.model, logicalCores: cpus().length, os: release(), platform: process.platform })},
    display: screen.getPrimaryDisplay(), media: ${JSON.stringify(media)}, requestedFps: ${frameRate}, quality: ${JSON.stringify(quality)}, codec: ${JSON.stringify(codec)}, hint: ${JSON.stringify(hint)}, bare: ${process.argv.includes("--bare")}, seconds: ${seconds}, warmup: ${warmup}, rounds: ${rounds}, samples: [], mediaProperties: {} };
  let source, code = 0;
  try {
    await window.loadURL(${JSON.stringify(origin + "/" + entry.split("/").at(-1))});
    window.webContents.debugger.attach('1.3');
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Media.playerPropertiesChanged') {
        const properties = result.mediaProperties[params.playerId] ??= {};
        for (const property of params.properties) properties[property.name] = property.value;
      }
    });
    await window.webContents.debugger.sendCommand('Media.enable');
    for (let round = 0; round < ${rounds}; round++) {
      const modes = ${JSON.stringify(modes)};
      if (round % 2) modes.reverse();
      for (const mode of modes) {
        console.log('Preparing ' + mode);
        if (mode === 'live') {
          source = new BrowserWindow({ width: 1920, height: 1080, x: 0, y: 0, frame: false, show: true, webPreferences: { backgroundThrottling: false } });
          await source.loadURL(${JSON.stringify(origin + "/source.html")});
          const sources = await desktopCapturer.getSources({ types: ${JSON.stringify(process.argv.includes("--screen") ? ["screen"] : ["window", "screen"])}, thumbnailSize: { width: 0, height: 0 } });
          const selected = sources.find(item => item.id === source.getMediaSourceId()) ?? sources.find(item => item.id.startsWith('screen:'));
          if (!selected) throw new Error('No desktop capture source');
          result.captureSource = { id: selected.id, name: selected.name, window: selected.id === source.getMediaSourceId() };
          window.webContents.session.setDisplayMediaRequestHandler((_request, callback) => callback({ video: selected }));
        }
        await window.loadURL(${JSON.stringify(origin + "/" + entry.split("/").at(-1))});
        window.focus();
        await evaluate('window.prepareVideo(' + JSON.stringify(mode) + ').then(fixture => { window.fixture = fixture; })');
        if (${process.argv.includes("--bare")}) await evaluate("(() => { const parent = document.createElement('div'); parent.style.cssText = 'position:fixed;inset:0;background:black'; document.body.append(parent); parent.append(document.querySelector('.player-video video')); document.getElementById('fixture').style.display = 'none'; })()");
        await wait(${warmup} * 1000);
        const timeline = mode === 'controls' ? await evaluate("(() => { document.querySelector('[data-player-surface]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); const box = document.querySelector('.player-timeline').getBoundingClientRect(); return { x: box.x, y: box.y + box.height / 2, width: box.width }; })()") : null;
        await evaluate('window.fixture.begin()');
        let before = new Map(app.getAppMetrics().map(item => [item.pid, item.cpu.cumulativeCPUUsage])), at = performance.now();
        const cpu = [];
        for (let second = 0; second < ${seconds}; second++) {
          if (mode === 'controls') {
            // Native pointer events exercise the actual wake/hover/preview path while decoding.
            for (let step = 0; step < 60; step++) {
              window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(timeline.x + timeline.width * (.05 + .9 * ((second * 60 + step) % 240) / 240)), y: Math.round(timeline.y) });
              await wait(1000 / 60);
            }
          } else await wait(1000);
          const now = performance.now(), metrics = app.getAppMetrics();
          cpu.push(metrics.map(item => ({ type: item.type, name: item.name, pid: item.pid, percent: before.has(item.pid) ? (item.cpu.cumulativeCPUUsage - before.get(item.pid)) * 100000 / (now - at) : null })));
          before = new Map(metrics.map(item => [item.pid, item.cpu.cumulativeCPUUsage])); at = now;
        }
        const sample = { round, receiverPid: window.webContents.getOSProcessId(), sourcePid: source?.webContents.getOSProcessId(), ...await evaluate('window.fixture.finish()'), cpu };
        result.samples.push(sample);
        console.log(JSON.stringify({ round, mode, videoFps: sample.videoFps, uiFps: sample.uiFps, frameMs: sample.frameMs, droppedPercent: sample.droppedPercent,
          cpuPercent: cpu.reduce((sum, items) => sum + items.reduce((sum, item) => sum + (item.percent ?? 0), 0), 0) / cpu.length, capture: sample.after.capture, errors: sample.errors }));
        if (sample.errors.length || sample.after.error || sample.after.paused || sample.totalFrames <= 0 || sample.droppedPercent > ${maxDropped} || (${assertFps} && sample.videoFps < ${assertFps})) code = 1;
        writeFileSync(${JSON.stringify(join(directory, "result.json"))}, JSON.stringify(result, null, 2));
        if (source) { source.destroy(); source = undefined; }
      }
    }
    result.gpu = app.getGPUFeatureStatus(); result.gpuInfo = await app.getGPUInfo('complete').catch(error => ({ unavailable: String(error) }));
  } catch (error) { result.error = String(error.stack || error); console.error(error); code = 1; }
  writeFileSync(${JSON.stringify(join(directory, "result.json"))}, JSON.stringify(result, null, 2));
  app.exit(code);
});
`);
const env = { ...process.env, COUCH_DATA_DIR: join(directory, "data"), COUCH_PORT: String(server.port) };
delete env.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn([electron, probe], { env, stdout: "inherit", stderr: "inherit" });
const timeout = setTimeout(() => { console.error("Video benchmark timed out"); child.kill(); }, 60_000 + rounds * modes.length * (warmup + seconds + 20) * 1000);
try { process.exitCode = await child.exited; console.log(`Evidence: ${join(directory, "result.json")}`); }
finally { clearTimeout(timeout); server.stop(true); }
