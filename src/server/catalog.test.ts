import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JellyfinItems } from "../shared/jellyfin";
import { createCatalog } from "./catalog";
import { createLibrary } from "./library";
import { createRadio } from "./radio";
import { openStore } from "./store";
import { createSession } from "./session";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "couch-catalog-")));
  const library = createLibrary({ databasePath: ":memory:", ffprobePath: null });
  const radio = createRadio({ databasePath: ":memory:", discover: async () => { throw new Error("private upstream details"); } });
  let connected = false;
  let connectCalls = 0;
  const invalidations: string[] = [];
  const jellyfin = {
    status: () => ({ connected, serverName: connected ? "Living room" : null, username: connected ? "viewer" : null }),
    connect: async (input: { url: string; username: string; password: string }) => {
      connectCalls++;
      if (input.password === "private-password") throw new Error(`Upstream request failed: ${input.url}; password=${input.password}`);
      connected = true;
      return jellyfin.status();
    },
    disconnect: async () => { connected = false; },
    items: async (options: { query?: string; startIndex?: number } = {}): Promise<JellyfinItems> => {
      if (options.query === "fail") throw new Error("Authorization: secret-token");
      return { items: [], total: 0, startIndex: options.startIndex ?? 0 };
    },
  };
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {});
  const catalog = createCatalog({ library, radio, jellyfin, viewing: { store, session }, invalidate: kind => invalidations.push(kind) });
  cleanup.push(async () => { session.close(); store.close(); await library.close(); radio.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = (path: string, method = "GET", value?: unknown, trusted = false) => catalog.handle(new Request(`http://localhost:4100${path}`, {
    method, ...(value === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  }), trusted);
  return { directory, library, radio, jellyfin, catalog, request, invalidations, session, store, connectCalls: () => connectCalls };
}

test("only the host can add or scan folders; remotes browse indexed media without paths", async () => {
  const { directory, library, request } = fixture();
  writeFileSync(join(directory, "Local song.mp3"), "audio fixture");
  expect((await request("/api/library/sources", "POST", { path: directory })).status).toBe(403);
  expect(library.listSources()).toEqual([]);
  const added = await request("/api/library/sources", "POST", { path: directory }, true);
  expect(added.status).toBe(202);
  const { source } = await added.json() as { source: { id: string; path: string; status: string } };
  expect(source.path).toBe(directory);
  expect(source.status).toBe("scanning");
  await library.scan(source.id);
  expect((await request(`/api/library/sources/${source.id}/scan`, "POST")).status).toBe(403);
  expect((await request("/api/library/sources/missing/scan", "POST", undefined, true)).status).toBe(404);
  const remoteSources = await (await request("/api/library/sources")).text();
  expect(remoteSources).not.toContain(directory);
  expect(remoteSources).not.toContain('"path"');
  const items = await (await request("/api/library/items?q=Local&limit=10")).json() as { total: number; items: Array<{ title: string; available: boolean }> };
  expect(items.total).toBe(1);
  expect(items.items[0]).toMatchObject({ title: "Local song", available: true });
  expect(JSON.stringify(items)).not.toContain(directory);
});

test("folder errors cannot disclose filesystem paths to remotes", async () => {
  const context = fixture();
  const source = await context.library.addSource(context.directory);
  const catalog = createCatalog({
    ...context,
    library: { ...context.library, listSources: () => [{ ...source, status: "error", error: `EACCES: ${context.directory}/private` }] },
    invalidate: () => {},
  });
  const response = await catalog.handle(new Request("http://localhost/api/library/sources"), false);
  const text = await response.text();
  expect(text).toContain("needs attention");
  expect(text).not.toContain(context.directory);
});

test("rejects malformed requests before changing a provider and hides upstream credentials", async () => {
  const { catalog, request, connectCalls, invalidations } = fixture();
  const credentials = { url: "http://private-jellyfin:8096", username: "viewer", password: "private-password" };
  expect((await request("/api/jellyfin", "POST", credentials)).status).toBe(403);
  expect((await request("/api/jellyfin", "DELETE")).status).toBe(403);
  for (const value of [null, [], {}, { ...credentials, username: 123 }]) {
    expect((await request("/api/jellyfin", "POST", value, true)).status).toBe(400);
  }
  const malformed = new Request("http://localhost/api/jellyfin", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect((await catalog.handle(malformed, true)).status).toBe(400);
  expect(connectCalls()).toBe(0);
  const failed = await request("/api/jellyfin", "POST", credentials, true);
  expect(failed.status).toBe(502);
  const text = await failed.text();
  expect(text).not.toContain("private-password");
  expect(text).not.toContain("private-jellyfin");
  expect(invalidations).toEqual([]);
  expect((await request("/api/jellyfin", "POST", { ...credentials, password: "valid" }, true)).status).toBe(200);
  expect(invalidations).toEqual(["jellyfin"]);
  expect(await (await request("/api/jellyfin")).json()).toEqual({ connected: true, serverName: "Living room", username: "viewer" });
  const browseFailure = await request("/api/jellyfin/items?q=fail");
  expect(browseFailure.status).toBe(502);
  expect(await browseFailure.text()).not.toContain("secret-token");
  expect((await request("/api/jellyfin", "DELETE", undefined, true)).status).toBe(200);
  expect(invalidations).toEqual(["jellyfin", "jellyfin"]);
  expect((await request("/api/jellyfin/items")).status).toBe(409);
});

test("radio favorites remain usable when the directory fails", async () => {
  const { request } = fixture();
  const station = { id: "0bfc2b7f-dee7-477b-a626-d14b7c611d39", name: "Test radio", url: "https://radio.example/live", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
  const failure = await request("/api/radio/stations?q=music");
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain("private upstream");
  expect((await request("/api/radio/favorites", "POST", { station })).status).toBe(200);
  expect(await (await request("/api/radio/favorites")).json()).toEqual({ favorites: [station] });
  expect((await request("/api/radio/favorites", "POST", { station: { ...station, url: "file:///private/media.mp3" } })).status).toBe(400);
  expect((await request(`/api/radio/favorites/${station.id}`, "DELETE")).status).toBe(204);
  expect(await (await request("/api/radio/favorites")).json()).toEqual({ favorites: [] });
});

test("rejects invalid pagination and reports supported methods without running mutations", async () => {
  const { request } = fixture();
  for (const path of ["/api/library/items?offset=-1", "/api/library/items?limit=0", "/api/library/items?limit=101", "/api/library/items?offset=NaN", "/api/jellyfin/items?startIndex=1.5", "/api/jellyfin/items?resume=invalid", "/api/radio/stations?countrycode=Italy"]) {
    expect((await request(path)).status).toBe(400);
  }
  const wrongMethod = await request("/api/library/sources", "DELETE");
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get("Allow")).toBe("GET, POST");
  expect((await request("/api/missing")).status).toBe(404);
});

test("video catalog routes paginate ordered episodes with progress and cached artwork without host paths", async () => {
  const { directory, library, request, store } = fixture();
  mkdirSync(join(directory, "Show", "Season 1"), { recursive: true });
  writeFileSync(join(directory, "Show", "tvshow.nfo"), '<tvshow><title>Catalog show</title><unknown path="/private/secret">host-only original</unknown></tvshow>');
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=", "base64");
  writeFileSync(join(directory, "Show", "poster.png"), image);
  for (const number of [10, 2]) writeFileSync(join(directory, "Show", "Season 1", `Show.S01E${number}.mkv`), "unit media");
  const source = await library.addSource(directory);
  await library.scan(source.id);
  const shows = await (await request("/api/library/video/shows?q=Catalog&limit=1")).json();
  const show = shows.items[0];
  expect(shows).toMatchObject({ total: 1, offset: 0, limit: 1, items: [{ title: "Catalog show", episodeCount: 2, seasonCount: 1 }] });
  expect(await (await request(`/api/library/video/shows/${show.id}/seasons`)).json()).toMatchObject({ items: [{ season: 1, episodeCount: 2 }] });
  const item = library.search({ showId: show.id }).items[0]!;
  store.saveProgress("household", { mediaId: `library:${item.id}`, libraryItemId: item.id, title: item.title, position: 25, duration: 120, watched: false, lastPlayedAt: 100 });
  const response = await request(`/api/library/items?videoType=episode&showId=${show.id}&season=1&limit=1`);
  const body = await response.text();
  expect(JSON.parse(body)).toMatchObject({ total: 2, items: [{ id: item.id, video: { episode: 2 }, progress: { position: 25 } }] });
  for (const secret of [directory, "/private/secret", "host-only original", '"fileMetadata"', '"path"']) expect(body + JSON.stringify(shows)).not.toContain(secret);
  const artwork = await request(`/api/library/artwork/${show.artworkId}`);
  expect(artwork.status).toBe(200);
  expect(artwork.headers.get("Content-Type")).toBe("image/png");
  expect(artwork.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(new Uint8Array(await artwork.arrayBuffer())).toEqual(image);
  for (const path of ["/api/library/items?videoType=audio", "/api/library/items?showId=../../private", "/api/library/items?season=1", `/api/library/items?showId=${show.id}&season=-1`,
    `/api/library/items?showId=${show.id}&season=1000`, "/api/library/video/shows?limit=101"]) expect((await request(path)).status).toBe(400);
  expect((await request(`/api/library/video/shows/${"0".repeat(64)}/seasons`)).status).toBe(404);
  expect((await request("/api/library/video/shows", "POST", {})).status).toBe(405);
  expect((await request(`/api/library/video/shows/${show.id}/seasons`, "POST", {})).status).toBe(405);
});

test("watching profiles and progress APIs validate edits and expose path-free catalog/history views", async () => {
  const { directory, library, request, session, store } = fixture();
  writeFileSync(join(directory, "Local movie.mkv"), "video fixture");
  const source = await library.addSource(directory);
  await library.scan(source.id);
  const item = library.search().items[0]!;
  const mediaId = `library:${item.id}`;
  expect(await (await request("/api/profiles")).json()).toEqual({ profiles: [{ id: "household", name: "Household" }], activeProfile: { id: "household", name: "Household" } });
  for (const name of [null, "", " ", "a".repeat(61), "bad\nname", "Household"]) expect((await request("/api/profiles", "POST", { name })).status).toBe(400);
  const created = await request("/api/profiles", "POST", { name: "  Guest  " });
  expect(created.status).toBe(201);
  const { profile } = await created.json() as { profile: { id: string; name: string } };
  expect(profile.name).toBe("Guest");
  expect(session.state.activeProfile.id).toBe("household");
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "POST", { watched: true })).status).toBe(200);
  const catalog = await (await request("/api/library/items")).json() as { items: Array<{ progress: { watched: boolean; position: number } }> };
  expect(catalog.items[0]!.progress).toMatchObject({ watched: true, position: 0 });
  expect(await (await request("/api/progress/history")).json()).toMatchObject({ items: [] });
  store.saveProgress("household", { mediaId, title: item.title, libraryItemId: item.id, position: 25, duration: 120, watched: false, lastPlayedAt: 100 });
  session.command({ type: "enqueue", entry: { id: "queued", title: item.title, source: mediaId } });
  const history = await (await request("/api/progress/history")).text();
  expect(history).toContain('"queueEntryId":"queued"');
  expect(history).not.toContain(directory);
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "POST", { clearResume: true, watched: false })).status).toBe(200);
  expect(store.progress("household", mediaId)).toMatchObject({ position: 0, watched: false });
  for (const edit of [{}, { watched: "yes" }, { clearResume: false }, { clearResume: true, source: "file:///private" }]) expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "POST", edit)).status).toBe(400);
  expect((await request("/api/progress/file%3Aprivate-path", "POST", { watched: true })).status).toBe(400);
  expect((await request("/api/progress/library%3Amissing", "POST", { watched: true })).status).toBe(404);
  expect((await request("/api/progress/history?limit=101")).status).toBe(400);
  expect((await request(`/api/profiles/${profile.id}/select`, "POST")).status).toBe(200);
  expect(await (await request("/api/progress/history")).json()).toMatchObject({ items: [], profile });
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  session.command({ type: "play", entryId: "queued" });
  expect((await request("/api/profiles/household/select", "POST")).status).toBe(409);
});
