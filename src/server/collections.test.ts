import { afterEach, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm, unlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCollections } from "./collections";
import { createLibrary } from "./library";
import { createMediaFolders } from "./media-folders";
import type { CollectionDefinition, CollectionPreview } from "../shared/collections";
import type { PlaybackActor, QueueEntry } from "../shared/protocol";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "couch-collections-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const media = join(root, "media");
  await mkdir(media);
  const databasePath = join(root, "state.sqlite");
  const library = createLibrary({ databasePath, ffprobePath: null, folders: createMediaFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null }) });
  cleanups.push(() => library.close());
  for (const [name, year] of [["Zulu", 2020], ["Alpha", 2021]] as const) {
    await Bun.write(join(media, `${name}.mkv`), "authorized generated fixture");
    await Bun.write(join(media, `${name}.nfo`), `<movie><title>${name}</title><year>${year}</year><genre>Drama</genre></movie>`);
  }
  await Bun.write(join(media, "Song.mp3"), "authorized generated audio fixture");
  const source = await library.addSource(media);
  await library.scan(source.id);
  const loaded = mock((_entries: QueueEntry[], _mode: "append" | "play", _authorize?: () => void, _playedBy?: PlaybackActor) => {});
  const changed = mock(() => {});
  let queue: QueueEntry[] = [];
  const open = () => {
    const service = createCollections({ databasePath, library, onChange: changed, queue: () => queue, loadQueue: loaded });
    cleanups.push(() => service.close());
    return service;
  };
  const service = open();
  return { service, open, library, media, source, loaded, changed, databasePath, setQueue: (entries: QueueEntry[]) => { queue = entries; } };
}
async function request(service: ReturnType<typeof createCollections>, method = "GET", path = "", body?: unknown, playedBy?: PlaybackActor) {
  return service.handle(new Request(`http://localhost/api/collections${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }), undefined, playedBy);
}
const filtered: CollectionDefinition = { name: "Drama", sort: "year", descending: true, filter: { kind: "movie", genre: "Drama" }, members: [] };
async function create(service: ReturnType<typeof createCollections>, definition = filtered) {
  const response = await request(service, "POST", "", { definition });
  expect(response.status).toBe(201);
  return await response.json() as CollectionPreview;
}

test("manual films and saved music survive scans and offline restart with ordered missing previews", async () => {
  const f = await fixture();
  const films = f.library.search({ videoType: "movie" }).items.reverse();
  const manual = await create(f.service, { name: "Film night", sort: "manual", descending: false, filter: null, members: films.map(({ id, title }) => ({ id, title })) });
  const music = await create(f.service, { name: "Music", sort: "album", descending: false, filter: { kind: "audio", title: "Song" }, members: [] });
  expect(manual.items.map(item => item.title)).toEqual(["Zulu", "Alpha"]);
  expect(music.items.map(item => item.title)).toEqual(["Song"]);
  await unlink(join(f.media, "Zulu.mkv"));
  await f.library.scan(f.source.id);
  let preview = await (await request(f.service, "GET", `/${manual.collection.id}`)).json() as CollectionPreview;
  expect(preview.items.map(item => item.available)).toEqual([false, true]);
  expect((await request(f.service, "POST", `/${manual.collection.id}/load`, { revision: 1, digest: manual.digest, mode: "play" })).status).toBe(409);
  expect((await request(f.service, "POST", `/${manual.collection.id}/load`, { revision: 1, digest: preview.digest, mode: "append" })).status).toBe(200);
  expect(f.loaded.mock.calls[0]![0].map(entry => entry.title)).toEqual(["Alpha"]);
  await rm(f.media, { recursive: true });
  await f.library.scan(f.source.id);
  const restarted = f.open();
  preview = await (await request(restarted, "GET", `/${manual.collection.id}`)).json() as CollectionPreview;
  expect(preview.items.map(item => item.available)).toEqual([false, false]);
  expect((await (await request(restarted, "GET", `/${music.collection.id}`)).json()).items[0].available).toBe(false);
  expect((await request(restarted, "POST", `/${manual.collection.id}/load`, { revision: 1, digest: preview.digest, mode: "play" })).status).toBe(400);
});

test("edits compare revisions across controllers and broadcast only committed state", async () => {
  const f = await fixture();
  const saved = await create(f.service);
  const db = new Database(f.databasePath);
  cleanups.push(() => db.close());
  f.changed.mockImplementation(() => expect(db.query<{ revision: number }, []>("SELECT revision FROM library_collections").get()!.revision).toBe(2));
  const responses = await Promise.all(["First controller", "Second controller"].map(name => request(f.service, "POST", `/${saved.collection.id}`, { revision: 1, definition: { ...filtered, name } })));
  expect(responses.map(response => response.status)).toEqual([200, 409]);
  expect(f.changed).toHaveBeenCalledTimes(2);
  expect((await request(f.service, "DELETE", `/${saved.collection.id}`, { revision: 1 })).status).toBe(409);
  f.changed.mockImplementation(() => {});
  expect((await request(f.service, "DELETE", `/${saved.collection.id}`, { revision: 2 })).status).toBe(200);
  expect((await request(f.service, "GET", `/${saved.collection.id}`)).status).toBe(404);
});

test("filters bound fields, preserve literal matching and require the current visible order", async () => {
  const f = await fixture();
  const saved = await create(f.service);
  expect(saved.items.map(item => item.title)).toEqual(["Alpha", "Zulu"]);
  const playedBy = { deviceId: "phone", name: "Phone" };
  expect((await request(f.service, "POST", `/${saved.collection.id}/load`, { revision: 1, digest: saved.digest, mode: "play" }, playedBy)).status).toBe(200);
  expect(f.loaded.mock.calls[0]![3]).toEqual(playedBy);
  expect(f.loaded.mock.calls[0]![0].map(entry => entry.title)).toEqual(["Alpha", "Zulu"]);
  f.setQueue(Array.from({ length: 499 }, (_, i) => ({ id: String(i), title: "Existing", source: "library:existing" })));
  expect((await request(f.service, "POST", `/${saved.collection.id}/load`, { revision: 1, digest: saved.digest, mode: "append" })).status).toBe(400);
  for (const definition of [
    { ...filtered, sort: "random" }, { ...filtered, filter: { kind: "audio", year: 2020 } },
    { ...filtered, filter: { kind: "movie", sql: "DROP TABLE library_items" } },
    { ...filtered, filter: { kind: "episode", year: -1 } }, { ...filtered, members: [{ id: "bad", title: "Bad" }] },
  ]) expect((await request(f.service, "POST", "", { definition })).status).toBe(400);
  const literal = await create(f.service, { ...filtered, name: "Literal", filter: { kind: "movie", title: "%" } });
  expect(literal.total).toBe(0);
  const db = new Database(f.databasePath);
  db.query("UPDATE library_items SET title = 'New title' WHERE title = 'Alpha'").run();
  db.close();
  expect((await request(f.service, "POST", `/${saved.collection.id}/load`, { revision: 1, digest: saved.digest, mode: "play" })).status).toBe(409);
});

test("removed folders retain manual identities while new unknown members and revoked writes fail", async () => {
  const f = await fixture();
  const movie = f.library.search({ videoType: "movie" }).items[0]!;
  const definition: CollectionDefinition = { name: "Keep", sort: "manual", descending: false, filter: null, members: [{ id: movie.id, title: movie.title }] };
  const saved = await create(f.service, definition);
  await f.library.removeSource(f.source.id, () => {});
  const preview = await (await request(f.service, "GET", `/${saved.collection.id}`)).json() as CollectionPreview;
  expect(preview.items[0]).toMatchObject({ id: movie.id, title: movie.title, available: false });
  expect((await request(f.service, "POST", `/${saved.collection.id}`, { revision: 1, definition: { ...definition, name: "Retained" } })).status).toBe(200);
  expect((await request(f.service, "POST", "", { definition: { ...definition, name: "Unknown" } })).status).toBe(400);
  const response = await f.service.handle(new Request("http://localhost/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition: filtered }) }), () => { throw new Error("revoked"); });
  expect(response.status).toBe(500);
  expect(f.changed).toHaveBeenCalledTimes(2);
});

test("preview bounds large catalog results to 500 and shutdown rejects a body still arriving", async () => {
  const f = await fixture();
  const db = new Database(f.databasePath);
  const song = db.query<{ id: string }, []>("SELECT id FROM library_items WHERE kind = 'audio'").get()!;
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(library_items)").all().map(column => column.name);
  db.transaction(() => {
    for (let index = 0; index < 505; index++) db.query(`INSERT INTO library_items (${columns.join(",")}) SELECT ${columns.map(column => column === "id" ? "?" : column === "path" ? "?" : column).join(",")} FROM library_items WHERE id = ?`).run(`track-${String(index).padStart(3, "0")}`, `/fixture/track-${index}`, song.id);
  })();
  db.close();
  const preview = await create(f.service, { name: "All music", sort: "title", descending: false, filter: { kind: "audio" }, members: [] });
  expect(preview.total).toBe(506);
  expect(preview.items).toHaveLength(500);
  expect((await request(f.service, "POST", `/${preview.collection.id}/load`, { revision: 1, digest: preview.digest, mode: "play" })).status).toBe(200);
  expect(f.loaded.mock.calls[0]![0]).toHaveLength(500);
  const gate = Promise.withResolvers<void>();
  const pending = f.service.handle(new Request("http://localhost/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ async start(controller) { await gate.promise; controller.enqueue(new TextEncoder().encode(JSON.stringify({ definition: filtered }))); controller.close(); } }) }));
  f.service.close();
  gate.resolve();
  expect((await pending).status).toBe(503);
});

test("a complete 500-film definition with maximum Unicode titles can be renamed and reordered", async () => {
  const f = await fixture();
  const db = new Database(f.databasePath);
  const film = db.query<{ id: string }, []>("SELECT id FROM library_items WHERE kind = 'video'").get()!;
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(library_items)").all().map(column => column.name);
  db.transaction(() => {
    for (let index = 0; index < 500; index++) db.query(`INSERT INTO library_items (${columns.join(",")}) SELECT ${columns.map(column => ["id", "path", "title"].includes(column) ? "?" : column).join(",")} FROM library_items WHERE id = ?`).run(`film-${index}`, `/fixture/film-${index}`, "映".repeat(300), film.id);
  })();
  db.close();
  const members = Array.from({ length: 500 }, (_, index) => ({ id: `film-${index}`, title: "Movie" }));
  const created = await create(f.service, { name: "Long films", filter: null, sort: "manual", descending: false, members });
  const read = await (await request(f.service, "GET", `/${created.collection.id}`)).json() as CollectionPreview;
  const { id, revision, updatedAt: _updatedAt, ...definition } = read.collection;
  expect(new TextEncoder().encode(JSON.stringify(definition)).length).toBeGreaterThan(450_000);
  const renamed = await request(f.service, "POST", `/${id}`, { revision, definition: { ...definition, name: "Renamed films" } });
  expect(renamed.status).toBe(200);
  const reordered = await request(f.service, "POST", `/${id}`, { revision: 2, definition: { ...definition, name: "Renamed films", members: [...definition.members].reverse() } });
  expect(reordered.status).toBe(200);
  expect((await reordered.json()).items[0].id).toBe("film-499");
  expect((await request(f.service, "POST", "", { definition, padding: "x".repeat(1_048_576) })).status).toBe(413);
});
