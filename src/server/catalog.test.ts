import { createMediaFolders } from "./media-folders";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JellyfinItems } from "../shared/jellyfin";
import { createCatalog } from "./catalog";
import { createJellyfinSettings } from "./jellyfin-settings";
import { createLibrary } from "./library";
import { createRadio } from "./radio";
import { openStore } from "./store";
import { createSession } from "./session";

const folders = createMediaFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null });

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "couch-catalog-")));
  const library = createLibrary({ folders, databasePath: ":memory:", ffprobePath: null });
  const radio = createRadio({ databasePath: ":memory:", discover: async () => { throw new Error("private upstream details"); } });
  let connected = false;
  let connectCalls = 0;
  const invalidations: string[] = [];
  const jellyfin = {
    status: () => ({ connected, serverName: connected ? "Living room" : null, username: connected ? "viewer" : null }),
    connection: () => ({ ...jellyfin.status(), url: connected ? "http://private-jellyfin:8096" : null }),
    test: async () => jellyfin.status(),
    connect: async (input: { url: string; username: string; password: string }, _authorize?: () => void, changed?: () => void) => {
      connectCalls++;
      if (input.password === "private-password") throw new Error(`Upstream request failed: ${input.url}; password=${input.password}`);
      connected = true;
      changed?.();
      return jellyfin.status();
    },
    disconnect: async (_authorize?: () => void, changed?: () => void) => { connected = false; changed?.(); },
    items: async (options: { query?: string; startIndex?: number } = {}): Promise<JellyfinItems> => {
      if (options.query === "fail") throw new Error("Authorization: secret-token");
      return { items: [], total: 0, startIndex: options.startIndex ?? 0 };
    },
  };
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {});
  const catalog = createCatalog({ library, radio, jellyfin, viewing: { store, session } });
  const settings = createJellyfinSettings({ jellyfin, invalidate: () => invalidations.push("jellyfin") });
  cleanup.push(async () => { session.close(); store.close(); await library.close(); radio.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = (path: string, method = "GET", value?: unknown, trusted = false) => {
    const input = new Request(`http://localhost:4100${path}`, {
      method, ...(value === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    });
    return path === "/api/jellyfin"
      ? settings.handle(input, () => ({ controller: null, authority: trusted ? "host" : "controller", claimAvailable: false }))
      : catalog.handle(input, trusted);
  };
  return { directory, library, radio, jellyfin, catalog, settings, request, invalidations, session, store, connectCalls: () => connectCalls };
}

test("catalog keeps source mutation in Settings while remotes browse indexed media without paths", async () => {
  const { directory, library, request } = fixture();
  writeFileSync(join(directory, "Local song.mp3"), "audio fixture");
  for (const trusted of [false, true]) expect((await request("/api/library/sources", "POST", { path: directory }, trusted)).status).toBe(405);
  expect(library.listSources()).toEqual([]);
  const source = await library.addSource(directory);
  await library.scan(source.id);
  expect((await request(`/api/library/sources/${source.id}/scan`, "POST", undefined, true)).status).toBe(404);
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
  });
  const response = await catalog.handle(new Request("http://localhost/api/library/sources"), false);
  const text = await response.text();
  expect(text).toContain("needs attention");
  expect(text).not.toContain(context.directory);
});

test("rejects malformed requests before changing a provider and hides upstream credentials", async () => {
  const { settings, request, connectCalls, invalidations } = fixture();
  const credentials = { url: "http://private-jellyfin:8096", username: "viewer", password: "private-password" };
  expect((await request("/api/jellyfin", "POST", credentials)).status).toBe(403);
  expect((await request("/api/jellyfin", "DELETE")).status).toBe(403);
  for (const value of [null, [], {}, { ...credentials, username: 123 }]) {
    expect((await request("/api/jellyfin", "POST", value, true)).status).toBe(400);
  }
  const malformed = new Request("http://localhost/api/jellyfin", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect((await settings.handle(malformed, () => ({ authority: "host", controller: null, claimAvailable: false }))).status).toBe(400);
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

test("radio favorites persist drag reordering and legacy installs keep their reading order", async () => {
  const { request } = fixture();
  const station = (name: string) => ({ id: name === "First" ? "0bfc2b7f-dee7-477b-a626-d14b7c611d11" : "0bfc2b7f-dee7-477b-a626-d14b7c611d22", name, url: `https://radio.example/${name.toLowerCase()}`, homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 });
  await request("/api/radio/favorites", "POST", { station: station("First") });
  await request("/api/radio/favorites", "POST", { station: station("Second") });
  expect((await (await request("/api/radio/favorites")).json() as { favorites: Array<{ name: string }> }).favorites.map(favorite => favorite.name)).toEqual(["Second", "First"]);
  expect((await request("/api/radio/favorites/reorder", "POST", { order: [station("First").id, station("Second").id] })).status).toBe(200);
  expect((await request("/api/radio/favorites/reorder", "POST", { order: [station("First").id, "gone"] })).status).toBe(400);
  expect((await request("/api/radio/favorites/reorder", "GET")).status).toBe(405);
  expect((await (await request("/api/radio/favorites")).json() as { favorites: Array<{ name: string }> }).favorites.map(favorite => favorite.name)).toEqual(["First", "Second"]);
  // A legacy database without saved positions backfills alphabetical order.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "couch-radio-order-")));
  cleanup.push(async () => rmSync(directory, { recursive: true, force: true }));
  const legacyPath = join(directory, "radio.sqlite");
  const legacy = new Database(legacyPath, { create: true, strict: true });
  legacy.run("CREATE TABLE radio_favorites (id TEXT PRIMARY KEY, station TEXT NOT NULL)");
  for (const name of ["Zebra", "Alpha"]) legacy.query("INSERT INTO radio_favorites VALUES (?, ?)").run(crypto.randomUUID(), JSON.stringify(station(name) as unknown));
  legacy.close();
  const reopened = createRadio({ databasePath: legacyPath, discover: async () => { throw new Error("private upstream details"); } });
  cleanup.push(async () => reopened.close());
  expect(reopened.favorites().map(favorite => favorite.name)).toEqual(["Alpha", "Zebra"]);
});

test("rejects invalid pagination and reports supported methods without running mutations", async () => {
  const { request } = fixture();
  for (const path of ["/api/library/items?offset=-1", "/api/library/items?limit=0", "/api/library/items?limit=101", "/api/library/items?offset=NaN", "/api/jellyfin/items?startIndex=1.5", "/api/jellyfin/items?resume=invalid", "/api/radio/stations?countrycode=Italy"]) {
    expect((await request(path)).status).toBe(400);
  }
  const wrongMethod = await request("/api/library/sources", "DELETE");
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get("Allow")).toBe("GET");
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
  expect(await (await request("/api/progress/history")).json()).toMatchObject({ items: [{ mediaId, position: 0, watched: false }], profile });
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  session.command({ type: "play", entryId: "queued" });
  expect((await request("/api/profiles/household/select", "POST")).status).toBe(409);
});

test("profile edits validate HTTP bodies consistently and leave the Jellyfin account alone", async () => {
  const { request, catalog, connectCalls, invalidations, session } = fixture();
  await request("/api/jellyfin", "POST", { url: "http://jellyfin.example", username: "viewer", password: "valid" }, true);
  const account = await (await request("/api/jellyfin")).json();
  const { profile } = await (await request("/api/profiles", "POST", { name: "Viewer" })).json();
  const rename = `/api/profiles/${profile.id}/rename`, remove = `/api/profiles/${profile.id}/remove`;
  for (const name of [null, 42, {}, "", " ", "x".repeat(61), "bad\nname", "hOuSeHoLd"]) {
    const create = await request("/api/profiles", "POST", { name });
    const edit = await request(rename, "POST", { name, expectedName: profile.name });
    expect(edit.status).toBe(400);
    expect(await edit.json()).toEqual(await create.json());
  }
  for (const path of [rename, remove]) {
    expect((await request(path)).status).toBe(405);
    for (const value of [[], null, {}, { expectedName: null }, { expectedName: "" }, { expectedName: "x".repeat(61) }, { expectedName: "Viewer", role: "administrator" }]) expect((await request(path, "POST", value)).status).toBe(400);
    const malformed = new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    expect((await catalog.handle(malformed, false)).status).toBe(400);
  }
  expect(await (await request(rename, "POST", { name: "Renamed", expectedName: profile.name })).json()).toEqual({ profile: { ...profile, name: "Renamed" } });
  expect((await request(remove, "POST", { expectedName: profile.name })).status).toBe(409);
  await request(`/api/profiles/${profile.id}/select`, "POST");
  expect(await (await request(remove, "POST", { expectedName: "Renamed" })).json()).toEqual({ activeProfile: { id: "household", name: "Household" } });
  expect((await request(remove, "POST", { expectedName: "Renamed" })).status).toBe(404);
  expect(session.state.activeProfile.id).toBe("household");
  expect(await (await request("/api/jellyfin")).json()).toEqual(account);
  expect(connectCalls()).toBe(1);
  expect(invalidations).toEqual(["jellyfin"]);
});


test("history replay validates current playback settings and keeps durable source URLs private", async () => {
  const { request, session, store } = fixture();
  const { playbackMediaId } = await import("./progress");
  const entry = { id: "web", title: "An album track", source: "web:https://artist.example/track", thumbnail: "https://artist.example/art.jpg" };
  const mediaId = playbackMediaId(entry)!;
  store.saveProgress("household", { mediaId, title: entry.title, libraryItemId: null, position: 21, duration: 200, watched: false, lastPlayedAt: 100 }, entry);
  const data = await (await request("/api/progress/history")).json();
  expect(data.items[0]).toMatchObject({ mediaId, playable: true, sourceLabel: "Online", thumbnail: entry.thumbnail });
  expect(JSON.stringify(data)).not.toContain(entry.source);
  expect(JSON.stringify(data)).not.toContain("queueEntryId");
  const endpoint = `/api/progress/${encodeURIComponent(mediaId)}/play`;
  expect((await request(endpoint)).status).toBe(405);
  for (const body of [{}, { profileId: "household", fromStart: "yes" }, { profileId: "household", source: "file:///private" }]) expect((await request(endpoint, "POST", body)).status).toBe(400);
  expect((await request(endpoint, "POST", { profileId: "other" })).status).toBe(409);
  expect(session.state.queue).toEqual([]);
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  expect((await request(endpoint, "POST", { profileId: "household" })).status).toBe(200);
  expect(session.state.queue[0]).toMatchObject({ title: entry.title, source: entry.source });
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "POST", { clearResume: true })).status).toBe(409);
  session.command({ type: "stop" });
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "POST", { clearResume: true })).status).toBe(200);
  expect(store.progress("household", mediaId)?.position).toBe(0);
});

test("history removal clears every profile's row and refuses entries that are playing or unknown", async () => {
  const { request, session, store } = fixture();
  const mediaId = `library:${"a".repeat(40)}`;
  store.saveProgress("household", { mediaId, title: "Shared item", libraryItemId: "a".repeat(40), position: 10, duration: 100, watched: false, lastPlayedAt: 100 });
  store.saveProgress("guest", { mediaId, title: "Shared item", libraryItemId: "a".repeat(40), position: 20, duration: 100, watched: true, lastPlayedAt: 90 });
  expect(await (await request("/api/progress/history")).json()).toMatchObject({ items: [{ mediaId, watched: false }] });
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "GET")).status).toBe(405);
  expect((await request(`/api/progress/${"b".repeat(64)}`, "DELETE")).status).toBe(400);
  expect((await request("/api/progress/library%3Amissing", "DELETE")).status).toBe(404);
  session.command({ type: "enqueue", entry: { id: "queued", title: "Shared item", source: mediaId } });
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}/play`, "POST", { profileId: "household" })).status).toBe(200);
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "DELETE")).status).toBe(409);
  session.command({ type: "stop" });
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "DELETE")).status).toBe(200);
  expect(store.progress("household", mediaId)).toBeNull();
  expect(store.progress("guest", mediaId)).toBeNull();
  expect(await (await request("/api/progress/history")).json()).toMatchObject({ items: [] });
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}`, "DELETE")).status).toBe(404);
});

test("history removal Undo restores every profile's exact progress once", async () => {
  const { request, store } = fixture();
  const mediaId = `library:${"a".repeat(40)}`;
  const guest = store.createProfile("Guest");
  store.saveProgress("household", { mediaId, title: "Shared item", libraryItemId: "a".repeat(40), position: 10, duration: 100, watched: false, lastPlayedAt: 100 });
  store.saveProgress(guest.id, { mediaId, title: "Shared item", libraryItemId: "a".repeat(40), position: 20, duration: 100, watched: true, lastPlayedAt: 90 });
  const before = [store.progress("household", mediaId), store.progress(guest.id, mediaId)];
  const removed = await request(`/api/progress/${encodeURIComponent(mediaId)}`, "DELETE");
  const { undoToken } = await removed.json() as { undoToken: string };
  expect(removed.status).toBe(200);
  expect(store.progress("household", mediaId)).toBeNull();
  expect((await request("/api/progress/undo", "POST", { token: undoToken })).status).toBe(200);
  expect([store.progress("household", mediaId), store.progress(guest.id, mediaId)]).toEqual(before);
  expect((await request("/api/progress/undo", "POST", { token: undoToken })).status).toBe(410);
});

test("Remove from Continue clears the resume point and Undo restores it", async () => {
  const { request, store } = fixture();
  const mediaId = `library:${"a".repeat(40)}`;
  store.saveProgress("household", { mediaId, title: "Half watched", libraryItemId: "a".repeat(40), position: 42, duration: 100, watched: false, lastPlayedAt: 100 });
  const before = store.progress("household", mediaId);
  const response = await request(`/api/progress/${encodeURIComponent(mediaId)}`, "POST", { clearResume: true });
  const { undoToken } = await response.json() as { undoToken: string };
  expect(store.progress("household", mediaId)).toMatchObject({ position: 0, watched: false });
  expect((await (await request("/api/progress/history")).json()).items).toHaveLength(1);
  expect((await request("/api/progress/undo", "POST", { token: undoToken })).status).toBe(200);
  expect(store.progress("household", mediaId)).toEqual(before);
});

test("person naming requires an explicit valid request and retains generic label API compatibility", async () => {
  const { request, store } = fixture();
  const path = "/api/profiles/household/person-name";
  expect((await request(path)).status).toBe(405);
  for (const body of [{ name: "Francesco" }, { name: "", expectedName: "Household" }, { name: "Francesco", expectedName: "Household", personName: "Invented" }]) expect((await request(path, "POST", body)).status).toBe(400);
  expect(await (await request(path, "POST", { name: "Francesco", expectedName: "Household" })).json()).toEqual({ profile: { id: "household", name: "Francesco", personName: "Francesco" } });
  expect((await request(path, "POST", { name: "Stale", expectedName: "Household" })).status).toBe(409);
  expect(store.profiles()).toEqual([{ id: "household", name: "Francesco", personName: "Francesco" }]);
  expect((await request("/api/profiles/household/rename", "POST", { name: "Device", expectedName: "Francesco" })).status).toBe(200);
  expect(store.activeProfile()).toEqual({ id: "household", name: "Device" });
});


test("changing active history while a person-name body loads rejects the stale name", async () => {
  const { catalog, session, store } = fixture();
  const first = store.activeProfile(), second = session.createProfile("Other");
  let finish!: () => void;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ name: "Francesco", expectedName: first.name })));
    finish = () => controller.close();
  } });
  const request = new Request(`http://localhost/api/profiles/${first.id}/person-name`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: stream,
  });
  const pending = catalog.handle(request, false);
  session.selectProfile(second.id);
  const before = structuredClone(session.state), profiles = store.profiles();
  finish();
  const response = await pending;
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("active history changed");
  expect(store.profiles()).toEqual(profiles);
  expect(session.state).toEqual(before);
});

test("every remote can play and edit shared history retained under a different legacy record", async () => {
  const { request, session, store } = fixture();
  const { playbackMediaId } = await import("./progress");
  const older = store.createProfile("Older history");
  const entry = { id: "old-video", title: "Older video", source: "web:https://video.example/watch/old" };
  const mediaId = playbackMediaId(entry)!;
  store.saveProgress(older.id, { mediaId, title: entry.title, libraryItemId: null, position: 21, duration: 200, watched: false, lastPlayedAt: 100 }, entry);
  expect((await (await request("/api/progress/history")).json()).items).toMatchObject([{ mediaId, position: 21, playable: true }]);
  expect(store.history("household")).toEqual([]);
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  expect((await request(`/api/progress/${encodeURIComponent(mediaId)}/play`, "POST", { profileId: "household" })).status).toBe(200);
  expect(session.state.queue[0]?.source).toBe(entry.source);
  expect(session.state.activeProfile.id).toBe("household");
  session.command({ type: "stop" });
  const response = await request(`/api/progress/${encodeURIComponent(mediaId)}`, "POST", { clearResume: true, watched: true });
  expect(response.status).toBe(200);
  expect((await response.json()).progress).toMatchObject({ position: 0, watched: true });
  expect(store.progress(older.id, mediaId)).toMatchObject({ position: 0, watched: true });
  expect(store.history("household")).toEqual([]);
  expect(store.profiles()).toHaveLength(2);
});


test("provider history filters before the limit, deduplicates shared plays and keeps source URLs private", async () => {
  const { request, store } = fixture();
  const { playbackMediaId } = await import("./progress");
  const profile = store.createProfile("Old profile");
  const sources = ["https://youtu.be/old", "https://www.twitch.tv/videos/123", "https://www.raiplay.it/video/episode.html", "https://artist.bandcamp.com/track/song", "https://youtube.com.evil.example/watch?v=private", "file:///private/movie.mp4", "https://youtube.com/watch?v=new"];
  const ids = sources.map((url, index) => {
    const entry = { id: `entry-${index}`, title: `Played ${index}`, source: url.startsWith("file:") ? url : `web:${url}` };
    const mediaId = playbackMediaId(entry)!;
    store.saveProgress("household", { mediaId, title: entry.title, libraryItemId: null, position: 20, duration: 100, watched: false, lastPlayedAt: index + 1 }, entry);
    return mediaId;
  });
  store.saveProgress("household", { mediaId: "media:" + "f".repeat(64), title: "Unavailable source", libraryItemId: null, position: 20, duration: 100, watched: false, lastPlayedAt: 11 });
  store.saveProgress(profile.id, { mediaId: ids[0]!, title: "Played again", libraryItemId: null, position: 40, duration: 100, watched: false, lastPlayedAt: 10 });
  for (const [provider, expected] of [["youtube", [ids[0], ids[6]]], ["twitch", [ids[1]]], ["raiplay", [ids[2]]], ["bandcamp", [ids[3]]]] as const) {
    const response = await request(`/api/progress/history?provider=${provider}&limit=2`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.items.map((item: { mediaId: string }) => item.mediaId)).toEqual(expected);
    expect(JSON.stringify(data)).not.toContain("web:");
    expect(JSON.stringify(data)).not.toContain("https:");
  }
  expect((await request("/api/progress/history?provider=unknown")).status).toBe(400);
  expect((await (await request("/api/progress/history?provider=youtube&limit=1")).json()).items).toMatchObject([{ mediaId: ids[0], position: 40 }]);
});
