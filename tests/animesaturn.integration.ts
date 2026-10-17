import assert from "node:assert/strict";
import { test } from "node:test";
import { animeSaturnPageUrl, animesaturnOrigin, isAnimeSaturnHost } from "../src/shared/animesaturn";
import { animeSaturnText, animeSaturnTitle, browseAnimeSaturn, loadAnimeSaturnList } from "../src/server/providers/animesaturn";

const origin = animesaturnOrigin;
const titleUrl = `${origin}/anime/one-piece/`;
const episodeUrl = (number: number) => `${origin}/one-piece-episodio-${number}-streaming-sub-ita/`;
const image = `${origin}/wp-content/uploads/2026/04/OnePieceElbafPic-1.png`;
// Reduced public AnimeStream markup captured on 2026-10-17. Generated rows
// preserve the observed chunk structure while keeping each fixture readable.
const row = (number: number) => `<li><a href="${episodeUrl(number)}" title="One Piece Episodio ${number} Streaming Sub ITA"><div class="epl-num">${number}</div><div class="epl-title">One Piece Episodio ${number} Streaming Sub ITA</div><div class="epl-sub"></div><div class="epl-date">April 16, 2026</div></a></li>`;
const rows = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => row(start + index)).join("");
const title = (total: number) => `<meta property="og:image" content="${image}"><h1 class="entry-title" itemprop="name">One Piece Sub ITA</h1>
<div class="spe"><span><b>Durata:</b> 24 min</span></div><div class="desc"><p>A pirate&#8217;s story.</p></div>
<div class="bixbox bxcl epcheck" id="episodes" data-series="70221" data-pages="${Math.max(1, Math.ceil(total / 50))}" data-total="${total}"><div class="eplister"><ul class="ep-page" data-eppage="0">${rows(1, Math.min(total, 50))}</ul></div></div><script>var nonce = '6fa8057845';</script>`;
const episode = `<meta property="og:image" content="${image}"><article itemtype="http://schema.org/Episode"><a href="${titleUrl}"><span itemprop="name">One Piece Sub ITA</span></a><h1 class="entry-title">One Piece Episodio 2 Streaming Sub ITA</h1></article>`;
const card = `<article class="bs" itemtype="http://schema.org/CreativeWork"><div class="bsx"><a href="${titleUrl}" itemprop="url" title="One Piece Sub ITA" class="tip" rel="70221"><div class="limit"><img src="${image}" class="thumb wp-post-image"></div><div class="tt">One Piece Sub ITA<h2 itemprop="headline">One Piece Sub ITA</h2></div></a></div></article>`;
const catalogue = `<div class="postbody"><div class="listupd">${card}</div><a class="next page-numbers" href="${origin}/anime/page/2/">Next &raquo;</a></div><div id="sidebar">${card.replaceAll("one-piece/", "other-series/")}</div>`;

const fixture = (route: string | ((url: string, init?: RequestInit) => string | Response), requests: { url: string; init?: RequestInit }[] = []) => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  requests.push({ url, init });
  assert.equal(init?.redirect, "error");
  assert.equal(init?.credentials, "omit");
  const body = typeof route === "function" ? route(url, init) : route;
  return body instanceof Response ? body : new Response(body);
}) as typeof fetch;

test("AnimeSaturn page references canonicalize public anime and episode paths", () => {
  assert.equal(isAnimeSaturnHost("www.animesaturn.ro"), true);
  assert.equal(isAnimeSaturnHost("animesaturn.ro.evil.example"), false);
  for (const path of ["anime/one-piece", "one-piece-sub-ita-episode-1180", "dragon-ball-z-a-ep-291", "one-piece-episodio-1-streaming-sub-ita"]) {
    assert.equal(animeSaturnPageUrl(`http://www.animesaturn.ro/${path}`)?.href, `${origin}/${path}/`);
  }
  for (const url of [`${origin}/`, `${origin}/anime/`, `${origin}/wp-content/themes/animestream-child/player/?source=animesaturn_live`, `${origin}/privacy-policy/`, `${origin}/anime/%2e%2e/`, `${titleUrl}?token=secret`, `${titleUrl}#fragment`, titleUrl.replace("https://", "https://name:secret@"), titleUrl.replace(".ro/", ".ro:444/"), titleUrl.replace("animesaturn.ro", "animesaturn.ro.evil.example"), `${origin}/one-piece-sub-ita-episode-1/\\evil`]) assert.equal(animeSaturnPageUrl(url), undefined, url);
});

test("catalogue and search retain only title cards in the main content", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const page = await browseAnimeSaturn({}, undefined, fixture(catalogue, requests));
  assert.deepEqual(page.items.map(item => [item.kind, item.title, item.url]), [["collection", "One Piece Sub ITA", titleUrl]]);
  assert.equal(page.item, undefined);
  assert.equal(page.nextCursor, "2");
  await browseAnimeSaturn({ cursor: page.nextCursor }, undefined, fixture(catalogue, requests));
  assert.deepEqual(requests.map(request => request.url), [`${origin}/anime/`, `${origin}/anime/page/2/`]);
  const search = catalogue.replace(`${origin}/anime/page/2/`, `${origin}/page/2/?s=One+Piece`);
  assert.equal((await browseAnimeSaturn({ query: "One Piece" }, undefined, fixture(search))).nextCursor, "2");
  await browseAnimeSaturn({ query: "One Piece", cursor: "2" }, undefined, fixture(search, requests));
  assert.equal(requests.at(-1)?.url, `${origin}/page/2/?s=One+Piece`);
  assert.equal((await browseAnimeSaturn({}, undefined, fixture(catalogue.replace(`${origin}/anime/page/2/`, "https://private.example/anime/page/2/")))).nextCursor, undefined);
  const empty = `<div class="postbody"><div class="listupd"><center><h3>Non trovato</h3></center></div></div><div id="sidebar">${card}</div>`;
  assert.deepEqual((await browseAnimeSaturn({ query: "nothing" }, undefined, fixture(empty))).items, []);
});

test("title lists expose ordered episodes with exact collection positions", async () => {
  const page = await loadAnimeSaturnList(titleUrl, undefined, fixture(title(2)));
  assert.equal(page.item?.kind, "collection");
  assert.equal(page.description, "A pirate’s story.");
  assert.equal(page.item?.duration, 1440);
  assert.deepEqual(page.items.map(item => item.url), [episodeUrl(1), episodeUrl(2)]);
  assert.deepEqual(page.items[1]?.collection, { title: "One Piece Sub ITA", url: titleUrl, index: 1 });
  assert.ok(page.items.every(item => item.kind === "media" && item.thumbnail === image));
  const direct = await browseAnimeSaturn({ url: episodeUrl(2) }, undefined, fixture(episode));
  assert.equal(direct.item?.kind, "media");
  assert.deepEqual(direct.items, [direct.item]);
  assert.deepEqual(direct.parent, { title: "One Piece Sub ITA", url: titleUrl });
});

test("large titles browse bounded public chunks, while queue loading enforces 500 entries", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const route = (url: string, init?: RequestInit) => {
    if (url === titleUrl) return title(1180);
    assert.equal(url, `${origin}/wp-admin/admin-ajax.php`);
    assert.equal(init?.method, "POST");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init?.body))), { action: "miruro_load_eplchunk", nonce: "6fa8057845", series: "70221", page: "23" });
    return JSON.stringify({ success: true, data: { html: rows(1151, 1180) } });
  };
  const first = await browseAnimeSaturn({ url: titleUrl }, undefined, fixture(route, requests));
  assert.equal(first.items.length, 50);
  assert.equal(first.nextCursor, "1");
  assert.equal(requests.length, 1);
  const last = await browseAnimeSaturn({ url: titleUrl, cursor: "23" }, undefined, fixture(route, requests));
  assert.equal(last.items.length, 30);
  assert.equal(last.items[0]?.collection?.index, 1150);
  assert.equal(last.items.at(-1)?.collection?.index, 1179);
  assert.equal(last.nextCursor, undefined);
  const before = requests.length;
  await assert.rejects(() => loadAnimeSaturnList(titleUrl, undefined, fixture(route, requests)), /more than 500 episodes/);
  assert.equal(requests.length, before + 1);
});

test("queue loading gathers every chunk and rejects incomplete or repeated upstream rows", async () => {
  const route = (url: string) => url === titleUrl ? title(51) : JSON.stringify({ success: true, data: { html: row(51) } });
  const page = await loadAnimeSaturnList(titleUrl, undefined, fixture(route));
  assert.equal(page.items.length, 51);
  assert.equal(page.items.at(-1)?.collection?.index, 50);
  for (const html of ["", row(1)]) await assert.rejects(() => loadAnimeSaturnList(titleUrl, undefined, fixture(url => url === titleUrl ? title(51) : JSON.stringify({ success: true, data: { html } }))), /changed this page/);
  await assert.rejects(() => browseAnimeSaturn({ url: titleUrl, cursor: "1" }, undefined, fixture(url => url === titleUrl ? title(51) : '{"success":false}')), /changed this page/);
});

test("invalid inputs and upstream changes cannot become unrelated queue entries", async () => {
  let calls = 0;
  const never = fixture(() => { calls++; throw new Error("unexpected fetch"); });
  for (const input of [{ url: "https://example.com/anime/" }, { url: `${origin}/wp-admin/` }, { query: "x" }, { cursor: "https://example.com/" }, { cursor: "0" }]) await assert.rejects(() => browseAnimeSaturn(input, undefined, never));
  await assert.rejects(() => loadAnimeSaturnList(`${origin}/anime/`, undefined, never));
  assert.equal(calls, 0);
  for (const html of ["<html>Challenge page</html>", title(2).replace('data-series="70221"', 'data-series="private"'), title(2).replace(episodeUrl(1), "https://private.example/episode-1/")]) await assert.rejects(() => loadAnimeSaturnList(titleUrl, undefined, fixture(html)), /changed this page/);
  await assert.rejects(() => animeSaturnTitle(episodeUrl(2), undefined, fixture(episode.replace("http://schema.org/Episode", "http://schema.org/WebPage"))), /changed this page/);
  await assert.rejects(() => browseAnimeSaturn({}, undefined, fixture("<html>Challenge page</html>")), /changed this page/);
});

test("requests bound streamed bodies and stop reads on cancellation", async () => {
  const cancellation = new AbortController();
  let cancelled = false;
  const request = (async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<html>")); }, cancel() { cancelled = true; } }))) as typeof fetch;
  const pending = animeSaturnText(titleUrl, cancellation.signal, request);
  cancellation.abort();
  await assert.rejects(() => pending, error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(cancelled, true);
  await assert.rejects(() => animeSaturnText(titleUrl, undefined, fixture(new Array(2 * 1024 * 1024 + 2).join("x"))), /changed this page/);
});
