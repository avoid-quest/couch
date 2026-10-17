import assert from "node:assert/strict";
import { test } from "node:test";
import { animeUnityOrigin, animeUnityPageUrl, isAnimeUnityHost } from "../src/shared/animeunity";
import { animeUnityText, animeUnityTitle, browseAnimeUnity, loadAnimeUnityList } from "../src/server/providers/animeunity";
import { resolveAnimeUnityLink } from "../src/server/animeunity";

const anime = `${animeUnityOrigin}/anime/12-one-piece`;
const episode = `${anime}/5987`;
// Reduced public fields observed in /archivio, /anime/12-one-piece, /info_api
// and the linked Vixcloud embed on 2026-10-17. IDs/numbers vary in edge cases.
const row = { id: 12, slug: "one-piece", title: null, title_eng: "One Piece", imageurl: "https://img.animeunity.so/anime/one-piece.jpg", plot: "A pirate&#039;s adventure.", date: "1999", type: "TV", dub: 0, episodes_length: 24 };
const ep = (number = 1, extra: Record<string, unknown> = {}) => ({ id: 5986 + number, anime_id: 12, number: String(number), public: 1, scws_id: 304644 + number, link: "One.Piece.mkv", ...extra });
const attribute = (value: unknown) => JSON.stringify(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const embed = "https://vixcloud.co/embed/304645?token=55119f2c6d8c2ba4fc85ee216976e62e&expires=1797414560&canPlayFHD=1";
function titleHtml(rows = [ep(), ep(2)], count = 2, selected: unknown = rows[0], extra: Record<string, unknown> = {}) {
  return `<video-player anime="${attribute({ ...row, ...extra })}" episode="${attribute(selected)}" episodes="${attribute(rows)}" episodes_count="${count}" embed_url="${embed.replace(/&/g, "&amp;")}"></video-player>`;
}
function archiveHtml(rows: unknown[], total = rows.length) {
  return `<meta name="csrf-token" content="JgDTH2JZ5KXR9AIq1112AtObea7nh6PpxOtkxioi"><archivio records="${attribute(rows)}" tot_count="${total}"></archivio>`;
}
const cookies = { "Set-Cookie": "animeunity_session=anonymous; Path=/; HttpOnly" };
type Call = { url: string; init?: RequestInit };
const fixture = (body: string | ((call: Call) => string | Response), calls: Call[] = []) => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const call = { url: String(input), init };
  calls.push(call);
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.redirect, "error");
  const result = typeof body === "function" ? body(call) : body;
  return result instanceof Response ? result : new Response(result);
}) as typeof fetch;

test("AnimeUnity canonical references distinguish title and database episode IDs", () => {
  assert.equal(animeUnityPageUrl("http://animeunity.so/anime/12-one-piece/5987/")?.href, episode);
  assert.equal(animeUnityPageUrl(`${anime}/`)?.href, anime);
  assert.equal(isAnimeUnityHost("www.animeunity.so"), true);
  for (const value of [episode.replace("animeunity.so", "animeunity.so.evil.example"), episode.replace("www.", "cdn."), `${episode}?token=private`, `${episode}#x`, episode.replace("https://", "https://user:secret@"), episode.replace(".so/", ".so:444/"), `${anime}/0`, `${anime}/1/2`, `${anime}/%31`, `${anime}/5987\n`]) assert.equal(animeUnityPageUrl(value), undefined, value);
});

test("catalogue and search read only public collection metadata", async () => {
  const calls: Call[] = [];
  const page = await browseAnimeUnity({ query: "one & piece" }, undefined, fixture(archiveHtml([row, { ...row, id: 20, slug: "../../bad" }]), calls));
  assert.equal(new URL(calls[0]!.url).pathname, "/archivio");
  assert.equal(new URL(calls[0]!.url).searchParams.get("title"), "one & piece");
  assert.equal(page.item, undefined);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.url, anime);
  assert.equal(page.items[0]?.kind, "collection");
  assert.equal(page.items[0]?.description, "A pirate's adventure.");
  assert.equal(page.items[0]?.subtitle, "1999 · TV · SUB ITA");
});

test("catalogue pagination follows the public CSRF protocol with temporary anonymous cookies", async () => {
  const calls: Call[] = [];
  const firstRows = Array.from({ length: 30 }, (_, index) => ({ ...row, id: index + 1 }));
  const request = fixture(call => {
    if (call.init?.method !== "POST") return new Response(archiveHtml(firstRows, 31), { headers: cookies });
    assert.equal(call.url, `${animeUnityOrigin}/archivio/get-animes`);
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.Cookie, "animeunity_session=anonymous");
    assert.equal(headers["X-CSRF-TOKEN"], "JgDTH2JZ5KXR9AIq1112AtObea7nh6PpxOtkxioi");
    assert.deepEqual(JSON.parse(String(call.init.body)), { title: "one piece", offset: 30, type: false, year: false, order: false, status: false, genres: false, dubbed: false, season: false });
    return JSON.stringify({ records: [row], tot: 31 });
  }, calls);
  assert.equal((await browseAnimeUnity({ query: "one piece" }, undefined, request)).nextCursor, "30");
  const next = await browseAnimeUnity({ query: "one piece", cursor: "30" }, undefined, request);
  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, undefined);
  assert.equal(calls.length, 3);
});

test("title rows carry ordered episode identities, exact known indices and parent metadata", async () => {
  const page = await browseAnimeUnity({ url: anime }, undefined, fixture(titleHtml()));
  assert.equal(page.item?.kind, "collection");
  assert.deepEqual(page.items.map(item => item.url), [episode, `${anime}/5988`]);
  assert.deepEqual(page.items[1]?.collection, { title: "One Piece", url: anime, index: 1 });
  const direct = await browseAnimeUnity({ url: `${anime}/5988` }, undefined, fixture(titleHtml([ep(), ep(2)], 2, ep(2))));
  assert.equal(direct.item?.kind, "media");
  assert.equal(direct.item?.title, "One Piece — Episode 2");
  assert.deepEqual(direct.items, [direct.item]);
  assert.deepEqual(direct.parent, direct.item?.collection);
});

test("large anime browse one bounded range and omit unknown occurrence indices", async () => {
  const calls: Call[] = [];
  const rows = Array.from({ length: 120 }, (_, index) => ep(index + 1));
  const request = fixture(call => call.url.includes("/info_api/") ? JSON.stringify({ episodes_count: 300, episodes: [ep(121), ep(122)] }) : titleHtml(rows, 300), calls);
  const page = await browseAnimeUnity({ url: anime, cursor: "121" }, undefined, request);
  assert.equal(page.items[0]?.title, "One Piece — Episode 121");
  assert.deepEqual(page.items[0]?.collection, { title: "One Piece", url: anime });
  assert.equal(page.nextCursor, "241");
  assert.deepEqual(calls.map(call => call.url), [anime, `${animeUnityOrigin}/info_api/12/1?start_range=121&end_range=240`]);
});

test("queue lists collect bounded ranges and never silently truncate a long anime", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => ep(index + 1));
  const page = await loadAnimeUnityList(anime, undefined, fixture(call => call.url.includes("/info_api/") ? JSON.stringify({ episodes_count: 122, episodes: [ep(121), ep(122)] }) : titleHtml(rows, 122)));
  assert.equal(page.items.length, 122);
  assert.equal(page.items.at(-1)?.collection?.index, 121);
  const calls: Call[] = [];
  await assert.rejects(() => loadAnimeUnityList(anime, undefined, fixture(titleHtml(rows, 1180), calls)), /more than 500/);
  assert.equal(calls.length, 1);
});

test("unpublished episodes and malformed title identities cannot enter playable lists", async () => {
  const page = await loadAnimeUnityList(anime, undefined, fixture(titleHtml([ep(), ep(2, { public: 0 })])));
  assert.deepEqual(page.items.map(item => item.url), [episode]);
  await assert.rejects(() => animeUnityTitle(`${anime}/5988`, undefined, fixture(titleHtml([ep(), ep(2, { public: 0 })], 2, ep(2, { public: 0 })))), /does not have this episode/);
  await assert.rejects(() => animeUnityTitle(anime, undefined, fixture(titleHtml([ep()], 1, ep(), { id: 999 }))), /changed this page/);
  const long = await browseAnimeUnity({ url: anime }, undefined, fixture(titleHtml([ep()], 1, ep(), { title_eng: "x".repeat(200) })));
  assert.equal(long.items[0]?.title.length, 200);
});

test("invalid URL targets, cursors and queries fail before requests", async () => {
  let calls = 0;
  const never = (async () => { calls++; throw new Error("Unexpected request"); }) as typeof fetch;
  for (const request of [{ url: "https://evil.example/archivio" }, { url: `${animeUnityOrigin}/embed-url/5987` }, { url: `${animeUnityOrigin}/archivio?token=secret` }, { url: anime, cursor: "2" }, { url: episode, cursor: "121" }, { cursor: "https://evil.example" }, { query: "x" }, { cursor: "31" }]) await assert.rejects(() => browseAnimeUnity(request, undefined, never));
  await assert.rejects(() => loadAnimeUnityList(`${animeUnityOrigin}/archivio`, undefined, never));
  assert.equal(calls, 0);
});

test("provider requests cancel streamed bodies and enforce a response bound", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const request = (async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<html>")); }, cancel() { cancelled = true; } }))) as typeof fetch;
  const pending = animeUnityText(anime, abort.signal, request);
  abort.abort();
  await assert.rejects(() => pending, error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(cancelled, true);
  await assert.rejects(() => animeUnityText(anime, undefined, fixture(() => new Response(new Uint8Array(4 * 1024 * 1024 + 1)))), /changed this page/);
});

const playerHtml = `<script>window.masterPlaylist = { params: { 'token': 'aff47512f4e237ec21d794b0d15b03c7', 'expires': '1797414595', 'asn': '', }, url: 'https://vixcloud.co/playlist/304645?b=1', }</script>`;
const manifest = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480\nhttps://vixcloud.co/playlist/304645?type=video\n";
const playback = (html = playerHtml, hls = manifest, calls: Call[] = []) => fixture(call => call.url.startsWith(`${animeUnityOrigin}/anime/`) ? titleHtml() : call.url.startsWith("https://vixcloud.co/embed/") ? html : hls, calls);

test("Vixcloud resolution copies the public playlist protocol and retains episode metadata", async () => {
  const calls: Call[] = [];
  const media = await resolveAnimeUnityLink(episode, undefined, playback(playerHtml, manifest, calls));
  const url = new URL(media.url);
  assert.equal(url.pathname, "/playlist/304645");
  assert.equal(url.searchParams.get("token"), "aff47512f4e237ec21d794b0d15b03c7");
  assert.equal(url.searchParams.get("expires"), "1797414595");
  assert.equal(url.searchParams.get("h"), "1");
  assert.equal(url.searchParams.has("asn"), false);
  assert.equal(media.metadata.title, "One Piece — Episode 1");
  assert.equal(media.metadata.duration, 1440);
  assert.deepEqual(media.headers, { "User-Agent": "Mozilla/5.0", Referer: "https://vixcloud.co/" });
  assert.deepEqual(media.subtitles, []);
  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.url, embed);
});

test("changed player fields, foreign playlists and non-HLS responses fail closed", async () => {
  for (const html of [playerHtml.replace("/playlist/304645", "/playlist/999"), playerHtml.replace("vixcloud.co/playlist", "evil.example/playlist"), playerHtml.replace("aff47512f4e237ec21d794b0d15b03c7", "'+runCode()+'"), playerHtml.replace("'asn': ''", "'arbitrary': 'secret'"), "<script>window.masterPlaylist = eval('remote')</script>"]) await assert.rejects(() => resolveAnimeUnityLink(episode, undefined, playback(html)), /changed its player/);
  await assert.rejects(() => resolveAnimeUnityLink(episode, undefined, playback(playerHtml, "<html>Challenge</html>")), /direct stream is unavailable/);
  const calls: Call[] = [];
  await assert.rejects(() => resolveAnimeUnityLink(anime, undefined, playback(playerHtml, manifest, calls)), /Choose an episode/);
  assert.equal(calls.length, 0);
});

test("legacy progressive playback accepts the site's observed public file host", async () => {
  const direct = "https://srv18-tsurukusa.sweetpixel.org/DDL/ANIME/OnePieceITA/OnePiece_Ep_940_ITA.mp4";
  const body = titleHtml([ep(1, { scws_id: null, link: direct })]);
  const calls: Call[] = [];
  assert.equal((await resolveAnimeUnityLink(episode, undefined, fixture(body, calls))).url, direct);
  assert.equal(calls.length, 1);
  await assert.rejects(() => resolveAnimeUnityLink(episode, undefined, fixture(body.replace("srv18-tsurukusa.sweetpixel.org", "localhost"))), /direct stream is unavailable/);
});
