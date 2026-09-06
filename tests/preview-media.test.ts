import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratePreviewMedia } from "../scripts/preview-media";
import { expect, test } from "bun:test";
import { createMediaFolders, FolderError } from "../src/server/media-folders";

test("preview supplied-media mount is a selectable child of the protected media container", async () => {
  const script = await Bun.file(new URL("../scripts/preview.ts", import.meta.url)).text();
  const target = script.match(/source=\$\{media\},target=([^,]+),readonly/)?.[1];
  expect(target).toBeDefined();
  // Selection policy runs before filesystem access, so no host /media directory is needed.
  const result = await createMediaFolders().inspect(target!).catch(error => error);
  expect(result instanceof FolderError && result.status === 403).toBe(false);
});


test("preview migration preserves source IDs, relative catalog paths, identities, queue and history and runs once", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-preview-paths-"));
  const path = join(root, "couch.sqlite");
  const db = new Database(path);
  try {
    db.run(`CREATE TABLE library_sources (id TEXT PRIMARY KEY, path TEXT UNIQUE, status TEXT);
      INSERT INTO library_sources VALUES ('root', '/media', 'ready'), ('nested', '/media/Albums', 'ready'), ('other', '/mnt/videos', 'ready');
      CREATE TABLE library_items (id TEXT, sourceId TEXT, path TEXT);
      INSERT INTO library_items VALUES ('movie', 'root', 'Movie.mkv');
      CREATE TABLE library_folder_identities (sourceId TEXT, filesystem TEXT, directory TEXT, mountRoot TEXT);
      INSERT INTO library_folder_identities VALUES ('nested', 'original-filesystem', 'original-directory', '/host');
      CREATE TABLE session (queue TEXT); INSERT INTO session VALUES ('[{"id":"queued","source":"library:movie"}]');
      CREATE TABLE viewing_progress (profileId TEXT, mediaId TEXT, position INTEGER);
      INSERT INTO viewing_progress VALUES ('household', 'library:movie', 15);`);
    await Bun.write(join(root, "Movie.mkv"), "original media");
    const tables = ["library_items", "library_folder_identities", "session", "viewing_progress"];
    const before = tables.map(table => db.query(`SELECT * FROM ${table}`).all());
    expect(migratePreviewMedia(path)).toBe(2);
    expect(db.query("SELECT * FROM library_sources ORDER BY id").all()).toEqual([
      { id: "nested", path: "/media/host/Albums", status: "ready" }, { id: "other", path: "/mnt/videos", status: "ready" }, { id: "root", path: "/media/host", status: "ready" },
    ]);
    expect(tables.map(table => db.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(await Bun.file(join(root, "Movie.mkv")).text()).toBe("original media");
    expect(migratePreviewMedia(path)).toBe(0);
    expect(db.query("SELECT path FROM library_sources WHERE id = 'root'").get()).toEqual({ path: "/media/host" });
    expect(db.query("SELECT * FROM library_folder_identities WHERE sourceId = 'root'").get()).toBeNull();
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test("fresh preview records the layout before new Sources are added", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-preview-new-"));
  try {
    const path = join(root, "couch.sqlite");
    expect(migratePreviewMedia(path)).toBe(0);
    const db = new Database(path);
    db.run("CREATE TABLE library_sources (id TEXT, path TEXT UNIQUE); INSERT INTO library_sources VALUES ('new', '/media/host')");
    expect(migratePreviewMedia(path)).toBe(0);
    expect(db.query("SELECT path FROM library_sources").get()).toEqual({ path: "/media/host" });
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("existing child-layout paths stay unchanged and collisions leave all rows and the marker untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-preview-collision-"));
  const path = join(root, "couch.sqlite");
  const db = new Database(path);
  try {
    db.run("CREATE TABLE library_sources (id TEXT PRIMARY KEY, path TEXT UNIQUE); INSERT INTO library_sources VALUES ('old', '/media'), ('current', '/media/host'), ('nested', '/media/Music')");
    const before = db.query("SELECT * FROM library_sources ORDER BY id").all();
    expect(() => migratePreviewMedia(path)).toThrow("collide");
    expect(db.query("SELECT * FROM library_sources ORDER BY id").all()).toEqual(before);
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'preview_migrations'").get()).toBeNull();
    db.query("DELETE FROM library_sources WHERE id = 'old'").run();
    expect(migratePreviewMedia(path)).toBe(1);
    expect(db.query("SELECT path FROM library_sources WHERE id = 'current'").get()).toEqual({ path: "/media/host" });
    expect(db.query("SELECT path FROM library_sources WHERE id = 'nested'").get()).toEqual({ path: "/media/host/Music" });
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
