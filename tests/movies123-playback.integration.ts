import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { test } from "node:test";
import { resolveMovies123Link } from "../src/server/movies123";
import { ExtractionError } from "../src/server/yt-dlp";
import { ProviderError } from "../src/server/providers/http";

const movie = "https://ww8.123moviesfree.net/movie/7500-100943/";
const season = "https://ww8.123moviesfree.net/season/animal-control-season-2-1630856705/";
const encryptedInfo = `${"a".repeat(16)}-${"b".repeat(24)}-${"c".repeat(66)}`;
const master = `https://ployan.me/hls/${encryptedInfo}/master.m3u8`;
const movieSubtitles = "https://ployan.me/sub/2223232a27203e22/";
const episodeSubtitles = "https://ployan.me/sub/222520232b26252423263e21/";
const manifest = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720\n720/index.m3u8\n";
const detail = (series = false, servers = [1, 2, 5]) => `<div id=mid data-mid=${series ? 1630856705 : 100943} data-mode=${series ? "serie" : "movie"}></div><h1>${series ? "Animal Control - Season 2" : "7500"}</h1><p><strong>Duration:</strong> ${series ? "21m" : "1h 32m"}</p>${servers.map(id => `<button class=server id=srv-${id}></button>`).join("")}${[1, 2, 3].map(id => `<button class=episode id=ep-${id}></button>`).join("")}`;

function decodeRequest(url: string): string {
  const value = new URL(url);
  assert.equal(value.origin, "https://ployan.me");
  assert.match(value.pathname, /^\/get\/[\da-f]{16}-[\da-f]{24}-[\da-f]+$/);
  const [salt, iv, encrypted] = value.pathname.slice(5).split("-").map(value => Buffer.from(value, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", pbkdf2Sync("player", salt!, 1000, 32, "sha256"), iv!);
  decipher.setAuthTag(encrypted!.subarray(-16));
  return Buffer.concat([decipher.update(encrypted!.subarray(0, -16)), decipher.final()]).toString();
}

function fixture({ page = detail(), metadata = { code: 200, mode: "direct", info: encryptedInfo }, playlist = () => new Response(manifest), subtitles = () => Response.json([]) } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    if (calls.length === 1) return new Response(page);
    if (calls.length === 2) return Response.json(metadata);
    if (url === master) return playlist();
    assert.ok(url === `${movieSubtitles}index.json` || url === `${episodeSubtitles}index.json`);
    return subtitles();
  }) as typeof fetch;
  return { calls, request };
}

for (const series of [false, true]) test(`123MoviesFree resolves a ${series ? "selected episode" : "movie"} through its published metadata contract`, async () => {
  const { calls, request } = fixture({ page: detail(series) });
  const before = Math.floor(Date.now() / 1000);
  const result = await resolveMovies123Link(series ? `${season}?episode=2` : movie, undefined, request);
  assert.equal(calls.length, 4);
  assert.equal(calls[0]!.url, series ? season : movie, "Couch's episode marker must not be sent to the catalogue");
  const [id, episode, server, timestamp] = decodeRequest(calls[1]!.url).split("+");
  assert.deepEqual([id, episode, server], [series ? "1630856705" : "100943", series ? "2" : "1", "1"]);
  assert.ok(Number(timestamp) >= before && Number(timestamp) <= Math.floor(Date.now() / 1000));
  assert.equal(result.url, master);
  assert.equal(result.metadata.title, series ? "Animal Control - Season 2 — Episode 2" : "7500");
  assert.equal(result.metadata.duration, series ? 1260 : 5520);
  assert.equal(result.headers.Referer, "https://ployan.me/watch/");
  assert.deepEqual(calls[2]!.init?.headers, { ...result.headers, Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain" });
});

test("123MoviesFree discovers alternate, SDH and forced subtitle tracks without losing their labels", async () => {
  const { calls, request } = fixture({ subtitles: () => Response.json([
    { file: `${movieSubtitles}en.vtt`, label: "English", lang: "en", default: true },
    { file: "/sub/2223232a27203e22/en-sdh.vtt", label: "English (SDH)", lang: "en" },
    { file: "/sub/2223232a27203e22/en-2.vtt", label: "English", lang: "en" },
    { file: "/sub/2223232a27203e22/it-forced.vtt", label: "Italian (Forced)", lang: "it" },
  ]) });
  const result = await resolveMovies123Link(movie, undefined, request);
  assert.deepEqual(result.subtitles, [
    { source: `${movieSubtitles}en.vtt`, title: "English", language: "en" },
    { source: `${movieSubtitles}en-sdh.vtt`, title: "English (SDH)", language: "en" },
    { source: `${movieSubtitles}en-2.vtt`, title: "English 2", language: "en" },
    { source: `${movieSubtitles}it-forced.vtt`, title: "Italian (Forced)", language: "it" },
  ]);
  assert.equal(calls[3]!.url, `${movieSubtitles}index.json`);
});

test("123MoviesFree subtitle discovery uses the selected episode", async () => {
  const { request } = fixture({ page: detail(true), subtitles: () => Response.json([
    { file: `${episodeSubtitles}en-sdh.vtt`, label: "English (SDH)", lang: "en" },
  ]) });
  const result = await resolveMovies123Link(`${season}?episode=2`, undefined, request);
  assert.deepEqual(result.subtitles, [{ source: `${episodeSubtitles}en-sdh.vtt`, title: "English (SDH)", language: "en" }]);
});

test("123MoviesFree rejects foreign, traversing and non-subtitle files and deduplicates URLs", async () => {
  const files = ["https://untrusted.example/en.vtt", "http://ployan.me/sub/2223232a27203e22/en.vtt", "https://user:password@ployan.me/sub/2223232a27203e22/en.vtt", "/sub/2223232a27203e22/../private.vtt", "/sub/other/en.vtt", "/sub/2223232a27203e22/%2e%2e/en.vtt", "/sub/2223232a27203e22/en.js", "/sub/2223232a27203e22/en.vtt?redirect=private", `${movieSubtitles}en.vtt`, `${movieSubtitles}en.vtt`];
  const { request } = fixture({ subtitles: () => Response.json(files.map(file => ({ file, label: "English", lang: "en" }))) });
  const result = await resolveMovies123Link(movie, undefined, request);
  assert.deepEqual(result.subtitles, [{ source: `${movieSubtitles}en.vtt`, title: "English", language: "en" }]);
});

test("123MoviesFree keeps the preferred subtitle language within the existing 16-track limit", async () => {
  const rows = [...Array.from({ length: 20 }, (_, i) => ({ file: `${movieSubtitles}en-${i}.vtt`, label: "English", lang: "en" })), { file: `${movieSubtitles}it.vtt`, label: "Italian", lang: "it" }];
  const { request } = fixture({ subtitles: () => Response.json(rows) });
  const result = await resolveMovies123Link(movie, undefined, request, "it");
  assert.equal(result.subtitles.length, 16);
  assert.deepEqual(result.subtitles[0], { source: `${movieSubtitles}it.vtt`, title: "Italian", language: "it" });
});

test("123MoviesFree still plays video when the optional subtitle index is unavailable or invalid", async () => {
  for (const subtitles of [() => new Response("Unavailable", { status: 502 }), () => new Response("<html>not JSON</html>"), () => Response.json({ tracks: [] }), () => { throw new Error("Subtitle network failed"); }]) {
    const { request } = fixture({ subtitles });
    const result = await resolveMovies123Link(movie, undefined, request);
    assert.equal(result.url, master);
    assert.deepEqual(result.subtitles, []);
  }
});

test("123MoviesFree keeps validated video when the video deadline expires during subtitle discovery", async context => {
  const videoDeadline = new AbortController(), subtitleDeadline = new AbortController();
  const timeout = AbortSignal.timeout;
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => milliseconds === 25_000 ? videoDeadline.signal : milliseconds === 5000 ? subtitleDeadline.signal : timeout(milliseconds));
  let cancelled = false, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const { request } = fixture({ subtitles: () => {
    started();
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  const pending = resolveMovies123Link(movie, undefined, request);
  await ready;
  videoDeadline.abort(new DOMException("Video deadline expired", "TimeoutError"));
  subtitleDeadline.abort(new DOMException("Subtitle deadline expired", "TimeoutError"));
  const result = await pending;
  assert.equal(result.url, master);
  assert.deepEqual(result.subtitles, []);
  assert.equal(cancelled, true);
});

test("123MoviesFree bounds the subtitle index and cancels its body without preventing video", async () => {
  let cancelled = false;
  const { request } = fixture({ subtitles: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); }, cancel() { cancelled = true; } })) });
  const result = await resolveMovies123Link(movie, undefined, request);
  assert.equal(result.url, master);
  assert.deepEqual(result.subtitles, []);
  assert.equal(cancelled, true);
});

test("123MoviesFree cancellation stops a stalled subtitle index and preserves the caller's reason", async () => {
  const controller = new AbortController(), reason = new Error("User stopped playback");
  let cancelled = false, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const { request } = fixture({ subtitles: () => {
    started();
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  const pending = resolveMovies123Link(movie, controller.signal, request);
  await ready;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(cancelled, true);
});

test("123MoviesFree rejects collection and foreign links before fetching", async () => {
  for (const url of [season, "https://123moviesfree.net.evil.example/movie/7500-100943/", `${movie}?episode=2`]) {
    const { calls, request } = fixture();
    await assert.rejects(resolveMovies123Link(url, undefined, request), ProviderError);
    assert.equal(calls.length, 0);
  }
});

test("123MoviesFree requires the selected episode and direct server to be listed", async () => {
  for (const [url, page, expected] of [[`${season}?episode=4`, detail(true), ProviderError], [movie, detail(false, [5]), ExtractionError]] as const) {
    const { calls, request } = fixture({ page });
    await assert.rejects(resolveMovies123Link(url, undefined, request), expected);
    assert.equal(calls.length, 1);
  }
});

const alternate = "https://noisy-king-5904.streamed-7.workers.dev/hls/selected-film/master.m3u8";
function encrypt(plaintext: string, key: Buffer, iv: Buffer) {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function embedFixture({ series = false, servers = [1, 2, 5], destination = series ? "tv/214162/2-2-1793148309" : "movie/509585-1793148309", envelope = (value: Record<string, unknown>) => Response.json(value), playlist = () => new Response(manifest), stream = { status: "success", type: "hls", url: alternate, subtitles: [] as unknown[] } } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const salt = randomBytes(8), iv = randomBytes(12);
  const info = [salt, iv, encrypt(destination, pbkdf2Sync("player", salt, 1000, 32, "sha256"), iv)].map(value => value.toString("hex")).join("-");
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), parsed = new URL(url);
    calls.push({ url, init });
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    if (url === movie || url === season) return new Response(detail(series, servers));
    if (parsed.pathname.startsWith("/get/")) {
      const [id, episode, server] = decodeRequest(url).split("+");
      assert.deepEqual([id, episode], [series ? "1630856705" : "100943", series ? "2" : "1"]);
      assert.ok(servers.includes(Number(server)));
      return Response.json({ code: 200, mode: server === "1" ? "direct" : "embed", info: server === "1" ? encryptedInfo : info });
    }
    if (url === master) return new Response("Bad gateway", { status: 502 });
    if (parsed.hostname === "new.vidnest.fun") {
      assert.equal(parsed.pathname, series ? "/flixhq/tv/214162/2/2" : "/flixhq/movie/509585");
      const nonce = parsed.searchParams.get("_n");
      assert.match(nonce!, /^[\w-]{22}$/);
      const key = createHash("sha256").update(`${nonce}|K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2`).digest();
      const iv = randomBytes(12);
      return envelope({ v: 2, n: nonce, d: Buffer.concat([iv, encrypt(JSON.stringify(stream), key, iv)]).toString("base64url") });
    }
    if (url === alternate) return playlist();
    assert.ok(url === `${movieSubtitles}index.json` || url === `${episodeSubtitles}index.json`);
    return Response.json([]);
  }) as typeof fetch;
  return { calls, request };
}

for (const series of [false, true]) test(`123MoviesFree recovers an unavailable direct ${series ? "episode" : "film"} through its advertised Server 2`, async () => {
  const { calls, request } = embedFixture({ series });
  const result = await resolveMovies123Link(series ? `${season}?episode=2` : movie, undefined, request);
  assert.equal(calls.length, 7);
  assert.equal(result.url, alternate);
  assert.equal(result.metadata.title, series ? "Animal Control - Season 2 — Episode 2" : "7500");
  assert.equal(result.metadata.duration, series ? 1260 : 5520);
  assert.equal(result.headers.Referer, series ? "https://vidnest.fun/tv/214162/2/2" : "https://vidnest.fun/movie/509585");
  assert.equal(new Headers(calls[4]!.init?.headers).get("Origin"), "https://vidnest.fun");
  assert.equal(new Headers(calls[5]!.init?.headers).get("Referer"), result.headers.Referer);
});

test("123MoviesFree can use advertised Server 2 when Server 1 is absent", async () => {
  const { calls, request } = embedFixture({ servers: [2, 5] });
  const result = await resolveMovies123Link(movie, undefined, request);
  assert.equal(result.url, alternate);
  assert.equal(calls.length, 5);
  assert.equal(decodeRequest(calls[1]!.url).split("+")[2], "2");
});

test("123MoviesFree never tries an unadvertised fallback server", async () => {
  const { calls, request } = embedFixture({ servers: [1, 5] });
  await assert.rejects(resolveMovies123Link(movie, undefined, request), ExtractionError);
  assert.equal(calls.length, 3);
});

test("123MoviesFree rejects foreign destinations, wrong media kinds and mismatched fallback episodes", async () => {
  for (const [series, destination] of [[false, "https://127.0.0.1/private"], [false, "tv/214162/2-2-1793148309"], [true, "movie/509585-1793148309"], [true, "tv/214162/2-3-1793148309"], [false, "movie/509585/../../private-1793148309"]] as const) {
    const { calls, request } = embedFixture({ series, destination });
    await assert.rejects(resolveMovies123Link(series ? `${season}?episode=2` : movie, undefined, request), ExtractionError);
    assert.equal(calls.length, 4, "An invalid player instruction must never reach an embed or API host");
  }
});

test("123MoviesFree authenticates fallback metadata and binds it to its request nonce", async () => {
  for (const change of [(v: Record<string, unknown>) => ({ ...v, n: "unrelated" }), (v: Record<string, unknown>) => ({ ...v, v: 1 }), (v: Record<string, unknown>) => ({ ...v, d: `${String(v.d).slice(0, -5)}AAAAA` })]) {
    const { calls, request } = embedFixture({ envelope: value => Response.json(change(value)) });
    await assert.rejects(resolveMovies123Link(movie, undefined, request), ExtractionError);
    assert.equal(calls.length, 5);
  }
});

test("123MoviesFree rejects non-HLS and unsafe fallback sources without leaking their URLs", async () => {
  for (const stream of [{ status: "success", type: "hls", url: "https://untrusted.example/master.m3u8" }, { status: "success", type: "hls", url: "https://127.0.0.1/master.m3u8" }, { status: "success", type: "mp4", url: alternate }, { status: "success", type: "hls", url: "https://user:PRIVATE@media.example/master.m3u8" }, { status: "success", type: "hls", url: "http://media.example/master.m3u8" }, { status: "success", type: "hls", url: "https://media.example/master.m3u8\nPRIVATE" }]) {
    const { calls, request } = embedFixture({ stream: { ...stream, subtitles: [] } });
    await assert.rejects(resolveMovies123Link(movie, undefined, request), error => error instanceof ExtractionError && !error.message.includes("PRIVATE"));
    assert.equal(calls.length, 5);
  }
});

test("123MoviesFree preserves the fallback's SDH subtitles and language preference within 16 tracks", async () => {
  const subtitles = [...Array.from({ length: 20 }, (_, i) => ({ url: `https://noisy-king-5904.streamed-7.workers.dev/sub/en-${i}`, lang: "eng" })), { url: "https://noisy-king-5904.streamed-7.workers.dev/sub/it", lang: "ita" }, { url: "https://noisy-king-5904.streamed-7.workers.dev/sub/it", lang: "ita" }, { url: "https://noisy-king-5904.streamed-7.workers.dev/sub/sdh", lang: "ita (SDH)" }, { url: "https://noisy-king-5904.streamed-7.workers.dev/sub/it-alt", lang: "ita (2)" }, { url: "file:///private", lang: "eng" }];
  const { request } = embedFixture({ stream: { status: "success", type: "hls", url: alternate, subtitles } });
  const result = await resolveMovies123Link(movie, undefined, request, "it");
  assert.equal(result.subtitles.length, 16);
  assert.deepEqual(result.subtitles.slice(0, 3), [{ source: "https://noisy-king-5904.streamed-7.workers.dev/sub/it", title: "Italian", language: "it" }, { source: "https://noisy-king-5904.streamed-7.workers.dev/sub/sdh", title: "Italian (SDH)", language: "it" }, { source: "https://noisy-king-5904.streamed-7.workers.dev/sub/it-alt", title: "Italian (2)", language: "it" }]);
});

test("123MoviesFree canonicalizes fallback language aliases before ranking subtitles", async () => {
  const subtitles = ["eng", "fre", "ger"].map(lang => ({ url: `https://noisy-king-5904.streamed-7.workers.dev/sub/${lang}`, lang }));
  const { request } = embedFixture({ stream: { status: "success", type: "hls", url: alternate, subtitles } });
  const result = await resolveMovies123Link(movie, undefined, request, "de");
  assert.deepEqual(result.subtitles.map(track => [track.title, track.language]), [["German", "de"], ["English", "en"], ["French", "fr"]]);
});

test("123MoviesFree bounds the fallback metadata and manifest bodies", async () => {
  for (const stage of ["metadata", "manifest"]) {
    let cancelled = false;
    const response = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array((stage === "metadata" ? 16 : 512) * 1024 + 1)); }, cancel() { cancelled = true; } }));
    const { calls, request } = embedFixture(stage === "metadata" ? { envelope: response } : { playlist: response });
    await assert.rejects(resolveMovies123Link(movie, undefined, request), ExtractionError);
    assert.equal(cancelled, true);
    assert.equal(calls.length, stage === "metadata" ? 5 : 6);
  }
});

test("123MoviesFree cancellation stops a stalled fallback and preserves the caller's reason", async () => {
  for (const stage of ["metadata", "manifest"]) {
    const controller = new AbortController(), reason = new Error("User stopped playback");
    let started!: () => void, cancelled = false;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const response = () => { started(); return new Response(new ReadableStream({ cancel() { cancelled = true; } })); };
    const { request } = embedFixture(stage === "metadata" ? { envelope: response } : { playlist: response });
    const pending = resolveMovies123Link(movie, controller.signal, request);
    await ready;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert.equal(cancelled, true);
  }
});

test("123MoviesFree keeps the whole resolution deadline while preparing its fallback", async context => {
  const deadline = new AbortController(), timeout = AbortSignal.timeout;
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => milliseconds === 25_000 ? deadline.signal : timeout(milliseconds));
  let started!: () => void, cancelled = false;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const { calls, request } = embedFixture({ envelope: () => { started(); return new Response(new ReadableStream({ cancel() { cancelled = true; } })); } });
  const pending = resolveMovies123Link(movie, undefined, request);
  await ready;
  deadline.abort(new DOMException("Video deadline expired", "TimeoutError"));
  await assert.rejects(pending, error => error instanceof ExtractionError && error.message === "123MoviesFree took too long to prepare this title. Try again shortly.");
  assert.equal(cancelled, true);
  assert.equal(calls.length, 5);
});

test("123MoviesFree rejects unsupported Server 1 and malformed player destinations", async () => {
  for (const metadata of [
    { code: 200, mode: "embed", info: "https://untrusted.example/player" },
    { code: 404, mode: "direct", info: encryptedInfo },
    { code: 200, mode: "direct", info: "../../private?signature=PRIVATE" },
    { code: 200, mode: "direct", info: `${encryptedInfo}f` },
  ]) {
    const { calls, request } = fixture({ metadata });
    await assert.rejects(resolveMovies123Link(movie, undefined, request), error => error instanceof ExtractionError && !error.message.includes("PRIVATE"));
    assert.equal(calls.length, 2, "An unsupported response must not trigger another host or server");
  }
});

test("123MoviesFree returns a safe actionable error for unavailable and non-HLS manifests", async () => {
  for (const playlist of [() => new Response("error code: 502", { status: 502 }), () => new Response("<html>upstream error #EXTM3U PRIVATE</html>"), () => { throw new Error(`fetch failed ${master}?signature=PRIVATE`); }]) {
    const { request } = fixture({ playlist });
    await assert.rejects(resolveMovies123Link(movie, undefined, request), error => error instanceof ExtractionError && error.message === "123MoviesFree's direct stream is unavailable. Try again shortly or choose another source.");
  }
});

for (const declared of [false, true]) test(`123MoviesFree bounds a ${declared ? "declared" : "chunked"} manifest and cancels its body`, async () => {
  let cancelled = false;
  const { request } = fixture({ playlist: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: declared ? { "Content-Length": "9999999" } : {} }) });
  await assert.rejects(resolveMovies123Link(movie, undefined, request), ExtractionError);
  assert.equal(cancelled, true);
});

test("123MoviesFree cancellation stops a stalled manifest and preserves the caller's reason", async () => {
  const controller = new AbortController(), reason = new Error("User stopped playback");
  let cancelled = false, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const { request } = fixture({ playlist: () => {
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    started();
    return response;
  } });
  const pending = resolveMovies123Link(movie, controller.signal, request);
  await ready;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(cancelled, true);
});

test("123MoviesFree network timeouts hide internal request details", async () => {
  const { request } = fixture({ playlist: () => { throw new DOMException(`Timed out ${master}`, "TimeoutError"); } });
  await assert.rejects(resolveMovies123Link(movie, undefined, request), error => error instanceof ExtractionError && error.message === "123MoviesFree took too long to prepare this title. Try again shortly.");
});
