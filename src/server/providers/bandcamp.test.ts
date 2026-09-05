import { expect, test } from "bun:test";
import type { BrowseRequest } from "../../shared/providers";
import type { YtDlpOptions } from "../yt-dlp";
import { createBandcampCatalog } from "./bandcamp";
import { providerItemId } from "./http";

const albumUrl = "https://blazo.bandcamp.com/album/jazz-format-mixtape-vol-1";
const trackUrl = "https://blazo.bandcamp.com/track/intro";
const image = "https://f4.bcbits.com/img/a1721150828_5.jpg";
const track = {
  _type: "video", webpage_url: trackUrl, title: "Blazo - Intro", track: "Intro", artist: "Blazo", album: "Jazz Format Mixtape vol.1", duration: 19.335, thumbnail: image,
  formats: [{ url: "https://t4.bcbits.com/stream/secret?token=private-stream", vcodec: "none", acodec: "mp3", protocol: "https", http_headers: { Cookie: "private-cookie" } }],
  http_headers: { Authorization: "private-authorization" },
};
const entries = [
  { _type: "url", title: "Intro", url: trackUrl },
  { _type: "url", title: "Kero One - Keep It Alive (Blazo remix)", url: "https://blazo.bandcamp.com/track/kero-one-keep-it-alive-blazo-remix" },
  { _type: "url", title: "Shinsight Trio - Heart", url: "https://blazo.bandcamp.com/track/shinsight-trio-heart" },
];
const albumInfo = { _type: "playlist", webpage_url: albumUrl, title: "Jazz Format Mixtape vol.1", entries, playlist_count: entries.length };

function fixture(outputs: unknown[] = [albumInfo, track]) {
  const calls: { args: string[]; options?: YtDlpOptions }[] = [];
  const catalog = createBandcampCatalog(async (args, options) => {
    calls.push({ args, options });
    if (calls.length > outputs.length) throw new Error("Unexpected extractor call");
    return JSON.stringify(outputs[calls.length - 1]);
  });
  return { ...catalog, calls };
}

test("Bandcamp suggestions are public album links and need no extraction", async () => {
  const { browse, calls } = fixture();
  const page = await browse({});
  expect(page.title).toBe("Suggested albums");
  expect(page.items.map(item => [item.kind, item.url])).toEqual([
    ["collection", albumUrl], ["collection", "https://benprunty.bandcamp.com/album/ftl"],
  ]);
  expect(page.items.every(item => item.provider === "bandcamp" && item.id === providerItemId("bandcamp", item.url))).toBeTrue();
  expect(calls).toHaveLength(0);
});

test("Bandcamp track browsing returns only public metadata and extracts one audio item", async () => {
  const { browse, calls } = fixture([track]);
  const page = await browse({ query: " http://BLAZO.bandcamp.com/track/intro/?from=search#lyrics " });
  expect(page).toEqual({ title: "Intro", items: [{ id: providerItemId("bandcamp", trackUrl), provider: "bandcamp", kind: "media", title: "Intro", subtitle: "Blazo", url: trackUrl, thumbnail: image, duration: 19.335 }] });
  expect(calls[0]!.args).toEqual(["--use-extractors", "bandcamp,bandcamp:album,end", "--dump-single-json", "--no-playlist", "--playlist-items", "1", "--format", "bestaudio/best", "--", trackUrl]);
  expect(JSON.stringify(page)).not.toContain("private-");
  expect(JSON.stringify(page)).not.toContain("http_headers");
  expect(JSON.stringify(page)).not.toContain("t4.bcbits.com");
});

test("Bandcamp album loading preserves flat order and enriches artwork with one full track", async () => {
  const { album, calls } = fixture();
  const page = await album(albumUrl);
  expect(page.title).toBe(albumInfo.title);
  expect(page.nextCursor).toBeUndefined();
  expect(page.items.map(item => item.title)).toEqual(entries.map(item => item.title));
  expect(page.items.map(item => item.url)).toEqual(entries.map(item => item.url));
  expect(page.items.every(item => item.kind === "media" && item.thumbnail === image && item.subtitle === "Blazo")).toBeTrue();
  expect(page.items.map(item => item.duration)).toEqual([19.335, undefined, undefined]);
  expect(calls).toHaveLength(2);
  expect(calls[0]!.args).toEqual(["--use-extractors", "bandcamp,bandcamp:album,end", "--dump-single-json", "--flat-playlist", "--playlist-items", "1:501", "--", albumUrl]);
  expect(calls[1]!.args.at(-1)).toBe(trackUrl);
  expect(calls[0]!.options?.signal).toBe(calls[1]!.options?.signal);
  expect(JSON.stringify(page)).not.toContain("private-");
  const fromBrowse = await fixture().browse({ url: albumUrl });
  expect(fromBrowse).toEqual(page);
});

test("Bandcamp album artist is shared without replacing ordered track names", async () => {
  const { album } = fixture([albumInfo, { ...track, album_artist: "Compilation label", artist: "First artist", track: "Wrong flat title" }]);
  const page = await album(albumUrl);
  expect(page.items.every(item => item.subtitle === "Compilation label")).toBeTrue();
  expect(page.items.map(item => item.title)).toEqual(entries.map(item => item.title));
});

test("Bandcamp rejects unsupported URL boundaries before starting any worker", async () => {
  const { browse, album, calls } = fixture();
  for (const url of [
    "Bandcamp search", "--exec=anything", "file:///etc/passwd", "ftp://blazo.bandcamp.com/track/intro", "https://bandcamp.com/track/intro", "https://www.bandcamp.com/track/intro", "https://daily.bandcamp.com/album/anything",
    "https://blazo.bandcamp.com.evil.test/track/intro", "https://sub.blazo.bandcamp.com/track/intro", "https://blazo.bandcamp.com./track/intro", "https://blazo.bandcamp.com@localhost/track/intro", "https://user:secret@blazo.bandcamp.com/track/intro",
    "https://blazo.bandcamp.com:444/track/intro", "https://blazo.bandcamp.com:443/track/intro", "http://blazo.bandcamp.com:80/track/intro", "https://blazo.bandcamp.com/track/intro/other", "https://blazo.bandcamp.com/music", "https://blazo.bandcamp.com/",
    "https://blazo.bandcamp.com/track/intro%2Fother", "https://blazo.bandcamp.com/track/%2e%2e", "https://blazo.bandcamp.com/track/bad%", "https://blazo.bandcamp.com/album/../track/intro", "https://blazo.bandcamp.com/track/intro\\other",
    "https://blazo.bandcamp.com/track/in\ntro", "https://blazo.bandcamp.com/track/in tro", `https://blazo.bandcamp.com/track/${"a".repeat(2_048)}`,
  ]) await expect(browse({ url })).rejects.toMatchObject({ status: 400 });
  for (const request of [{ query: 12 }, { url: 12 }, { cursor: 12 }, { cursor: "0" }, { cursor: "24" }, { query: "a\u0000b" }, { query: "x".repeat(2_049) }]) await expect(browse(request as BrowseRequest)).rejects.toMatchObject({ status: 400 });
  await expect(album(trackUrl)).rejects.toThrow("album link");
  expect(calls).toHaveLength(0);
});

test("Bandcamp rejects malformed albums and tracks without silently dropping entries", async () => {
  for (const output of [null, [], {}, { ...albumInfo, title: " " }, { ...albumInfo, _type: "video" }, { ...albumInfo, entries: {} }, { ...albumInfo, playlist_count: 4 }, { ...albumInfo, webpage_url: "https://blazo.bandcamp.com/album/another" }]) {
    await expect(fixture([output]).album(albumUrl)).rejects.toThrow("invalid catalog");
  }
  for (const entry of [null, [], {}, { ...entries[0], title: " " }, { ...entries[0], url: "https://example.org/track/intro" }, { ...entries[0], url: albumUrl }, { ...entries[0], url: "https://other.bandcamp.com/track/intro" }, { ...entries[0], url: trackUrl }]) {
    const { album, calls } = fixture([{ ...albumInfo, entries: [entries[0], entry], playlist_count: 2 }]);
    await expect(album(albumUrl)).rejects.toThrow("invalid catalog");
    expect(calls).toHaveLength(1);
  }
  await expect(fixture([{ ...albumInfo, entries: [], playlist_count: 0 }]).album(albumUrl)).rejects.toThrow("no public tracks");
});

test("Bandcamp accepts all 500 returned tracks and refuses oversized or truncated albums", async () => {
  const many = Array.from({ length: 500 }, (_, index) => ({ title: `Track ${index}`, url: index === 0 ? trackUrl : `https://blazo.bandcamp.com/track/track-${index}` }));
  const page = await fixture([{ ...albumInfo, entries: many, playlist_count: 500 }, track]).album(albumUrl);
  expect(page.items).toHaveLength(500);
  expect(page.items.at(-1)!.title).toBe("Track 499");
  for (const info of [{ ...albumInfo, entries: [...many, { title: "Extra", url: "https://blazo.bandcamp.com/track/extra" }], playlist_count: 501 }, { ...albumInfo, playlist_count: 2_000 }]) {
    const { album, calls } = fixture([info]);
    await expect(album(albumUrl)).rejects.toThrow("more than 500");
    expect(calls).toHaveLength(1);
  }
  await expect(fixture([{ ...albumInfo, playlist_count: 4 }]).album(albumUrl)).rejects.toThrow("invalid catalog");
});

test("Bandcamp requires actual supported audio formats for inspected tracks", async () => {
  for (const detail of [
    { ...track, formats: [] }, { ...track, formats: [{ url: "file:///private/audio", vcodec: "none", acodec: "mp3" }] },
    { ...track, formats: [{ url: "https://user:secret@t4.bcbits.com/stream/audio", vcodec: "none", acodec: "mp3" }] },
    { ...track, formats: [{ url: "https://t4.bcbits.com/stream/audio", vcodec: "none", acodec: "none" }] },
    { ...track, formats: [{ url: "https://t4.bcbits.com/stream/audio", vcodec: "none", acodec: "mp3", protocol: "rtmp" }] },
    { ...track, has_drm: true }, { ...track, _has_drm: true },
  ]) {
    await expect(fixture([detail]).browse({ url: trackUrl })).rejects.toThrow("no supported public audio stream");
    await expect(fixture([albumInfo, detail]).album(albumUrl)).rejects.toThrow("no supported public audio stream");
  }
  for (const detail of [{ ...track, entries: [] }, { ...track, _type: "playlist" }, { ...track, formats: {} }, { ...track, webpage_url: "https://blazo.bandcamp.com/track/other" }]) await expect(fixture([detail]).browse({ url: trackUrl })).rejects.toThrow("invalid catalog");
});

test("Bandcamp display metadata is bounded and artwork contains no stream or credential URLs", async () => {
  const page = await fixture([{ ...track, track: " First\r\n\tsecond\u0000\u007f third ", artist: undefined, artists: [" Creator\tname ", "Second"], description: "D".repeat(2_000), duration: -1, thumbnail: "https://f4.bcbits.com/img/a1_5.jpg?token=secret#fragment" }]).browse({ url: trackUrl });
  expect(page.items[0]).toMatchObject({ title: "First second third", subtitle: "Creator name, Second", description: "D".repeat(1_000), thumbnail: "https://f4.bcbits.com/img/a1_5.jpg" });
  expect(page.items[0]!.duration).toBeUndefined();
  for (const thumbnail of ["file:///private/image", "https://user:secret@f4.bcbits.com/img/a1.jpg", "https://f4.bcbits.com:443/img/a1.jpg", "https://f4.bcbits.com.evil.test/img/a1.jpg", "https://t4.bcbits.com/stream/audio?token=secret", "https://f4.bcbits.com/img/a%2f1.jpg", "https://localhost/img/a1.jpg"]) {
    expect((await fixture([{ ...track, thumbnail }]).browse({ url: trackUrl })).items[0]!.thumbnail).toBeUndefined();
  }
  const long = (await fixture([{ ...track, track: "T".repeat(400), artist: "A".repeat(400), thumbnail: undefined, thumbnails: [{ url: "//f4.bcbits.com/img/a1.jpg" }] }]).browse({ url: trackUrl })).items[0]!;
  expect(long.title).toHaveLength(200);
  expect(long.subtitle).toHaveLength(200);
  expect(long.thumbnail).toBe("https://f4.bcbits.com/img/a1.jpg");
});

test("Bandcamp rejects invalid JSON and preserves safe worker errors", async () => {
  for (const output of ["not json", "null", "[]"]) await expect(createBandcampCatalog(async () => output).browse({ url: trackUrl })).rejects.toThrow("invalid catalog");
  await expect(createBandcampCatalog(async () => { throw new Error("The website took too long to respond."); }).album(albumUrl)).rejects.toThrow("too long");
});

test("Bandcamp forwards cancellation and rejects output arriving after cancellation", async () => {
  for (const abortCall of [1, 2]) {
    const controller = new AbortController();
    let calls = 0;
    const catalog = createBandcampCatalog(async (_args, options) => {
      calls++;
      expect(options?.signal?.aborted).toBeFalse();
      if (calls === abortCall) controller.abort();
      expect(options?.signal?.aborted).toBe(calls === abortCall);
      return JSON.stringify(calls === 1 ? albumInfo : track);
    });
    await expect(catalog.album(albumUrl, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(abortCall);
  }
  const controller = new AbortController();
  controller.abort();
  const { browse, album, calls } = fixture();
  await expect(browse({}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  await expect(album(albumUrl, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toHaveLength(0);
});
