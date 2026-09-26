import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store";
import { createLibrary } from "./library";
import { createMediaFolders } from "./media-folders";
import { ControllerError } from "./controllers";
import { createFolderSettings } from "./folder-settings";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const authorize = () => {};
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "couch-folder-library-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const media = join(root, "Movies");
  await mkdir(media);
  await Bun.write(join(media, "Original.mp4"), "fixture");
  const folders = createMediaFolders({ roots: [root], mountInfo: async () => null });
  const databasePath = join(root, "library.sqlite");
  const library = createLibrary({ databasePath, folders, ffprobePath: null });
  cleanups.push(() => library.close());
  const source = await library.addSource(media);
  await library.scan(source.id);
  return { root, media, folders, databasePath, library, source };
}

test("replaced mount directory preserves catalog and identity until the original returns, including restart", async () => {
  const { root, media, library, source, databasePath, folders } = await fixture();
  const original = library.search().items[0]!;
  await rename(media, join(root, "Disconnected"));
  await mkdir(media);
  expect((await library.scan(source.id)).status).toBe("unavailable");
  expect(library.search().items).toHaveLength(1);
  expect(library.search().items[0]).toMatchObject({ id: original.id, title: original.title, available: false });
  await expect(library.testSource(source.id, authorize, true)).rejects.toThrow("original drive");
  await expect(library.getPlayable(original.id)).rejects.toThrow("unavailable");
  await library.close();
  const restarted = createLibrary({ databasePath, folders, ffprobePath: null });
  cleanups.push(() => restarted.close());
  expect(restarted.managedSources()[0]?.verified).toBe(true);
  expect((await restarted.scan(source.id)).status).toBe("unavailable");
  await rm(media, { recursive: true });
  await rename(join(root, "Disconnected"), media);
  await restarted.testSource(source.id, authorize);
  await restarted.scan(source.id);
  expect(restarted.search().items[0]).toMatchObject({ id: original.id, available: true });
  expect((await restarted.getPlayable(original.id)).title).toBe(original.title);
  expect(JSON.stringify(restarted.listSources())).not.toMatch(/filesystem|mountRoot|directory/);
});

test("legacy source must be explicitly verified before scanning or playing, while its catalog survives", async () => {
  const { library, source, databasePath } = await fixture();
  const item = library.search().items[0]!;
  const db = new Database(databasePath);
  db.query("DELETE FROM library_folder_identities").run();
  db.close();
  expect(library.managedSources()[0]?.verified).toBe(false);
  expect(() => library.scan(source.id)).toThrow("Confirm this folder");
  await expect(library.testSource(source.id, authorize)).rejects.toThrow("Confirm this folder");
  await expect(library.getPlayable(item.id)).rejects.toThrow("unavailable");
  expect(library.search().items[0]?.id).toBe(item.id);
  await library.testSource(source.id, authorize, true);
  expect(library.managedSources()[0]?.verified).toBe(true);
  expect((await library.scan(source.id)).status).toBe("ready");
  expect(library.search().items[0]?.id).toBe(item.id);
});

test("removal clears only that source's catalog and rejects later play without deleting media", async () => {
  const { root, media, library, source, databasePath } = await fixture();
  const other = join(root, "Other");
  await mkdir(other);
  await Bun.write(join(other, "Other.mp4"), "other");
  const otherSource = await library.addSource(other);
  await library.scan(otherSource.id);
  const original = library.search({ query: "Original" }).items[0]!;
  const store = openStore(databasePath);
  const entry = { id: "queued-original", title: original.title, source: `library:${original.id}` };
  const progress = { mediaId: entry.source, title: original.title, libraryItemId: original.id, position: 25, duration: 100, watched: false, lastPlayedAt: 1 };
  store.saveQueue([entry]);
  store.saveProgress("household", progress);
  library.removeSource(source.id, authorize);
  expect(store.progress("household", entry.source)).toEqual(progress);
  store.close();
  const reopenedStore = openStore(databasePath);
  expect(reopenedStore.queue).toEqual([entry]);
  expect(reopenedStore.history("household")).toEqual([progress]);
  reopenedStore.close();
  expect(library.search().items.map(item => item.title)).toEqual(["Other"]);
  expect(library.managedSources().map(folder => folder.id)).toEqual([otherSource.id]);
  expect(await Bun.file(join(media, "Original.mp4")).text()).toBe("fixture");
  await expect(library.getPlayable(original.id)).rejects.toThrow("not found");
  expect(library.search({ query: "Original" }).total).toBe(0);
});

test("revocation during folder verification prevents registration and starting a scan", async () => {
  const { root, folders, databasePath } = await fixture();
  const newFolder = join(root, "New");
  await mkdir(newFolder);
  let allowed = true;
  const library = createLibrary({ databasePath, folders: { ...folders, verify: async (...args) => {
    const identity = await folders.verify(...args); allowed = false; return identity;
  } }, ffprobePath: null });
  cleanups.push(() => library.close());
  const check = () => { if (!allowed) throw new ControllerError("Administrator removed.", 403); };
  await expect(library.addSource(newFolder, check)).rejects.toThrow("Administrator removed");
  expect(library.managedSources()).toHaveLength(1);
  expect(() => library.scan(library.listSources()[0]!.id, check)).toThrow("Administrator removed");
  expect(library.listSources()[0]?.status).toBe("ready");
});

test("folder HTTP integrates explicit add/scan/test/remove and retains source state after duplicate or invalid input", async () => {
  const { root, folders, library, source } = await fixture();
  const settings = createFolderSettings(library, folders);
  const api = (path: string, method: string, body?: unknown) => settings.handle(new Request(`http://couch${path}`, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), () => ({ controller: null, authority: "administrator", claimAvailable: false }));
  const before = library.managedSources();
  expect((await api("/api/library/sources", "POST", { path: before[0]!.path })).status).toBe(409);
  expect((await api("/api/library/sources", "POST", { path: "/etc" })).status).toBe(403);
  expect(library.managedSources()).toEqual(before);
  const other = join(root, "New"); await mkdir(other);
  expect((await api("/api/library/sources", "POST", { path: other })).status).toBe(201);
  expect((await api(`/api/library/sources/${source.id}/test`, "POST")).status).toBe(200);
  expect((await api(`/api/library/sources/${source.id}/scan`, "POST")).status).toBe(202);
  expect((await api(`/api/library/sources/${source.id}`, "DELETE")).status).toBe(409);
  await library.scan(source.id);
  expect((await api(`/api/library/sources/${source.id}`, "DELETE")).status).toBe(200);
  expect(library.managedSources().map(folder => folder.path)).toEqual([other]);
});

test("an in-flight access test cannot recreate a removed source or its identity", async () => {
  const { library: initial, folders, source, databasePath } = await fixture();
  await initial.close();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const library = createLibrary({ databasePath, folders: { ...folders, verify: async (...args) => {
    entered.resolve(); await release.promise; return folders.verify(...args);
  } }, ffprobePath: null });
  cleanups.push(() => library.close());
  const pending = library.testSource(source.id, authorize);
  await entered.promise;
  library.removeSource(source.id, authorize);
  release.resolve();
  await expect(pending).rejects.toThrow("not found");
  expect(library.managedSources()).toEqual([]);
  const db = new Database(databasePath);
  expect(db.query("SELECT * FROM library_folder_identities").all()).toEqual([]);
  db.close();
});
