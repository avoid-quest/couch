import { expect, test } from "bun:test";
import { isYouTubePlaylistUrl } from "../../shared/providers";
import type { BrowseRequest } from "../../shared/providers";
import type { YtDlpOptions } from "../yt-dlp";
import { parseCommand } from "../validation";
import { providerItemId } from "./http";
import { createProviders } from "./index";
import { createYouTubeBrowser, createYouTubePlaylistLoader } from "./youtube";

const video = { id: "BaW_jenozKc", title: "Public video", url: "https://www.youtube.com/watch?v=BaW_jenozKc", duration: 42, channel: "Creator" };
const playlist = "https://www.youtube.com/playlist?list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr";

function fixture(output: unknown = { title: "Results", entries: [video] }) {
  const calls: { args: string[]; options?: YtDlpOptions }[] = [];
  const browse = createYouTubeBrowser(async (args, options) => { calls.push({ args, options }); return JSON.stringify(output); });
  return { calls, browse };
}

test("search keeps user text in one encoded YouTube URL and limits flat extraction", async () => {
  const { browse, calls } = fixture();
  const query = 'NASA & --exec $(touch owned) "science"';
  await browse({ query });
  expect(calls).toHaveLength(1);
  const args = calls[0]!.args;
  expect(args.slice(-2)).toEqual(["--", `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`]);
  expect(args[args.indexOf("--playlist-items") + 1]).toBe("1:25");
  expect(args[args.indexOf("--use-extractors") + 1]).toBe("youtube.*,end");
  expect(args).toContain("--flat-playlist");
  expect(args).toContain("--dump-single-json");
});

test("maps mixed search metadata to playable videos and browsable channels or playlists", async () => {
  const channel = "https://www.youtube.com/channel/UCLA_DiR1FfKNvjuUpBHmylQ";
  const { browse } = fixture({ title: "NASA", entries: [
    { ...video, title: "  Public video  ", description: "Description", live_status: "is_live", thumbnails: [{ url: "https://i.ytimg.com/vi/BaW_jenozKc/small.jpg" }, { url: "https://i.ytimg.com/vi/BaW_jenozKc/large.jpg" }] },
    { title: "NASA", url: channel, thumbnails: [{ url: "//yt3.ggpht.com/avatar=s176" }] },
    { title: "Linear algebra", url: playlist },
  ] });
  const page = await browse({ query: "NASA" });
  expect(page.title).toBe("NASA");
  expect(page.items).toEqual([
    { id: providerItemId("youtube", video.url), provider: "youtube", kind: "media", title: "Public video", url: video.url, duration: 42, subtitle: "Creator", description: "Description", live: true, thumbnail: "https://i.ytimg.com/vi/BaW_jenozKc/large.jpg" },
    { id: providerItemId("youtube", channel), provider: "youtube", kind: "channel", title: "NASA", url: channel, thumbnail: "https://yt3.ggpht.com/avatar=s176" },
    { id: providerItemId("youtube", playlist), provider: "youtube", kind: "collection", title: "Linear algebra", url: playlist },
  ]);
});

test("returns 24 entries with a lookahead cursor and advances the upstream range", async () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({ ...video, id: String(index).padStart(11, "0"), url: `https://www.youtube.com/watch?v=${String(index).padStart(11, "0")}` }));
  const { browse, calls } = fixture({ title: "Playlist", entries });
  const first = await browse({ url: playlist });
  expect(first.items).toHaveLength(24);
  expect(first.nextCursor).toBe("24");
  const second = await browse({ url: playlist, cursor: first.nextCursor });
  expect(calls[1]!.args[calls[1]!.args.indexOf("--playlist-items") + 1]).toBe("25:49");
  expect(second.nextCursor).toBe("48");
  const last = await fixture({ entries: entries.slice(0, 24) }).browse({ url: playlist });
  expect(last.nextCursor).toBeUndefined();
  expect((await browse({ url: playlist, cursor: "2400" })).nextCursor).toBeUndefined();
});

test("suggested channels and channel sections work without a subprocess", async () => {
  const { browse, calls } = fixture();
  const home = await browse({});
  expect(home.title).toBe("Suggested channels");
  expect(home.items.every(item => item.kind === "channel")).toBeTrue();
  const sections = await browse({ query: "@NASA" });
  expect(sections.items.map(item => item.title)).toEqual(["Videos", "Playlists", "Shorts", "Live streams"]);
  expect(sections.items.map(item => item.url)).toEqual(["videos", "playlists", "shorts", "streams"].map(tab => `https://www.youtube.com/@NASA/${tab}`));
  expect(calls).toHaveLength(0);
  await browse({ url: sections.items[1]!.url });
  expect(calls[0]!.args.at(-1)).toBe("https://www.youtube.com/@NASA/playlists");
});

test("normalizes supported video, channel and playlist URL forms", async () => {
  const { browse, calls } = fixture();
  for (const url of ["http://youtu.be/BaW_jenozKc?t=30", "https://m.youtube.com/shorts/BaW_jenozKc", "https://www.youtube.com/live/BaW_jenozKc", "https://www.youtube.com/embed/BaW_jenozKc"]) {
    await browse({ url });
    expect(calls.at(-1)!.args.at(-1)).toBe(video.url);
  }
  await browse({ url: `https://www.youtube.com/watch?v=BaW_jenozKc&list=${new URL(playlist).searchParams.get("list")}&index=3` });
  expect(calls.at(-1)!.args.at(-1)).toBe(playlist);
  await browse({ url: "https://music.youtube.com/@NASA/videos?view=0#fragment" });
  expect(calls.at(-1)!.args.at(-1)).toBe("https://www.youtube.com/@NASA/videos");
});

test("rejects unsafe URLs and malformed or expensive requests before extraction", async () => {
  const { browse, calls } = fixture();
  for (const url of ["file:///etc/passwd", "https://example.org/playlist?list=PL1234567890", "https://youtube.com.example.org/@NASA", "https://youtube.com@localhost/@NASA", "https://user:secret@youtube.com/@NASA", "https://youtube.com:444/@NASA", "https://youtube.com/redirect?q=https://example.org", "https://youtube.com/\\@NASA", "https://youtube.com/@NAS\nA", "https://youtube.com/@NASA%2Fvideos", "https://youtube.com/@bad%", "https://youtube.com/watch?v=invalid", "--exec=anything"]) {
    await expect(browse({ url })).rejects.toThrow("YouTube");
  }
  for (const cursor of ["-24", "1", "24.0", "024", "2401", "2424", "10000000000", "24:1000000", "NaN"]) await expect(browse({ query: "NASA", cursor })).rejects.toThrow("page");
  for (const request of [{ query: "x".repeat(201) }, { query: "a\u0000b" }, { query: 12 }, { url: 12 }, { cursor: 24 }]) await expect(browse(request as BrowseRequest)).rejects.toThrow();
  await expect(browse({ cursor: "24" })).rejects.toThrow("page");
  await expect(browse({ url: "https://www.youtube.com/@NASA", cursor: "24" })).rejects.toThrow("section");
  expect(calls).toHaveLength(0);
});

test("drops unavailable or unsafe results and bounds display metadata", async () => {
  const { browse } = fixture({ entries: [
    null, [], { ...video, availability: "private" }, { ...video, title: "[Deleted video]" }, { ...video, url: "https://outside.example/watch?v=BaW_jenozKc" }, { ...video, url: "file:///etc/passwd" },
    { ...video, title: "T".repeat(400), description: "D".repeat(1_500), channel: "C".repeat(250), duration: -1, live_status: "was_live", thumbnail: "https://outside.example/image", thumbnails: [{ url: "https://user:password@i.ytimg.com/secret" }] },
  ] });
  const page = await browse({ query: "NASA" });
  expect(page.items).toHaveLength(1);
  const result = page.items[0]!;
  expect(result.title).toHaveLength(200);
  expect(result.description).toHaveLength(1_000);
  expect(result.subtitle).toHaveLength(200);
  expect(result.duration).toBeUndefined();
  expect(result.live).toBeUndefined();
  expect(result.thumbnail).toBe("https://i.ytimg.com/vi/BaW_jenozKc/hqdefault.jpg");
});

test("long or multiline titles and descriptions can be queued and saved", async () => {
  const { browse } = fixture({ entries: [
    { ...video, title: "T".repeat(201), description: "First line\nSecond line" },
    { ...video, title: " First\r\n\tsecond\u0000\u007f third ", channel: " Creator\tname ", description: " First paragraph.\n\nSecond\tparagraph.\u0001 " },
  ] });
  const { items } = await browse({ query: "NASA" });
  expect(items[0]!.title).toBe("T".repeat(200));
  expect(items[0]!.description).toBe("First line Second line");
  expect(items[1]).toMatchObject({ title: "First second third", subtitle: "Creator name", description: "First paragraph. Second paragraph." });
  const providers = createProviders({ databasePath: ":memory:" });
  try {
    for (const item of items) {
      expect(() => parseCommand(JSON.stringify({ type: "command", requestId: "youtube-test", action: { type: "enqueueWeb", entryId: "youtube-entry", url: item.url, title: item.title, thumbnail: item.thumbnail } }), false)).not.toThrow();
      const saved = await providers.handle(new Request("http://localhost/api/providers/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) }));
      expect(saved.status).toBe(200);
      expect((await saved.json() as { item: unknown }).item).toEqual(item);
    }
  } finally { providers.close(); }
});

test("invalid browse URLs and cursors return HTTP 400 through the provider route", async () => {
  const { browse, calls } = fixture();
  const providers = createProviders({ databasePath: ":memory:", browse: { youtube: browse, twitch: browse, raiplay: browse, bandcamp: browse, streamingcommunity: browse } });
  try {
    for (const query of ["url=https%3A%2F%2Fexample.org%2F", "q=NASA&cursor=1", "q=NASA&cursor=2424", "cursor=24", "url=https%3A%2F%2Fwww.youtube.com%2F%40NASA&cursor=24"]) {
      expect((await providers.handle(new Request(`http://localhost/api/providers/youtube/items?${query}`))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  } finally { providers.close(); }
});

test("supports sparse flat entries and individual video metadata", async () => {
  const { browse } = fixture({ id: video.id, title: video.title, duration: 0 });
  expect((await browse({ url: video.url })).items[0]).toMatchObject({ url: video.url, duration: 0, kind: "media" });
  await expect(browse({ url: video.url, cursor: "24" })).rejects.toThrow("page");
});

test("rejects invalid upstream JSON and propagates extractor failure", async () => {
  for (const output of ["not json", "null", "[]", '{"entries":{}}']) await expect(createYouTubeBrowser(async () => output)({ query: "NASA" })).rejects.toThrow("invalid catalog");
  await expect(createYouTubeBrowser(async () => { throw new Error("Extractor failed"); })({ query: "NASA" })).rejects.toThrow("Extractor failed");
});

test("forwards cancellation, rejects stale output, and never starts with an aborted signal", async () => {
  const controller = new AbortController();
  let called = false;
  const browse = createYouTubeBrowser(async (_args, options) => {
    called = true;
    expect(options?.signal).toBe(controller.signal);
    controller.abort();
    return JSON.stringify({ entries: [video] });
  });
  await expect(browse({ query: "NASA" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(called).toBeTrue();
  const { browse: noStart, calls } = fixture();
  await expect(noStart({ query: "NASA" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toHaveLength(0);
});


test("playlist loader resolves every entry in order with a 500 item bound", async () => {
  const entries = Array.from({ length: 26 }, (_, index) => ({ ...video, url: `https://www.youtube.com/watch?v=${String(index).padStart(11, "0")}` }));
  let args: string[] = [];
  const load = createYouTubePlaylistLoader(async input => { args = input; return JSON.stringify({ _type: "playlist", title: "All episodes", webpage_url: playlist, playlist_count: entries.length, entries }); });
  const page = await load(playlist);
  expect(page.items.map(item => item.url)).toEqual(entries.map(entry => entry.url));
  expect(args).toEqual(["--use-extractors", "youtube.*,end", "--flat-playlist", "--dump-single-json", "--playlist-items", "1:501", "--", playlist]);
});

test("channel video sections queue as a bounded list", async () => {
  const channel = "https://www.youtube.com/@NASA/videos";
  const load = createYouTubePlaylistLoader(async () => JSON.stringify({ _type: "playlist", entries: [video] }));
  const page = await load(channel);
  expect(page.title).toBe("YouTube channel");
  expect(page.items).toHaveLength(1);
});

test("playlist loader rejects nonplaylists, partial or unavailable entries without returning a partial queue", async () => {
  let calls = 0;
  const load = createYouTubePlaylistLoader(async () => { calls++; return "{}"; });
  for (const url of [video.url, "https://example.org/playlist?list=PL1234567890"]) await expect(load(url)).rejects.toThrow();
  expect(calls).toBe(0);
  for (const metadata of [
    { _type: "playlist", entries: [] },
    { _type: "playlist", entries: [video], playlist_count: 2 },
    { _type: "playlist", entries: [video], playlist_count: 501 },
    { _type: "playlist", entries: Array(501).fill(video) },
    { _type: "playlist", entries: [video, { ...video, availability: "private" }] },
    { _type: "playlist", entries: [{ title: "Channel", url: "https://www.youtube.com/@NASA" }] },
    { _type: "playlist", entries: [video], webpage_url: "https://www.youtube.com/playlist?list=PL1234567890" },
    { entries: [video] },
  ]) await expect(createYouTubePlaylistLoader(async () => JSON.stringify(metadata))(playlist)).rejects.toThrow();
});

test("playlist loading discards cancelled output", async () => {
  const controller = new AbortController();
  const load = createYouTubePlaylistLoader(async () => { controller.abort(); return JSON.stringify({ _type: "playlist", entries: [video] }); });
  await expect(load(playlist, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});


test("playlist action eligibility accepts the same trailing slash forms as browsing", async () => {
  const url = playlist.replace("/playlist?", "/playlist/?");
  expect(isYouTubePlaylistUrl(url)).toBe(true);
  const { browse, calls } = fixture();
  await browse({ url });
  expect(calls[0]!.args.at(-1)).toBe(playlist);
  expect(isYouTubePlaylistUrl("https://www.youtube.com/@NASA/videos/")).toBe(false);
});

test("playlist previews retain collection metadata and distinct repeated occurrences", async () => {
  const page = await fixture({ title: "Two viewings", description: "Watch once, then revisit.", thumbnail: "https://i.ytimg.com/vi/BaW_jenozKc/hqdefault.jpg", entries: [video, video] }).browse({ url: playlist, cursor: "24" });
  expect(page).toMatchObject({ title: "Two viewings", description: "Watch once, then revisit.", thumbnail: "https://i.ytimg.com/vi/BaW_jenozKc/hqdefault.jpg" });
  expect(page.items.map(item => item.collection)).toEqual([{ title: "Two viewings", url: playlist, index: 24 }, { title: "Two viewings", url: playlist, index: 25 }]);
  expect((await fixture().browse({ query: "Public video" })).items[0]!.collection).toBeUndefined();
});
