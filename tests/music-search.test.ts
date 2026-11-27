import { expect, test } from "bun:test";
import { createBandcampCatalog } from "../src/server/providers/bandcamp";
import {
  createSoundCloudBrowser,
  createSoundCloudListLoader,
} from "../src/server/providers/soundcloud";
import { createSpotifyCatalog } from "../src/server/providers/spotify";
import { createBandcampFans } from "../src/server/providers/bandcamp-fans";
import { ExtractionError } from "../src/server/yt-dlp";

const album = {
  type: "a",
  name: "A che punto siamo",
  band_name: "Arsider",
  url: "https://arsider.bandcamp.com/album/a-che-punto-siamo",
  img: "https://f4.bcbits.com/img/3034736658_3.jpg",
  art_id: 3034736658,
};
const track = {
  type: "t",
  name: "Track",
  band_name: "Arsider",
  url: "https://arsider.bandcamp.com/track/track",
};
const soundcloud = (index = 0) => ({
  _type: "url",
  title: `Arsider track ${index}`,
  uploader: "Arsider Produzioni",
  duration: 92.566,
  url: `https://api.soundcloud.com/tracks/${index}`,
  webpage_url: `https://soundcloud.com/arsiderprod/track-${index}`,
  thumbnails: [
    { url: "https://i1.sndcdn.com/artworks-small.jpg" },
    { url: "https://i1.sndcdn.com/artworks-original.jpg" },
  ],
});

test("Bandcamp parses helper search results and reports helper failures or challenge HTML", async () => {
  for (const body of [
    JSON.stringify({ results: [album, track] }),
    "<!doctype html><title>Client Challenge</title>",
  ]) {
    const catalog = createBandcampCatalog(async () =>
      JSON.stringify({ couch_bandcamp_search: body }),
    );
    if (body.startsWith("{"))
      expect((await catalog.browse({ query: "tycho" })).items.map((item) => item.url)).toEqual([
        album.url,
        track.url,
      ]);
    else
      await expect(catalog.browse({ query: "tycho" })).rejects.toThrow(
        "Bandcamp search is unavailable. Try again shortly.",
      );
  }
  for (const output of ["not JSON", "{}", '{"couch_bandcamp_search":{}}']) {
    await expect(
      createBandcampCatalog(async () => output).browse({ query: "tycho" }),
    ).rejects.toThrow("Bandcamp search is unavailable. Try again shortly.");
  }
  await expect(
    createBandcampCatalog(async () => {
      throw new ExtractionError("Couldn't open this page.");
    }).browse({ query: "tycho" }),
  ).rejects.toThrow("Bandcamp search is unavailable. Try again shortly.");
});

test("Bandcamp keyword search returns openable albums and tracks without extracting each result", async () => {
  let extractions = 0;
  const catalog = createBandcampCatalog(
    async () => {
      extractions++;
      return "{}";
    },
    (async (url, init) => {
      expect(String(url)).toBe(
        "https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=arsider%20%26%20jazz",
      );
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
      return Response.json({
        results: [
          { ...album, url: `https://arsider.bandcamp.com${album.url}` },
          { ...track, url: `https://arsider.bandcamp.com${track.url}` },
          album,
          { type: "b", name: "Arsider", url: "https://arsider.bandcamp.com" },
          { ...track, type: "b", url: `${track.url}-band` },
          { ...track, type: "unknown", url: `${track.url}-other` },
          {
            ...album,
            url: "https://arsider.bandcamp.comhttps://outside.example/album/album",
          },
          { ...album, url: `${track.url}-wrong-kind` },
        ],
      });
    }) as typeof fetch,
  );
  const page = await catalog.browse({ query: " arsider & jazz " });
  expect(page.items.map((item) => [item.title, item.kind, item.url])).toEqual([
    [album.name, "collection", album.url],
    [track.name, "media", track.url],
  ]);
  // Search names the cover without its "a" (a 404), so it comes from art_id.
  expect(page.items[0]?.thumbnail).toBe("https://f4.bcbits.com/img/a3034736658_5.jpg");
  expect(page.items[0]?.subtitle).toBe("Arsider");
  expect(extractions).toBe(0);
});

test("Bandcamp search keeps the original item when a query or fragment contains another URL", async () => {
  for (const item of [album, track])
    for (const prefix of ["", "https://arsider.bandcamp.com"]) {
      for (const suffix of [
        "?from=https://other.bandcamp.com/track/other",
        "#https://outside.example/track/other",
      ]) {
        const catalog = createBandcampCatalog(undefined, (async () =>
          Response.json({
            results: [{ ...item, url: `${prefix}${item.url}${suffix}` }],
          })) as typeof fetch);
        expect(
          (await catalog.browse({ query: "arsider" })).items.map((result) => result.url),
        ).toEqual([item.url]);
      }
    }
});

test("Bandcamp distinguishes an empty search from unavailable or malformed responses", async () => {
  for (const response of [{ results: [] }, { results: null }, { results: {} }, {}, null]) {
    const catalog = createBandcampCatalog(undefined, (async () =>
      Response.json(response)) as typeof fetch);
    if (response && Array.isArray(response.results))
      expect((await catalog.browse({ query: "missing" })).items).toEqual([]);
    else
      await expect(catalog.browse({ query: "arsider" })).rejects.toThrow(
        "Bandcamp search is unavailable",
      );
  }
});

test("Bandcamp keeps search limits and builds zero-padded art_id covers", async () => {
  let calls = 0;
  const catalog = createBandcampCatalog(undefined, (async () => {
    calls++;
    return Response.json({
      results: Array.from({ length: 51 }, (_, index) => ({
        ...album,
        url: `${album.url}-${index}`,
        art_id: 978734060,
      })),
    });
  }) as typeof fetch);
  await expect(catalog.browse({ query: "a".repeat(201) })).rejects.toMatchObject({ status: 400 });
  expect(calls).toBe(0);
  const page = await catalog.browse({ query: "a".repeat(200) });
  expect(page.items).toHaveLength(50);
  expect(page.items[0]?.thumbnail).toBe("https://f4.bcbits.com/img/a0978734060_5.jpg");
});

test("SoundCloud searches metadata, paginates, and uses public track links instead of API URLs", async () => {
  const calls: string[][] = [];
  const browse = createSoundCloudBrowser(async (args) => {
    calls.push(args);
    return JSON.stringify({
      entries: Array.from({ length: calls.length === 1 ? 25 : 1 }, (_, index) =>
        soundcloud((calls.length - 1) * 24 + index),
      ),
    });
  });
  const first = await browse({ query: "arsider" });
  expect(first.items).toHaveLength(24);
  expect(first.nextCursor).toBe("24");
  expect(first.items[0]).toMatchObject({
    title: "Arsider track 0",
    provider: "soundcloud",
    kind: "media",
    url: soundcloud().webpage_url,
    duration: 92.566,
    thumbnail: "https://i1.sndcdn.com/artworks-original.jpg",
  });
  expect(calls[0]?.at(-1)).toBe("scsearch25:arsider");
  const next = await browse({ query: "arsider", cursor: first.nextCursor });
  expect(calls[1]?.at(-1)).toBe("scsearch49:arsider");
  expect(next.items[0]?.url).toBe(soundcloud(24).webpage_url);
  expect(next.nextCursor).toBeUndefined();
});

test("SoundCloud details are independently openable and query text cannot select another extractor", async () => {
  const browse = createSoundCloudBrowser(async (args) => {
    const url = args.at(-1)!;
    if (url.startsWith("scsearch")) {
      expect(url).toBe("scsearch25:ytsearch:arsider");
      return '{"entries":[]}';
    }
    expect(args).toContain("--no-playlist");
    expect(url).toBe(soundcloud().webpage_url);
    return JSON.stringify(soundcloud());
  });
  const page = await browse({
    url: `${soundcloud().webpage_url}?utm_source=clipboard`,
  });
  expect(page.item).toEqual(page.items[0]);
  expect((await browse({ query: "ytsearch:arsider" })).items).toEqual([]);
  for (const request of [
    { query: "arsider", cursor: "1" },
    { query: "arsider", cursor: "2424" },
    { url: "https://example.com/arsider/track" },
    { url: "https://soundcloud.com/discover" },
    { url: `${soundcloud().webpage_url}?secret_token=private` },
  ]) {
    await expect(browse(request)).rejects.toThrow();
  }
});

test("SoundCloud filters unsafe results and rejects invalid upstream data", async () => {
  const browse = createSoundCloudBrowser(async () =>
    JSON.stringify({
      entries: [
        soundcloud(),
        {
          ...soundcloud(),
          webpage_url: "https://outside.example/artist/track",
        },
        {
          ...soundcloud(),
          webpage_url: "https://user:password@soundcloud.com/artist/track",
        },
      ],
    }),
  );
  expect((await browse({ query: "arsider" })).items).toHaveLength(1);
  for (const output of ["not json", "{}", '{"entries":{}}'])
    await expect(createSoundCloudBrowser(async () => output)({ query: "arsider" })).rejects.toThrow(
      "invalid catalog information",
    );
});

test("SoundCloud sets and profiles browse a page at a time and queue their first 500 tracks", async () => {
  const set = "https://soundcloud.com/arsiderprod/sets/album";
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const [from, to] = args[args.indexOf("--playlist-items") + 1]!.split(":").map(Number);
    return JSON.stringify({
      _type: "playlist",
      title: "Album",
      uploader: "Arsider Produzioni",
      playlist_count: 600,
      entries: Array.from({ length: to! - from! + 1 }, (_, index) => soundcloud(from! - 1 + index)),
    });
  };
  const page = await createSoundCloudBrowser(run)({ url: `${set}?si=share` });
  expect(calls[0]?.at(-1)).toBe(set);
  expect(page.item).toMatchObject({
    kind: "collection",
    url: set,
    title: "Album",
  });
  expect(page.count).toBe(600);
  expect(page.items).toHaveLength(24);
  expect(page.items[1]?.collection).toEqual({
    title: "Album",
    url: set,
    index: 1,
  });
  expect(page.nextCursor).toBe("24");
  const next = await createSoundCloudBrowser(run)({ url: set, cursor: "24" });
  expect(next.items[0]?.collection?.index).toBe(24);
  const list = await createSoundCloudListLoader(run)(set);
  expect(calls.at(-1)).toContain("1:500");
  expect(list.items).toHaveLength(500);
  expect(list.count).toBe(600);
  await expect(createSoundCloudListLoader(run)(soundcloud().webpage_url)).rejects.toMatchObject({
    status: 400,
  });
});

const spotifyPage = (entity: unknown) =>
  new Response(
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity } } } },
    })}</script></html>`,
  );
const spotifyAlbum = "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy";
const albumEntity = {
  type: "album",
  id: "4aawyAB9vmqN3uQ7FjRGTy",
  title: "Global Warming",
  subtitle: "Pitbull",
  visualIdentity: {
    image: [
      {
        url: "https://image-cdn-ak.spotifycdn.com/image/ab67616d00004851aaaa",
        maxWidth: 64,
      },
      {
        url: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273bbbb",
        maxWidth: 640,
      },
    ],
  },
  trackList: [
    {
      uri: "spotify:track:6OmhkSOpvYBokMKQxpIGx2",
      title: "Global Warming (feat. Sensato)",
      subtitle: "Pitbull,\u00a0Sensato",
      duration: 85400,
    },
    { uri: "spotify:local:x", title: "Local file", duration: 1000 },
    {
      uri: "spotify:track:2iblMMIgSznA464mNov7A8",
      title: "Gone",
      duration: 2000,
      isPlayable: false,
    },
  ],
};
const trackEntity = {
  type: "track",
  id: "6OmhkSOpvYBokMKQxpIGx2",
  uri: "spotify:track:6OmhkSOpvYBokMKQxpIGx2",
  title: "Global Warming (feat. Sensato)",
  artists: [{ name: "Pitbull" }, { name: "Sensato" }],
  duration: 85400,
};

test("Spotify reads a list's tracks from its public embed page and keeps their Spotify links", async () => {
  const urls: string[] = [];
  const catalog = createSpotifyCatalog((async (url: string) => {
    urls.push(url);
    return spotifyPage(albumEntity);
  }) as typeof fetch);
  const page = await catalog.browse({ url: `${spotifyAlbum}?si=share` });
  expect(urls).toEqual(["https://open.spotify.com/embed/album/4aawyAB9vmqN3uQ7FjRGTy"]);
  expect(page.item).toMatchObject({
    provider: "spotify",
    kind: "collection",
    url: spotifyAlbum,
  });
  expect(page.items).toEqual([
    {
      id: expect.any(String),
      provider: "spotify",
      kind: "media",
      title: "Global Warming (feat. Sensato)",
      url: "https://open.spotify.com/track/6OmhkSOpvYBokMKQxpIGx2",
      subtitle: "Pitbull, Sensato, plays from YouTube",
      thumbnail: "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273bbbb",
      collection: { title: "Global Warming", url: spotifyAlbum, index: 0 },
      duration: 85.4,
    },
  ]);
  for (const body of [
    "<html></html>",
    JSON.stringify({}),
    '<script id="__NEXT_DATA__" type="application/json">{</script>',
  ])
    await expect(
      createSpotifyCatalog((async () => new Response(body)) as typeof fetch).browse({
        url: spotifyAlbum,
      }),
    ).rejects.toThrow("Spotify changed its player page");
  await expect(
    createSpotifyCatalog((async () =>
      spotifyPage({
        ...albumEntity,
        id: "0000000000000000000000",
      })) as typeof fetch).browse({
      url: spotifyAlbum,
    }),
  ).rejects.toThrow("Spotify changed its player page");
});

test("A Spotify track plays the first YouTube hit within 10 seconds of its length", async () => {
  const queries: string[] = [];
  const hit = (id: string, duration: number) => ({
    id,
    provider: "youtube" as const,
    kind: "media" as const,
    title: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    duration,
  });
  const catalog = (durations: number[]) =>
    createSpotifyCatalog(
      (async () => spotifyPage(trackEntity)) as typeof fetch,
      async ({ query }) => {
        queries.push(query!);
        return {
          items: durations.map((duration, index) => hit(`video${index}abcd`, duration)),
        };
      },
    );
  const { url, item } = await catalog([200, 96, 90]).match(
    "https://open.spotify.com/track/6OmhkSOpvYBokMKQxpIGx2",
  );
  expect(queries).toEqual(["Pitbull, Sensato Global Warming (feat. Sensato)"]);
  expect(url).toBe("https://www.youtube.com/watch?v=video2abcd");
  expect(item.url).toBe("https://open.spotify.com/track/6OmhkSOpvYBokMKQxpIGx2");
  await expect(
    catalog([200]).match("https://open.spotify.com/track/6OmhkSOpvYBokMKQxpIGx2"),
  ).rejects.toThrow("no YouTube upload");
  await expect(catalog([90]).match(spotifyAlbum)).rejects.toMatchObject({
    status: 400,
  });
});

test("A Bandcamp fan's page lists its items, pages with its token, and Play all queues every page's tracks", async () => {
  const escape = (value: unknown) =>
    JSON.stringify(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const collected = (type: "a" | "t", host: string, slug: string) => ({
    tralbum_type: type,
    item_url: `https://${host}.bandcamp.com/${type === "a" ? "album" : "track"}/${slug}`,
    item_title: `${slug} & co`,
    band_name: host,
    item_art_id: 3758392852,
  });
  const blob = {
    fan_data: { fan_id: 957304, name: "Bimbo in Lacrime", username: "fan" },
    collection_data: { item_count: 4, last_token: "1789822872:3585349819:a::" },
    item_cache: {
      collection: {
        a1: collected("a", "label", "first"),
        t2: collected("t", "artist", "single"),
        x3: {
          ...collected("a", "label", "elsewhere"),
          item_url: "https://music.example/album/x",
        },
      },
    },
  };
  const calls: string[][] = [];
  const fans = createBandcampFans(async (args) => {
    calls.push(args);
    const url = args.at(-1)!;
    if (url === "https://bandcamp.com/fan")
      return JSON.stringify({
        couch_bandcamp_page: `<div id="pagedata" data-blob="${escape(blob)}"></div>`,
      });
    if (url.startsWith("https://bandcamp.com/api/"))
      return JSON.stringify({
        couch_bandcamp_page: JSON.stringify({
          items: [
            collected("t", "artist", "older"),
            collected("a", "label", "removed"),
            collected("a", "label", "second"),
          ],
          more_available: false,
        }),
      });
    const albums = args.slice(args.indexOf("--") + 1);
    // One album that no longer opens fails its whole extraction.
    if (albums.includes("https://label.bandcamp.com/album/removed"))
      throw new ExtractionError("Couldn't open this page. It may be unsupported.");
    return albums
      .map((album) =>
        JSON.stringify({
          _type: "playlist",
          webpage_url: album,
          entries: [1, 2].map((n) => ({
            url: `${album.replace("/album/", "/track/")}-song-${n}`,
            title: `${album.split("/").at(-1)} ${n}`,
          })),
        }),
      )
      .join("\n");
  });
  const page = await fans.browse("https://www.bandcamp.com/fan/");
  expect(page.item).toMatchObject({
    kind: "collection",
    url: "https://bandcamp.com/fan",
  });
  expect(page.title).toBe("Bimbo in Lacrime's collection");
  expect(page.items.map((item) => [item.kind, item.title])).toEqual([
    ["collection", "first & co"],
    ["media", "single & co"],
  ]);
  expect(page.items[0]?.thumbnail).toBe("https://f4.bcbits.com/img/a3758392852_5.jpg");
  expect(page.nextCursor).toBe("957304/1789822872:3585349819:a::");
  const next = await fans.browse("https://bandcamp.com/fan", page.nextCursor);
  expect(calls.at(-1)?.at(-1)).toBe(
    "https://bandcamp.com/api/fancollection/1/collection_items?fan_id=957304&older_than_token=1789822872:3585349819:a::&count=24",
  );
  expect(next.items.map((item) => item.title)).toEqual([
    "older & co",
    "removed & co",
    "second & co",
  ]);
  expect(next.nextCursor).toBeUndefined();
  await expect(fans.browse("https://bandcamp.com/fan", "957304/x&y=1")).rejects.toMatchObject({
    status: 400,
  });
  calls.length = 0;
  const queued = await fans.load("https://bandcamp.com/fan");
  // Play all reads the later pages too, many releases per request.
  expect(calls[1]?.at(-1)).toEndWith("&count=100");
  expect(queued.items.map((item) => [item.title, item.url, item.collection?.index])).toEqual([
    ["first 1", "https://label.bandcamp.com/track/first-song-1", 0],
    ["first 2", "https://label.bandcamp.com/track/first-song-2", 1],
    ["single & co", "https://artist.bandcamp.com/track/single", undefined],
    ["older & co", "https://artist.bandcamp.com/track/older", undefined],
    ["second 1", "https://label.bandcamp.com/track/second-song-1", 0],
    ["second 2", "https://label.bandcamp.com/track/second-song-2", 1],
  ]);
});
