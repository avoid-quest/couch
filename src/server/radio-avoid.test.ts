import { afterEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { avoidRadioPlaylistId, avoidRadioPlaylistUrl } from "../shared/radio";
import { createRadio } from "./radio";
import { createRadioSettings } from "./radio-settings";
import { createRadioMetadata } from "./radio-metadata";

const feed = '#EXTM3U\n#EXTINF:-1 tvg-id="avoid-radio-one",One\nhttps://stream.example/one\n';
const radios: ReturnType<typeof createRadio>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const radio of radios.splice(0)) radio.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const fixture = (options: Partial<Parameters<typeof createRadio>[0]> = {}) => {
  const radio = createRadio({ databasePath: ":memory:", fetch: (async () => new Response(feed)) as unknown as typeof fetch, ...options });
  radios.push(radio); return radio;
};
const payload = (fields = {}) => ({ ok: true, data: { streamUrl: "https://stream.example/one", title: "Current programme", sampledAt: 1000, expiresAt: 901000, stationDescription: "Provider description", itemUrl: "https://provider.example/show", ...fields } });

test("first browsing loads avoid radio without setup, coalesces requests and persists stable playback IDs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-avoid-")); directories.push(directory);
  const request = mock(async (url: string) => { expect(url).toBe(avoidRadioPlaylistUrl); return new Response(feed); });
  const databasePath = join(directory, "radio.sqlite");
  const radio = fixture({ databasePath, fetch: request as unknown as typeof fetch });
  const [first, second] = await Promise.all([radio.avoid(), radio.avoid()]);
  expect(first).toEqual(second);
  expect(request).toHaveBeenCalledTimes(1);
  expect(first.playlist).toMatchObject({ id: avoidRadioPlaylistId, name: "avoid radio", stationCount: 1, error: null });
  const station = first.stations[0]!;
  expect(station.sourceId).toBe(avoidRadioPlaylistId);
  expect(radio.getPlayable(station.id)).toMatchObject({ title: "One", source: "https://stream.example/one" });
  radio.saveFavorite(station);
  radio.close();
  const restarted = fixture({ databasePath, fetch: request as unknown as typeof fetch });
  expect((await restarted.avoid()).stations[0]?.id).toBe(station.id);
  expect(restarted.favorites()).toEqual([station]);
  expect(request).toHaveBeenCalledTimes(1);
});

test("default feed failure retains stations, retries explicitly, and does not alter custom playlists", async () => {
  let fail = false;
  const request = mock(async () => fail ? new Response(null, { status: 503 }) : new Response(feed));
  const radio = fixture({ fetch: request as unknown as typeof fetch });
  const custom = await radio.addPlaylist({ name: "Custom", url: "https://example.com/custom.m3u" });
  const initial = await radio.avoid();
  fail = true;
  const failed = await radio.avoid(true);
  expect(failed.stations).toEqual(initial.stations);
  expect(failed.playlist.error).toContain("HTTP 503");
  expect((await radio.avoid()).stations).toEqual(initial.stations);
  expect(request).toHaveBeenCalledTimes(3);
  fail = false;
  expect((await radio.avoid(true)).playlist.error).toBeNull();
  expect(radio.playlistStations({ playlistId: custom.id })).toHaveLength(1);
});

test("paired controllers may browse default radio but cannot change source definitions", async () => {
  const request = mock(async () => new Response(feed));
  const radio = fixture({ fetch: request as unknown as typeof fetch });
  const settings = createRadioSettings(radio);
  const identity = () => ({ authority: "controller" as const, controller: null, claimAvailable: false });
  const read = await settings.handle(new Request("http://localhost/api/radio/avoid"), identity);
  expect(read.status).toBe(200);
  expect((await read.json()).stations).toHaveLength(1);
  expect((await settings.handle(new Request("http://localhost/api/radio/avoid?refresh=true"), identity)).status).toBe(200);
  expect(request).toHaveBeenCalledTimes(2);
  expect((await settings.handle(new Request(`http://localhost/api/radio/playlists/${avoidRadioPlaylistId}/refresh`, { method: "POST" }), identity)).status).toBe(403);
  expect((await settings.handle(new Request("http://localhost/api/radio/sources"), identity)).status).toBe(403);
  expect((await settings.handle(new Request("http://localhost/api/radio/avoid"), () => null)).status).toBe(401);
});

test.each(["before", "after"])("default radio loaded %s custom imports leaves all 30 custom slots available", async when => {
  const radio = fixture();
  expect(radio.playlists()).toEqual([]);
  if (when === "before") await radio.avoid();
  for (let index = 0; index < 30; index++) await radio.addPlaylist({ name: `Custom ${index}`, url: `https://example.com/${index}.m3u` });
  if (when === "after") await radio.avoid();
  expect(radio.playlists()).toHaveLength(31);
  await expect(radio.addPlaylist({ name: "One too many", url: "https://example.com/30.m3u" })).rejects.toThrow("30 custom radio playlists");
  expect((await radio.addPlaylist({ name: "Renamed", url: "https://example.com/0.m3u" })).name).toBe("Renamed");
  expect((await radio.addPlaylist({ name: "avoid radio", url: avoidRadioPlaylistUrl })).id).toBe(avoidRadioPlaylistId);
  expect(radio.playlists()).toHaveLength(31);
});

test("metadata cache shares discovery and playback requests, respects expiry and keeps provider description and URL", async () => {
  let time = 1000;
  const request = mock(async () => Response.json(payload()));
  const metadata = createRadioMetadata({ now: () => time, fetch: request as unknown as typeof fetch });
  const [first, second] = await Promise.all([metadata.get("one", "https://stream.example/one"), metadata.get("one", "https://stream.example/one")]);
  expect(first).toEqual(second);
  expect(first.programme).toMatchObject({ description: "Provider description", programmeUrl: "https://provider.example/show" });
  expect(request).toHaveBeenCalledTimes(1);
  await metadata.get("one", "https://stream.example/one");
  expect(request).toHaveBeenCalledTimes(1);
  time = 902000;
  expect((await metadata.get("one", "https://stream.example/one")).programme).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});

test.each([0, 1])("canceling metadata caller %i leaves the other caller and shared cache healthy", async canceledIndex => {
  const release = Promise.withResolvers<Response>();
  let upstreamSignal: AbortSignal | undefined;
  const request = mock(async (_url: unknown, init?: RequestInit) => { upstreamSignal = init?.signal ?? undefined; return release.promise; });
  const metadata = createRadioMetadata({ now: () => 1000, fetch: request as unknown as typeof fetch });
  const callers = [new AbortController(), new AbortController()];
  const results = callers.map(caller => metadata.get("one", "https://stream.example/one", caller.signal));
  callers[canceledIndex]!.abort();
  expect((await results[canceledIndex])?.programme).toBeNull();
  expect(upstreamSignal?.aborted).toBe(false);
  release.resolve(Response.json(payload()));
  expect((await results[1 - canceledIndex])?.programme?.title).toBe("Current programme");
  expect((await metadata.get("one", "https://stream.example/one")).programme?.title).toBe("Current programme");
  expect(request).toHaveBeenCalledTimes(1);
});

test("unsafe programme links are dropped and provider rate limits apply across stations", async () => {
  const unsafe = createRadioMetadata({ now: () => 1000, fetch: (async () => Response.json(payload({ itemUrl: "javascript:alert(1)", artworkUrl: "https://secret:password@example.com/image" }))) as unknown as typeof fetch });
  const current = (await unsafe.get("one", "https://stream.example/one")).programme;
  expect(current?.title).toBe("Current programme");
  expect(current?.programmeUrl).toBeUndefined();
  expect(current?.artworkUrl).toBeUndefined();
  const request = mock(async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  const limited = createRadioMetadata({ now: () => 1000, fetch: request as unknown as typeof fetch });
  expect((await limited.get("one", "https://stream.example/one")).retryAt).toBe(121000);
  expect((await limited.get("two", "https://stream.example/two")).programme).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});


test("programme details retain provider genre, artist, album and bitrate with bounded optional fields", async () => {
  const rich = { genre: "Detroit House", artist: "Allysha Joy", album: "Live session", bitrate: 320 };
  const metadata = createRadioMetadata({ now: () => 1000, fetch: (async () => Response.json(payload(rich))) as unknown as typeof fetch });
  expect((await metadata.get("one", "https://stream.example/one")).programme).toMatchObject(rich);
  const invalid = createRadioMetadata({ now: () => 1000, fetch: (async () => Response.json(payload({ genre: ["House"], artist: "x".repeat(501), album: " ", bitrate: -1 }))) as unknown as typeof fetch });
  const current = (await invalid.get("one", "https://stream.example/one")).programme!;
  expect(current.title).toBe("Current programme");
  for (const field of ["genre", "artist", "album", "bitrate"]) expect(current).not.toHaveProperty(field);
});
