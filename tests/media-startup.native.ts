// COUCH_TEST_FFMPEG=/path/to/ffmpeg xvfb-run -a bun tests/media-startup.native.ts .artifacts/media-startup/baseline --rounds=3 --delay=200
// Measures resolved-media-to-first-frame, excluding provider extraction. No external traffic.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { build, mergeConfig } from "vite";
import electron from "electron";
import config from "../vite.config";
import { createPassThrough } from "../src/server/pass-through";
import { parseMedia } from "../src/server/web-media";

const directory = resolve(process.argv[2] ?? ".artifacts/media-startup/run");
const argument = (key: string, fallback: number) => Number(process.argv.find(arg => arg.startsWith(`--${key}=`))?.split("=")[1] ?? fallback);
const rounds = argument("rounds", 3), delay = argument("delay", 200), budget = argument("assert-first-frame", 0);
const mediaDir = resolve(".artifacts/media-startup/media"), outDir = join(directory, "dist");
mkdirSync(mediaDir, { recursive: true }); mkdirSync(directory, { recursive: true });
const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
async function generate(args: string[]) {
  const child = Bun.spawn([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "inherit", stderr: "inherit" });
  if (await child.exited) throw new Error("Could not generate startup fixtures");
}
if (!await Bun.file(join(mediaDir, "movie.mp4")).exists()) {
  await generate(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "12", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-g", "60", "-c:a", "aac", "-movflags", "+faststart", join(mediaDir, "movie.mp4")]);
  await generate(["-i", join(mediaDir, "movie.mp4"), "-an", "-c:v", "copy", "-movflags", "+faststart", join(mediaDir, "video.mp4")]);
  await generate(["-i", join(mediaDir, "movie.mp4"), "-vn", "-c:a", "copy", join(mediaDir, "audio.m4a")]);
  await generate(["-i", join(mediaDir, "movie.mp4"), "-c", "copy", "-hls_time", "2", "-hls_playlist_type", "vod", join(mediaDir, "movie.m3u8")]);
}
const entry = resolve(`src/client/__media-startup-${process.pid}.html`);
writeFileSync(entry, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:black;width:100vw;height:100vh"><script type="module">import { measureMediaStartup } from "../../tests/media-startup.browser"; window.measureMediaStartup = measureMediaStartup;</script></body></html>');
try { await build(mergeConfig(config({ command: "build", mode: "production" }), { build: { outDir, rollupOptions: { input: entry } }, logLevel: "error" })); }
finally { rmSync(entry); }
let requests = 0, playbackId = "";
const relay = createPassThrough(id => id === playbackId, (async (input, init) => {
  requests++;
  await new Promise(resolve => setTimeout(resolve, delay));
  init?.signal?.throwIfAborted();
  const name = new URL(String(input)).pathname.slice(1);
  const file = Bun.file(join(mediaDir, name === "playlist" ? "movie.m3u8" : name));
  if (!await file.exists()) return new Response(null, { status: 404 });
  const type = name === "playlist" || name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : name.endsWith(".ts") ? "video/mp2t" : "video/mp4";
  const range = /^bytes=(\d+)-(\d*)$/.exec(new Headers(init?.headers).get("range") ?? "");
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  let response: Response;
  if (range) {
    const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : file.size - 1, file.size - 1);
    response = start > end ? new Response(null, { status: 416 }) : new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) } });
  } else response = new Response(file, { headers });
  Object.defineProperty(response, "url", { value: String(input) });
  return response;
}) as typeof fetch);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/relay/")) return relay.serve(request);
  if (url.pathname === "/load") {
    const mode = url.searchParams.get("mode");
    const info = mode === "split" ? { requested_formats: [
      { url: "https://media.example/video.mp4", protocol: "https", vcodec: "h264", acodec: "none" },
      { url: "https://media.example/audio.m4a", protocol: "https", vcodec: "none", acodec: "aac" },
    ] } : { url: `https://media.example/${mode === "hls" ? "playlist" : "movie.mp4"}`, protocol: mode === "hls" ? "m3u8_native" : "https", vcodec: "h264", acodec: "aac" };
    const media = { ...parseMedia(info, ""), publicNetwork: true };
    playbackId = crypto.randomUUID();
    const before = requests, at = performance.now();
    await relay.prepare(playbackId, media, {}, { origin: "http://127.0.0.1:42000", userAgent: "Couch" }, request.signal);
    const prepared = await relay.prepare(playbackId, media, {}, { origin: url.origin, userAgent: "Chromium" }, request.signal);
    return Response.json({ command: { type: "load", playbackId, ...prepared, preview: undefined }, prepareMs: performance.now() - at, upstreamRequests: requests - before });
  }
  const path = resolve(outDir, "." + url.pathname);
  const file = Bun.file(path);
  return path.startsWith(outDir + sep) && await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} });
const origin = `http://127.0.0.1:${server.port}`, probe = join(directory, "probe.cjs");
writeFileSync(probe, `
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
app.setPath('userData', ${JSON.stringify(join(directory, "data"))});
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1280, height: 720, show: true, webPreferences: { backgroundThrottling: false } });
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => done({ cancel: new URL(request.url).origin !== ${JSON.stringify(origin)} }));
  const result = { revision: ${JSON.stringify(Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim())}, versions: process.versions, delayMs: ${delay}, samples: [] };
  let code = 0;
  try {
    for (let round = 0; round < ${rounds}; round++) for (const mode of (round % 2 ? ['hls', 'split', 'mp4'] : ['mp4', 'split', 'hls'])) {
      await window.webContents.session.clearCache();
      await window.loadURL(${JSON.stringify(origin + "/" + basename(entry))});
      const sample = { round, ...await window.webContents.executeJavaScript('window.measureMediaStartup(' + JSON.stringify(mode) + ')', true) };
      result.samples.push(sample); console.log(JSON.stringify(sample));
      if (sample.width !== 1280 || sample.height !== 720 || sample.totalFrames < 5 || (${budget} && sample.firstFrameMs > ${budget})) code = 1;
    }
  } catch (error) { result.error = String(error.stack || error); console.error(result.error); code = 1; }
  result.gpu = app.getGPUFeatureStatus();
  writeFileSync(${JSON.stringify(join(directory, "result.json"))}, JSON.stringify(result, null, 2)); app.exit(code);
});
`);
const env = { ...process.env, COUCH_DATA_DIR: join(directory, "data"), COUCH_PORT: String(server.port) };
delete env.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn([electron, probe], { env, stdout: "inherit", stderr: "inherit" });
const timeout = setTimeout(() => child.kill(), 30_000 + rounds * 3 * 20_000);
try { process.exitCode = await child.exited; }
finally { clearTimeout(timeout); server.stop(true); await relay.close(); }
