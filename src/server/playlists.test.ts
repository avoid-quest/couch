import { afterEach, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedPlaylist } from "../shared/playlists";
import type { QueueEntry } from "../shared/protocol";
import { ProviderError } from "./providers/http";
import { createPlaylists } from "./playlists";

const opened = new Set<ReturnType<typeof createPlaylists>>();
const directories: string[] = [];
const track: QueueEntry = { id: "track-1", title: "First track", source: "library:first" };

function fixture(options: Partial<Parameters<typeof createPlaylists>[0]> = {}) {
  let current = [{ ...track }];
  const changed = mock(() => {});
  const loaded = mock((_entries: QueueEntry[], _mode: "append" | "replace" | "play") => {});
  const service = createPlaylists({ databasePath: ":memory:", onChange: changed, queue: () => current, loadQueue: loaded, ...options });
  opened.add(service);
  return { service, changed, loaded, setQueue: (entries: QueueEntry[]) => { current = entries; } };
}

function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), "couch-playlists-"));
  directories.push(directory);
  return join(directory, "state.sqlite");
}

function request(service: ReturnType<typeof createPlaylists>, method = "GET", path = "", body?: unknown) {
  return service.handle(new Request(`http://localhost/api/playlists${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }));
}

async function create(service: ReturnType<typeof createPlaylists>, name = "Favorites") {
  const response = await request(service, "POST", "", { name });
  expect(response.status).toBe(201);
  return (await response.json() as { playlist: SavedPlaylist }).playlist;
}

async function detail(service: ReturnType<typeof createPlaylists>, id: string) {
  return (await (await request(service, "GET", `/${id}`)).json() as { playlist: SavedPlaylist }).playlist;
}

afterEach(() => {
  for (const service of opened) service.close();
  opened.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("saves named household playlists, lists summaries, and restores them after restart", async () => {
  const path = databasePath();
  const first = fixture({ databasePath: path });
  const saved = await create(first.service, "  Evening music  ");
  expect(saved).toEqual({ id: expect.any(String), name: "Evening music", revision: 1, updatedAt: expect.any(Number), entries: [{ id: track.id, title: track.title }] });
  expect(first.changed).toHaveBeenCalledTimes(1);
  first.service.close();
  opened.delete(first.service);
  const second = fixture({ databasePath: path });
  expect(await detail(second.service, saved.id)).toEqual(saved);
  expect(await (await request(second.service)).json()).toEqual({ playlists: [{ id: saved.id, name: saved.name, revision: 1, updatedAt: saved.updatedAt, entryCount: 1 }] });
  expect(second.loaded).not.toHaveBeenCalled();
  expect(second.changed).not.toHaveBeenCalled();
});

test.each(["auto", "best", "720p"] as const)("captures original source references privately with %s quality and strips unsupported queue fields", async quality => {
  const path = databasePath();
  const { service, setQueue, loaded } = fixture({ databasePath: path });
  const sources = ["library:local", "radio:station", `jellyfin:${"a".repeat(24)}:movie`, "web:https://artist.bandcamp.com/track/public", "file:///private/media/film.mkv", "https://chosen.example/song?token=host-only"];
  const entries = sources.map((source, index) => ({
    ...track, id: `entry-${index}`, source, title: `Item ${index}`,
    thumbnail: index === 0 ? "file:///private/artwork.jpg" : "https://images.example/art.jpg",
    artworkId: "cached-image", duration: 123, live: false, quality, automaticTitle: true,
    headers: { Authorization: "secret" }, audioSource: "https://resolved.example/private", unknown: "private-field",
  }));
  setQueue(entries);
  const saved = await create(service);
  const publicText = JSON.stringify(saved);
  for (const secret of [...sources, "automaticTitle", "/private/", "secret", "private-field", "resolved.example", "headers", "audioSource"]) expect(publicText).not.toContain(secret);
  expect(saved.entries[0]).toEqual({ id: "entry-0", title: "Item 0", artworkId: "cached-image", duration: 123, live: false, quality });
  const db = new Database(path);
  const stored = db.query<{ entries: string }, []>("SELECT entries FROM saved_playlists").get()!.entries;
  db.close();
  expect(JSON.parse(stored).map((entry: QueueEntry) => entry.source)).toEqual(sources);
  for (const secret of ["secret", "private-field", "resolved.example", "headers", "audioSource", "/private/artwork.jpg"]) expect(stored).not.toContain(secret);
  expect((await request(service, "POST", `/${saved.id}/load`, { revision: 1, mode: "append" })).status).toBe(200);
  expect(loaded.mock.calls[0]![0].map(entry => entry.source)).toEqual(sources);
  expect(loaded.mock.calls[0]![0].map(entry => entry.quality)).toEqual(sources.map(() => quality));
  expect(loaded.mock.calls[0]![0][3]!.automaticTitle).toBeTrue();
});

test("saving and loading a radio queue preserves its reconnect policy across restart", async () => {
  const path = databasePath();
  const first = fixture({ databasePath: path });
  first.setQueue([{ id: "station", title: "Station", source: "https://radio.example/stream", kind: "radio", live: true }]);
  const saved = await create(first.service);
  first.service.close();
  opened.delete(first.service);
  const second = fixture({ databasePath: path });
  expect((await detail(second.service, saved.id)).entries[0]).toEqual({ id: "station", title: "Station", kind: "radio", live: true });
  expect((await request(second.service, "POST", `/${saved.id}/load`, { revision: 1, mode: "play" })).status).toBe(200);
  expect(second.loaded.mock.calls[0]![0][0]).toMatchObject({ source: "https://radio.example/stream", kind: "radio" });
});

test("saves a source list through the shared entry point without touching the queue", async () => {
  const { service, changed, loaded } = fixture({ resolveSource: async source => {
    expect(source).toEqual({ provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" });
    return { name: "  Evening videos  ", entries: [
      { id: "yt-one", title: "First video", source: "web:https://www.youtube.com/watch?v=one", thumbnail: "https://i.ytimg.com/vi/one/hqdefault.jpg", duration: 90, headers: { Authorization: "secret" }, quality: "1080p" },
      { id: "yt-two", title: "Second video", source: "web:https://www.youtube.com/watch?v=two" },
    ] };
  } });
  const response = await request(service, "POST", "", { source: { provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" } });
  expect(response.status).toBe(201);
  const { playlist } = await response.json() as { playlist: SavedPlaylist };
  // The snapshot reuses the queue-save validation: unsupported fields are stripped.
  expect(playlist.name).toBe("Evening videos");
  expect(playlist.entries).toEqual([
    { id: "yt-one", title: "First video", thumbnail: "https://i.ytimg.com/vi/one/hqdefault.jpg", duration: 90, quality: "1080p" },
    { id: "yt-two", title: "Second video" },
  ]);
  expect(await (await request(service)).json()).toEqual({ playlists: [{ id: playlist.id, name: playlist.name, revision: 1, updatedAt: playlist.updatedAt, entryCount: 2 }] });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(loaded).not.toHaveBeenCalled();
});

test.each([
  [{ provider: "twitch", url: "https://twitch.tv/x" }, "Choose a YouTube playlist, RaiPlay programme, or Bandcamp album to save."],
  [{ provider: "youtube", url: "" }, "Choose a YouTube playlist, RaiPlay programme, or Bandcamp album to save."],
  [{ provider: "raiplay", url: "https://www.raiplay.it/programmi/report", extra: true }, "Invalid playlist command."],
])("rejects malformed source commands with an actionable message", async (source, error) => {
  const { service } = fixture({ resolveSource: async () => ({ name: "Unused", entries: [track] }) });
  const response = await request(service, "POST", "", { source });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error });
  expect(await (await request(service)).json()).toEqual({ playlists: [] });
});

test("a vanished source list fails without saving anything", async () => {
  const { service, changed } = fixture({ resolveSource: async () => { throw new ProviderError("This playlist is no longer available.", 404); } });
  const response = await request(service, "POST", "", { source: { provider: "bandcamp", url: "https://artist.bandcamp.com/album/gone" } });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "This playlist is no longer available." });
  expect(changed).not.toHaveBeenCalled();
  expect(await (await request(service)).json()).toEqual({ playlists: [] });
});

test("resolver breakdowns surface their message instead of a generic error", async () => {
  const { service } = fixture({ resolveSource: async () => { throw new Error("yt-dlp could not open this webpage. Check the link and update yt-dlp; this site or item may be unsupported."); } });
  const response = await request(service, "POST", "", { source: { provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" } });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "yt-dlp could not open this webpage. Check the link and update yt-dlp; this site or item may be unsupported." });
});

test("source saves honor the playlist count and name limits", async () => {
  const { service } = fixture({ resolveSource: async () => ({ name: "Same name", entries: [track] }) });
  const first = await request(service, "POST", "", { source: { provider: "bandcamp", url: "https://artist.bandcamp.com/album/first" } });
  expect(first.status).toBe(201);
  const second = await request(service, "POST", "", { source: { provider: "bandcamp", url: "https://artist.bandcamp.com/album/second" } });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "A playlist already has that name." });
  const entries = Array.from({ length: 501 }, (_, index) => ({ ...track, id: `entry-${index}` }));
  const tooMany = fixture({ resolveSource: async () => ({ name: "Big", entries }) });
  const response = await request(tooMany.service, "POST", "", { source: { provider: "raiplay", url: "https://www.raiplay.it/programmi/report" } });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "A playlist can contain up to 500 entries." });
});

test("edits duplicate source occurrences by entry identity and preserves order", async () => {
  const { service, setQueue, changed } = fixture();
  setQueue([track, { ...track, id: "repeat", title: "Repeated track" }, { ...track, id: "last", source: "library:last" }]);
  const saved = await create(service);
  const edit = (body: unknown) => request(service, "POST", `/${saved.id}`, body);
  expect((await edit({ revision: 1, operation: "move", entryId: "last", beforeEntryId: "track-1" })).status).toBe(200);
  expect((await detail(service, saved.id)).entries.map(entry => entry.id)).toEqual(["last", "track-1", "repeat"]);
  expect((await edit({ revision: 2, operation: "remove", entryId: "track-1" })).status).toBe(200);
  expect((await detail(service, saved.id)).entries.map(entry => entry.id)).toEqual(["last", "repeat"]);
  expect((await edit({ revision: 3, operation: "move", entryId: "last", beforeEntryId: null })).status).toBe(200);
  expect((await detail(service, saved.id)).entries.map(entry => entry.id)).toEqual(["repeat", "last"]);
  expect((await detail(service, saved.id)).revision).toBe(4);
  expect(changed).toHaveBeenCalledTimes(4);
});

test("rejects stale edits, deletes and loads without any mutation or callback", async () => {
  const { service, changed, loaded } = fixture();
  const saved = await create(service);
  expect((await request(service, "POST", `/${saved.id}`, { revision: 1, operation: "rename", name: "Renamed" })).status).toBe(200);
  const current = await detail(service, saved.id);
  for (const operation of ["rename", "saveQueue", "remove", "move"]) {
    expect((await request(service, "POST", `/${saved.id}`, { revision: 1, operation, name: "Overwrite", entryId: track.id, beforeEntryId: null })).status).toBe(409);
  }
  expect((await request(service, "DELETE", `/${saved.id}`, { revision: 1 })).status).toBe(409);
  expect((await request(service, "POST", `/${saved.id}/load`, { revision: 1, mode: "play" })).status).toBe(409);
  expect(await detail(service, saved.id)).toEqual(current);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(loaded).not.toHaveBeenCalled();
});

test("serializes concurrent controller revisions and allows only one conflicting write", async () => {
  const { service, changed } = fixture();
  const saved = await create(service);
  const results = await Promise.all(["Phone", "TV"].map(name => request(service, "POST", `/${saved.id}`, { revision: 1, operation: "rename", name })));
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
  expect((await detail(service, saved.id)).revision).toBe(2);
  expect(changed).toHaveBeenCalledTimes(2);
});

test("saves a replacement queue and loads fresh copies in each supported mode", async () => {
  const { service, setQueue, loaded, changed } = fixture();
  const saved = await create(service);
  const replacement = { ...track, id: "replacement", source: "radio:favorite", live: true };
  setQueue([replacement]);
  expect((await request(service, "POST", `/${saved.id}`, { revision: 1, operation: "saveQueue" })).status).toBe(200);
  for (const mode of ["append", "replace", "play"] as const) {
    expect((await request(service, "POST", `/${saved.id}/load`, { revision: 2, mode })).status).toBe(200);
    const [entries, receivedMode] = loaded.mock.calls.at(-1)!;
    expect(entries).toEqual([replacement]);
    expect(receivedMode).toBe(mode);
    entries[0]!.title = "Must not change the saved playlist";
  }
  expect((await detail(service, saved.id)).entries[0]!.title).toBe(track.title);
  expect(changed).toHaveBeenCalledTimes(2);
});

test("normalizes and validates names with Unicode case-insensitive uniqueness", async () => {
  const { service, changed } = fixture();
  const saved = await create(service, "Café");
  for (const name of ["CAFÉ", "  cafe\u0301  "]) expect((await request(service, "POST", "", { name })).status).toBe(409);
  const another = await create(service, "Another");
  expect((await request(service, "POST", `/${another.id}`, { revision: 1, operation: "rename", name: "café" })).status).toBe(409);
  for (const name of ["", "  ", "x".repeat(81), "invalid\nname", "name\0", null, 42]) expect((await request(service, "POST", "", { name })).status).toBe(400);
  expect(await detail(service, saved.id)).toEqual(saved);
  expect(changed).toHaveBeenCalledTimes(2);
});

test("no-op edits retain the revision and do not broadcast", async () => {
  const { service, changed } = fixture();
  const saved = await create(service);
  for (const operation of [{ operation: "rename", name: saved.name }, { operation: "saveQueue" }, { operation: "move", entryId: track.id, beforeEntryId: track.id }, { operation: "move", entryId: track.id, beforeEntryId: null }]) {
    expect((await request(service, "POST", `/${saved.id}`, { revision: 1, ...operation })).status).toBe(200);
    expect(await detail(service, saved.id)).toEqual(saved);
  }
  expect(changed).toHaveBeenCalledTimes(1);
});

test("validates JSON commands, revisions, and positions without accepting client entries", async () => {
  const { service, changed, loaded } = fixture();
  const saved = await create(service);
  for (const input of [null, [], { name: "Injected", entries: [{ source: "file:///private" }] }, { name: "Injected", source: "file:///private" }]) expect((await request(service, "POST", "", input)).status).toBe(400);
  for (const revision of [undefined, null, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) expect((await request(service, "POST", `/${saved.id}`, { revision, operation: "saveQueue" })).status).toBe(400);
  for (const input of [{ operation: "unknown" }, { operation: "remove", entryId: "../bad" }, { operation: "move", entryId: track.id }, { operation: "move", entryId: track.id, beforeEntryId: 4 }, { operation: "saveQueue", entries: [] }]) expect((await request(service, "POST", `/${saved.id}`, { revision: 1, ...input })).status).toBe(400);
  for (const input of [{ operation: "remove", entryId: "missing" }, { operation: "move", entryId: track.id, beforeEntryId: "missing" }]) expect((await request(service, "POST", `/${saved.id}`, { revision: 1, ...input })).status).toBe(404);
  expect((await request(service, "POST", `/${saved.id}/load`, { revision: 1, mode: "autoplay" })).status).toBe(400);
  expect((await request(service, "POST", `/${saved.id}/load`, { revision: 1, mode: "play", entries: [] })).status).toBe(400);
  expect((await service.handle(new Request("http://localhost/api/playlists", { method: "POST", body: "bad" }))).status).toBe(400);
  expect((await service.handle(new Request("http://localhost/api/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
  expect((await request(service, "POST", "", { name: "x".repeat(9000) })).status).toBe(413);
  expect(await detail(service, saved.id)).toEqual(saved);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(loaded).not.toHaveBeenCalled();
});

test("bounds playlists, captured queues and appended queue sizes", async () => {
  const { service, setQueue, loaded } = fixture();
  setQueue([]);
  expect((await request(service, "POST", "", { name: "Empty" })).status).toBe(400);
  setQueue(Array.from({ length: 501 }, (_, index) => ({ ...track, id: `entry-${index}` })));
  expect((await request(service, "POST", "", { name: "Too long" })).status).toBe(400);
  setQueue(Array.from({ length: 500 }, (_, index) => ({ ...track, id: `entry-${index}` })));
  const full = await create(service, "Full queue");
  expect(full.entries).toHaveLength(500);
  expect((await request(service, "POST", `/${full.id}/load`, { revision: 1, mode: "append" })).status).toBe(400);
  expect(loaded).not.toHaveBeenCalled();
  setQueue([track]);
  for (let index = 1; index < 100; index++) await create(service, `Playlist ${index}`);
  expect((await request(service, "POST", "", { name: "One too many" })).status).toBe(400);
  expect((await request(service, "DELETE", `/${full.id}`, { revision: 1 })).status).toBe(200);
  await create(service, "Room again");
});

test("permits an edited empty playlist but rejects empty saves and loads", async () => {
  const { service, setQueue, changed, loaded } = fixture();
  const saved = await create(service);
  setQueue([]);
  expect((await request(service, "POST", `/${saved.id}`, { revision: 1, operation: "saveQueue" })).status).toBe(400);
  expect(await detail(service, saved.id)).toEqual(saved);
  expect((await request(service, "POST", `/${saved.id}`, { revision: 1, operation: "remove", entryId: track.id })).status).toBe(200);
  expect((await detail(service, saved.id)).entries).toEqual([]);
  expect((await request(service, "POST", `/${saved.id}/load`, { revision: 2, mode: "play" })).status).toBe(400);
  expect(loaded).not.toHaveBeenCalled();
  expect((await request(service, "DELETE", `/${saved.id}`, { revision: 2 })).status).toBe(200);
  expect((await request(service, "GET", `/${saved.id}`)).status).toBe(404);
  expect(changed).toHaveBeenCalledTimes(3);
});

test("does not persist invalid queue identities or unsupported original sources", async () => {
  const { service, setQueue, changed } = fixture();
  for (const source of ["javascript:alert(1)", "jellyfin:unscoped", "https://user:secret@example.com/", "file:///private/%00", "web:file:///private"]) {
    setQueue([{ ...track, source }]);
    expect((await request(service, "POST", "", { name: "Invalid" })).status).toBe(400);
  }
  setQueue([track, { ...track }]);
  expect((await request(service, "POST", "", { name: "Duplicate ID" })).status).toBe(400);
  expect(await (await request(service)).json()).toEqual({ playlists: [] });
  expect(changed).not.toHaveBeenCalled();
});

test("broadcasts only after commit and rolls back failed durable writes without exposing storage details", async () => {
  const path = databasePath();
  const observed: string[] = [];
  const { service } = fixture({ databasePath: path, onChange: () => {
    const observer = new Database(path);
    observed.push(observer.query<{ name: string }, []>("SELECT name FROM saved_playlists").get()!.name);
    observer.close();
  } });
  const saved = await create(service);
  expect(observed).toEqual([saved.name]);
  const db = new Database(path);
  db.run("CREATE TRIGGER reject_playlist_update BEFORE UPDATE ON saved_playlists BEGIN SELECT RAISE(ABORT, '/private/state.sqlite secret'); END");
  const failed = await request(service, "POST", `/${saved.id}`, { revision: 1, operation: "rename", name: "Changed" });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toMatch(/private|secret|sqlite/);
  expect(await detail(service, saved.id)).toEqual(saved);
  expect(observed).toEqual([saved.name]);
  db.run("DROP TRIGGER reject_playlist_update");
  db.close();
  expect((await request(service, "POST", `/${saved.id}`, { revision: 1, operation: "rename", name: "Recovered" })).status).toBe(200);
  expect(observed).toEqual([saved.name, "Recovered"]);
});

test("reports failed queue loads without altering the saved playlist or leaking host errors", async () => {
  const { service, changed } = fixture({ loadQueue: () => { throw new Error("/private/media/source secret"); } });
  const saved = await create(service);
  const failed = await request(service, "POST", `/${saved.id}/load`, { revision: 1, mode: "play" });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toMatch(/private|secret/);
  expect(await detail(service, saved.id)).toEqual(saved);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("returns allowed methods and missing endpoint errors", async () => {
  const { service } = fixture();
  const saved = await create(service);
  for (const [method, path, allowed] of [["DELETE", "", "GET, POST"], ["PATCH", `/${saved.id}`, "GET, POST, DELETE"], ["GET", `/${saved.id}/load`, "POST"]]) {
    const response = await request(service, method, path);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allowed!);
  }
  for (const path of ["/missing", "/invalid/route", "/%2e%2e%2fprivate"]) expect((await request(service, "GET", path)).status).toBe(404);
});
