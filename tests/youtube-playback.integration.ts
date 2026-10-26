// Run with Node (Bun bundles the TS):
// bun build tests/youtube-playback.integration.ts --target=node --outfile=build/youtube-playback.integration.mjs
// COUCH_TEST_YT_DLP=/absolute/path/to/yt-dlp node --test build/youtube-playback.integration.mjs
// Use the executable from yt-dlp's platform zip, as Couch's helper manager does.
// The real format-selection cases explicitly skip without that optional executable.
// Helper discovery is stubbed; selection uses real yt-dlp --load-info-json, with no website requests.
import assert from "node:assert/strict";
import { test } from "node:test";
import cp from "node:child_process";
import dns from "node:dns";
import { isIP } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createPublicMediaProxy } from "../src/server/public-media-proxy";
import type { VideoQuality } from "../src/shared/protocol";

type Format = Record<string, unknown>;
const video = (id: string, width?: number, height?: number, vcodec = "avc1.640028", extra: Format = {}): Format => ({
  format_id: id, url: `https://media.example/${id}.mp4`, ext: "mp4", protocol: "https", vcodec, acodec: "none", width, height, fps: 30, ...extra,
});
const aac: Format = { format_id: "aac", url: "https://media.example/aac.m4a", ext: "m4a", protocol: "https", vcodec: "none", acodec: "mp4a.40.2", abr: 128 };
const opus: Format = { ...aac, format_id: "opus", url: "https://media.example/opus.webm", ext: "webm", acodec: "opus", abr: 160 };
const unavailable = "This website offers no format Couch can play yet.";

test("YouTube playback selection and safe extraction errors", async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-youtube-playback-"));
  const root = join(directory, "helpers"), fixture = join(directory, "info.json");
  const originalEnv = { PATH: process.env.PATH, COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, SSL_CERT_FILE: process.env.SSL_CERT_FILE };
  const executable = process.env.COUCH_TEST_YT_DLP;
  const spawn = cp.spawn, execFile = cp.execFile, lookup = dns.lookup;
  let stderr: string | undefined;
  let extractions = 0, lookups = 0;
  let downloadProxy: string | undefined;
  const children: ReturnType<typeof cp.spawn>[] = [];
  const probes = new Map<string, string>();
  for (const [name, version] of [["yt-dlp", "2026.10.21"], ["qjs", "0.17.0"], ["ffmpeg", "ffmpeg version 9.0.2"]]) {
    const dir = join(root, name!, "fixture");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "helper");
    writeFileSync(path, "Fixture helper; execution is intercepted by the test.\n", { mode: 0o755 });
    probes.set(path, version!);
  }
  process.env.PATH = "";
  process.env.COUCH_DATA_DIR = directory;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline test"); });
  t.mock.method(dns, "lookup", (...args: Parameters<typeof dns.lookup>) => {
    if (isIP(args[0])) return lookup(...args);
    lookups++; throw new Error("Offline test forbids DNS");
  });
  t.mock.method(cp, "execFile", (file: string, args: string[], options: object, callback: (...args: unknown[]) => void) => {
    const version = probes.get(file);
    return version ? execFile(process.execPath, ["-e", `console.log(${JSON.stringify(version)})`], options, callback) : execFile(file, args, options, callback);
  });
  t.mock.method(cp, "spawn", (file: string, args: string[], options: cp.SpawnOptions) => {
    if (!probes.has(file)) return spawn(file, args, options);
    assert.ok(args.includes("--proxy"), "real protected proxy remains configured");
    let child: ReturnType<typeof cp.spawn>;
    if (stderr !== undefined) child = spawn(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = 1;`], options);
    else {
      assert.ok(executable, "COUCH_TEST_YT_DLP is required for real selection");
      const host = new URL(args.at(-1)!).hostname;
      assert.equal(args.includes("--check-formats"), host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"), "downloadability checks apply only to YouTube");
      extractions++;
      // Sorting fixtures have no media server. The downloadability cases below keep
      // the production check and use the real proxy with its controlled local fixture.
      const selection = args.slice(0, args.indexOf("--")).filter(arg => downloadProxy || arg !== "--check-formats");
      if (downloadProxy) selection[selection.indexOf("--proxy") + 1] = downloadProxy;
      child = spawn(executable, [...selection, "--load-info-json", fixture], options);
    }
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    t.mock.restoreAll();
    syncBuiltinESMExports();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const { startHelpers, helper } = await import("../src/server/helpers");
  const { createWebMediaResolver } = await import("../src/server/web-media");
  const { runYtDlp, ExtractionError } = await import("../src/server/yt-dlp");
  startHelpers(root);
  await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  const resolve = createWebMediaResolver();
  const select = (formats: Format[], quality: VideoQuality = "auto", vp9 = false, url = "https://www.youtube.com/watch?v=fixture") => {
    writeFileSync(fixture, JSON.stringify({
      id: "fixture", title: "Offline format selection", extractor: "youtube", extractor_key: "Youtube", webpage_url: url, formats,
      subtitles: { en: [{ url: "https://media.example/en.vtt", ext: "vtt" }], it: [{ url: "https://media.example/it.vtt", ext: "vtt" }] },
      automatic_captions: { de: [{ url: "https://media.example/automatic.vtt", ext: "vtt" }] },
    }));
    return resolve(url, undefined, quality, undefined, vp9, "it");
  };
  const noFormat = (pending: ReturnType<typeof select>) => assert.rejects(pending, error => error instanceof ExtractionError && error.message === unavailable);
  const real = { skip: !executable && "Set COUCH_TEST_YT_DLP to run the real offline selector" };
  const qualities = [["480p", 480], ["720p", 720], ["1080p", 1080], ["auto", 1080], ["best", 2160]] as const;
  for (const portrait of [false, true]) for (const vp9 of [false, true]) for (const [quality, cap] of qualities) {
    await t.test(`${portrait ? "portrait" : "landscape"} ${quality}, vp9=${vp9}`, real, async () => {
      const formats = [240, 360, 480, 720, 1080, 2160].flatMap(size => {
        const [width, height] = portrait ? [size, Math.round(size * 16 / 9)] : [Math.round(size * 16 / 9), size];
        return [video(`vp9-${size}`, width, height, "vp9", { fps: 60 }), ...(size <= 1080 ? [video(`h264-${size}`, width, height)] : [])];
      });
      const media = await select([...formats, aac, opus], quality, vp9);
      assert.equal(new URL(media.source).pathname, `/${vp9 ? "vp9" : "h264"}-${vp9 ? cap : Math.min(cap, 1080)}.mp4`);
      assert.equal(new URL(media.audioSource!).pathname, vp9 ? "/opus.webm" : "/aac.m4a");
      assert.equal(media.publicNetwork, true);
      assert.deepEqual(media.subtitles?.map(track => track.language), ["it", "en"]);
    });
  }
  for (const [name, formats] of [
    ["VP9 only", [video("vp9", 1920, 1080, "vp9"), aac]],
    ["AV1 only", [video("av1", 1920, 1080, "av01.0.08M.08"), aac]],
    ["Opus only", [video("h264", 1920, 1080), opus]],
    ["incompatible combined audio", [video("muxed-opus", 854, 480, "avc1.4d401e", { acodec: "opus" }), aac]],
    ["unknown video codec", [video("unknown", 854, 480, "unknown"), aac]],
    ["unknown audio codec", [video("h264", 854, 480), { ...aac, acodec: "unknown" }]],
    ["DASH only", [video("dash", 854, 480, "avc1.4d401e", { protocol: "http_dash_segments" }), aac]],
  ] as const) await t.test(`no incompatible fallback: ${name}`, real, () => noFormat(select([...formats], "best")));
  await t.test("compatible progressive fallback when separate AAC is absent", real, async () => {
    const media = await select([video("h264", 1920, 1080), video("progressive", 854, 480, "h264", { acodec: "aac" }), opus], "best");
    assert.equal(new URL(media.source).pathname, "/progressive.mp4");
    assert.equal(media.audioSource, undefined);
  });
  await t.test("low-resolution-only video falls back below the requested cap", real, async () => {
    assert.equal(new URL((await select([video("low", 320, 240), aac], "1080p")).source).pathname, "/low.mp4");
  });
  for (const quality of ["480p", "720p", "1080p", "auto"] as const) await t.test(`above-cap-only video stays unavailable at ${quality}`, real, () => noFormat(select([video("large", 3840, 2160), aac], quality)));
  for (const [width, height] of [[undefined, undefined], [640, undefined], [undefined, 360]]) await t.test(`missing dimensions ${width}x${height} remain playable`, real, async () => {
    assert.equal(new URL((await select([video("unknown-size", width, height), aac])).source).pathname, "/unknown-size.mp4");
  });
  for (const [width, height] of [[1920, undefined], [undefined, 1920]]) await t.test(`one known dimension ${width}x${height} still enforces Auto's cap`, real, () => noFormat(select([video("partly-known", width, height), aac])));
  await t.test("known under-cap video outranks unknown dimensions", real, async () => {
    assert.equal(new URL((await select([video("known", 854, 480), video("unknown", undefined, undefined), aac], "480p")).source).pathname, "/known.mp4");
  });
  await t.test("no formats fails with a fixed public error", real, async () => {
    await assert.rejects(select([]), error => error instanceof ExtractionError && !error.message.includes("media.example"));
  });
  await t.test("audio-only source retains AAC and rejects Opus-only on non-VP9 Devices", real, async () => {
    const media = await select([aac, opus]);
    assert.equal(media.audioOnly, true);
    assert.equal(new URL(media.source).pathname, "/aac.m4a");
    await noFormat(select([opus]));
  });
  await t.test("HLS video and audio from one master still collapse to that master", real, async () => {
    const hls = { protocol: "m3u8_native", manifest_url: "https://media.example/master.m3u8" };
    const media = await select([video("hls", 854, 480, "avc1.4d401e", hls), { ...aac, ...hls }], "480p");
    assert.equal(media.source, hls.manifest_url);
    assert.equal(media.audioSource, undefined);
    assert.deepEqual(media.subtitles?.map(track => track.language), ["it", "en"]);
    assert.equal(media.publicNetwork, true);
  });
  await t.test("non-VP9 YouTube uses HLS picture and original audio instead of DASH MP4 files", real, async () => {
    const hls = { protocol: "m3u8_native", manifest_url: "https://media.example/master.m3u8" };
    const formats = [
      video("h264-http", 1920, 1080, "avc1.64002a", { fps: 60, container: "mp4_dash" }),
      video("vp9-http", 1920, 1080, "vp9", { fps: 60 }),
      { ...aac, container: "m4a_dash", language: "it", language_preference: 10 }, { ...opus, language: "it", language_preference: 10 },
      video("h264-hls", 1920, 1080, "avc1.64002a", { ...hls, fps: 60 }),
      // Real YouTube HLS audio omits acodec; its master lists the dub first.
      { ...aac, ...hls, format_id: "aac-hls", url: "https://media.example/it.m3u8", acodec: undefined, language: "it", language_preference: 10 },
      { ...aac, ...hls, format_id: "dub-hls", url: "https://media.example/en.m3u8", acodec: undefined, language: "en", language_preference: 5 },
      { ...aac, format_id: "dub", url: "https://media.example/dub.m4a", language: "en", language_preference: 5 },
    ];
    const native = await select(formats);
    assert.equal(native.source, hls.manifest_url);
    assert.equal(native.audioSource, undefined);
    assert.deepEqual(native.hlsSelection, { video: "https://media.example/h264-hls.mp4", audio: "https://media.example/it.m3u8", bandwidth: 128000 });
    assert.deepEqual(native.subtitles?.map(track => track.language), ["it", "en"]);
    const chromium = await select(formats, "auto", true);
    assert.equal(new URL(chromium.source).pathname, "/vp9-http.mp4");
    assert.equal(new URL(chromium.audioSource!).pathname, "/opus.webm");
  });
  await t.test("known incompatible HLS audio stays unavailable on non-VP9 Devices", real, async () => {
    await noFormat(select([video("hls", 1920, 1080, "avc1.64002a", { protocol: "m3u8_native" }), { ...opus, protocol: "m3u8_native" }]));
  });
  await t.test("non-VP9 YouTube rejects DASH MP4 video but still plays DASH AAC audio", real, async () => {
    await noFormat(select([video("dash-mp4", 1920, 1080, "avc1.64002a", { container: "mp4_dash" }), aac]));
    const media = await select([{ ...aac, container: "m4a_dash" }]);
    assert.equal(media.audioOnly, true);
  });
  await t.test("native YouTube keeps quality caps when HLS and progressive formats differ", real, async () => {
    const hls = video("hls-720", 1280, 720, "avc1.64001f", { protocol: "m3u8_native" });
    const dash = video("dash-1080", 1920, 1080, "avc1.64002a", { container: "mp4_dash" });
    const progressive = video("progressive-480", 854, 480, "avc1.4d401e", { acodec: "mp4a.40.2" });
    assert.equal(new URL((await select([hls, dash, aac])).source).pathname, "/hls-720.mp4");
    assert.equal(new URL((await select([hls, dash, progressive, aac], "480p")).source).pathname, "/progressive-480.mp4");
    assert.equal(new URL((await select([video("portrait-hls", 1080, 1920, "avc1.64002a", { protocol: "m3u8_native" }), aac])).source).pathname, "/portrait-hls.mp4");
  });
  await t.test("non-YouTube selection keeps its existing height cap and codecs", real, async () => {
    const media = await select([video("small", 240, 426, "vp9"), video("large", 480, 854, "vp9"), opus], "480p", false, "https://www.dailymotion.com/video/fixture");
    assert.equal(new URL(media.source).pathname, "/small.mp4");
  });
  await t.test("YouTube skips a refused advertised format and rejects an entirely refused selection", real, async () => {
    const contacts: string[] = [];
    let stalled = false;
    const upstream = createServer((request, response) => {
      contacts.push(request.url!);
      if (stalled) return;
      if (request.url === "/refused.mp4") { response.writeHead(403); response.end(); }
      else { response.writeHead(200, { "Content-Length": "1024" }); response.end(Buffer.alloc(1024)); }
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    const port = (upstream.address() as import("node:net").AddressInfo).port;
    const proxy = await createPublicMediaProxy(new AbortController().signal, undefined, async hostname => {
      assert.equal(hostname, "media.example");
      return [{ address: "127.0.0.1", family: 4 }];
    });
    downloadProxy = proxy.url;
    const address = (path: string) => ({ url: `http://media.example:${port}/${path}`, protocol: "http" });
    const refused = video("refused", 1920, 1080, "avc1.640028", address("refused.mp4"));
    const available = video("available", 1280, 720, "avc1.640028", address("available.mp4"));
    const audio = { ...aac, ...address("aac.m4a") };
    try {
      const media = await select([refused, available, audio]);
      assert.equal(new URL(media.source).pathname, "/available.mp4");
      assert.ok(contacts.includes("/refused.mp4"));
      assert.ok(contacts.includes("/available.mp4"));
      await noFormat(select([refused, audio]));
      const checked = contacts.length;
      stalled = true;
      const started = performance.now();
      await assert.rejects(createWebMediaResolver({ timeoutMs: 2000 })("https://www.youtube.com/watch?v=fixture"), error => error instanceof ExtractionError && error.message === "The website took too long to respond. Try again.");
      assert.ok(contacts.length > checked, "the deadline interrupted an actual format check");
      assert.ok(performance.now() - started < 5000, "format checks remain inside the extraction deadline");
      assert.equal(children.at(-1)!.killed, true, "the deadline kills the stalled extractor");
    } finally {
      downloadProxy = undefined;
      await proxy.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });
  for (const [upstream, expected] of [
    ["This live stream recording is not available.", "This video is unavailable or was removed."],
    ["Video unavailable", "This video is unavailable or was removed."],
    ["This live event is offline", "This live stream is offline or has not started yet."],
    ["Requested format is not available", unavailable],
    ["Sign in to confirm your age", "This website requires an account or browser session. Website sign-in is not supported yet."],
    ["This video is not available in your country", "This isn't available in your region."],
    ["unexpected extraction error", "Couldn't open this page. It may be unsupported."],
  ]) await t.test(`fixed error: ${upstream}`, async () => {
    stderr = `ERROR: [youtube] fixture: ${upstream}\nhttps://media.example/stream?signature=PRIVATE`;
    await assert.rejects(runYtDlp(["--", "https://www.youtube.com/watch?v=fixture"]), error => error instanceof ExtractionError && error.message === expected);
  });
  assert.equal(lookups, 0, "offline fixtures must make no outbound DNS requests");
  if (executable) assert.ok(extractions >= 40, "selection must run the actual executable");
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), "all owned helpers exited");
});
