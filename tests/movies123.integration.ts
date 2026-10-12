import assert from "node:assert/strict";
import { test } from "node:test";
import { browseMovies123, loadMovies123List, movies123Text, movies123Title } from "../src/server/providers/movies123";
import { createProviders } from "../src/server/providers";
import { movies123PageUrl } from "../src/shared/movies123";
import { providerForUrl, publicProviderMediaUrl } from "../src/shared/providers";
import { parseCommand } from "../src/server/validation";
import { createContinuationResolver } from "../src/server/continuation";

const origin = "https://ww8.123moviesfree.net";
const movie = `${origin}/movie/example-123/`;
const season = `${origin}/season/example-season-2-456/`;
// Reduced fixtures retain the unquoted attributes and public fields observed on
// 123MoviesFree's catalogue, search, film and season pages on 2026-10-12.
const film = `<div id=mid data-mid=123 data-mode=movie></div><button id=srv-1 class="dropdown-item server">Server 1</button><button id=srv-2 class=server>Server 2</button>
<h1 class="card-title fs-4">A &amp; B</h1><div class="fst-italic lh-sm mb-2">A traveller&rsquo;s story.</div>
<p><strong>Duration:</strong> 1h 32m</p><p><strong>Release:</strong> <a>2019</a></p><p><strong>Quality:</strong> <span>HD</span></p>`;
const series = film.replace("data-mid=123 data-mode=movie", "data-mid=456 data-mode=serie").replace("A &amp; B", "Example — Season 2")
  + `<button id=ep-1 class="list-group-item episode">Episode 1</button><button id=ep-2 class=episode>Episode 2</button><button id=ep-3 class=episode>Episode 3</button>`;
const catalog = `<main><div class="row list-movie"><a href=${movie} class="rounded poster"><h2>A &amp; B</h2></a><a href=${season} class=poster><h2>Example — Season 2</h2></a>
<a href=https://123moviesfree.net.evil.example/movie/foreign-999/ class=poster><h2>Foreign</h2></a><a href=${origin}/hls/private/master.m3u8 class=poster><h2>Stream</h2></a></div>
<a href=/movies//2/ aria-label=Next class=page-link>Next</a></main>`;

const fixture = (body: string | ((url: string) => string), requests: string[] = []) => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  requests.push(url);
  assert.equal(init?.redirect, "error");
  assert.equal(init?.credentials, "omit");
  return new Response(typeof body === "function" ? body(url) : body);
}) as typeof fetch;

test("public source references keep distinct film, season and episode identities", () => {
  assert.equal(providerForUrl(movie), "movies123");
  assert.equal(providerForUrl("https://ww9.123moviesfree.net/movie/example-123/"), "movies123");
  assert.equal(publicProviderMediaUrl(movie), movie);
  assert.equal(publicProviderMediaUrl(`${season}?episode=2`), `${season}?episode=2`);
  assert.equal(publicProviderMediaUrl(season), undefined);
  for (const host of ["ww9.123moviesfree.net", "www.123moviesfree.net", "123moviesfree.net"]) {
    assert.equal(publicProviderMediaUrl(movie.replace("ww8.123moviesfree.net", host)), movie);
    assert.equal(publicProviderMediaUrl(`${season.replace("ww8.123moviesfree.net", host)}?episode=2`), `${season}?episode=2`);
  }
  for (const value of [movie.replace("ww8.", "cdn."), movie.replace("123moviesfree.net", "123moviesfree.net.evil.example"), `${movie}?token=secret`, `${season}?episode=0`, `${season}?episode=501`, `${season}?episode=1&episode=2`, `${season}?episode=2&token=secret`, `${movie}#fragment`, movie.replace("https://", "https://user:secret@"), movie.replace(".net/", ".net:444/")]) {
    assert.equal(movies123PageUrl(value), undefined, value);
    assert.equal(publicProviderMediaUrl(value), undefined, value);
  }
});

test("catalogue cards use public detail links and follow only the next catalogue page", async () => {
  const requests: string[] = [];
  const first = await browseMovies123({}, undefined, fixture(catalog, requests));
  assert.equal(first.title, "123MoviesFree · Movies");
  assert.deepEqual(first.items.map(item => [item.title, item.kind, item.url]), [["A & B", "media", movie], ["Example — Season 2", "collection", season]]);
  assert.equal(first.nextCursor, "2");
  await browseMovies123({ cursor: first.nextCursor }, undefined, fixture(catalog, requests));
  assert.deepEqual(requests, [`${origin}/movies/`, `${origin}/movies/2/`]);
  const invalid = catalog.replace("href=/movies//2/ aria-label=Next", "href=https://private.example/2/ aria-label=Next");
  assert.equal((await browseMovies123({}, undefined, fixture(invalid))).nextCursor, undefined);
});

test("search maps films and seasons and advances a bounded offset", async () => {
  const requests: string[] = [];
  const body = JSON.stringify({ data: [{ t: "Example", s: "example-123", d: "m", q: "HD", y: 2019 }, { t: "Example — Season 2", s: "example-season-2-456", d: "s", e: 3, n: 2, q: "HD", y: 2024 }, { t: "Foreign", s: "../../bad", d: "m" }], meta: { total_items: 28 } });
  const page = await browseMovies123({ query: "Example & friend", cursor: "24" }, undefined, fixture(body, requests));
  const request = new URL(requests[0]!);
  assert.equal(request.pathname, "/searching");
  assert.equal(request.searchParams.get("q"), "Example & friend");
  assert.equal(request.searchParams.get("offset"), "24");
  assert.equal(request.searchParams.get("limit"), "24");
  assert.deepEqual(page.items.map(item => item.kind), ["media", "collection"]);
  assert.equal(page.nextCursor, "27");
  const empty = await browseMovies123({ query: "nothing" }, undefined, fixture('{"data":[],"meta":{"total_items":0}}'));
  assert.deepEqual(empty.items, []);
  assert.equal(empty.nextCursor, undefined);
});

test("film details retain their own playable item and catalogue metadata", async () => {
  const page = await browseMovies123({ url: movie }, undefined, fixture(film));
  assert.equal(page.item?.title, "A & B");
  assert.equal(page.item?.description, "A traveller’s story.");
  assert.equal(page.item?.subtitle, "2019 · HD");
  assert.equal(page.item?.duration, 5520);
  assert.equal(page.item?.kind, "media");
  assert.deepEqual(page.items, [page.item]);
});

test("season lists contain ordered playable episodes and direct episode reads strip only the selector", async () => {
  const requests: string[] = [];
  const page = await loadMovies123List(season, undefined, fixture(series));
  assert.equal(page.item?.kind, "collection");
  assert.deepEqual(page.items.map(item => item.url), [1, 2, 3].map(episode => `${season}?episode=${episode}`));
  assert.ok(page.items.every(item => item.kind === "media"));
  assert.deepEqual(page.items[1]?.collection, { title: "Example — Season 2", url: season, index: 1 });
  const direct = await browseMovies123({ url: `${season}?episode=2` }, undefined, fixture(series, requests));
  assert.equal(direct.item?.title, "Example — Season 2 — Episode 2");
  assert.deepEqual(direct.items, [direct.item]);
  assert.deepEqual(requests, [season]);
  await assert.rejects(() => movies123Title(`${season}?episode=4`, undefined, fixture(series)), /does not have this episode/);
});

test("invalid targets and changed upstream markup fail without queueing unrelated items", async () => {
  let requests = 0;
  const never = (async () => { requests++; throw new Error("unexpected request"); }) as typeof fetch;
  for (const request of [{ url: "https://example.com/movies/" }, { url: `${origin}/get/private` }, { url: `${origin}/movies2/` }, { url: movie, cursor: "2" }, { cursor: "https://example.com/" }, { query: "x" }]) {
    await assert.rejects(() => browseMovies123(request, undefined, never));
  }
  await assert.rejects(() => loadMovies123List(`${origin}/movies/`, undefined, never));
  assert.equal(requests, 0);
  for (const body of ["<html>Challenge page</html>", film.replace("data-mid=123", "data-mid=999")]) await assert.rejects(() => movies123Title(movie, undefined, fixture(body)), /changed this page/);
  await assert.rejects(() => browseMovies123({ query: "Example" }, undefined, fixture('{"data":[{"unsupported":true}],"meta":{"total_items":1}}')), /changed this page/);
});

test("catalogue requests stop on cancellation and bound streamed bodies", async () => {
  const cancellation = new AbortController();
  let cancelled = false;
  const request = (async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<html>")); }, cancel() { cancelled = true; } }))) as typeof fetch;
  const pending = movies123Text(`${origin}/movies/`, cancellation.signal, request);
  cancellation.abort();
  await assert.rejects(() => pending, error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(cancelled, true);
  await assert.rejects(() => movies123Text(`${origin}/movies/`, undefined, (async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1))) as typeof fetch), /changed this page/);
});

test("the registered source browses, caches, saves a season and accepts its queue command", async () => {
  let calls = 0;
  const providers = createProviders({ databasePath: ":memory:", browse: { movies123: (request, signal) => { calls++; return browseMovies123(request, signal, fixture(series)); } } as Parameters<typeof createProviders>[0]["browse"] });
  try {
    const browse = () => new Request(`http://localhost/api/providers/movies123/items?${new URLSearchParams({ url: season })}`);
    const response = await providers.handle(browse());
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.deepEqual(await (await providers.handle(browse())).json(), page);
    assert.equal(calls, 1);
    const saved = await providers.handle(new Request("http://localhost/api/providers/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: page.item }) }));
    assert.equal(saved.status, 200);
    const favorites = await (await providers.handle(new Request("http://localhost/api/providers/favorites"))).json();
    assert.equal(favorites.favorites[0].url, season);
    const episode = page.items[1];
    const action = { type: "enqueueProvider", provider: "movies123", shape: "atom", url: episode.url, title: episode.title, collection: episode.collection };
    assert.deepEqual(parseCommand(JSON.stringify({ type: "command", requestId: "request", action })).action, action);
    assert.throws(() => parseCommand(JSON.stringify({ type: "command", requestId: "request", action: { ...action, collection: { ...episode.collection, url: "https://example.com/season" } } })));
  } finally { providers.close(); }
});

test("automatic continuation advances within the selected season only", async () => {
  const page = await loadMovies123List(season, undefined, fixture(series));
  const first = page.items[0]!;
  const resolve = createContinuationResolver(async (provider, url) => { assert.equal(provider, "movies123"); assert.equal(url, season); return page; });
  const continuation = await resolve({ id: "first", source: `web:${first.url}`, title: first.title, collection: first.collection }, new AbortController().signal);
  assert.deepEqual(continuation?.entries.map(entry => entry.source), page.items.slice(1).map(item => `web:${item.url}`));
  const unrelated = await resolve({ id: "other", source: `web:${season}?episode=99`, title: "Other", collection: first.collection }, new AbortController().signal);
  assert.equal(unrelated, null);
});

test("pasted episodes discover their season without collection metadata", async () => {
  const page = await loadMovies123List(season, undefined, fixture(series));
  const second = page.items[1]!;
  const resolve = createContinuationResolver(async (provider, url) => { assert.equal(provider, "movies123"); assert.equal(url, season); return page; });
  const continuation = await resolve({ id: "pasted", source: `web:${second.url}`, title: second.title }, new AbortController().signal);
  assert.equal(continuation?.title, page.title);
  assert.deepEqual(continuation?.entries.map(entry => ({ source: entry.source, collection: entry.collection })), [{
    source: `web:${page.items[2]!.url}`, collection: { title: page.title, url: season, index: 2 },
  }]);
});

test("continuation matches canonical episode URLs with HTTP or a missing trailing slash", async () => {
  const page = await loadMovies123List(season, undefined, fixture(series));
  const second = page.items[1]!;
  const resolve = createContinuationResolver(async (provider, url) => { assert.equal(provider, "movies123"); assert.equal(url, season); return page; });
  const references = [second.url.replace("https:", "http:"), second.url.replace("/?", "?"), second.url.replace("https:", "http:").replace("/?", "?")];
  for (const url of references) for (const collection of [undefined, second.collection]) {
    const continuation = await resolve({ id: "canonical", source: `web:${url}`, title: second.title, collection }, new AbortController().signal);
    assert.deepEqual(continuation?.entries.map(entry => entry.source), [`web:${page.items[2]!.url}`]);
  }
});

test("continuation never matches the same episode number from another season", async () => {
  const page = await loadMovies123List(season, undefined, fixture(series));
  const first = page.items[0]!;
  const otherSeason = `${origin}/season/example-season-3-789/`;
  const requests: string[] = [];
  const resolve = createContinuationResolver(async (provider, url) => { assert.equal(provider, "movies123"); requests.push(url); return page; });
  for (const collection of [undefined, first.collection]) {
    const continuation = await resolve({ id: "other-season", source: `web:${otherSeason}?episode=1`, title: "Other season", collection }, new AbortController().signal);
    assert.equal(continuation, null);
  }
  assert.deepEqual(requests, [otherSeason, season]);
});
