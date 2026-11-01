import { expect, test } from "bun:test";
import { createBandcampCatalog } from "../src/server/providers/bandcamp";
import { createSoundCloudBrowser } from "../src/server/providers/soundcloud";
import { publicProviderMediaUrl, providerForUrl } from "../src/shared/providers";
import { parseCommand } from "../src/server/validation";
import { readCollectionSearch } from "../src/client/collection-pagination";
import { readSearchState, searchLocation } from "../src/client/search";
import { supportsWebVideoQuality } from "../src/shared/video-quality";
import { ExtractionError } from "../src/server/yt-dlp";

const album = { type: "a", name: "A che punto siamo", band_name: "Arsider", url: "https://arsider.bandcamp.com/album/a-che-punto-siamo", img: "https://f4.bcbits.com/img/3034736658_3.jpg", art_id: 3034736658 };
const track = { type: "t", name: "Track", band_name: "Arsider", url: "https://arsider.bandcamp.com/track/track" };
const soundcloud = (index = 0) => ({ _type: "url", title: `Arsider track ${index}`, uploader: "Arsider Produzioni", duration: 92.566,
  url: `https://api.soundcloud.com/tracks/${index}`, webpage_url: `https://soundcloud.com/arsiderprod/track-${index}`,
  thumbnails: [{ url: "https://i1.sndcdn.com/artworks-small.jpg" }, { url: "https://i1.sndcdn.com/artworks-original.jpg" }] });

test("Bandcamp search uses Couch's yt-dlp transport with one bounded request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const catalog = createBandcampCatalog(async (args, options) => {
    calls++;
    expect(args.at(-1)).toBe("https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=tycho");
    expect(args).toContain("CouchBandcampSearch,end");
    expect(args.slice(args.indexOf("--retries"), args.indexOf("--retries") + 4)).toEqual(["--retries", "0", "--extractor-retries", "0"]);
    expect(options?.plugin).toBe("bandcamp");
    expect(options?.timeoutMs).toBe(12_000);
    expect(options?.signal?.aborted).toBe(false);
    controller.abort();
    expect(options?.signal?.aborted).toBe(true);
    return JSON.stringify({ couch_bandcamp_search: JSON.stringify({ results: [album, track] }) });
  });
  await expect(catalog.browse({ query: "tycho" }, controller.signal)).rejects.toBe(controller.signal.reason);
  expect(calls).toBe(1);
});

test("Bandcamp parses helper search results and reports helper failures or challenge HTML", async () => {
  for (const body of [JSON.stringify({ results: [album, track] }), "<!doctype html><title>Client Challenge</title>"]) {
    const catalog = createBandcampCatalog(async () => JSON.stringify({ couch_bandcamp_search: body }));
    if (body.startsWith("{")) expect((await catalog.browse({ query: "tycho" })).items.map(item => item.url)).toEqual([album.url, track.url]);
    else await expect(catalog.browse({ query: "tycho" })).rejects.toThrow("Bandcamp search is unavailable. Try again shortly.");
  }
  for (const output of ["not JSON", "{}", '{"couch_bandcamp_search":{}}']) {
    await expect(createBandcampCatalog(async () => output).browse({ query: "tycho" })).rejects.toThrow("Bandcamp search is unavailable. Try again shortly.");
  }
  await expect(createBandcampCatalog(async () => { throw new ExtractionError("Couldn't open this page."); }).browse({ query: "tycho" })).rejects.toThrow("Bandcamp search is unavailable. Try again shortly.");
});

test("Bandcamp keyword search returns openable albums and tracks without extracting each result", async () => {
  let extractions = 0;
  const catalog = createBandcampCatalog(async () => { extractions++; return "{}"; }, (async (url, init) => {
    expect(String(url)).toBe("https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=arsider%20%26%20jazz");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    return Response.json({ results: [{ ...album, url: `https://arsider.bandcamp.com${album.url}` },
      { ...track, url: `https://arsider.bandcamp.com${track.url}` }, album,
      { type: "b", name: "Arsider", url: "https://arsider.bandcamp.com" },
      { ...track, type: "b", url: `${track.url}-band` }, { ...track, type: "unknown", url: `${track.url}-other` },
      { ...album, url: "https://arsider.bandcamp.comhttps://outside.example/album/album" },
      { ...album, url: `${track.url}-wrong-kind` }] });
  }) as typeof fetch);
  const page = await catalog.browse({ query: " arsider & jazz " });
  expect(page.items.map(item => [item.title, item.kind, item.url])).toEqual([
    [album.name, "collection", album.url], [track.name, "media", track.url],
  ]);
  // Search names the cover without its "a" (a 404), so it comes from art_id.
  expect(page.items[0]?.thumbnail).toBe("https://f4.bcbits.com/img/a3034736658_5.jpg");
  expect(page.items[0]?.subtitle).toBe("Arsider");
  expect(extractions).toBe(0);
});

test("Bandcamp search keeps the original item when a query or fragment contains another URL", async () => {
  for (const item of [album, track]) for (const prefix of ["", "https://arsider.bandcamp.com"]) {
    for (const suffix of ["?from=https://other.bandcamp.com/track/other", "#https://outside.example/track/other"]) {
      const catalog = createBandcampCatalog(undefined, (async () => Response.json({ results: [{ ...item, url: `${prefix}${item.url}${suffix}` }] })) as typeof fetch);
      expect((await catalog.browse({ query: "arsider" })).items.map(result => result.url)).toEqual([item.url]);
    }
  }
});

test("Bandcamp distinguishes an empty search from unavailable or malformed responses", async () => {
  for (const response of [{ results: [] }, { results: null }, { results: {} }, {}, null]) {
    const catalog = createBandcampCatalog(undefined, (async () => Response.json(response)) as typeof fetch);
    if (response && Array.isArray(response.results)) expect((await catalog.browse({ query: "missing" })).items).toEqual([]);
    else await expect(catalog.browse({ query: "arsider" })).rejects.toThrow("Bandcamp search is unavailable");
  }
});

test("Bandcamp reports challenge pages and other non-JSON responses without retrying", async () => {
  for (const body of ["<!doctype html><html><title>Client Challenge</title></html>", "not JSON"]) {
    let calls = 0;
    const catalog = createBandcampCatalog(undefined, (async () => {
      calls++;
      return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch);
    await expect(catalog.browse({ query: "tycho" })).rejects.toMatchObject({ status: 502, message: "Bandcamp search is unavailable. Try again shortly." });
    expect(calls).toBe(1);
  }
});

test("Bandcamp keeps search limits and builds zero-padded art_id covers", async () => {
  let calls = 0;
  const catalog = createBandcampCatalog(undefined, (async () => {
    calls++;
    return Response.json({ results: Array.from({ length: 51 }, (_, index) => ({ ...album, url: `${album.url}-${index}`, art_id: 978734060 })) });
  }) as typeof fetch);
  await expect(catalog.browse({ query: "a".repeat(201) })).rejects.toMatchObject({ status: 400 });
  expect(calls).toBe(0);
  const page = await catalog.browse({ query: "a".repeat(200) });
  expect(page.items).toHaveLength(50);
  expect(page.items[0]?.thumbnail).toBe("https://f4.bcbits.com/img/a0978734060_5.jpg");
});

test("Bandcamp search cancellation reaches the request and pasted tracks keep their extractor path", async () => {
  const controller = new AbortController();
  const catalog = createBandcampCatalog(async args => {
    expect(args.at(-1)).toBe(track.url);
    return JSON.stringify({ title: "Track", vcodec: "none", acodec: "mp3", url: "https://t4.bcbits.com/stream/track" });
  }, (async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }))) as typeof fetch);
  const pending = catalog.browse({ query: "arsider" }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toBe(controller.signal.reason);
  expect((await catalog.browse({ url: track.url })).item?.kind).toBe("media");
});

test("SoundCloud searches metadata, paginates, and uses public track links instead of API URLs", async () => {
  const calls: string[][] = [];
  const browse = createSoundCloudBrowser(async args => {
    calls.push(args);
    return JSON.stringify({ entries: Array.from({ length: calls.length === 1 ? 25 : 1 }, (_, index) => soundcloud((calls.length - 1) * 24 + index)) });
  });
  const first = await browse({ query: "arsider" });
  expect(first.items).toHaveLength(24);
  expect(first.nextCursor).toBe("24");
  expect(first.items[0]).toMatchObject({ title: "Arsider track 0", provider: "soundcloud", kind: "media", url: soundcloud().webpage_url, duration: 92.566, thumbnail: "https://i1.sndcdn.com/artworks-original.jpg" });
  expect(calls[0]).toContain("--flat-playlist");
  expect(calls[0]?.at(-1)).toBe("scsearch25:arsider");
  const next = await browse({ query: "arsider", cursor: first.nextCursor });
  expect(calls[1]).toContain("25:49");
  expect(calls[1]?.at(-1)).toBe("scsearch49:arsider");
  expect(next.items[0]?.url).toBe(soundcloud(24).webpage_url);
  expect(next.nextCursor).toBeUndefined();
});

test("SoundCloud details are independently openable and query text cannot select another extractor", async () => {
  const browse = createSoundCloudBrowser(async args => {
    const url = args.at(-1)!;
    if (url.startsWith("scsearch")) { expect(url).toBe("scsearch25:ytsearch:arsider"); return '{"entries":[]}'; }
    expect(args).toContain("--no-playlist");
    expect(url).toBe(soundcloud().webpage_url);
    return JSON.stringify(soundcloud());
  });
  const page = await browse({ url: `${soundcloud().webpage_url}?utm_source=clipboard` });
  expect(page.item).toEqual(page.items[0]);
  expect((await browse({ query: "ytsearch:arsider" })).items).toEqual([]);
  for (const request of [{ query: "arsider", cursor: "1" }, { query: "arsider", cursor: "2424" }, { url: "https://example.com/arsider/track" }, { url: "https://soundcloud.com/arsider/sets/album" }, { url: `${soundcloud().webpage_url}?secret_token=private` }]) {
    await expect(browse(request)).rejects.toThrow();
  }
});

test("SoundCloud filters unsafe results and propagates cancellation and invalid upstream data", async () => {
  const controller = new AbortController();
  const browse = createSoundCloudBrowser(async (_args, options) => {
    expect(options?.signal).toBe(controller.signal);
    return JSON.stringify({ entries: [soundcloud(), { ...soundcloud(), webpage_url: "https://outside.example/artist/track" }, { ...soundcloud(), webpage_url: "https://user:password@soundcloud.com/artist/track" }] });
  });
  expect((await browse({ query: "arsider" }, controller.signal)).items).toHaveLength(1);
  controller.abort();
  await expect(browse({ query: "arsider" }, controller.signal)).rejects.toThrow();
  for (const output of ["not json", "{}", '{"entries":{}}']) await expect(createSoundCloudBrowser(async () => output)({ query: "arsider" })).rejects.toThrow("invalid catalog information");
});

test("music filters, SoundCloud details, queue commands and history share the provider identity", () => {
  for (const source of ["Bandcamp", "SoundCloud"]) {
    const state = { query: "arsider", source, kind: "music" as const };
    expect(readSearchState(new URL(searchLocation(state), "https://couch.local").search)).toEqual(state);
  }
  const url = soundcloud().webpage_url;
  expect(providerForUrl(url)).toBe("soundcloud");
  expect(publicProviderMediaUrl(url)).toBe(url);
  expect(publicProviderMediaUrl(`${url}?secret_token=private`)).toBeUndefined();
  expect(readCollectionSearch({ provider: "soundcloud", url }).provider).toBe("soundcloud");
  expect(supportsWebVideoQuality(url)).toBe(false);
  const action = { type: "enqueueProvider", provider: "soundcloud", url, shape: "atom", title: "Arsider", playNow: true };
  expect(parseCommand(JSON.stringify({ type: "command", requestId: "test", action })).action).toEqual(action);
});
