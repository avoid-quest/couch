import assert from "node:assert/strict";
import { test } from "node:test";
import { animeUnityOrigin, animeUnityPageUrl, isAnimeUnityHost } from "../src/shared/animeunity";
import { animeUnityText, animeUnityTitle, browseAnimeUnity, loadAnimeUnityList } from "../src/server/providers/animeunity";
import { resolveAnimeUnityLink } from "../src/server/animeunity";
import { createProviders } from "../src/server/providers";
import { createForLater } from "../src/server/for-later";
import { providerItemId } from "../src/server/providers/http";

const transport = "https://www.animeunity.to";
const anime = `${animeUnityOrigin}/anime/12-one-piece`;
const episode = `${anime}/5987`;
// Reduced public fields observed in /archivio, /anime/12-one-piece, /info_api
// and the linked Vixcloud embed; domains rechecked on 2026-10-19. IDs/numbers vary in edge cases.
const row = { id: 12, slug: "one-piece", title: null, title_eng: "One Piece", imageurl: "https://img.animeunity.so/anime/one-piece.jpg", plot: "A pirate&#039;s adventure.", date: "1999", type: "TV", dub: 0, episodes_length: 24 };
const ep = (number = 1, extra: Record<string, unknown> = {}) => ({ id: 5986 + number, anime_id: 12, number: String(number), public: 1, scws_id: 304644 + number, link: "One.Piece.mkv", ...extra });
const attribute = (value: unknown) => JSON.stringify(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const embed = "https://vixcloud.cc/embed/304645?token=55119f2c6d8c2ba4fc85ee216976e62e&expires=1797414560&canPlayFHD=1";
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
  for (const value of [episode.replace("/anime/", ".evil.example/anime/"), episode.replace("www.", "cdn."), `${episode}?token=private`, `${episode}#x`, episode.replace("https://", "https://user:secret@"), episode.replace("/anime/", ":444/anime/"), `${anime}/0`, `${anime}/1/2`, `${anime}/%31`, `${anime}/5987\n`]) assert.equal(animeUnityPageUrl(value), undefined, value);
});

test("AnimeUnity uses its moved origin for browsing and legacy saved episode playback", async () => {
  assert.equal(animeUnityOrigin, "https://www.animeunity.so");
  for (const host of ["animeunity.to", "www.animeunity.to", "animeunity.so", "www.animeunity.so"]) {
    assert.equal(isAnimeUnityHost(host), true);
    assert.equal(animeUnityPageUrl(`https://${host}/anime/12-one-piece/5987`)?.href, episode);
  }
  for (const host of ["animeunity.to.evil.example", "cdn.animeunity.to", "notanimeunity.to"]) assert.equal(isAnimeUnityHost(host), false);
  const calls: Call[] = [];
  await browseAnimeUnity({}, undefined, fixture(archiveHtml([row]), calls));
  await browseAnimeUnity({ url: "https://www.animeunity.so/archivio?title=naruto" }, undefined, fixture(archiveHtml([row]), calls));
  await browseAnimeUnity({ url: "https://www.animeunity.so/anime/12-one-piece" }, undefined, fixture(titleHtml(), calls));
  await resolveAnimeUnityLink("https://www.animeunity.so/anime/12-one-piece/5987", undefined, playback(playerHtml, manifest, calls));
  assert.deepEqual(calls.slice(0, 4).map(call => call.url), [
    "https://www.animeunity.to/archivio",
    "https://www.animeunity.to/archivio?title=naruto",
    "https://www.animeunity.to/anime/12-one-piece",
    "https://www.animeunity.to/anime/12-one-piece/5987",
  ]);
  assert.equal((calls[4]?.init?.headers as Record<string, string>).Referer, "https://www.animeunity.to/");
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

const tracker = "https://domains-tracker.server66.workers.dev/get";
const moved = "https://www.animeunity.test";
const recoveryFixture = (handle: (call: Call) => Response | Promise<Response>, calls: Call[] = []) => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const call = { url: String(input), init };
  calls.push(call);
  assert.equal(init?.credentials, "omit");
  assert.ok(init?.signal);
  return handle(call);
}) as typeof fetch;

test("a domain redirect heals browsing, search pagination and saved title requests", async () => {
  const calls: Call[] = [];
  const request = recoveryFixture(call => {
    if (call.url.startsWith("https://vixcloud.cc/")) {
      if (call.url.includes("/embed/")) assert.equal(new Headers(call.init?.headers).get("referer"), `${moved}/`);
      return new Response(call.url.includes("/embed/") ? playerHtml : manifest);
    }
    if (call.url.startsWith(transport)) return new Response(null, { status: 302, headers: { Location: moved } });
    assert.ok(call.url.startsWith(moved));
    if (call.init?.method === "POST") {
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get("referer"), `${moved}/archivio?title=naruto`);
      assert.equal(headers.get("cookie"), "animeunity_session=anonymous");
      return new Response(JSON.stringify({ records: [row], tot: 31 }));
    }
    return call.url.includes("/anime/") ? new Response(titleHtml()) : new Response(archiveHtml([row], 31), { headers: cookies });
  }, calls);
  assert.equal((await browseAnimeUnity({}, undefined, request)).items[0]?.url, anime);
  assert.equal((await browseAnimeUnity({ query: "naruto", cursor: "30" }, undefined, request)).items.length, 1);
  assert.equal((await browseAnimeUnity({ url: "https://animeunity.so/anime/12-one-piece" }, undefined, request)).items.length, 2);
  assert.equal((await resolveAnimeUnityLink(episode, undefined, request)).metadata.title, "One Piece — Episode 1");
  const before = calls.length;
  await assert.rejects(() => animeUnityText(`${transport}/archivio/get-animes`, undefined, request, { method: "POST", headers: { Referer: `${transport}/archivio`, Cookie: "animeunity_session=old" } }), /changed this page/);
  assert.equal(calls.length, before);
  assert.deepEqual(calls.slice(0, 4).map(call => [call.url, call.init?.redirect]), [
    [`${transport}/archivio`, "error"], [`${transport}/archivio`, "manual"],
    [`${moved}/archivio`, "manual"], [`${moved}/archivio`, "error"],
  ]);
  assert.equal(calls.some(call => call.url === tracker), false);
});

test("a dead origin recovers from the tracker's AnimeUnity entry only after validating the catalogue", async () => {
  const calls: Call[] = [];
  const request = recoveryFixture(call => {
    if (call.url.startsWith(transport)) throw new TypeError("getaddrinfo ENOTFOUND");
    if (call.url === tracker) return new Response(JSON.stringify({ animeunity: { full_url: `${moved}/` } }));
    assert.equal(new URL(call.url).origin, moved);
    return new Response(archiveHtml([row]));
  }, calls);
  assert.equal((await browseAnimeUnity({ query: "naruto" }, undefined, request)).items.length, 1);
  assert.equal((await browseAnimeUnity({}, undefined, request)).items.length, 1);
  assert.equal(calls.filter(call => call.url === tracker).length, 1);
  assert.ok(calls.some(call => call.url === `${moved}/archivio?title=naruto`));
});

test("concurrent failures share recovery and redirected loops stay bounded", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let lookups = 0;
  const request = recoveryFixture(async call => {
    if (call.url.startsWith(transport)) throw new TypeError("getaddrinfo ENOTFOUND");
    if (call.url === tracker) {
      lookups++;
      release();
      return new Response(JSON.stringify({ animeunity: { full_url: moved } }));
    }
    await gate;
    return new Response(archiveHtml([row]));
  });
  const pages = await Promise.all([browseAnimeUnity({}, undefined, request), browseAnimeUnity({ query: "naruto" }, undefined, request)]);
  assert.deepEqual(pages.map(page => page.items.length), [1, 1]);
  assert.equal(lookups, 1);
  const calls: Call[] = [];
  const loop = recoveryFixture(call => call.url === tracker ? new Response("{}") : new Response(null, { status: 302, headers: { Location: call.url.startsWith(transport) ? moved : transport } }), calls);
  await assert.rejects(() => browseAnimeUnity({}, undefined, loop), /did not load/);
  assert.equal(calls.filter(call => call.init?.redirect === "manual").length, 4);
});

test("invalid redirects and tracker addresses are never fetched", async () => {
  for (const candidate of ["https://animeunity.to.evil.example", "https://127.0.0.1", "https://cdn.animeunity.to", "http://animeunity.test", "https://user:secret@animeunity.test", "https://animeunity.test:444", "https://animeunity.test/?token=private"]) {
    const request = recoveryFixture(call => {
      if (call.url.startsWith(transport)) return new Response(null, { status: 302, headers: { Location: candidate } });
      assert.equal(call.url, tracker);
      return new Response(JSON.stringify({ animeunity: { full_url: candidate } }));
    });
    await assert.rejects(() => browseAnimeUnity({}, undefined, request), /did not load/);
  }
});

test("a tracker candidate serving a challenge is rejected and failed recovery is throttled", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let lookups = 0;
  const request = recoveryFixture(call => {
    if (call.url.startsWith(transport)) throw new TypeError("getaddrinfo ENOTFOUND");
    if (call.url === tracker) { lookups++; return new Response(JSON.stringify({ animeunity: { full_url: moved } })); }
    assert.equal(call.url, `${moved}/archivio`);
    return new Response("<html>Just a moment...</html>");
  });
  for (let i = 0; i < 2; i++) await assert.rejects(() => browseAnimeUnity({}, undefined, request), /ENOTFOUND/);
  assert.equal(lookups, 1);
  t.mock.timers.tick(600_001);
  await assert.rejects(() => browseAnimeUnity({}, undefined, request), /ENOTFOUND/);
  assert.equal(lookups, 2);
});

test("missing titles and failed POSTs do not trigger domain recovery", async () => {
  for (const init of [{}, { method: "POST" }]) {
    const calls: Call[] = [];
    const request = recoveryFixture(() => new Response(null, { status: init.method ? 419 : 404 }), calls);
    await assert.rejects(() => animeUnityText(anime, undefined, request, init));
    assert.equal(calls.length, 1);
  }
});

test("recovery can finish after its caller leaves and serve the next attempt", async () => {
  const abort = new AbortController();
  let probes = 0;
  const request = recoveryFixture(call => {
    if (call.url.startsWith(transport)) throw new TypeError("getaddrinfo ENOTFOUND");
    if (call.url === tracker) return new Response(JSON.stringify({ animeunity: { full_url: moved } }));
    if (++probes === 1) abort.abort();
    return new Response(archiveHtml([row]));
  });
  await assert.rejects(() => browseAnimeUnity({}, abort.signal, request), error => error === abort.signal.reason);
  assert.equal((await browseAnimeUnity({}, undefined, request)).items.length, 1);
  assert.equal(probes, 2);
});

test("catalogue pagination follows the public CSRF protocol with temporary anonymous cookies", async () => {
  const calls: Call[] = [];
  const firstRows = Array.from({ length: 30 }, (_, index) => ({ ...row, id: index + 1 }));
  const request = fixture(call => {
    if (call.init?.method !== "POST") return new Response(archiveHtml(firstRows, 31), { headers: cookies });
    assert.equal(call.url, `${transport}/archivio/get-animes`);
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

test("short catalogue pages advance by their returned row count", async () => {
  const rows = [row, { ...row, id: 20 }];
  const calls: Call[] = [];
  const request = fixture(call => {
    if (call.init?.method !== "POST") return new Response(archiveHtml(rows, 4), { headers: cookies });
    assert.equal(JSON.parse(String(call.init.body)).offset, 2);
    return JSON.stringify({ records: [{ ...row, id: 21 }, { ...row, id: 22 }], tot: 4 });
  }, calls);
  const first = await browseAnimeUnity({}, undefined, request);
  assert.equal(first.nextCursor, "2");
  const last = await browseAnimeUnity({ cursor: first.nextCursor }, undefined, request);
  assert.equal(last.items.length, 2);
  assert.equal(last.nextCursor, undefined);
  assert.equal(calls.length, 3);
});

test("empty catalogue pages cannot hide advertised remaining results", async () => {
  await assert.rejects(() => browseAnimeUnity({}, undefined, fixture(archiveHtml([], 1))), /changed this page/);
  const request = fixture(call => call.init?.method === "POST" ? JSON.stringify({ records: [], tot: 31 }) : new Response(archiveHtml([row], 31), { headers: cookies }));
  await assert.rejects(() => browseAnimeUnity({ cursor: "30" }, undefined, request), /changed this page/);
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
  assert.deepEqual(calls.map(call => call.url), [anime.replace(animeUnityOrigin, transport), `${transport}/info_api/12/1?start_range=121&end_range=240`]);
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

test("incomplete episode ranges never produce a shortened queue with shifted indices", async () => {
  const first = Array.from({ length: 120 }, (_, index) => ep(index + 1));
  for (const last of [[], [ep(121)], [ep(122)]]) {
    const request = fixture(call => call.url.includes("/info_api/") ? JSON.stringify({ episodes_count: 122, episodes: last }) : titleHtml(first, 122));
    await assert.rejects(() => loadAnimeUnityList(anime, undefined, request), /changed this page/);
  }
  const request = fixture(call => call.url.includes("/info_api/") ? JSON.stringify({ episodes_count: 122, episodes: [ep(121), ep(122)] }) : titleHtml(first.filter(row => row.number !== "60"), 122));
  await assert.rejects(() => loadAnimeUnityList(anime, undefined, request), /changed this page/);
});

test("combined and unpublished rows contribute coverage before queue filtering", async () => {
  const first = Array.from({ length: 120 }, (_, index) => ep(index + 1));
  const request = fixture(call => call.url.includes("/info_api/") ? JSON.stringify({ episodes_count: 123, episodes: [ep(121, { number: "121-122" }), ep(123, { public: 0 })] }) : titleHtml(first, 123));
  const page = await loadAnimeUnityList(anime, undefined, request);
  assert.equal(page.items.length, 121);
  assert.equal(page.items.at(-1)?.title, "One Piece — Episode 121-122");
  assert.equal(page.items.at(-1)?.collection?.index, 120);
  for (const [number, count] of [["1-2", 2], ["1-2-3", 3], ["1-2-3-4", 4]] as const) {
    const combined = await loadAnimeUnityList(anime, undefined, fixture(titleHtml([ep(1, { number })], count)));
    assert.equal(combined.items.length, 1);
    assert.equal(combined.items[0]?.collection?.index, 0);
  }
  await assert.rejects(() => loadAnimeUnityList(anime, undefined, fixture(titleHtml([ep(1, { number: "1-3" })], 3))), /changed this page/);
});

test("unpublished episodes and malformed title identities cannot enter playable lists", async () => {
  const title = await animeUnityTitle(anime, undefined, fixture(titleHtml([ep(), ep(2, { public: 0, link: "private-file.mkv" })])));
  assert.deepEqual(title.episodes.map(row => row.id), [5987]);
  assert.equal(JSON.stringify(title).includes("private-file.mkv"), false);
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
  for (const request of [{ url: "https://evil.example/archivio" }, { url: `${animeUnityOrigin}/embed-url/5987` }, { url: `${transport}/archivio?token=secret` }, { url: anime, cursor: "2" }, { url: episode, cursor: "121" }, { cursor: "https://evil.example" }, { query: "x" }, { cursor: "100001" }]) await assert.rejects(() => browseAnimeUnity(request, undefined, never));
  await assert.rejects(() => loadAnimeUnityList(`${transport}/archivio`, undefined, never));
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

const playerHtml = `<script>window.masterPlaylist = { params: { 'token': 'aff47512f4e237ec21d794b0d15b03c7', 'expires': '1797414595', 'asn': '', }, url: 'https://vixcloud.cc/playlist/304645?b=1', }</script>`;
const manifest = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480\nhttps://vixcloud.cc/playlist/304645?type=video\n";
const playback = (html = playerHtml, hls = manifest, calls: Call[] = []) => fixture(call => call.url.startsWith(`${transport}/anime/`) ? titleHtml() : call.url.startsWith("https://vixcloud.cc/embed/") ? html : hls, calls);

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
  assert.deepEqual(media.headers, { "User-Agent": "Mozilla/5.0", Referer: "https://vixcloud.cc/" });
  assert.deepEqual(media.subtitles, []);
  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.url, embed);
});

test("playback follows the Vixcloud domain published by AnimeUnity and pins the playlist to it", async () => {
  for (const host of ["vixcloud.co", "vixcloud.test"]) {
    const request = fixture(call => call.url.startsWith(transport) ? titleHtml().replaceAll("vixcloud.cc", host)
      : call.url.includes("/embed/") ? playerHtml.replaceAll("vixcloud.cc", host) : manifest.replaceAll("vixcloud.cc", host));
    assert.equal(new URL((await resolveAnimeUnityLink(episode, undefined, request)).url).hostname, host);
  }
  for (const host of ["vixcloud.cc.evil.example", "cdn.vixcloud.cc", "localhost"]) {
    await assert.rejects(() => resolveAnimeUnityLink(episode, undefined, fixture(titleHtml().replaceAll("vixcloud.cc", host))), /changed its player/);
  }
  await assert.rejects(() => resolveAnimeUnityLink(episode, undefined, playback(playerHtml.replaceAll("vixcloud.cc", "vixcloud.co"))), /changed its player/);
});

test("changed player fields, foreign playlists and non-HLS responses fail closed", async () => {
  for (const html of [playerHtml.replace("/playlist/304645", "/playlist/999"), playerHtml.replace("vixcloud.cc/playlist", "evil.example/playlist"), playerHtml.replace("aff47512f4e237ec21d794b0d15b03c7", "'+runCode()+'"), playerHtml.replace("'asn': ''", "'arbitrary': 'secret'"), "<script>window.masterPlaylist = eval('remote')</script>"]) await assert.rejects(() => resolveAnimeUnityLink(episode, undefined, playback(html)), /changed its player/);
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


for (const target of [{}, { query: "naruto" }, { url: anime }, { url: episode }]) {
  test(`HTTP 200 placeholder recovers ${JSON.stringify(target)}`, async () => {
    const calls: Call[] = [];
    const request = recoveryFixture(call => {
      if (call.url.startsWith(transport)) return new Response("<html>Parked. Just a moment...</html>");
      if (call.url === tracker) return Response.json({ animeunity: { full_url: moved } });
      assert.equal(new URL(call.url).origin, moved);
      return new Response(call.url.includes("/anime/") ? titleHtml() : archiveHtml([row]));
    }, calls);
    assert.ok((await browseAnimeUnity(target, undefined, request)).items.length > 0);
    assert.equal(calls.filter(call => call.url === tracker).length, 1);
  });
}

for (const cancellingInitiator of [true, false]) test(`aborting the ${cancellingInitiator ? "initiator" : "waiter"} leaves the other caller running`, async () => {
  const abort = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let lookups = 0;
  let recoverySignal: AbortSignal | null | undefined;
  const request = recoveryFixture(async call => {
    if (call.url.startsWith(transport)) throw new TypeError("getaddrinfo ENOTFOUND");
    if (call.url === tracker) {
      lookups++;
      recoverySignal = call.init?.signal;
      entered.resolve();
      await release.promise;
      recoverySignal?.throwIfAborted();
      return Response.json({ animeunity: { full_url: moved } });
    }
    return new Response(archiveHtml([row]));
  });
  const first = browseAnimeUnity({}, cancellingInitiator ? abort.signal : undefined, request);
  await entered.promise;
  const second = browseAnimeUnity({ query: "naruto" }, cancellingInitiator ? undefined : abort.signal, request);
  const rejected = assert.rejects(cancellingInitiator ? first : second, error => error === abort.signal.reason);
  const remaining = cancellingInitiator ? second : first;
  const healthy = assert.doesNotReject(remaining);
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  try {
    await Promise.race([rejected, new Promise((_, reject) => setTimeout(() => reject(new Error("caller kept waiting on shared recovery")), 100))]);
    assert.equal(recoverySignal?.aborted, false);
  } finally { release.resolve(); await healthy; }
  assert.equal((await remaining).items.length, 1);
  assert.equal(lookups, 1);
});

test("existing AnimeUnity saves match browsed identities and toggle without duplicates", async () => {
  const providers = createProviders({ databasePath: ":memory:" });
  const later = createForLater({ databasePath: ":memory:", onChange() {}, lookup: async () => { throw new Error("unused"); }, prepare: async () => {}, reservePlay: () => 0, enqueue() {} });
  const send = (path: string, body?: unknown, method = body ? "POST" : "GET") => new Request(`http://localhost${path}`, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const legacyAnime = "https://www.animeunity.so/anime/12-one-piece";
  const legacyEpisode = `${legacyAnime}/5987`;
  try {
    await providers.handle(send("/api/providers/favorites", { item: { provider: "animeunity", kind: "collection", title: "One Piece", url: legacyAnime } }));
    await later.handle(send("/api/for-later", { reference: { kind: "web", title: "Episode 1", url: legacyEpisode } }));
    const collection = (await browseAnimeUnity({}, undefined, fixture(archiveHtml([row])))).items[0]!;
    const media = (await browseAnimeUnity({ url: collection.url }, undefined, fixture(titleHtml()))).items[0]!;
    const favorites = async () => (await (await providers.handle(send("/api/providers/favorites"))).json()).favorites;
    const saved = async () => (await (await later.handle(send("/api/for-later"))).json()).items;
    assert.equal(collection.id, providerItemId("animeunity", legacyAnime));
    assert.equal((await favorites())[0].id, collection.id);
    assert.equal((await saved())[0].url, media.url);
    await providers.handle(send("/api/providers/favorites", { item: collection }));
    assert.equal((await later.handle(send("/api/for-later", { reference: { kind: "web", title: media.title, url: media.url } }))).status, 200);
    assert.equal((await favorites()).length, 1);
    assert.equal((await saved()).length, 1);
    await providers.handle(send(`/api/providers/favorites/${collection.id}`, undefined, "DELETE"));
    await later.handle(send(`/api/for-later/${(await saved())[0].id}`, undefined, "DELETE"));
    assert.equal((await favorites()).length, 0);
    assert.equal((await saved()).length, 0);
    await providers.handle(send("/api/providers/favorites", { item: collection }));
    await later.handle(send("/api/for-later", { reference: { kind: "web", title: media.title, url: media.url } }));
    assert.equal((await favorites()).length, 1);
    assert.equal((await saved()).length, 1);
  } finally { providers.close(); later.close(); }
});


test("shared recovery has its own bounded deadline and throttles timeout retries", async t => {
  const deadline = new AbortController();
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms: number) => ms === 20_000 ? deadline.signal : timeout(ms));
  const entered = Promise.withResolvers<void>();
  let lookups = 0;
  const request = recoveryFixture(async call => {
    if (call.url.startsWith(transport)) throw new TypeError("getaddrinfo ENOTFOUND");
    assert.equal(call.url, tracker);
    lookups++;
    entered.resolve();
    return new Promise<Response>((_, reject) => call.init!.signal!.addEventListener("abort", () => reject(call.init!.signal!.reason), { once: true }));
  });
  const result = browseAnimeUnity({}, undefined, request);
  const rejected = assert.rejects(result, error => error === deadline.signal.reason);
  await entered.promise;
  deadline.abort(new DOMException("Recovery deadline", "TimeoutError"));
  await rejected;
  await assert.rejects(browseAnimeUnity({}, undefined, request), /ENOTFOUND/);
  assert.equal(lookups, 1);
});

test("a valid empty search does not trigger recovery", async () => {
  const calls: Call[] = [];
  assert.deepEqual((await browseAnimeUnity({ query: "missing" }, undefined, fixture(archiveHtml([], 0), calls))).items, []);
  assert.equal(calls.length, 1);
});
