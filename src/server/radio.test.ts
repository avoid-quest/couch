import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RadioStation } from "../shared/radio";
import { createRadio } from "./radio";

const radios: ReturnType<typeof createRadio>[] = [];
const directories: string[] = [];
const favorite: RadioStation = { id: "01234567-89ab-cdef-0123-456789abcdef", name: "Test radio", url: "https://stream.example/live", homepage: "https://radio.example/", countryCode: "IT", codec: "MP3", bitrate: 128 };
const raw = { stationuuid: favorite.id, name: favorite.name, url: "https://radio.example/playlist.m3u", url_resolved: favorite.url, homepage: favorite.homepage, countrycode: favorite.countryCode, codec: favorite.codec, bitrate: favorite.bitrate, private_field: "not exposed" };

function fixture(options: Partial<Parameters<typeof createRadio>[0]> = {}) {
  const radio = createRadio({ databasePath: ":memory:", discover: async () => ["https://one.api.radio-browser.info"], ...options });
  radios.push(radio);
  return radio;
}

afterEach(() => {
  setSystemTime();
  for (const radio of radios.splice(0)) radio.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("discovers mirrors, retries failures, normalizes stations, and caches matching searches", async () => {
  const discover = mock(async () => ["https://one.api.radio-browser.info", "https://two.api.radio-browser.info"]);
  const calls: { url: string; init?: RequestInit }[] = [];
  const radio = fixture({ discover, fetch: (async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).startsWith("https://one.")) return new Response("Down", { status: 503 });
    return Response.json([raw, raw, { ...raw, stationuuid: "invalid" }, { ...raw, stationuuid: "12345678-89ab-cdef-0123-456789abcdef", url_resolved: "file:///tmp/private", url: "file:///tmp/private" }]);
  }) as typeof fetch });
  const found = await radio.search({ q: " Test ", countrycode: "it" });
  expect(found).toEqual([favorite]);
  const target = new URL(calls[1]!.url);
  expect(target.searchParams.get("name")).toBe("Test");
  expect(target.searchParams.get("countrycode")).toBe("IT");
  expect(target.searchParams.get("limit")).toBe("50");
  expect(target.searchParams.get("hidebroken")).toBe("true");
  expect(new Headers(calls[1]?.init?.headers).get("User-Agent")).toBe("Couch/0.1");
  expect(calls[1]?.init?.signal).toBeInstanceOf(AbortSignal);
  expect(await radio.search({ q: "Test", countrycode: "IT" })).toEqual(found);
  expect(calls.length).toBe(2);
  expect(discover).toHaveBeenCalledTimes(1);
});

test("expires cached searches and discovered mirrors", async () => {
  const start = new Date("2026-09-05T10:00:00Z");
  setSystemTime(start);
  const discover = mock(async () => ["https://one.api.radio-browser.info"]);
  const request = mock(async () => Response.json([raw]));
  const radio = fixture({ discover, fetch: request as unknown as typeof fetch });
  await radio.search();
  setSystemTime(new Date(start.getTime() + 6 * 60_000));
  await radio.search();
  expect(request).toHaveBeenCalledTimes(2);
  expect(discover).toHaveBeenCalledTimes(1);
  setSystemTime(new Date(start.getTime() + 31 * 60_000));
  await radio.search();
  expect(request).toHaveBeenCalledTimes(3);
  expect(discover).toHaveBeenCalledTimes(2);
});

test("shares in-flight searches and caps upstream results", async () => {
  const request = mock(async () => Response.json(Array.from({ length: 80 }, (_, index) => ({ ...raw, stationuuid: `${index.toString(16).padStart(8, "0")}-89ab-cdef-0123-456789abcdef` }))));
  const radio = fixture({ fetch: request as unknown as typeof fetch });
  const [first, second] = await Promise.all([radio.search(), radio.search()]);
  expect(first).toHaveLength(50);
  expect(second).toEqual(first);
  expect(request).toHaveBeenCalledTimes(1);
});

test("reports malformed providers and retries discovery on the next search", async () => {
  const discover = mock(async () => ["https://one.api.radio-browser.info"]);
  const radio = fixture({ discover, fetch: (async () => Response.json({ error: "not stations" })) as unknown as typeof fetch });
  await expect(radio.search()).rejects.toMatchObject({ status: 503 });
  await expect(radio.search()).rejects.toThrow("Your saved stations are still available");
  expect(discover).toHaveBeenCalledTimes(2);
  expect(radio.favorites()).toEqual([]);
  const noDns = fixture({ discover: async () => { throw new Error("DNS failed"); } });
  await expect(noDns.search()).rejects.toMatchObject({ status: 503 });
});

test("aborts a stalled provider before trying another mirror", async () => {
  let aborted = false;
  const radio = fixture({ discover: async () => ["https://stalled.api.radio-browser.info", "https://working.api.radio-browser.info"], fetch: (async (input, init) => {
    if (String(input).includes("working")) return Response.json([raw]);
    return new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener("abort", () => { aborted = true; reject(init!.signal!.reason); }, { once: true });
    });
  }) as typeof fetch });
  expect(await radio.search()).toEqual([favorite]);
  expect(aborted).toBeTrue();
}, 5_000);

test("validates search inputs before contacting the provider", async () => {
  const discover = mock(async () => []);
  const radio = fixture({ discover });
  await expect(radio.search({ q: "x".repeat(101) })).rejects.toMatchObject({ status: 400 });
  await expect(radio.search({ countrycode: "Italy" })).rejects.toMatchObject({ status: 400 });
  expect(discover).not.toHaveBeenCalled();
});

test("persists favorites, updates by stable station UUID, and broadcasts actual removals", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-radio-"));
  directories.push(directory);
  const databasePath = join(directory, "state.sqlite");
  const changed = mock(() => {});
  const first = fixture({ databasePath, onChange: changed });
  first.saveFavorite(favorite);
  first.saveFavorite({ ...favorite, name: "Updated name" });
  expect(first.favorites()).toEqual([{ ...favorite, name: "Updated name" }]);
  first.close();
  radios.splice(radios.indexOf(first), 1);
  const reopened = fixture({ databasePath, onChange: changed });
  expect(reopened.favorites()).toEqual([{ ...favorite, name: "Updated name" }]);
  reopened.removeFavorite(favorite.id.toUpperCase());
  reopened.removeFavorite(favorite.id);
  expect(reopened.favorites()).toEqual([]);
  expect(changed).toHaveBeenCalledTimes(3);
});

test("rejects malformed favorites and strips fields outside the public station model", () => {
  const radio = fixture();
  for (const value of [null, {}, { ...favorite, id: "bad" }, { ...favorite, url: "file:///private" }, { ...favorite, url: "https://user:password@example.com/" }, { ...favorite, homepage: "javascript:alert(1)" }, { ...favorite, bitrate: -1 }, { ...favorite, name: " " }]) {
    expect(() => radio.saveFavorite(value)).toThrow();
  }
  expect(radio.favorites()).toEqual([]);
  expect(radio.saveFavorite({ ...favorite, secret: "must not persist" })).toEqual(favorite);
  expect(radio.favorites()).toEqual([favorite]);
});

test("programme lookup trusts only stations currently imported from the avoid feed", async () => {
  let stream = "https://streams.example/original";
  const radio = fixture({ fetch: (async () => new Response(`#EXTM3U\n#EXTINF:-1 tvg-id="avoid-radio-one",One\n${stream}\n`)) as unknown as typeof fetch });
  const own = await radio.addPlaylist({ name: "avoid", url: "https://radio.avoid.quest/playlist.m3u" });
  const other = await radio.addPlaylist({ name: "other", url: "https://example.com/playlist.m3u" });
  const station = radio.playlistStations({ playlistId: own.id })[0]!;
  expect(radio.programmeStation(`radio:${station.id}`)).toEqual({ id: "avoid-radio-one", streamUrl: stream });
  expect(radio.programmeStation(`radio:${radio.playlistStations({ playlistId: other.id })[0]!.id}`)).toBeNull();
  radio.saveFavorite(station);
  stream = "https://streams.example/updated";
  await radio.refreshPlaylist(own.id);
  expect(radio.programmeStation(`radio:${station.id}`)).toEqual({ id: "avoid-radio-one", streamUrl: stream });
  expect(radio.getPlayable(station.id).source).toBe(stream);
  radio.removePlaylist(own.id);
  expect(radio.programmeStation(`radio:${station.id}`)).toBeNull();
  expect(radio.getPlayable(station.id).source).toBe(stream);
});
