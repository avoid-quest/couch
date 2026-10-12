import assert from "node:assert/strict";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { test } from "node:test";
import { resolveMovies123Link } from "../src/server/movies123";
import { ExtractionError } from "../src/server/yt-dlp";
import { ProviderError } from "../src/server/providers/http";

const movie = "https://ww8.123moviesfree.net/movie/7500-100943/";
const season = "https://ww8.123moviesfree.net/season/animal-control-season-2-1630856705/";
const encryptedInfo = `${"a".repeat(16)}-${"b".repeat(24)}-${"c".repeat(66)}`;
const master = `https://ployan.me/hls/${encryptedInfo}/master.m3u8`;
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

function fixture({ page = detail(), metadata = { code: 200, mode: "direct", info: encryptedInfo }, playlist = () => new Response(manifest) } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    if (calls.length === 1) return new Response(page);
    if (calls.length === 2) return Response.json(metadata);
    assert.equal(url, master);
    return playlist();
  }) as typeof fetch;
  return { calls, request };
}

for (const series of [false, true]) test(`123MoviesFree resolves a ${series ? "selected episode" : "movie"} through its published metadata contract`, async () => {
  const { calls, request } = fixture({ page: detail(series) });
  const before = Math.floor(Date.now() / 1000);
  const result = await resolveMovies123Link(series ? `${season}?episode=2` : movie, undefined, request);
  assert.equal(calls.length, 3);
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

test("123MoviesFree rejects collection and foreign links before fetching", async () => {
  for (const url of [season, "https://123moviesfree.net.evil.example/movie/7500-100943/", `${movie}?episode=2`]) {
    const { calls, request } = fixture();
    await assert.rejects(resolveMovies123Link(url, undefined, request), ProviderError);
    assert.equal(calls.length, 0);
  }
});

test("123MoviesFree requires the selected episode and direct server to be listed", async () => {
  for (const [url, page, expected] of [[`${season}?episode=4`, detail(true), ProviderError], [movie, detail(false, [2, 5]), ExtractionError]] as const) {
    const { calls, request } = fixture({ page });
    await assert.rejects(resolveMovies123Link(url, undefined, request), expected);
    assert.equal(calls.length, 1);
  }
});

test("123MoviesFree does not follow embedded or malformed player destinations", async () => {
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
