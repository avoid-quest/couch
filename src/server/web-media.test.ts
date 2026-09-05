import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebMediaInspector, createWebMediaResolver } from "./web-media";

const directories: string[] = [];
const page = "https://video.example/watch?v=123";
const combined = { url: "https://cdn.example/movie.mp4?signature=private", protocol: "https", vcodec: "av1", acodec: "opus" };

async function fixture(body: string, timeoutMs = 2_000) {
  const directory = mkdtempSync(join(tmpdir(), "couch-web-media-"));
  directories.push(directory);
  const executable = join(directory, "yt-dlp");
  await Bun.write(executable, `#!${process.execPath}\n${body}\n`);
  chmodSync(executable, 0o755);
  return { directory, resolve: createWebMediaResolver({ executable, timeoutMs }), inspect: createWebMediaInspector({ executable, timeoutMs }) };
}

const output = (value: unknown) => `console.log(${JSON.stringify(JSON.stringify(value))});`;

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("uses safe argv, ignores user configuration, and resolves only selected media fields", async () => {
  const { directory, resolve } = await fixture(`await Bun.write(import.meta.dir + '/args.json', JSON.stringify(process.argv.slice(2)));\n${output({ ...combined, title: "Movie title", description: "Private metadata", http_headers: { "User-Agent": "Extractor agent", Referer: page } })}`);
  const url = "https://video.example/watch?v=$(touch%20owned)&option=--exec";
  expect(await resolve(url)).toEqual({ source: combined.url, headers: { "user-agent": "Extractor agent", referer: page }, metadata: { title: "Movie title" } });
  const args = await Bun.file(join(directory, "args.json")).json() as string[];
  expect(args.slice(-2)).toEqual(["--", url]);
  for (const option of ["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--dump-single-json", "--skip-download", "--no-cache-dir", "--no-remote-components"]) expect(args).toContain(option);
  expect(args[args.indexOf("--format") + 1]).toBe("bv*+ba/b");
  expect(args).not.toContain("--cookies-from-browser");
  if (!process.env.COUCH_DENO) expect(args).not.toContain("--js-runtimes");
});

test("caps both split and combined video formats while retaining audio and unknown-height sources", async () => {
  const { directory, resolve } = await fixture(`await Bun.write(import.meta.dir + '/args.json', JSON.stringify(process.argv.slice(2)));\n${output(combined)}`);
  for (const quality of ["1080p", "720p", "480p"] as const) {
    await resolve(page, undefined, quality);
    const args = await Bun.file(join(directory, "args.json")).json() as string[];
    const cap = quality.slice(0, -1);
    expect(args[args.indexOf("--format") + 1]).toBe(`bv*[height<=?${cap}]+ba/b[height<=?${cap}]`);
  }
  await expect(resolve(page, undefined, "--exec" as "best")).rejects.toThrow("available video quality");
});

test("returns only validated public metadata for playback and inspection", async () => {
  const metadata = { title: "The movie", thumbnail: "https://images.example/poster.jpg", duration: 123.5, live: false };
  const { resolve, inspect, directory } = await fixture(`await Bun.write(import.meta.dir + '/args.json', JSON.stringify(process.argv.slice(2)));\n${output({ ...combined, title: " The\nmovie ", thumbnail: metadata.thumbnail, duration: 123.5, is_live: false, http_headers: { Authorization: "private-secret" }, cookies: "private-cookie", description: "private-description" })}`);
  expect((await resolve(page)).metadata).toEqual(metadata);
  expect(await inspect(page)).toEqual(metadata);
  const args = await Bun.file(join(directory, "args.json")).json() as string[];
  expect(args).toContain("--skip-download");
  expect(args).toContain("--dump-single-json");
  expect(args).toContain("--ignore-no-formats-error");
  expect(args).toContain("--no-playlist");
  expect(args.slice(-2)).toEqual(["--", page]);
});

test("omits invalid optional metadata and allows previews before live streams have formats", async () => {
  for (const thumbnail of ["file:///private/poster", "https://user:secret@example.com/image", "https://example.com/image\nprivate"]) {
    const { resolve } = await fixture(output({ ...combined, title: "\u0000\n ", thumbnail, duration: -1, is_live: "yes", live_status: "unexpected" }));
    expect(await resolve(page)).toEqual({ source: combined.url });
  }
  const { inspect } = await fixture(output({ title: "Live event", live_status: "is_upcoming", duration: "123" }));
  expect(await inspect(page)).toEqual({ title: "Live event", live: false });
  const live = await fixture(output({ ...combined, title: "x".repeat(250), live_status: "is_live", duration: 0 }));
  expect((await live.resolve(page)).metadata).toEqual({ title: "x".repeat(200), duration: 0, live: true });
  const playlist = await fixture(output({ _type: "playlist", entries: [combined] }));
  await expect(playlist.inspect(page)).rejects.toThrow("specific video or track");
});

test("preserves split best-quality media with identical effective headers", async () => {
  const { resolve } = await fixture(output({ http_headers: { "User-Agent": "Extractor agent" }, requested_formats: [
    { url: "https://cdn.example/audio.webm?signature=audio", vcodec: "none", acodec: "opus", protocol: "https", http_headers: { Referer: page } },
    { url: "https://cdn.example/video.webm?signature=video", vcodec: "av1", acodec: "none", protocol: "https", http_headers: { referer: page } },
  ] }));
  expect(await resolve(page)).toEqual({ source: "https://cdn.example/video.webm?signature=video", audioSource: "https://cdn.example/audio.webm?signature=audio", headers: { "user-agent": "Extractor agent", referer: page } });
});

test("rejects a private header belonging to only one split stream in either order", async () => {
  const streams = [
    { url: "https://video.example/movie.webm", vcodec: "av1", acodec: "none", protocol: "https", http_headers: { "X-Playback-Token": "video-secret" } },
    { url: "https://audio.example/music.webm", vcodec: "none", acodec: "opus", protocol: "https" },
  ];
  for (const selected of [streams, streams.toReversed()]) {
    const { resolve } = await fixture(output({ requested_formats: selected }));
    await expect(resolve(page)).rejects.toThrow("different headers");
  }
});

test("inherits base headers before comparing the split streams", async () => {
  const { resolve } = await fixture(output({ http_headers: { "X-Playback-Token": "shared-token" }, requested_formats: [
    { url: "https://video.example/movie.webm", vcodec: "av1", acodec: "none", protocol: "https", http_headers: { "x-playback-token": "shared-token" } },
    { url: "https://audio.example/music.webm", vcodec: "none", acodec: "opus", protocol: "https" },
  ] }));
  expect(await resolve(page)).toEqual({ source: "https://video.example/movie.webm", audioSource: "https://audio.example/music.webm", headers: { "x-playback-token": "shared-token" } });
});

test("opens audio-only and HLS sources and gives DASH manifests to the native demuxer", async () => {
  for (const info of [{ url: "https://cdn.example/music.mp3", vcodec: "none", acodec: "mp3", protocol: "https" }, { url: "https://cdn.example/live.m3u8", protocol: "m3u8_native" }]) {
    const { resolve } = await fixture(output(info));
    expect(await resolve(page)).toEqual({ source: info.url });
  }
  const manifest = "https://cdn.example/manifest.mpd";
  const { resolve } = await fixture(output({ requested_formats: [
    { url: "https://cdn.example/fragments/", manifest_url: manifest, vcodec: "av1", acodec: "none", protocol: "http_dash_segments" },
    { url: "https://cdn.example/fragments/", manifest_url: manifest, vcodec: "none", acodec: "opus", protocol: "http_dash_segments" },
  ] }));
  expect(await resolve(page)).toEqual({ source: manifest });
});

test("carries DASH height limits separately from public metadata regardless of representation order", async () => {
  const manifest = "https://cdn.example/manifest.mpd";
  const streams = [
    { url: manifest, manifest_url: manifest, vcodec: "none", acodec: "opus", protocol: "http_dash_segments", manifest_stream_number: 0 },
    { url: manifest, manifest_url: manifest, vcodec: "av1", acodec: "none", protocol: "http_dash_segments", manifest_stream_number: 2, height: 360 },
  ];
  for (const requested_formats of [streams, streams.toReversed()]) {
    const { resolve, inspect } = await fixture(output({ requested_formats, manifest_stream_number: 9, title: "DASH movie" }));
    for (const quality of ["1080p", "720p", "480p"] as const) expect(await resolve(page, undefined, quality)).toEqual({ source: manifest, maxVideoHeight: Number(quality.slice(0, -1)), metadata: { title: "DASH movie" } });
    expect(await resolve(page)).toEqual({ source: manifest, metadata: { title: "DASH movie" } });
    expect(await inspect(page)).toEqual({ title: "DASH movie" });
  }
  const audio = await fixture(output(streams[0]));
  expect(await audio.resolve(page, undefined, "480p")).toEqual({ source: manifest });
});

test("DASH caps do not depend on extractor stream numbering and direct sources need no native cap", async () => {
  const manifest = "https://cdn.example/manifest.mpd";
  for (const manifest_stream_number of [undefined, null, "0", -1, 1.5, 1025]) {
    const { resolve } = await fixture(output({ url: manifest, manifest_url: manifest, protocol: "http_dash_segments", vcodec: "av1", manifest_stream_number }));
    expect(await resolve(page, undefined, "480p")).toEqual({ source: manifest, maxVideoHeight: 480 });
    expect(await resolve(page)).toEqual({ source: manifest });
  }
  const direct = await fixture(output({ ...combined, manifest_stream_number: 2 }));
  expect(await direct.resolve(page, undefined, "480p")).toEqual({ source: combined.url });
});

test("rejects input protocols, credentials and control characters before spawning", async () => {
  const { directory, resolve } = await fixture(`await Bun.write(import.meta.dir + '/started', 'yes');\n${output(combined)}`);
  for (const url of ["file:///etc/passwd", "https://user:secret@example.com/", "--exec=anything", "https:example.com", "https://example.com/\nprivate", "https://example.com/\\other", "https://example.com/" + "x".repeat(8192)]) await expect(resolve(url)).rejects.toThrow("HTTP or HTTPS");
  expect(await Bun.file(join(directory, "started")).exists()).toBeFalse();
});

test("rejects unusable extracted sources, DRM, playlists and header injection", async () => {
  const invalid = [
    { ...combined, url: "file:///etc/passwd" },
    { ...combined, url: "https://user:password@example.com/private" },
    { ...combined, url: "https://cdn.example/\nprivate" },
    { ...combined, has_drm: true },
    { _type: "playlist", entries: [combined] },
    { ...combined, protocol: "http_dash_segments" },
    { ...combined, protocol: "mhtml" },
    { ...combined, http_headers: { Referer: "safe\r\nAuthorization: secret" } },
    { ...combined, http_headers: { "Invalid name": "value" } },
    { ...combined, http_headers: { referer: "x".repeat(16 * 1024) } },
    { requested_formats: [combined, combined] },
  ];
  for (const info of invalid) {
    const { resolve } = await fixture(output(info));
    await expect(resolve(page)).rejects.toThrow();
  }
  const { resolve } = await fixture(output({ requested_formats: [
    { ...combined, acodec: "none", http_headers: { Referer: "https://video.example/" } },
    { ...combined, vcodec: "none", http_headers: { referer: "https://audio.example/" } },
  ] }));
  await expect(resolve(page)).rejects.toThrow("different headers");
});

test("classifies extractor failures without exposing private URLs or raw logs", async () => {
  for (const [stderr, message] of [["ERROR: DRM protected", "DRM playback"], ["ERROR: Sign in required", "account or browser session"], ["ERROR: not available in your country", "player's region"], ["ERROR: channel is not live", "offline"], ["ERROR: The channel is not currently live", "offline"], ["ERROR: JavaScript challenge failed", "install Deno"], ["ERROR: network failure", "could not open"]]) {
    const { resolve } = await fixture(`console.error(${JSON.stringify(`${stderr}: https://private.example/?token=never-share`)}); process.exit(1);`);
    try { await resolve(page); throw new Error("Expected rejection"); }
    catch (error) {
      expect((error as Error).message).toContain(message!);
      expect((error as Error).message).not.toContain("never-share");
    }
  }
});

test("aborts and reaps a running extractor and handles an already aborted signal", async () => {
  const { directory, resolve } = await fixture("await Bun.write(import.meta.dir + '/pid', String(process.pid)); await Bun.sleep(60_000);");
  const controller = new AbortController();
  const pending = resolve(page, controller.signal);
  const started = join(directory, "pid");
  const limit = Date.now() + 1_500;
  try {
    while (!existsSync(started)) { if (Date.now() > limit) throw new Error("Extractor did not start"); await Bun.sleep(10); }
  } catch (error) { controller.abort(); await pending.catch(() => {}); throw error; }
  const pid = Number(await Bun.file(started).text());
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(resolve(page, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("times out stalled extraction and bounds stdout and stderr", async () => {
  const stalled = await fixture("await Bun.sleep(60_000);", 50);
  await expect(stalled.resolve(page)).rejects.toThrow("too long");
  for (const [stream, length] of [["stdout", 8 * 1024 * 1024 + 1], ["stderr", 64 * 1024 + 1]] as const) {
    const { resolve } = await fixture(`await Bun.write(Bun.${stream}, 'x'.repeat(${length})); await Bun.sleep(60_000);`);
    await expect(resolve(page)).rejects.toThrow("too much output");
  }
});

test("reports invalid output and an unavailable executable", async () => {
  const { resolve } = await fixture("console.log('not json');");
  await expect(resolve(page)).rejects.toThrow("invalid media information");
  await expect(createWebMediaResolver({ executable: "/missing-couch-test/yt-dlp" })(page)).rejects.toThrow("installation");
});

test.skipIf(!Bun.which("yt-dlp"))("actual yt-dlp selects audio-only HTML sources at every quality", async () => {
  const wav = Buffer.alloc(44 + 88_200);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44_100, 24); wav.writeUInt32LE(88_200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    return new URL(request.url).pathname === "/tone.wav"
      ? new Response(wav, { headers: { "Content-Type": "audio/wav" } })
      : new Response('<!doctype html><title>Audio fixture</title><audio controls><source src="/tone.wav" type="audio/wav"></audio>', { headers: { "Content-Type": "text/html" } });
  } });
  try {
    for (const quality of ["best", "1080p", "720p", "480p"] as const) {
      const media = await createWebMediaResolver()(`http://127.0.0.1:${server.port}/`, undefined, quality);
      expect(media.source).toBe(`http://127.0.0.1:${server.port}/tone.wav`);
      expect(media.audioSource).toBeUndefined();
    }
  } finally { server.stop(true); }
}, 35_000);

test.skipIf(!Bun.which("yt-dlp"))("actual yt-dlp respects quality caps when selecting HLS variants", async () => {
  const master = "#EXTM3U\n" + [360, 720, 1080, 2160].map(height => `#EXT-X-STREAM-INF:BANDWIDTH=${height * 5000},RESOLUTION=${Math.round(height * 16 / 9)}x${height},CODECS="avc1.640028,mp4a.40.2"\n/${height}.m3u8\n`).join("");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response('<!doctype html><title>HLS fixture</title><video src="/master.m3u8"></video>', { headers: { "Content-Type": "text/html" } });
    return new Response(path === "/master.m3u8" ? master : "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10,\n/segment.ts\n#EXT-X-ENDLIST\n", { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
  } });
  try {
    for (const [quality, height] of [["best", 2160], ["1080p", 1080], ["720p", 720], ["480p", 360]] as const) {
      const media = await createWebMediaResolver()(`http://127.0.0.1:${server.port}/`, undefined, quality);
      expect(media.source).toBe(`http://127.0.0.1:${server.port}/${height}.m3u8`);
      expect(media.audioSource).toBeUndefined();
    }
  } finally { server.stop(true); }
}, 35_000);

test.skipIf(!Bun.which("yt-dlp"))("actual yt-dlp passes DASH height limits to native playback with audio before video", async () => {
  const segment = '<SegmentTemplate timescale="1" duration="10" initialization="/init-$RepresentationID$.m4s" media="/$RepresentationID$-$Number$.m4s" startNumber="1"/>';
  const manifest = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S" minBufferTime="PT1S"><Period>'
    + `<AdaptationSet mimeType="audio/mp4" contentType="audio"><Representation id="audio" codecs="mp4a.40.2" bandwidth="128000" audioSamplingRate="48000">${segment}</Representation></AdaptationSet>`
    + '<AdaptationSet mimeType="video/mp4" contentType="video">'
    + [360, 720, 1080, 2160].map(height => `<Representation id="v${height}" codecs="avc1.640028" width="${Math.round(height * 16 / 9)}" height="${height}" bandwidth="${height * 5000}">${segment}</Representation>`).join("")
    + '</AdaptationSet></Period></MPD>';
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    return new URL(request.url).pathname === "/"
      ? new Response('<!doctype html><title>DASH fixture</title><video src="/manifest.mpd"></video>', { headers: { "Content-Type": "text/html" } })
      : new Response(manifest, { headers: { "Content-Type": "application/dash+xml" } });
  } });
  try {
    for (const [quality, maxVideoHeight] of [["best", undefined], ["1080p", 1080], ["720p", 720], ["480p", 480]] as const) {
      const media = await createWebMediaResolver()(`http://127.0.0.1:${server.port}/`, undefined, quality);
      expect(media.source).toBe(`http://127.0.0.1:${server.port}/manifest.mpd`);
      expect(media.maxVideoHeight).toBe(maxVideoHeight);
      expect(media.audioSource).toBeUndefined();
    }
  } finally { server.stop(true); }
}, 35_000);
