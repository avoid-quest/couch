import { expect, test } from "bun:test";
import { createBandcampCatalog } from "../src/server/providers/bandcamp";
import { createSoundCloudBrowser } from "../src/server/providers/soundcloud";
import { publicProviderMediaUrl, providerForUrl } from "../src/shared/providers";
import { parseCommand } from "../src/server/validation";
import { readCollectionSearch } from "../src/client/collection-pagination";
import { readSearchState, searchLocation } from "../src/client/search";
import { supportsWebVideoQuality } from "../src/shared/video-quality";

const album = { type: "a", name: "A che punto siamo", band_name: "Arsider", item_url_path: "https://arsider.bandcamp.com/album/a-che-punto-siamo", img: "https://f4.bcbits.com/img/3034736658_3.jpg", art_id: 3034736658 };
const track = { type: "t", name: "Track", band_name: "Arsider", item_url_path: "https://arsider.bandcamp.com/track/track" };
const soundcloud = (index = 0) => ({ _type: "url", title: `Arsider track ${index}`, uploader: "Arsider Produzioni", duration: 92.566,
  url: `https://api.soundcloud.com/tracks/${index}`, webpage_url: `https://soundcloud.com/arsiderprod/track-${index}`,
  thumbnails: [{ url: "https://i1.sndcdn.com/artworks-small.jpg" }, { url: "https://i1.sndcdn.com/artworks-original.jpg" }] });

test("Bandcamp keyword search returns openable albums and tracks without extracting each result", async () => {
  let extractions = 0;
  const catalog = createBandcampCatalog(async () => { extractions++; return "{}"; }, (async (url, init) => {
    expect(String(url)).toBe("https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic");
    expect(JSON.parse(String(init?.body))).toEqual({ search_text: "arsider", search_filter: "", full_page: true, fan_id: null });
    return Response.json({ auto: { results: [album, track, album,
      { type: "b", name: "Arsider", item_url_root: "https://arsider.bandcamp.com" },
      { ...album, item_url_path: "https://outside.example/album/album" }, { ...track, item_url_path: album.item_url_path }] } });
  }) as typeof fetch);
  const page = await catalog.browse({ query: " arsider " });
  expect(page.items.map(item => [item.title, item.kind, item.url])).toEqual([
    [album.name, "collection", album.item_url_path], [track.name, "media", track.item_url_path],
  ]);
  // Search names the cover without its "a" (a 404), so it comes from art_id.
  expect(page.items[0]?.thumbnail).toBe("https://f4.bcbits.com/img/a3034736658_5.jpg");
  expect(page.items[0]?.subtitle).toBe("Arsider");
  expect(extractions).toBe(0);
});

test("Bandcamp distinguishes an empty search from unavailable or malformed responses", async () => {
  for (const response of [{ auto: { results: [] } }, { auto: { ac_error: true, results: [] } }, { auto: {} }, {}]) {
    const catalog = createBandcampCatalog(undefined, (async () => Response.json(response)) as typeof fetch);
    if ("auto" in response && "results" in response.auto && !("ac_error" in response.auto)) expect((await catalog.browse({ query: "missing" })).items).toEqual([]);
    else await expect(catalog.browse({ query: "arsider" })).rejects.toThrow("Bandcamp search is unavailable");
  }
});

test("Bandcamp search cancellation reaches the request and pasted tracks keep their extractor path", async () => {
  const controller = new AbortController();
  const catalog = createBandcampCatalog(async args => {
    expect(args.at(-1)).toBe(track.item_url_path);
    return JSON.stringify({ title: "Track", vcodec: "none", acodec: "mp3", url: "https://t4.bcbits.com/stream/track" });
  }, (async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }))) as typeof fetch);
  const pending = catalog.browse({ query: "arsider" }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect((await catalog.browse({ url: track.item_url_path })).item?.kind).toBe("media");
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
