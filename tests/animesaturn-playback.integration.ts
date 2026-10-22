import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAnimeSaturnLink } from "../src/server/animesaturn";
import { animeSaturnTitle } from "../src/server/providers/animesaturn";
import { animesaturnOrigin } from "../src/shared/animesaturn";

const origin = animesaturnOrigin;
const page = `${origin}/one-piece-sub-ita-episode-1180/`;
const collection = `${origin}/anime/one-piece/`;
const image = `${origin}/wp-content/uploads/2026/04/OnePieceElbafPic-1.png`;
const player = (source: string) => `${origin}/wp-content/themes/animestream-child/player/?${new URLSearchParams({ source, url: source === "animesaturn_live" ? "/episode/one-piece-PmTvj/ep-1180" : "aGVsbG8=", poster: image })}`;
const live = player("animesaturn_live"), mega = player("megavid_panel");
const liveStream = "https://srv30.sake.streampeaker.org/_t/1792273767/hWH05TYyXI6TUWHunF-qCw/DDL/ANIME/OnePiece/1180/playlist.m3u8";
const embed = "https://cdn2.megaplay.su/e/6cc193a4facd7d3d177fc90079bc86cec5da770737cc838d?autoplay=1";
const megaStream = "https://cdn2.megaplay.su/hls/20260927_203701_5d832541/master.m3u8";
// Public player responses captured on 2026-10-17, reduced to the fields used
// by Couch. The opaque Mega reference is substituted; scripts are never run.
const frame = (url: string) => `<iframe src="${url.replaceAll("&", "&#038;")}" allowfullscreen></iframe>`;
const html = `<meta property="og:image" content="${image}"><article itemtype="http://schema.org/Episode"><a href="${collection}"><span itemprop="name">One Piece Sub ITA</span></a><h1 class="entry-title">One Piece Sub ITA Episode 1180</h1>${frame(mega)}<button onclick="loadMi({ value: '${Buffer.from(frame(live)).toString("base64")}' });">HD</button></article>`;
const manifest = "#EXTM3U\r\n#EXT-X-VERSION:3\r\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720\r\n./720p/playlist_720p.m3u8\r\n";

const fixture = (route: (url: string) => string | Response, requests: string[] = []) => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  requests.push(url);
  assert.equal(init?.redirect, "error");
  assert.equal(init?.credentials, "omit");
  assert.equal((init?.headers as Record<string, string>)["User-Agent"], "Mozilla/5.0");
  const body = route(url);
  return body instanceof Response ? body : new Response(body);
}) as typeof fetch;

test("HD extraction reads public literals, validates HLS and preserves page metadata", async () => {
  const requests: string[] = [];
  const result = await resolveAnimeSaturnLink(page, undefined, fixture(url => {
    if (url === page) return html;
    if (url === live) return `<script>var src = ${JSON.stringify(liveStream)}; var isHls = true;</script>`;
    assert.equal(url, liveStream);
    return manifest;
  }, requests));
  assert.deepEqual(requests, [page, live, liveStream]);
  assert.equal(result.url, liveStream);
  assert.deepEqual(result.metadata, { title: "One Piece Sub ITA Episode 1180", thumbnail: image });
  assert.deepEqual(result.headers, { "User-Agent": "Mozilla/5.0", Referer: `${origin}/` });
  assert.deepEqual(result.subtitles, []);
});

test("HD progressive MP4 goes to playback without downloading the media as text", async () => {
  const requests: string[] = [];
  const progressive = "https://srv30.sake.streampeaker.org/DDL/ANIME/Suikoden/01.mp4?token=fixture";
  const result = await resolveAnimeSaturnLink(page, undefined, fixture(url => {
    if (url === page) return html;
    assert.equal(url, live, "extraction must stop at the public player response");
    return `<script>var src = ${JSON.stringify(progressive)}; var isHls = false;</script>`;
  }, requests));
  assert.deepEqual(requests, [page, live]);
  assert.equal(result.url, progressive);
  assert.deepEqual(result.metadata, { title: "One Piece Sub ITA Episode 1180", thumbnail: image });
  assert.deepEqual(result.headers, { "User-Agent": "Mozilla/5.0", Referer: `${origin}/` });
  assert.deepEqual(result.subtitles, []);
});

test("Mega remains available through one allowlisted iframe when HD fails", async () => {
  const requests: string[] = [];
  const result = await resolveAnimeSaturnLink(page, undefined, fixture(url => {
    if (url === page) return html;
    if (url === live) return new Response("Unavailable", { status: 503 });
    if (url === mega) return frame(embed);
    if (url === embed) return `<script>var primary = ${JSON.stringify(megaStream)};</script>`;
    assert.equal(url, megaStream);
    return manifest;
  }, requests));
  assert.equal(result.url, megaStream);
  assert.deepEqual(requests, [page, live, mega, embed, megaStream]);
});

test("unaccepted public embeds, stream hosts and invalid HLS responses are rejected", async () => {
  for (const body of [
    `<script>var src = "https://127.0.0.1/private/master.m3u8";</script>`,
    frame("https://cdn2.megaplay.su.evil.example/e/6cc193a4facd7d3d177fc90079bc86cec5da770737cc838d"),
    frame("https://name:secret@cdn2.megaplay.su/e/6cc193a4facd7d3d177fc90079bc86cec5da770737cc838d"),
    `<script>var src = "https://srv30.sake.streampeaker.org:444/private/master.m3u8";</script>`,
    `<script>var src = ${JSON.stringify(liveStream)};</script>`,
  ]) {
    const requests: string[] = [];
    await assert.rejects(() => resolveAnimeSaturnLink(page, undefined, fixture(url => {
      if (url === page) return html;
      if (url === live || url === mega) return body;
      assert.equal(url, liveStream);
      return "<html>Challenge page</html>";
    }, requests)), /direct stream is unavailable/);
    assert.ok(requests.every(url => new URL(url).hostname === "animesaturn.ro" || url === liveStream));
  }
  const foreign = html.replace(frame(mega), frame("https://example.com/embed/"))
    .replace(Buffer.from(frame(live)).toString("base64"), Buffer.from(frame("https://127.0.0.1/private")).toString("base64"));
  assert.deepEqual((await animeSaturnTitle(page, undefined, fixture(() => foreign))).players, []);
});

test("collections and private targets fail before requests; cancellation stops player reads", async () => {
  let calls = 0;
  const never = fixture(() => { calls++; throw new Error("unexpected request"); });
  for (const url of [collection, live, liveStream, `${page}?token=secret`, "https://example.com/episode-1/"]) await assert.rejects(() => resolveAnimeSaturnLink(url, undefined, never), /Choose an AnimeSaturn episode/);
  assert.equal(calls, 0);
  const controller = new AbortController();
  let cancelled = false;
  const request = fixture(url => url === page ? html : new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode("<script>")); controller.abort(); }, cancel() { cancelled = true; } })));
  await assert.rejects(() => resolveAnimeSaturnLink(page, controller.signal, request), error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(cancelled, true);
});
