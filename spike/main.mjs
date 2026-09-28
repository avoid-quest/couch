// Ticket 1 spike (#644): plays each source in a plain Chromium <video>/<audio> inside Electron and records
// the decoder Chromium chose, Electron's CPU and dropped frames. Ticket 3 absorbs or deletes this folder.
// Usage: bunx electron spike/main.mjs <sources.json from spike/resolve.ts> <out dir> [seconds=60] [name filter]
import { app, BrowserWindow, session } from "electron";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [sourcesPath, outDir, seconds = "60", filter = ""] = process.argv.slice(2);
const port = 4711;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Live MPEG-TS test channels with the codec pairs DVB IPTV carries (HD: H.264/HEVC, SD: MPEG-2).
const encoders = {
  h264: ["-s", "1920x1080", "-r", "25", "-c:v", "h264_videotoolbox", "-b:v", "6M", "-g", "50"],
  hevc: ["-s", "1920x1080", "-r", "25", "-c:v", "hevc_videotoolbox", "-b:v", "4M", "-g", "50"],
  mpeg2: ["-s", "720x576", "-r", "25", "-c:v", "mpeg2video", "-b:v", "4M", "-g", "12"],
  aac: ["-c:a", "aac", "-b:a", "128k"], mp2: ["-c:a", "mp2", "-b:a", "192k"], ac3: ["-c:a", "ac3", "-b:a", "192k"],
};
const files = { "/player.html": "spike/player.html", "/hls.js": "node_modules/hls.js/dist/hls.min.js", "/mpegts.js": "node_modules/mpegts.js/dist/mpegts.js" };
const server = createServer((request, response) => {
  const ts = /^\/ts\/(\w+)-(\w+)$/.exec(request.url);
  if (ts) {
    const ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      ...encoders[ts[1]], ...encoders[ts[2]], "-f", "mpegts", "pipe:1"], { stdio: ["ignore", "pipe", "inherit"] });
    response.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
    ffmpeg.stdout.pipe(response);
    response.on("close", () => ffmpeg.kill("SIGKILL"));
    return;
  }
  if (!files[request.url]) return response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": request.url.endsWith(".html") ? "text/html" : "text/javascript" });
  createReadStream(join(root, files[request.url])).pipe(response);
});

// Record failed requests, and add a CORS header for sources that ask for it (googlevideo answers CORS only for youtube.com).
let current = { failed: [], cors: false };
function watchRequests() {
  const web = session.defaultSession.webRequest;
  web.onHeadersReceived((details, callback) => {
    if (details.statusCode >= 400) current.failed.push(`${details.statusCode} ${details.method} ${details.url.slice(0, 120)}`);
    callback(current.cors ? { responseHeaders: { ...details.responseHeaders, "access-control-allow-origin": ["*"] } } : {});
  });
  web.onErrorOccurred(details => { if (details.error !== "net::ERR_ABORTED") current.failed.push(`${details.error} ${details.url.slice(0, 120)}`); });
}

function cpuSeconds() {
  const byType = {};
  for (const metric of app.getAppMetrics()) {
    const key = metric.type === "Utility" ? `Utility:${metric.serviceName ?? metric.name}` : metric.type;
    byType[key] = (byType[key] ?? 0) + (metric.cpu.cumulativeCPUUsage ?? 0);
  }
  return byType;
}

async function run(win, source, window) {
  const players = new Map();
  const debug = win.webContents.debugger;
  const onMessage = (_event, method, params) => {
    const player = players.get(params.playerId) ?? { properties: {}, errors: [], messages: [] };
    players.set(params.playerId, player);
    if (method === "Media.playerPropertiesChanged") for (const { name, value } of params.properties) player.properties[name] = value;
    if (method === "Media.playerErrorsRaised") player.errors.push(...params.errors.map(error => `${error.errorType} ${error.code} ${JSON.stringify(error.data ?? {})}`.slice(0, 300)));
    if (method === "Media.playerMessagesLogged") player.messages.push(...params.messages.filter(message => message.level === "error").map(message => message.message.slice(0, 300)));
  };
  debug.on("message", onMessage);
  // Twitch playlists answer 403 to any Origin but twitch.tv and localhost, so a source can ask for a localhost page.
  await win.loadURL(`http://${source.host ?? "127.0.0.1"}:${port}/player.html`);
  await debug.sendCommand("Media.enable");
  current = { failed: [], cors: !!source.cors };
  const result = { name: source.name, note: source.note, delivery: source.delivery, cors: source.cors };
  try {
    const started = await win.webContents.executeJavaScript(`play(${JSON.stringify(source)})`);
    Object.assign(result, started);
    if (started.error) throw new Error(started.error);
    await sleep(5000);
    const cpuBefore = cpuSeconds();
    const before = await win.webContents.executeJavaScript("stats()");
    const at = performance.now();
    await sleep(window * 1000);
    const cpuAfter = cpuSeconds();
    const after = await win.webContents.executeJavaScript("stats()");
    const elapsed = (performance.now() - at) / 1000;
    result.cpuPercentOfOneCore = Object.fromEntries(Object.keys(cpuAfter).map(type => [type, Math.round((cpuAfter[type] - (cpuBefore[type] ?? 0)) / elapsed * 1000) / 10]));
    result.cpuPercentOfOneCore.total = Math.round(Object.values(result.cpuPercentOfOneCore).reduce((sum, value) => sum + value, 0) * 10) / 10;
    result.window = Math.round(elapsed);
    result.advanced = Math.round((after.currentTime - before.currentTime) * 10) / 10;
    result.size = `${after.videoWidth}x${after.videoHeight}`;
    result.error = after.error;
    result.visibility = after.visibility;
    result.pageLog = after.log;
    if (after.quality) {
      const frames = after.quality.totalVideoFrames - before.quality.totalVideoFrames;
      result.frames = { total: frames, dropped: after.quality.droppedVideoFrames - before.quality.droppedVideoFrames, fps: Math.round(frames / elapsed * 10) / 10, droppedSinceStart: after.quality.droppedVideoFrames, totalSinceStart: after.quality.totalVideoFrames };
    }
    if (source.kind === "video") await win.webContents.capturePage().then(image => writeFile(join(outDir, `${source.name.replace(/\W+/g, "-")}.png`), image.toPNG())).catch(error => { result.screenshotError = error.message; });
    result.plays = result.advanced >= window * 0.8 && !after.error && (source.kind === "audio" || after.videoWidth > 0 && result.frames.total > 0);
  } catch (error) {
    result.plays = false;
    result.error = error.message;
    result.pageLog = await win.webContents.executeJavaScript("stats().log").catch(() => []);
  }
  debug.removeListener("message", onMessage);
  result.players = [...players.values()].filter(player => Object.keys(player.properties).length).map(({ properties: p, errors, messages }) => ({
    videoDecoder: p.kVideoDecoderName, platformVideoDecoder: p.kIsPlatformVideoDecoder, audioDecoder: p.kAudioDecoderName, platformAudioDecoder: p.kIsPlatformAudioDecoder,
    videoTracks: p.kVideoTracks, audioTracks: p.kAudioTracks, errors, messages: messages.slice(0, 5),
  }));
  // Every video source here carries sound, so a picture without an audio decoder does not count as playing.
  if (source.kind === "video" && !result.players.some(player => player.audioDecoder)) result.plays = false;
  result.failedRequests = current.failed.slice(0, 10);
  return result;
}

app.whenReady().then(async () => {
  await mkdir(outDir, { recursive: true });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  watchRequests();
  const win = new BrowserWindow({ width: 1280, height: 720, webPreferences: { autoplayPolicy: "no-user-gesture-required", backgroundThrottling: false } });
  // A covered window or one on another Space reports hidden and renders a few fps, so keep the player on top everywhere while measuring.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.webContents.debugger.attach("1.3");
  await win.loadURL(`http://127.0.0.1:${port}/player.html`);
  const environment = { versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8 }, gpuFeatureStatus: app.getGPUFeatureStatus(),
    support: await win.webContents.executeJavaScript("support()"), platform: `${process.platform} ${process.arch}` };
  await writeFile(join(outDir, "environment.json"), JSON.stringify(environment, null, 2));
  const results = [];
  for (const source of JSON.parse(await readFile(sourcesPath, "utf8")).filter(source => source.name.includes(filter))) {
    const result = source.url ? await run(win, source, Number(seconds)) : { name: source.name, plays: false, error: source.note };
    console.log(JSON.stringify({ name: result.name, plays: result.plays, error: result.error, size: result.size, frames: result.frames, cpu: result.cpuPercentOfOneCore?.total, decoder: result.players?.map(p => [p.videoDecoder, p.audioDecoder]) }));
    results.push(result);
    await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  }
  server.close();
  app.quit();
});
