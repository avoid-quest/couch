import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { browseTwitch } from "./twitch";

afterEach(() => mock.restore());

const liveStream = {
  id: "317638324066", title: "lofi hip hop radio 📚 beats to relax/study to", viewersCount: 227,
  previewImageURL: "https://static-cdn.jtvnw.net/previews-ttv/live_user_lofigirl-640x360.jpg", game: { name: "Music" },
};
const liveChannel = {
  login: "lofigirl", displayName: "LofiGirl", description: "Study - Chill - Sleep - Repeat",
  profileImageURL: "https://static-cdn.jtvnw.net/jtv_user_pictures/lofigirl.png", stream: liveStream, videos: { edges: [], pageInfo: { hasNextPage: false } },
};
const offlineChannel = { ...liveChannel, login: "lofigirlie", displayName: "LofiGirlie", stream: null };
const searchResult = (channels: unknown[], cursor = "", hasNextPage = false) => ({
  data: { searchFor: { channels: { edges: channels.map(item => ({ item })), cursor, pageInfo: { hasNextPage } } } },
});
const respond = (value: unknown) => spyOn(globalThis, "fetch").mockResolvedValue(Response.json(value));

test("public search maps live and offline channels without authentication or embedding", async () => {
  const fetch = respond(searchResult([liveChannel, offlineChannel], "MjA=", true));
  const page = await browseTwitch({ query: "LofiGirl" });
  expect(page.title).toBe("Twitch: LofiGirl");
  expect(page.nextCursor).toBe("MjA=");
  expect(page.items).toHaveLength(2);
  expect(page.items[0]).toMatchObject({
    provider: "twitch", kind: "media", title: "LofiGirl", url: "https://www.twitch.tv/lofigirl", live: true,
    description: liveStream.title, subtitle: "Music · 227 viewers", thumbnail: liveStream.previewImageURL,
  });
  expect(page.items[1]).toMatchObject({ kind: "channel", title: "LofiGirlie", live: false, subtitle: "Offline" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://gql.twitch.tv/gql");
  expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
  const headers = new Headers(init?.headers);
  expect(headers.get("Client-ID")).toBe("kimne78kx3ncx6brgo4mv6wki5h1ko");
  expect(headers.has("Authorization")).toBe(false);
  expect(headers.has("Cookie")).toBe(false);
  expect(JSON.parse(String(init?.body)).variables).toEqual({ q: "LofiGirl", options: { targets: [{ index: "CHANNEL", limit: 20 }] } });
});

test("search sends text and pagination as variables and never repeats a cursor", async () => {
  const fetch = respond(searchResult([offlineChannel], "MjA=", true));
  const search = 'music" }) { privateField }';
  const page = await browseTwitch({ query: search, cursor: "MjA=" });
  const payload = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
  expect(payload.variables).toEqual({ q: search, options: { targets: [{ index: "CHANNEL", limit: 20, cursor: "MjA=" }] } });
  expect(payload.query).not.toContain(search);
  expect(page.nextCursor).toBeUndefined();
});

test("empty search pages stop pagination and malformed channels are skipped", async () => {
  respond(searchResult([{ ...liveChannel, login: "../admin" }, { ...liveChannel, stream: {} }, null], "MjA=", true));
  expect(await browseTwitch({ query: "missing" })).toEqual({ title: "Twitch: missing", items: [] });
});

test("home returns playable streams and a categories collection without a directory cursor", async () => {
  respond({ data: { streams: { edges: [{ node: { ...liveStream, broadcaster: liveChannel } }], pageInfo: { hasNextPage: true } } } });
  const page = await browseTwitch({});
  expect(page.items[0]).toMatchObject({ kind: "collection", title: "Browse categories", url: "https://www.twitch.tv/directory" });
  expect(page.items[1]).toMatchObject({ kind: "media", live: true, title: "LofiGirl", url: "https://www.twitch.tv/lofigirl" });
  expect(page.nextCursor).toBeUndefined();
});

test("category lists and category URLs drill into the public live directory", async () => {
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ data: { games: { edges: [{ node: {
      name: "Music", slug: "music", viewersCount: 2000, boxArtURL: "https://static-cdn.jtvnw.net/ttv-boxart/26936-285x380.jpg",
    } }] } } }))
    .mockResolvedValueOnce(Response.json({ data: { game: { name: "Music", streams: { edges: [{ node: { ...liveStream, broadcaster: liveChannel } }] } } } }));
  const categories = await browseTwitch({ url: "https://www.twitch.tv/directory" });
  expect(categories.items[0]).toMatchObject({ kind: "collection", title: "Music", subtitle: "2,000 viewers", url: "https://www.twitch.tv/directory/category/music" });
  const streams = await browseTwitch({ url: categories.items[0]!.url });
  expect(streams).toMatchObject({ title: "Music", items: [{ kind: "media", live: true, title: "LofiGirl" }] });
  expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body)).variables).toEqual({ slug: "music" });
});

test("direct channel lookup keeps a stable item ID when a channel goes offline", async () => {
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ data: { user: liveChannel } }))
    .mockResolvedValueOnce(Response.json({ data: { user: { ...liveChannel, stream: null } } }));
  const live = await browseTwitch({ url: "https://twitch.tv/LofiGirl/" });
  const offline = await browseTwitch({ url: "https://www.twitch.tv/lofigirl" });
  expect(live.items[0]!.id).toBe(offline.items[0]!.id);
  expect(live.item).toMatchObject({ id: offline.item!.id, url: "https://www.twitch.tv/lofigirl", kind: "channel", title: "LofiGirl" });
  expect(live.items[0]!.live).toBe(true);
  expect(offline.items[0]).toMatchObject({ live: false, kind: "channel", description: liveChannel.description });
  expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).variables).toEqual({ login: "lofigirl" });
});

const broadcast = {
  id: "2868067605", title: "Legacy of Kain: Defiance w/Sabaku #5", lengthSeconds: 7472,
  previewThumbnailURL: "https://static-cdn.jtvnw.net/cf_vods/example/thumb-640x360.jpg", publishedAt: "2026-09-07T19:33:40Z",
};
const videoCursor = "2846192531|13831|2026-08-14T19:01:51Z|8538";
const channelVideos = (nodes: unknown[], cursor = videoCursor, hasNextPage = true) => ({ data: { user: {
  ...offlineChannel, videos: { edges: nodes.map(node => ({ node, cursor })), pageInfo: { hasNextPage } },
} } });

test("offline channel opens available past broadcasts with artwork and duration", async () => {
  const fetch = respond(channelVideos([broadcast]));
  const page = await browseTwitch({ url: "https://www.twitch.tv/lofigirlie/videos?filter=archives" });
  expect(page.items[0]).toMatchObject({ kind: "channel", live: false });
  expect(page.items[1]).toMatchObject({ kind: "media", live: false, title: broadcast.title,
    url: "https://www.twitch.tv/videos/2868067605", duration: 7472, subtitle: "Past broadcast · 2026-09-07",
    thumbnail: broadcast.previewThumbnailURL,
  });
  expect(page.nextCursor).toBeUndefined();
  const payload = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
  expect(payload.variables).toEqual({ login: "lofigirlie" });
  expect(payload.query).toContain("type:ARCHIVE,sort:TIME");
});

test("live channels keep live playback alongside distinct archived broadcasts", async () => {
  const response = channelVideos([broadcast]);
  const user = { ...response.data.user, stream: liveStream };
  respond({ data: { user } });
  const page = await browseTwitch({ url: "https://www.twitch.tv/lofigirlie" });
  expect(page.items[0]).toMatchObject({ kind: "media", live: true, url: "https://www.twitch.tv/lofigirlie" });
  expect(page.items[1]).toMatchObject({ kind: "media", live: false, url: "https://www.twitch.tv/videos/2868067605" });
  expect(page.items[0]!.id).not.toBe(page.items[1]!.id);
});

test("archive pagination is not offered when Twitch requires an integrity challenge", async () => {
  const fetch = respond(channelVideos([broadcast]));
  const url = "https://www.twitch.tv/lofigirlie";
  expect((await browseTwitch({ url })).nextCursor).toBeUndefined();
  expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).query).toContain("videos(first:50");
  await expect(browseTwitch({ url, cursor: videoCursor })).rejects.toMatchObject({ status: 400 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("malformed broadcast entries are skipped without inventing media", async () => {
  respond(channelVideos([{ ...broadcast, id: "../private" }, null, { ...broadcast, title: "" }]));
  const page = await browseTwitch({ url: "https://www.twitch.tv/lofigirlie" });
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).toBeUndefined();
});

test("broadcast metadata stays bounded and foreign artwork is omitted", async () => {
  respond(channelVideos([{ ...broadcast, lengthSeconds: -5, previewThumbnailURL: "https://example.com/a.jpg", publishedAt: "bad" }], "", false));
  const item = (await browseTwitch({ url: "https://www.twitch.tv/lofigirlie" })).items[1]!;
  expect(item.duration).toBeUndefined();
  expect(item.thumbnail).toBeUndefined();
  expect(item.subtitle).toBe("Past broadcast");
});

test("invalid URLs and unsupported cursors fail before any network request", async () => {
  const fetch = respond({});
  for (const url of [
    "https://example.com/lofigirl", "https://www.twitch.tv.evil.example/lofigirl", "https://twitch.tv@127.0.0.1/lofigirl",
    "https://user:password@twitch.tv/lofigirl", "https://twitch.tv:8443/lofigirl", "file:///lofigirl", "https://www.twitch.tv/videos/123",
    "https://www.twitch.tv/directory/category/../settings", "https://www.twitch.tv/directory/category/music%2Fsettings", "https://www.twitch.tv/%00",
  ]) await expect(browseTwitch({ url })).rejects.toMatchObject({ status: 400 });
  for (const request of [{ query: "x".repeat(201) }, { query: "a\nb" }, { cursor: "MjA=" }, { query: "music", cursor: "../private" }, { query: "music", url: "https://www.twitch.tv/lofigirl" }]) {
    await expect(browseTwitch(request)).rejects.toMatchObject({ status: 400 });
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("provider errors and integrity challenges fail once without pretending a channel is offline", async () => {
  const fetch = respond({ errors: [{ message: "failed integrity check", extensions: { code: "IntegrityCheckFailed" } }], data: { user: null } });
  await expect(browseTwitch({ url: "https://www.twitch.tv/lofigirl" })).rejects.toMatchObject({ status: 502, message: "Twitch's public catalog is unavailable. Try again shortly." });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("missing channels and categories return not found", async () => {
  spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ data: { user: null } }))
    .mockResolvedValueOnce(Response.json({ data: { game: null } }));
  await expect(browseTwitch({ url: "https://www.twitch.tv/missing_channel" })).rejects.toMatchObject({ status: 404 });
  await expect(browseTwitch({ url: "https://www.twitch.tv/directory/category/missing-category" })).rejects.toMatchObject({ status: 404 });
});

test("malformed provider responses fail and foreign thumbnail hosts are omitted", async () => {
  spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ data: {} }))
    .mockResolvedValueOnce(Response.json(searchResult([{ ...offlineChannel, profileImageURL: "https://127.0.0.1/private" }])));
  await expect(browseTwitch({ query: "lofigirl" })).rejects.toMatchObject({ status: 502 });
  expect((await browseTwitch({ query: "lofigirl" })).items[0]!.thumbnail).toBeUndefined();
});

test("cancellation reaches the request and aborts a stalled response body", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const fetch = spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode('{"data":')); setTimeout(() => controller.abort(), 10); },
      cancel() { cancelled = true; },
    }));
  }) as typeof globalThis.fetch);
  await expect(browseTwitch({}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(cancelled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(browseTwitch({}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.skipIf(process.env.COUCH_PROVIDER_NETWORK_TESTS !== "1")("actual Twitch public catalog returns live streams, offline channels, categories and search pagination", async () => {
  const directory = await browseTwitch({});
  const playing = directory.items.find(item => item.kind === "media");
  expect(playing?.live).toBe(true);
  expect((await browseTwitch({ url: playing!.url })).items[0]!.live).toBe(true);
  const search = await browseTwitch({ query: "lofigirl" });
  expect(search.items.some(item => item.url === "https://www.twitch.tv/lofigirl")).toBe(true);
  expect(search.items.some(item => item.live === false && item.kind === "channel")).toBe(true);
  expect(search.nextCursor).toBeDefined();
  const next = await browseTwitch({ query: "lofigirl", cursor: search.nextCursor });
  expect(next.items.length).toBeGreaterThan(0);
  expect(next.items.some(item => !search.items.some(previous => previous.id === item.id))).toBe(true);
  const categories = await browseTwitch({ url: "https://www.twitch.tv/directory" });
  expect(categories.items.length).toBeGreaterThan(0);
  const music = await browseTwitch({ url: "https://www.twitch.tv/directory/category/music" });
  expect(music.title).toBe("Music");
  expect(music.items.some(item => item.live && item.kind === "media")).toBe(true);
}, 60_000);

test.skipIf(process.env.COUCH_PROVIDER_NETWORK_TESTS !== "1")("actual offline Sabaku channel lists recent past broadcasts", async () => {
  const url = "https://www.twitch.tv/sabaku_no_sutoriimaa";
  const page = await browseTwitch({ url });
  expect(page.items.some(item => item.kind === "media" && item.live === false && item.url.startsWith("https://www.twitch.tv/videos/"))).toBe(true);
  expect(page.items.length).toBeGreaterThan(20);
  expect(page.items.length).toBeLessThanOrEqual(51);
  expect(page.nextCursor).toBeUndefined();
}, 30_000);
