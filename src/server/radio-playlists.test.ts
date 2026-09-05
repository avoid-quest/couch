import { afterEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRadio } from "./radio";

const radios: ReturnType<typeof createRadio>[] = [];
const directories: string[] = [];
const feedUrl = "https://radio.example/playlist.m3u";
const entry = (name = "First station", url = "https://stream.example/first", attributes = 'tvg-id="first" group-title="Music" radio="true"') => `#EXTINF:-1 ${attributes},${name}\n${url}\n`;
const playlist = (entries = entry()) => `#EXTM3U\n${entries}`;

function fixture(request: typeof fetch = (async () => new Response(playlist())) as unknown as typeof fetch, databasePath = ":memory:", onChange = () => {}) {
  const radio = createRadio({ databasePath, fetch: request, onChange });
  radios.push(radio);
  return radio;
}

afterEach(() => {
  for (const radio of radios.splice(0)) radio.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("imports the actual avoid.quest Kodi feed contract with all ten stations in feed order", async () => {
  const text = await Bun.file(join(import.meta.dir, "radio-playlists.avoid.m3u")).text();
  const radio = fixture((async () => new Response(text)) as unknown as typeof fetch);
  const source = await radio.addPlaylist({ name: "avoid radio", url: "https://radio.avoid.quest/playlist.m3u" });
  expect(source).toMatchObject({ name: "avoid radio", stationCount: 10, error: null });
  expect(source.updatedAt).toBeNumber();
  const stations = radio.playlistStations({ playlistId: source.id });
  expect(stations.map(station => station.name)).toEqual(["Sygma Radio", "Lyl Radio", "Cashmere Radio", "NTS Radio | Channel 1", "NTS Radio | Channel 2", "Resonance Extra", "Internet Public Radio", "HKCR", "Radio Alhara", "Radio BlackOut"]);
  expect(stations.every(station => station.sourceId === source.id && station.groupTitle === "avoid radio" && station.logoUrl?.startsWith("https://") && station.tvgId?.startsWith("avoid-radio-"))).toBeTrue();
  expect(stations[0]?.url).toBe("https://radio.syg.ma/audio.mp3");
  expect(stations[7]?.url).toBe("https://stream-test.hkcr.live/hls/main.m3u8");
  expect(radio.playlistStations({ playlistId: source.id, q: "nts radio" }).map(station => station.name)).toEqual(["NTS Radio | Channel 1", "NTS Radio | Channel 2"]);
});

test("preserves IDs across restart, refresh and reimport while favorites follow current metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-playlists-"));
  directories.push(directory);
  const databasePath = join(directory, "radio.sqlite");
  let text = playlist(entry("Original", "https://stream.example/old", 'tvg-id="channel-1" tvg-logo="https://images.example/old.png"'));
  const request = (async () => new Response(text)) as unknown as typeof fetch;
  const first = fixture(request, databasePath);
  const source = await first.addPlaylist({ name: "Radio feed", url: feedUrl });
  const original = first.playlistStations({ playlistId: source.id })[0]!;
  first.saveFavorite(original);
  first.close();
  const reopened = fixture(request, databasePath);
  expect(reopened.playlists()).toEqual([source]);
  expect(reopened.favorites()).toEqual([original]);
  text = playlist(entry("Updated", "https://stream.example/new", 'tvg-id="channel-1" tvg-logo="https://images.example/new.png"'));
  const refreshed = await reopened.addPlaylist({ name: "Renamed feed", url: `${feedUrl}#ignored-fragment` });
  expect(refreshed.id).toBe(source.id);
  expect(reopened.playlists()).toHaveLength(1);
  const updated = reopened.playlistStations({ playlistId: source.id })[0]!;
  expect(updated).toMatchObject({ id: original.id, name: "Updated", url: "https://stream.example/new", logoUrl: "https://images.example/new.png" });
  expect(reopened.favorites()).toEqual([updated]);
  expect(reopened.saveFavorite(original)).toEqual(updated);
  reopened.removePlaylist(source.id);
  expect(reopened.favorites()).toEqual([updated]);
  expect((await reopened.addPlaylist({ name: "Restored", url: feedUrl })).id).toBe(source.id);
  expect(reopened.playlistStations({ playlistId: source.id })[0]?.id).toBe(original.id);
  expect(reopened.favorites()).toHaveLength(1);
});

test("preserves the last catalog on refresh failure and clears it on valid empty or TV-only refresh", async () => {
  let response = () => new Response(playlist());
  const changed = mock(() => {});
  const radio = fixture((async () => response()) as unknown as typeof fetch, ":memory:", changed);
  const source = await radio.addPlaylist({ name: "Stations", url: feedUrl });
  const stations = radio.playlistStations({ playlistId: source.id });
  radio.saveFavorite(stations[0]);
  response = () => new Response("Unavailable", { status: 503 });
  await expect(radio.refreshPlaylist(source.id)).rejects.toMatchObject({ status: 502 });
  expect(radio.playlistStations({ playlistId: source.id })).toEqual(stations);
  expect(radio.playlists()[0]).toMatchObject({ updatedAt: source.updatedAt, stationCount: 1, error: "The playlist server returned HTTP 503." });
  for (const text of [playlist(""), playlist(entry("TV", "https://stream.example/tv.m3u8", 'radio="FALSE"'))]) {
    response = () => new Response(text);
    expect(await radio.refreshPlaylist(source.id)).toMatchObject({ stationCount: 0, error: null });
    expect(radio.playlistStations({ playlistId: source.id })).toEqual([]);
    expect(radio.favorites()).toEqual(stations);
  }
  expect(changed).toHaveBeenCalledTimes(5);
});

test("coalesces refresh and prevents a removed source's old response overwriting its replacement", async () => {
  const releases: ((response: Response) => void)[] = [];
  const request = mock(() => new Promise<Response>(resolve => releases.push(resolve)));
  const radio = fixture(request as unknown as typeof fetch);
  const importing = radio.addPlaylist({ name: "First", url: feedUrl });
  const id = radio.playlists()[0]!.id;
  const refresh = radio.refreshPlaylist(id);
  expect(radio.refreshPlaylist(id)).toBe(refresh);
  expect(request).toHaveBeenCalledTimes(1);
  releases.shift()!(new Response(playlist()));
  await Promise.all([importing, refresh]);
  const old = radio.refreshPlaylist(id).catch(error => error);
  radio.removePlaylist(id);
  const replacement = radio.addPlaylist({ name: "Replacement", url: feedUrl });
  releases.shift()!(new Response(playlist(entry("Old response"))));
  releases.shift()!(new Response(playlist(entry("New response"))));
  expect(await old).toMatchObject({ status: 404 });
  await replacement;
  expect(radio.playlistStations({ playlistId: id })[0]?.name).toBe("New response");
});

test("close aborts a streaming playlist without writing to a closed database", async () => {
  let canceled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("#EXTM3U\n")); }, cancel() { canceled = true; } });
  const radio = fixture((async () => new Response(body)) as unknown as typeof fetch);
  const importing = radio.addPlaylist({ name: "Slow feed", url: feedUrl });
  await Bun.sleep(1);
  radio.close();
  await expect(importing).rejects.toMatchObject({ status: 503, message: "The radio catalog is closing." });
  expect(canceled).toBeTrue();
  expect(() => radio.playlists()).toThrow("closing");
});

test("supports BOM, CRLF, relative URLs, comma metadata, filtering and stable source-scoped IDs", async () => {
  const text = `\uFEFF#EXTM3U\r\n${entry("Radio, live", "streams/live.mp3", 'tvg-id="same" group-title="Music, live" tvg-logo="../logo.png" radio="TRUE"')}${entry("Skip TV", "https://stream.example/tv", 'radio="false"')}${entry("Duplicate", "https://stream.example/duplicate", 'tvg-id="same"')}`;
  const radio = fixture((async () => new Response(text)) as unknown as typeof fetch);
  const first = await radio.addPlaylist({ name: "First", url: "https://radio.example/one/list.m3u" });
  const second = await radio.addPlaylist({ name: "Second", url: "https://radio.example/two/list.m3u" });
  const stations = radio.playlistStations({ playlistId: first.id });
  expect(stations).toHaveLength(1);
  expect(stations[0]).toMatchObject({ name: "Radio, live", groupTitle: "Music, live", url: "https://radio.example/one/streams/live.mp3", logoUrl: "https://radio.example/logo.png" });
  expect(radio.playlistStations({ playlistId: second.id })[0]?.id).not.toBe(stations[0]?.id);
});

test("rejects HLS and unsupported playback directives without silently changing stream behavior", async () => {
  const cases = [
    "<html>Not a playlist</html>",
    "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n",
    playlist(entry().replace("https://stream.example/first", "file:///etc/passwd")),
    playlist(entry().replace("https://stream.example/first", "https://user:password@stream.example/private")),
    playlist(entry().replace("https://stream.example/first", "https://stream.example/first|Cookie=private")),
    playlist(entry().replace("https://stream.example/first", "#KODIPROP:inputstream.adaptive.license_key=private\nhttps://stream.example/first")),
    playlist(entry().replace("https://stream.example/first", "#EXTVLCOPT:http-referrer=https://private.example\nhttps://stream.example/first")),
    playlist(entry("First", "https://stream.example/first", 'user-agent="custom"')),
    "#EXTM3U user-agent=\"custom\"\n" + entry(),
    "#EXTM3U\nhttps://stream.example/first\n",
    "#EXTM3U\n#EXTINF:-1,Missing URL\n",
  ];
  for (const text of cases) {
    const radio = fixture((async () => new Response(text)) as unknown as typeof fetch);
    await expect(radio.addPlaylist({ name: "Invalid", url: feedUrl })).rejects.toMatchObject({ status: 502 });
    expect(radio.playlists()[0]?.stationCount).toBe(0);
  }
});

test("discards invalid optional artwork while keeping playable stations", async () => {
  const radio = fixture((async () => new Response(playlist(entry("No image", "https://stream.example/first", 'tvg-logo="file:///private/image.png"')))) as unknown as typeof fetch);
  const source = await radio.addPlaylist({ name: "Stations", url: feedUrl });
  expect(radio.playlistStations({ playlistId: source.id })[0]).toMatchObject({ name: "No image", url: "https://stream.example/first" });
  expect(radio.playlistStations({ playlistId: source.id })[0]?.logoUrl).toBeUndefined();
});

test("bounds bytes, station count and redirects, including streams without Content-Length", async () => {
  const responses = [
    () => new Response("small", { headers: { "Content-Length": String(2 * 1024 * 1024 + 1) } }),
    () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
    () => new Response(playlist(Array.from({ length: 5_001 }, (_, index) => entry(`Station ${index}`, `https://stream.example/${index}`, "")).join(""))),
    () => Response.redirect("https://redirect.example/list.m3u", 302),
    () => Response.redirect("https://user:password@redirect.example/private", 302),
  ];
  for (const response of responses) {
    const radio = fixture((async () => response()) as unknown as typeof fetch);
    await expect(radio.addPlaylist({ name: "Too much", url: feedUrl })).rejects.toMatchObject({ status: 502 });
  }
});

test("resolves relative media against the final redirect and rejects invalid feed URLs before fetching", async () => {
  const request = mock(async (input: unknown) => String(input) === feedUrl
    ? new Response(null, { status: 302, headers: { Location: "https://cdn.example/folder/list.m3u" } })
    : new Response(playlist(entry("Redirected", "live.mp3"))));
  const radio = fixture(request as unknown as typeof fetch);
  const source = await radio.addPlaylist({ name: "Redirect", url: feedUrl });
  expect(radio.playlistStations({ playlistId: source.id })[0]?.url).toBe("https://cdn.example/folder/live.mp3");
  const count = request.mock.calls.length;
  for (const url of ["file:///tmp/list.m3u", "https://user:password@example.com/list.m3u", "https://radio.example/list.m3u|Cookie=private", "https:example.com"]) await expect(radio.addPlaylist({ name: "Invalid", url })).rejects.toMatchObject({ status: 400 });
  expect(request).toHaveBeenCalledTimes(count);
});

test("resolves queued radio IDs against the current catalog, then the retained favorite", async () => {
  let text = playlist();
  const radio = fixture((async () => new Response(text)) as unknown as typeof fetch);
  const source = await radio.addPlaylist({ name: "Stations", url: feedUrl });
  const item = radio.playlistStations({ playlistId: source.id })[0]!;
  expect(radio.getPlayable(item.id.toUpperCase())).toEqual({ source: item.url, title: item.name });
  text = playlist(entry("Moved station", "https://stream.example/moved"));
  await radio.refreshPlaylist(source.id);
  const current = { source: "https://stream.example/moved", title: "Moved station" };
  expect(radio.getPlayable(item.id)).toEqual(current);
  radio.saveFavorite(item);
  radio.removePlaylist(source.id);
  expect(radio.getPlayable(item.id)).toEqual(current);
  radio.removeFavorite(item.id);
  expect(() => radio.getPlayable(item.id)).toThrow("not found");
  expect(() => radio.getPlayable("not-a-uuid")).toThrow("Invalid radio station ID");
});
