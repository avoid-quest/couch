import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { copyFile, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibrary } from "./library";
import { createMediaFolders } from "./media-folders";
import { createSession } from "./session";
import { openStore } from "./store";
import { createPlaylists } from "./playlists";
import type { PlaybackCommand } from "../shared/protocol";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const fixtures = new URL("../../tests/fixtures/cue/", import.meta.url).pathname;
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "couch-library-cue-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const media = join(root, "media");
  await mkdir(media);
  for (const file of ["album.cue", "album.flac"]) await copyFile(join(fixtures, file), join(media, file));
  const databasePath = join(root, "state.sqlite");
  const folders = createMediaFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null });
  const library = createLibrary({ databasePath, folders, ffprobePath: null });
  cleanups.push(() => library.close());
  const source = await library.addSource(media);
  await library.scan(source.id);
  return { root, media, databasePath, folders, library, source };
}

test("cue tracks have ordered durations and private source bounds; rescan resolves current metadata with stable IDs", async () => {
  const { media, library, source } = await setup();
  const albums = library.musicAlbums().items;
  expect(albums).toHaveLength(1);
  expect(albums[0]).toMatchObject({ title: "Three tones", trackCount: 3, duration: 18 });
  const tracks = library.albumTracks(albums[0]!.id).items;
  expect(tracks.map(track => track.trackNumber)).toEqual([1, 2, 3]);
  expect(tracks.map(track => track.duration)).toEqual([400 / 75, 475 / 75, 18 - 875 / 75]);
  expect(JSON.stringify(tracks)).not.toContain(media);
  expect(JSON.stringify(tracks)).not.toContain("cuePath");
  const playable = await library.getPlayable(tracks[1]!.id);
  expect(playable).toMatchObject({ segment: { start: 400 / 75, end: 875 / 75 }, source: new URL(`file://${media}/album.flac`).href });
  const text = await Bun.file(join(media, "album.cue")).text();
  await rename(join(media, "album.flac"), join(media, "renamed.flac"));
  await writeFile(join(media, "album.cue"), text.replace("album.flac", "renamed.flac").replace("Second tone", "Changed track").replace("00:05:25", "00:05:30"));
  expect(await library.getPlayable(tracks[1]!.id)).toMatchObject({ title: "Changed track", segment: { start: 5.4, end: 875 / 75 }, metadata: { duration: 875 / 75 - 5.4 } });
  await library.scan(source.id);
  const changed = library.albumTracks(albums[0]!.id).items;
  expect(changed.map(track => track.id)).toEqual(tracks.map(track => track.id));
  expect(changed[1]!.title).toBe("Changed track");
});

test("malformed or missing cue sheets retain unavailable track identities and bounded source errors", async () => {
  const { media, library, source } = await setup();
  const album = library.musicAlbums().items[0]!;
  const original = library.albumTracks(album.id).items;
  await rename(join(media, "album.flac"), join(media, "offline"));
  expect((await library.scan(source.id)).warning).toContain("album.cue");
  expect(library.albumTracks(album.id).items.every(track => !track.available)).toBe(true);
  await expect(library.getPlayable(original[0]!.id)).rejects.toThrow("unavailable");
  await rename(join(media, "offline"), join(media, "album.flac"));
  await library.scan(source.id);
  expect(library.albumTracks(album.id).items.map(track => track.id)).toEqual(original.map(track => track.id));
  await writeFile(join(media, "album.cue"), "FILE bad WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:99\n");
  expect((await library.scan(source.id)).warning).toContain("Skipped 1 cue sheet");
  expect(library.albumTracks(album.id).items.every(track => !track.available)).toBe(true);
  await rm(join(media, "album.cue"));
  await library.scan(source.id);
  expect(library.albumTracks(album.id).items.every(track => !track.available)).toBe(true);
});

test("cue library queue, saved playlist and relative progress survive restart without autoplay", async () => {
  const { databasePath, library, folders, source } = await setup();
  const album = library.musicAlbums().items[0]!;
  const tracks = library.albumTracks(album.id).items;
  const store = openStore(databasePath);
  const commands: PlaybackCommand[] = [];
  let loaded = Promise.withResolvers<PlaybackCommand>();
  const session = createSession(store, command => { commands.push(command); if (command.type === "load") loaded.resolve(command); }, () => {}, { resolveSource: entry => library.getPlayable(entry.source.slice(8)) });
  const playlists = createPlaylists({ databasePath, onChange: () => {}, queue: () => session.state.queue, loadQueue: (entries, mode, authorize) => { session.loadQueue(entries, mode, authorize); } });
  const idle = { playbackId: null, status: "idle" as const, position: 0, duration: null, volume: 80, seekable: false, error: null };
  session.observe(idle);
  session.loadQueue(tracks.map(track => ({ id: track.id, source: `library:${track.id}`, title: track.title })), "replace");
  const saved = await playlists.handle(new Request("http://localhost/api/playlists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cue album" }) }), () => {});
  expect(saved.status).toBe(201);
  const snapshot = await saved.json() as { playlist: { id: string } };
  const entry = session.state.queue[1]!;
  session.command({ type: "play", entryId: entry.id });
  expect(await loaded.promise).toMatchObject({ type: "load", segment: { start: 400 / 75, end: 875 / 75 } });
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "paused", position: 2, duration: 475 / 75, seekable: true });
  session.command({ type: "stop" });
  expect(store.progress("household", entry.source)?.position).toBe(2);
  loaded = Promise.withResolvers<PlaybackCommand>();
  session.command({ type: "play", entryId: entry.id });
  expect(await loaded.promise).toMatchObject({ startPosition: 2, segment: { start: 400 / 75, end: 875 / 75 } });
  session.command({ type: "stop" });
  const playbackQueue = session.state.queue.map(item => item.source);
  expect(playbackQueue).toEqual([tracks[1]!, tracks[0]!, ...tracks.slice(2)].map(track => `library:${track.id}`));
  playlists.close(); store.close(); await library.close();
  const reopened = createLibrary({ databasePath, folders, ffprobePath: null });
  const store2 = openStore(databasePath);
  const session2 = createSession(store2, () => { throw new Error("Restart must not autoplay"); }, () => {});
  const playlists2 = createPlaylists({ databasePath, onChange: () => {}, queue: () => session2.state.queue, loadQueue: () => {} });
  cleanups.push(() => { playlists2.close(); store2.close(); return reopened.close(); });
  await reopened.scan(source.id);
  expect(session2.state.currentEntryId).toBeNull();
  expect(session2.state.queue.map(item => item.source)).toEqual(playbackQueue);
  expect(reopened.albumTracks(album.id).items.map(track => track.id)).toEqual(tracks.map(track => track.id));
  const detail = await playlists2.handle(new Request(`http://localhost/api/playlists/${snapshot.playlist.id}`), () => {});
  expect(detail.status).toBe(200);
  expect(JSON.stringify(await detail.json())).not.toContain("album.flac");
  expect(store2.progress("household", entry.source)?.position).toBe(2);
});


test("cue filesystem failures do not expose host paths in source payloads", async () => {
  const { library, media, source } = await setup();
  const original = fs.open;
  const intercept = spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
    if (String(path) === join(media, "album.cue")) throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: "EACCES" });
    return original(path, flags, mode);
  });
  try {
    const result = await library.scan(source.id);
    expect(result.warning).toContain("album.cue: Couldn't read the cue sheet");
    // Paired controllers receive sources without the host-only path field.
    const payload = library.listSources().map(({ path: _path, ...source }) => source);
    expect(JSON.stringify(payload)).not.toContain(media);
    expect(JSON.stringify(payload)).not.toContain("EACCES");
  } finally { intercept.mockRestore(); }
});

test("revocation during the final cue stat prevents catalog publication", async () => {
  const { library, media, source } = await setup();
  const album = library.musicAlbums().items[0]!;
  const originalTracks = library.albumTracks(album.id).items;
  await writeFile(join(media, "album.cue"), (await Bun.file(join(media, "album.cue")).text()).replace("First tone", "Unauthorized title"));
  const original = fs.lstat;
  let authorizations = 0, revoked = false;
  const intercept = spyOn(fs, "lstat").mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
    const info = await original(...args);
    if (String(args[0]) === join(media, "album.cue") && authorizations >= 3) revoked = true;
    return info;
  }) as typeof fs.lstat);
  try {
    const result = await library.scan(source.id, () => { authorizations++; if (revoked) throw new Error("Controller access revoked"); });
    expect(revoked).toBe(true);
    expect(result.status).toBe("error");
    expect(library.albumTracks(album.id).items).toEqual(originalTracks);
  } finally { intercept.mockRestore(); }
});


test("cue playback rejects an ancestor replaced after cue validation and before path handoff", async () => {
  const { root, media, library, source, folders } = await setup();
  const nested = join(media, "nested"), outside = join(root, "outside");
  await mkdir(nested); await mkdir(outside);
  await rename(join(media, "album.flac"), join(nested, "album.flac"));
  await copyFile(join(fixtures, "album.flac"), join(outside, "album.flac"));
  await writeFile(join(media, "album.cue"), (await Bun.file(join(media, "album.cue")).text()).replace("album.flac", "nested/album.flac"));
  await library.scan(source.id);
  const album = library.musicAlbums().items[0]!;
  const track = library.albumTracks(album.id).items[1]!;
  const original = folders.verify;
  let verified = 0;
  const intercept = spyOn(folders, "verify").mockImplementation(async (path, identity) => {
    const result = await original(path, identity);
    // getPlayable verifies again only after readCueAlbum has returned and closed its descriptors.
    if (++verified === 2) {
      await rename(nested, join(media, "original"));
      await fs.symlink(outside, nested);
    }
    return result;
  });
  try {
    await expect(library.getPlayable(track.id)).rejects.toThrow("unavailable");
    expect(verified).toBe(2);
    expect(library.albumTracks(album.id).items.find(item => item.id === track.id)?.available).toBe(false);
  } finally { intercept.mockRestore(); }
});
