// bun tests/compressor.native.ts .artifacts/compressor [--serve] [--warmup=30] [--seconds=60] [--rounds=3]
// Production UI and the actual renderer/DSP; no installed Couch or Core is started.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { build, mergeConfig } from "vite";
import electron from "electron";
import config from "../vite.config";
const directory = resolve(process.argv[2] ?? ".artifacts/compressor"), outDir = join(directory, "dist");
const argument = (name: string, fallback: number) => Number(process.argv.find(value => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const warmup = argument("warmup", 30), seconds = argument("seconds", 60), rounds = argument("rounds", 3);
const media = process.env.COUCH_PERF_MEDIA, mediaFile = media ? `/benchmark${extname(media)}` : "/tone.wav", tv = process.argv.includes("--tv");
const modes = (process.argv.find(value => value.startsWith("--modes="))?.slice(8) ?? "none,bypass,enabled,advanced,stress").split(",");
if (modes.some(mode => !["none", "bypass", "enabled", "advanced", "stress", "paused", "paused-native", "toggle"].includes(mode))) throw new Error("Unknown benchmark mode");
mkdirSync(directory, { recursive: true });
const entry = resolve(`src/client/__compressor-${process.pid}.html`);
writeFileSync(entry, `<!doctype html><html lang="en" class="dark" data-media="${mediaFile}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body${tv ? ' class="tv-presentation"' : ""}><div id="fixture"></div><script type="module">import './index.css'; import { runChecks, runPerformanceChecks, prepare, playbackHealth } from '../../tests/compressor.browser'; window.runChecks = runChecks; window.runPerformanceChecks = runPerformanceChecks; window.prepare = prepare; window.playbackHealth = playbackHealth;</script></body></html>`);
try { await build(mergeConfig(config({ command: "build", mode: "production" }), { define: { COUCH_TV_OVERRIDE: "true" }, build: { outDir, rollupOptions: { input: entry } }, logLevel: "error" })); }
finally { rmSync(entry); }
if (media) copyFileSync(media, join(outDir, mediaFile));
// Eight seconds of stereo, quiet/loud 997 Hz; the renderer loops it during samples.
const rate = 48000, frames = rate * 8, bytes = Buffer.alloc(44 + frames * 4);
bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 997 * i / rate) * (Math.floor(i / rate) % 2 ? .8 : .04) * 32767 / (channel + 1)), 44 + i * 4 + channel * 2);
writeFileSync(join(outDir, "tone.wav"), bytes);
const page = basename(entry);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname), path = resolve(outDir, "." + (pathname === "/" ? "/" + page : pathname));
  if (!path.startsWith(outDir + sep)) return new Response(null, { status: 404 });
  const file = Bun.file(path); return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} });
console.log(`Fixture: http://127.0.0.1:${server.port}`);
if (process.argv.includes("--serve")) await new Promise(() => {});
const probe = join(directory, "probe.cjs");
writeFileSync(probe, `
const { app, BrowserWindow, contentTracing } = require('electron');
const { writeFileSync } = require('node:fs');
app.setPath('userData', ${JSON.stringify(join(directory, "data"))});
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Match ordinary playback in app/main.ts, including the Mac output buffer.
if (process.platform === 'darwin') app.commandLine.appendSwitch('audio-buffer-size', '128');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { backgroundThrottling: false } });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evaluate = text => window.webContents.executeJavaScript(text, true);
  const result = { versions: process.versions, hardware: ${JSON.stringify({ cpu: cpus()[0]?.model, logicalCores: cpus().length, os: release(), platform: process.platform })}, fixture: ${JSON.stringify(media ?? "48 kHz stereo PCM16 WAV, alternating quiet/loud 997 Hz, no Core or network relay")}, tv: ${tv}, warmup: ${warmup}, seconds: ${seconds}, rounds: ${rounds}, samples: [] };
  result.audioBufferSize = app.commandLine.getSwitchValue('audio-buffer-size');
  let code = 0;
  try {
    await window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.port}${tv ? "/?tv=1" : ""}`)});
    if (${process.argv.includes("--perf-checks")}) result.performanceChecks = await evaluate('window.runPerformanceChecks()');
    result.checks = await evaluate('window.runChecks()');
    window.setContentSize(360, 800); await wait(100);
    result.mobile = await evaluate('window.runChecks()');
    writeFileSync(${JSON.stringify(join(directory, "mobile.png"))}, (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1280, 800); await wait(100);
    writeFileSync(${JSON.stringify(join(directory, "desktop.png"))}, (await window.webContents.capturePage()).toPNG());
    if (${process.argv.includes("--trace")}) await contentTracing.startRecording({ included_categories: ['webaudio', 'audio', 'media', 'toplevel', 'blink.user_timing'] });
    for (let round = 0; round < ${rounds}; round++) {
      const modes = ${JSON.stringify(modes)};
      if (round % 2) modes.reverse();
      for (const mode of modes) {
        const startup = await evaluate('window.prepare(' + JSON.stringify(mode) + ')');
        await wait(${warmup} * 1000);
        const warmed = await evaluate('window.playbackHealth()');
        let before = new Map(app.getAppMetrics().map(item => [item.pid, item.cpu.cumulativeCPUUsage])), at = performance.now();
        const samples = [];
        for (let second = 0; second < ${seconds}; second++) {
          await wait(1000);
          const metrics = app.getAppMetrics(), now = performance.now();
          const processes = metrics.map(item => ({ pid: item.pid, type: item.type, name: item.name, cpuPercent: before.has(item.pid) ? (item.cpu.cumulativeCPUUsage - before.get(item.pid)) * 100000 / (now - at) : null, rssKiB: item.memory.workingSetSize }));
          samples.push({ processes, totalCpuPercent: processes.reduce((sum, item) => sum + (item.cpuPercent ?? 0), 0), totalRssKiB: processes.reduce((sum, item) => sum + item.rssKiB, 0) });
          before = new Map(metrics.map(item => [item.pid, item.cpu.cumulativeCPUUsage])); at = now;
        }
        result.samples.push({ round, mode, startup, samples, warmed, playback: await evaluate('window.playbackHealth()') });
        writeFileSync(${JSON.stringify(join(directory, "result.json"))}, JSON.stringify(result, null, 2));
        console.log(JSON.stringify({ round, mode, meanCpuPercent: samples.reduce((sum, item) => sum + item.totalCpuPercent, 0) / samples.length }));
      }
    }
    result.gpu = app.getGPUFeatureStatus();
    result.summary = Object.fromEntries(${JSON.stringify(modes)}.filter(mode => result.samples.some(run => run.mode === mode)).map(mode => {
      const runs = result.samples.filter(run => run.mode === mode), samples = runs.flatMap(run => run.samples);
      const cpu = samples.map(sample => sample.totalCpuPercent).sort((a, b) => a - b);
      return [mode, { meanCpuPercent: cpu.reduce((sum, value) => sum + value, 0) / cpu.length, p95CpuPercent: cpu[Math.ceil(cpu.length * .95) - 1],
        warmupDroppedFrames: runs.reduce((sum, run) => sum + run.warmed.droppedFrames, 0),
        steadyFrames: runs.reduce((sum, run) => sum + run.playback.decodedFrames - run.warmed.decodedFrames, 0),
        steadyDroppedFrames: runs.reduce((sum, run) => sum + run.playback.droppedFrames - run.warmed.droppedFrames, 0),
        steadyAudioUnderruns: runs.every(run => run.playback.audio && run.warmed.audio) ? runs.reduce((sum, run) => sum + run.playback.audio.underrunEvents - run.warmed.audio.underrunEvents, 0) : null }];
    }));
    console.log(JSON.stringify({ summary: result.summary }));
    if (${process.argv.includes("--trace")}) await contentTracing.stopRecording(${JSON.stringify(join(directory, "trace.json"))});
  } catch (error) { result.error = String(error.stack || error); console.error(error); code = 1; }
  writeFileSync(${JSON.stringify(join(directory, "result.json"))}, JSON.stringify(result, null, 2));
  app.exit(code);
});
`);
const env = { ...process.env, COUCH_DATA_DIR: join(directory, "data"), COUCH_PORT: String(server.port) };
delete env.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn([electron, probe], { env, stdout: "inherit", stderr: "inherit" });
const timeout = setTimeout(() => child.kill(), 90000 + rounds * modes.length * (warmup + seconds + 2) * 1000);
try { process.exitCode = await child.exited; console.log(`Evidence: ${join(directory, "result.json")}`); }
finally { clearTimeout(timeout); server.stop(true); }
