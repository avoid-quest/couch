import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibrary } from "./library";
import { createContinuationResolver } from "./continuation";
import type { loadProviderList } from "./providers";
import type { ProviderItem } from "../shared/providers";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const signal = () => new AbortController().signal;

function fixture(loadList?: typeof loadProviderList) {
  const directory = mkdtempSync(join(tmpdir(), "couch-continuation-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "library.sqlite");
  const library = createLibrary({ databasePath, ffprobePath: null });
  cleanup.push(() => library.close());
  const db = new Database(databasePath);
  cleanup.push(() => db.close());
  db.run("INSERT INTO library_sources (id, name, path, status) VALUES ('source', 'Fixture', '/fixture', 'ready')");
  const add = (id: string, options: { album?: string; disc?: number; track?: number; season?: number | null; episode?: number | null; available?: boolean; show?: string } = {}) => {
    const video = options.season !== undefined || options.episode !== undefined ? JSON.stringify({ type: "episode", plot: `Synopsis of ${id}`, season: options.season ?? null, episode: options.episode ?? null, show: { id: options.show ?? "show", title: "Fixture series" } }) : null;
    db.query("INSERT INTO library_items (id, sourceId, path, title, kind, size, modified, seenScan, albumId, album, discNumber, trackNumber, video, available) VALUES (?, 'source', ?, ?, ?, 1, 1, 'scan', ?, ?, ?, ?, ?, ?)")
      .run(id, `/${id}`, id, options.album ? "audio" : "video", options.album ?? null, options.album ?? null, options.disc ?? null, options.track ?? null, video, options.available === false ? 0 : 1);
  };
  const resolve = createContinuationResolver({ library, jellyfin: { continuation: async () => null }, loadList });
  const play = (id: string) => resolve({ id: "current", title: id, source: `library:${id}` }, signal());
  return { add, play, resolve };
}

test("album continuation follows disc and track metadata without queueing its current track", async () => {
  const { add, play } = fixture();
  add("alphabetically first", { album: "Record", disc: 2, track: 1 });
  add("current", { album: "Record", disc: 1, track: 2 });
  add("previous", { album: "Record", disc: 1, track: 1 });
  add("next", { album: "Record", disc: 1, track: 3 });
  add("missing", { album: "Record", disc: 1, track: 4, available: false });
  add("unrelated", { album: "Other", disc: 1, track: 3 });
  const continuation = await play("current");
  expect(continuation?.title).toBe("Record");
  expect(continuation?.entries[0]?.subtitle).toBe("Record");
  expect(continuation?.entries.map(entry => entry.title)).toEqual(["next", "alphabetically first"]);
  expect(new Set(continuation?.entries.map(entry => entry.id)).size).toBe(2);
  expect((await play("alphabetically first"))?.entries).toEqual([]);
});

test("numbered television continuation spans every page and season, excluding alternate versions and unknown numbers", async () => {
  const { add, play } = fixture();
  for (let index = 204; index >= 1; index--) add(`episode-${index}`, { season: index <= 102 ? 1 : 2, episode: index <= 102 ? index : index - 102 });
  add("alternate current", { season: 1, episode: 101 });
  add("alternate next", { season: 1, episode: 102, available: false });
  add("unknown", { season: 2, episode: null });
  add("other show", { season: 2, episode: 1, show: "other" });
  const continuation = await play("episode-101");
  expect(continuation?.title).toBe("Fixture series");
  expect(continuation?.entries).toHaveLength(103);
  expect(continuation?.entries[0]).toMatchObject({ source: "library:episode-102", subtitle: "Fixture series", description: "Synopsis of episode-102" });
  expect(continuation?.entries[1]?.source).toBe("library:episode-103");
  expect(continuation?.entries.at(-1)?.source).toBe("library:episode-204");
});

test("standalone media, unknown episode ordering and live sources do not acquire a continuation", async () => {
  const { add, play, resolve } = fixture();
  add("movie");
  add("unknown", { season: null, episode: 1 });
  expect(await play("movie")).toBeNull();
  expect(await play("unknown")).toBeNull();
  expect(await play("gone")).toBeNull();
  for (const source of ["web:https://www.youtube.com/watch?v=abcdefghijk", "radio:station", "file:/movie.mkv"]) {
    expect(await resolve({ id: "entry", title: "Media", source }, signal())).toBeNull();
  }
  expect(await resolve({ id: "entry", title: "Live", source: "library:movie", live: true }, signal())).toBeNull();
});

test("canceled lookups never return a continuation", async () => {
  const { resolve } = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(resolve({ id: "entry", title: "Media", source: "library:any" }, controller.signal)).rejects.toThrow();
});

test("YouTube continuation preserves the selected playlist occurrence and validates membership", async () => {
  const collection = "https://www.youtube.com/playlist?list=PLfixture12345";
  const video = (id: string): ProviderItem => ({ id, provider: "youtube", kind: "media", title: id, url: `https://www.youtube.com/watch?v=${id}` });
  const a = video("aaaaaaaaaaa"), b = video("bbbbbbbbbbb"), c = video("ccccccccccc");
  const { resolve } = fixture(async () => ({ title: "Confirmed list", items: [a, b, a, c] }));
  const entry = { id: "current", title: a.title, source: `web:${a.url}`, quality: "720p" as const, collection: { title: "Supplied label", url: collection, index: 2 } };
  const result = await resolve(entry, signal());
  expect(result?.title).toBe("Confirmed list");
  expect(result?.entries.map(entry => entry.source)).toEqual([`web:${c.url}`]);
  expect(result?.entries[0]?.collection).toEqual({ title: "Confirmed list", url: collection, index: 3 });
  expect(result?.entries[0]?.quality).toBe("720p");
  expect(await resolve({ ...entry, collection: { ...entry.collection, index: 1 } }, signal())).toBeNull();
  expect(await resolve({ ...entry, collection: { title: "List", url: collection } }, signal())).toBeNull();
});

test("a Bandcamp album continues only after its selected track and preserves artwork", async () => {
  const items: ProviderItem[] = ["one", "two", "three"].map(id => ({ id, provider: "bandcamp", kind: "media", title: id, url: `https://fixture.bandcamp.com/track/${id}`, thumbnail: "https://f4.bcbits.com/img/a123_5.jpg", duration: 90 }));
  const { resolve } = fixture(async () => ({ title: "Record", items }));
  const result = await resolve({ id: "current", title: "two", source: `web:${items[1]!.url}`, collection: { title: "Record", url: "https://fixture.bandcamp.com/album/record", index: 1 } }, signal());
  expect(result?.entries).toHaveLength(1);
  expect(result?.entries[0]).toMatchObject({ title: "three", thumbnail: items[2]!.thumbnail, duration: 90 });
});

test("historical StreamingCommunity episodes recover only their own title's confirmed sequence", async () => {
  const origin = "https://streamingcommunityz.photos";
  const requested: string[] = [];
  const items: ProviderItem[] = [17206, 17207, 17208].map(id => ({ id: String(id), provider: "streamingcommunity", kind: "media", title: `Episode ${id}`, url: `${origin}/it/watch/1955?e=${id}` }));
  const watch = await Bun.file(new URL("./providers/streamingcommunity.fixtures/watch-episode.json", import.meta.url)).text();
  const request = spyOn(globalThis, "fetch").mockResolvedValue(new Response(`<div data-page="${watch.replace(/"/g, "&quot;")}"></div>`));
  cleanup.push(() => request.mockRestore());
  const { resolve } = fixture(async (_provider, url) => {
    requested.push(url);
    if (url !== `${origin}/it/titles/1955-masterchef-italia`) throw new Error("404: canonical slug required");
    return { title: "MasterChef Italia", items };
  });
  const result = await resolve({ id: "current", title: "Old episode", source: `web:${origin}/it/watch/1955?e=17207` }, signal());
  expect(requested).toEqual([`${origin}/it/titles/1955-masterchef-italia`]);
  expect(result?.entries.map(entry => entry.source)).toEqual([`web:${items[2]!.url}`]);
  expect(request).toHaveBeenCalledTimes(1);
});

test("a StreamingCommunity episode selected in a season continues into the next season of its series", async () => {
  const origin = "https://streamingcommunityz.photos";
  const requested: string[] = [];
  const items: ProviderItem[] = ["S01E01", "S01E02", "S02E01"].map((title, index) => ({ id: String(index + 1), provider: "streamingcommunity", kind: "media", title, url: `${origin}/it/watch/12?e=${index + 1}` }));
  const { resolve } = fixture(async (_provider, url) => { requested.push(url); return { title: "The series", items }; });
  const result = await resolve({ id: "current", title: "S01E02", source: `web:${items[1]!.url}`, collection: { title: "Season 1", url: `${origin}/it/titles/12-the-series/season-1`, index: 0 } }, signal());
  expect(requested).toEqual([`${origin}/it/titles/12-the-series`]);
  expect(result?.entries.map(entry => entry.title)).toEqual(["S02E01"]);
  expect(result?.entries[0]?.collection).toEqual({ title: "The series", url: `${origin}/it/titles/12-the-series`, index: 2 });
});

test("provider continuation rejects unrelated containers, bare videos and canceled list reads", async () => {
  let loads = 0;
  const controller = new AbortController();
  const { resolve } = fixture(async () => { loads++; controller.abort(); return { items: [] }; });
  const entry = { id: "current", title: "Video", source: "web:https://www.youtube.com/watch?v=aaaaaaaaaaa" };
  expect(await resolve(entry, signal())).toBeNull();
  expect(await resolve({ ...entry, collection: { title: "Unrelated", url: "https://fixture.bandcamp.com/album/record" } }, signal())).toBeNull();
  expect(await resolve({ ...entry, collection: { title: "Feed", url: "https://www.youtube.com/@channel/videos" } }, signal())).toBeNull();
  expect(loads).toBe(0);
  await expect(resolve({ ...entry, collection: { title: "List", url: "https://www.youtube.com/playlist?list=PLfixture12345" } }, controller.signal)).rejects.toThrow();
});
