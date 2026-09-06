import { realpathSync } from "node:fs";
import { createMediaFolders } from "./media-folders";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLibrary, type Library } from "./library";

const folders = createMediaFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null });

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

const cover = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aJcAAAAASUVORK5CYII=", "base64");
function taggedWave(tags: Record<string, string>, image?: Uint8Array) {
  const frame = (id: string, value: Uint8Array) => { const header = Buffer.alloc(10); header.write(id); header.writeUInt32BE(value.length, 4); return Buffer.concat([header, value]); };
  const frames = Object.entries(tags).map(([id, value]) => frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value)])));
  if (image) frames.push(frame("APIC", Buffer.concat([Buffer.from([0]), Buffer.from("image/png\0"), Buffer.from([3, 0]), image])));
  const payload = Buffer.concat(frames);
  const id3 = Buffer.from([73, 68, 51, 4, 0, 0, payload.length >> 21 & 127, payload.length >> 14 & 127, payload.length >> 7 & 127, payload.length & 127]);
  // These fixtures use short v2.4 frames whose syncsafe lengths match their integer lengths.
  const chunk = (id: string, bytes: Uint8Array) => { const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(bytes.length, 4); return Buffer.concat([header, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])]); };
  const format = Buffer.alloc(16); format.writeUInt16LE(1, 0); format.writeUInt16LE(1, 2); format.writeUInt32LE(8000, 4); format.writeUInt32LE(16000, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
  const contents = Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", format), chunk("id3 ", Buffer.concat([id3, payload])), chunk("data", Buffer.alloc(16000))]);
  return chunk("RIFF", contents);
}

async function setup(ffprobePath: string | null = null) {
  const root = await mkdtemp(join(tmpdir(), "couch-library-"));
  cleanups.push(() => rm(root, { force: true, recursive: true }));
  const media = join(root, "media");
  await mkdir(media);
  const databasePath = join(root, "library.sqlite");
  const library = createLibrary({ folders, databasePath, ffprobePath });
  cleanups.push(() => library.close());
  return { root, media, databasePath, library };
}

async function sourceWithFiles(library: Library, media: string, files: string[]) {
  for (const file of files) await Bun.write(join(media, file), "media fixture");
  const source = await library.addSource(media);
  await library.scan(source.id);
  return source;
}

test("scan indexes nested media, skips symlinks and nonmedia, and preserves IDs after rescanning and restart", async () => {
  const { root, media, databasePath, library } = await setup();
  await mkdir(join(media, "album"));
  await Bun.write(join(media, "album", "One.flac"), "audio");
  await Bun.write(join(root, "private.mp4"), "outside media root");
  await symlink(join(root, "private.mp4"), join(media, "escape.mp4"));
  await symlink(root, join(media, "recursive"));
  const source = await sourceWithFiles(library, media, ["Two.MKV", "Three.mp3", "notes.txt", "streams.m3u"]);
  await expect(library.addSource(media)).rejects.toThrow("already a source");
  const original = library.search();
  expect(original.items.map(item => item.title)).toEqual(["One", "Three", "Two"]);
  expect(original.items.map(item => item.kind)).toEqual(["audio", "audio", "video"]);
  expect(original.items.every(item => item.available)).toBe(true);
  expect(library.listSources()[0]?.warning).toContain("Install ffprobe");
  expect(library.search({ query: "tw", offset: 0, limit: 1 }).items[0]?.title).toBe("Two");
  expect(library.search({ offset: 1, limit: 1 }).items[0]?.title).toBe("Three");
  expect(library.search({ query: '" OR * : -' }).items).toEqual([]);
  expect(library.search({ query: "\"Two\"" }).total).toBe(1);
  await library.scan(source.id);
  expect(library.search().items).toEqual(original.items);
  await library.close();
  const reopened = createLibrary({ folders, databasePath, ffprobePath: null });
  cleanups.push(() => reopened.close());
  expect(reopened.search().items).toEqual(original.items);
  const playable = await reopened.getPlayable(original.items[0]!.id);
  expect(fileURLToPath(playable.source)).toBe(await realpath(join(media, "album", "One.flac")));
});

test("missing files and disconnected roots retain the catalog and recover on rescan", async () => {
  const { root, media, library } = await setup();
  const source = await sourceWithFiles(library, media, ["One.mp4", "Two.flac"]);
  const original = library.search().items;
  await unlink(join(media, "One.mp4"));
  await library.scan(source.id);
  expect(library.search().items.find(item => item.title === "One")?.available).toBe(false);
  await rename(media, join(root, "disconnected"));
  expect((await library.scan(source.id)).status).toBe("unavailable");
  expect(library.search().total).toBe(2);
  expect(library.search().items.every(item => !item.available)).toBe(true);
  await rename(join(root, "disconnected"), media);
  await Bun.write(join(media, "One.mp4"), "restored media");
  await library.scan(source.id);
  expect(library.search().items.map(item => item.id)).toEqual(original.map(item => item.id));
  expect(library.search().items.every(item => item.available)).toBe(true);
});

test("queue lookup rechecks files and rejects symlinks introduced after scanning", async () => {
  const { root, media, library } = await setup();
  await sourceWithFiles(library, media, ["One.mp4"]);
  const item = library.search().items[0]!;
  expect((await library.getPlayable(item.id)).title).toBe("One");
  await Bun.write(join(root, "private.mp4"), "outside media root");
  await unlink(join(media, "One.mp4"));
  await symlink(join(root, "private.mp4"), join(media, "One.mp4"));
  await expect(library.getPlayable(item.id)).rejects.toThrow("unavailable");
  await expect(library.getPlayable("unknown")).rejects.toThrow("not found");
  expect(library.search().items[0]?.available).toBe(false);
  await expect(library.addSource("../outside")).rejects.toThrow("absolute");
  await expect(library.addSource(join(root, "missing"))).rejects.toThrow("cannot be opened");
});

test("a directory replaced with a link outside its source cannot be queued", async () => {
  const { root, media, library } = await setup();
  await mkdir(join(media, "album"));
  await sourceWithFiles(library, media, ["album/One.mp4"]);
  const id = library.search().items[0]!.id;
  await rename(join(media, "album"), join(root, "album"));
  await symlink(join(root, "album"), join(media, "album"));
  await expect(library.getPlayable(id)).rejects.toThrow("unavailable");
});

test("probe metadata is searchable and unchanged files do not launch new probes", async () => {
  const { root, media, databasePath, library } = await setup();
  await library.close();
  const executable = join(root, "probe");
  const countPath = join(root, "probes.log");
  await Bun.write(executable, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(countPath)}, (await Bun.file(${JSON.stringify(countPath)}).text().catch(() => '')) + 'probe\\n');\nconsole.log(JSON.stringify({format:{duration:'123.25',tags:{TITLE:'A tagged song',ARTIST:'Björk',album:'Debut'}}}));\n`);
  await chmod(executable, 0o755);
  const metadataLibrary = createLibrary({ folders, databasePath, ffprobePath: executable });
  cleanups.push(() => metadataLibrary.close());
  const source = await sourceWithFiles(metadataLibrary, media, ["one.mkv"]);
  const item = metadataLibrary.search({ query: "bjork" }).items[0]!;
  expect(item.title).toBe("A tagged song");
  expect(item.duration).toBe(123.25);
  expect(item.album).toBe("Debut");
  expect(metadataLibrary.search({ query: "debut tagged" }).total).toBe(1);
  await metadataLibrary.scan(source.id);
  expect(await readFile(countPath, "utf8")).toBe("probe\n");
  await Bun.write(join(media, "one.mkv"), "changed contents with new size");
  await metadataLibrary.scan(source.id);
  expect(await readFile(countPath, "utf8")).toBe("probe\nprobe\n");
  expect(metadataLibrary.search().items[0]?.id).toBe(item.id);
});

test("scans coalesce per folder and queue across folders", async () => {
  const { root, media, library } = await setup();
  const second = join(root, "second");
  await mkdir(second);
  await Bun.write(join(media, "one.mp4"), "first");
  await Bun.write(join(second, "two.mp3"), "second");
  const one = await library.addSource(media);
  const two = await library.addSource(second);
  const firstScan = library.scan(one.id);
  expect(library.scan(one.id)).toBe(firstScan);
  const secondScan = library.scan(two.id);
  expect(library.listSources().every(source => source.status === "scanning")).toBe(true);
  const [firstResult, secondResult] = await Promise.all([firstScan, secondScan]);
  expect(firstResult.status).toBe("ready");
  expect(secondResult.status).toBe("ready");
  expect(library.search().total).toBe(2);
});

test("probe work stays bounded and failed metadata leaves files available", async () => {
  const { root, media, databasePath, library } = await setup();
  await library.close();
  const executable = join(root, "probe");
  const log = join(root, "probe.log");
  await Bun.write(executable, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, 'start\\n');\nawait Bun.sleep(40);\nappendFileSync(${JSON.stringify(log)}, 'end\\n');\nprocess.exit(1);\n`);
  await chmod(executable, 0o755);
  const bounded = createLibrary({ folders, databasePath, ffprobePath: executable });
  cleanups.push(() => bounded.close());
  await sourceWithFiles(bounded, media, ["One.mp4", "Two.mp4", "Three.mp4", "Four.mp4", "Five.mp4"]);
  let active = 0;
  let maximum = 0;
  for (const event of (await readFile(log, "utf8")).trim().split("\n")) {
    active += event === "start" ? 1 : -1;
    maximum = Math.max(maximum, active);
  }
  expect(active).toBe(0);
  expect(maximum).toBeLessThanOrEqual(2);
  expect(bounded.listSources()[0]?.status).toBe("ready");
  expect(bounded.listSources()[0]?.warning).toContain("5 files");
  expect(bounded.search().items.every(item => item.available && item.duration === null)).toBe(true);
});

test("closing the library terminates active probes and records an interrupted scan", async () => {
  const { root, media, databasePath, library } = await setup();
  await library.close();
  const executable = join(root, "probe");
  const started = join(root, "started");
  await Bun.write(executable, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(started)}, 'started');\nawait Bun.sleep(60_000);\n`);
  await chmod(executable, 0o755);
  const running = createLibrary({ folders, databasePath, ffprobePath: executable });
  cleanups.push(() => running.close());
  await Bun.write(join(media, "One.mp4"), "media");
  const source = await running.addSource(media);
  const scan = running.scan(source.id);
  const deadline = Date.now() + 2_000;
  while (!await Bun.file(started).exists() && Date.now() < deadline) await Bun.sleep(10);
  expect(await Bun.file(started).exists()).toBe(true);
  const beforeClose = Date.now();
  await running.close();
  expect(Date.now() - beforeClose).toBeLessThan(1_000);
  expect((await scan).status).toBe("error");
  const reopened = createLibrary({ folders, databasePath, ffprobePath: null });
  cleanups.push(() => reopened.close());
  expect(reopened.listSources()[0]?.error).toBe("Scan interrupted.");
});

test("music-metadata reads duration from a PCM WAV fixture without ffprobe", async () => {
  const { media, library } = await setup();
  const sampleRate = 8000;
  const bytes = Buffer.alloc(44 + sampleRate * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(sampleRate * 2, 40);
  await Bun.write(join(media, "silence.wav"), bytes);
  const source = await library.addSource(media);
  expect((await library.scan(source.id)).warning).toBeNull();
  expect(library.search().items[0]?.duration).toBe(1);
});

test("tagged albums preserve compilation credits, numeric disc ordering, artwork and restart", async () => {
  const { media, library, databasePath } = await setup();
  const tags = { TALB: "Fixture collection", TPE2: "Fixture Ensemble" };
  await Bun.write(join(media, "z.wav"), taggedWave({ ...tags, TIT2: "Disc one first", TPE1: "Guest Singer", TPOS: "1/2", TRCK: "2/10" }, cover));
  await Bun.write(join(media, "a.wav"), taggedWave({ ...tags, TIT2: "Disc one last", TPE1: "Fixture Ensemble", TPOS: "1/2", TRCK: "10/10" }, cover));
  await Bun.write(join(media, "b.wav"), taggedWave({ ...tags, TIT2: "Disc two first", TPE1: "Fixture Ensemble", TPOS: "2/2", TRCK: "1/1" }, cover));
  await Bun.write(join(media, "unknown.wav"), taggedWave({ TIT2: "Single without album", TPE1: "Guest Singer" }));
  const source = await library.addSource(media);
  expect((await library.scan(source.id)).warning).toBeNull();
  expect(library.search().total).toBe(4);
  const albums = library.musicAlbums();
  expect(albums.total).toBe(1);
  expect(albums.items[0]).toMatchObject({ title: "Fixture collection", artist: "Fixture Ensemble", trackCount: 3, duration: 3 });
  const ordered = library.albumTracks(albums.items[0]!.id);
  expect(ordered.items.map(item => item.title)).toEqual(["Disc one first", "Disc one last", "Disc two first"]);
  expect(ordered.items[0]).toMatchObject({ artists: ["Guest Singer"], albumArtist: "Fixture Ensemble", discNumber: 1, trackNumber: 2 });
  expect(library.artwork(albums.items[0]!.artworkId!)?.data).toEqual(cover);
  expect(library.artwork(albums.items[0]!.artworkId!)?.mimeType).toBe("image/png");
  expect(library.artwork("../private")).toBeNull();
  const guest = library.musicArtists({ query: "Guest" }).items[0]!;
  expect(guest).toMatchObject({ name: "Guest Singer", albumCount: 1, trackCount: 2 });
  expect(library.musicAlbums({ artistId: guest.id }).items).toEqual(albums.items);
  expect(library.search({ artistId: guest.id }).items.map(item => item.title)).toEqual(["Disc one first", "Single without album"]);
  expect(library.search({ artistId: guest.id, query: "Single" }).items.map(item => item.title)).toEqual(["Single without album"]);
  expect(library.musicArtists({ limit: 1, offset: 1 })).toMatchObject({ total: 2, offset: 1, limit: 1 });
  expect(library.musicAlbums({ query: "%" }).items).toEqual([]);
  expect(library.search({ query: "Ensemble" }).total).toBe(3);
  await library.close();
  const reopened = createLibrary({ folders, databasePath, ffprobePath: null });
  cleanups.push(() => reopened.close());
  expect(reopened.albumTracks(albums.items[0]!.id)).toEqual(ordered);
  expect(reopened.artwork(albums.items[0]!.artworkId!)?.data).toEqual(cover);
});

test("old successful audio probes are reparsed without file changes and failed migration retains known tags", async () => {
  const { media, library, databasePath } = await setup();
  await Bun.write(join(media, "song.wav"), taggedWave({ TIT2: "Tagged title", TALB: "Album", TPE1: "Singer", TRCK: "12" }));
  const source = await library.addSource(media);
  await library.scan(source.id);
  const id = library.search().items[0]!.id;
  const db = new Database(databasePath);
  db.run("UPDATE library_items SET metadataVersion = 0, title = 'Old title', albumId = NULL, trackNumber = NULL, probed = 1");
  await library.scan(source.id);
  expect(library.getItem(id)).toMatchObject({ title: "Tagged title", trackNumber: 12 });
  expect(library.musicAlbums().total).toBe(1);
  await Bun.write(join(media, "song.wav"), "unsupported contents");
  await library.scan(source.id);
  db.run("UPDATE library_items SET metadataVersion = 0, title = 'Known title', artist = 'Known artist', probed = 1");
  await library.scan(source.id);
  expect(library.getItem(id)).toMatchObject({ title: "Known title", artist: "Known artist", available: true });
  expect(library.listSources()[0]?.warning).toContain("Could not read metadata");
  db.close();
});

test("rescanning changed music replaces artist credits and releases unreferenced artwork", async () => {
  const { media, library } = await setup();
  const path = join(media, "song.wav");
  await Bun.write(path, taggedWave({ TIT2: "Original", TALB: "Album", TPE1: "Original singer" }, cover));
  const source = await library.addSource(media);
  await library.scan(source.id);
  const original = library.search().items[0]!;
  expect(library.artwork(original.artworkId!)).not.toBeNull();
  await Bun.write(path, taggedWave({ TIT2: "Updated without album art", TALB: "Album", TPE1: "Replacement singer" }));
  await library.scan(source.id);
  expect(library.getItem(original.id)).toMatchObject({ title: "Updated without album art", artworkId: null, artists: ["Replacement singer"] });
  expect(library.musicArtists().items.map(artist => artist.name)).toEqual(["Replacement singer"]);
  expect(library.search({ query: "Original" }).total).toBe(0);
  expect(library.artwork(original.artworkId!)).toBeNull();
});

test("missing disc and track numbers sort last with a stable title tie break", async () => {
  const { media, library } = await setup();
  const common = { TALB: "Ordered", TPE1: "Singer" };
  const files: Record<string, Record<string, string>> = {
    "unknown.wav": { TIT2: "No disc", TRCK: "1" }, "track.wav": { TIT2: "No track", TPOS: "1" },
    "z.wav": { TIT2: "Z title", TPOS: "1", TRCK: "2" }, "a.wav": { TIT2: "A title", TPOS: "1", TRCK: "2" },
  };
  for (const [name, tags] of Object.entries(files)) await Bun.write(join(media, name), taggedWave({ ...common, ...tags }));
  const source = await library.addSource(media);
  await library.scan(source.id);
  expect(library.albumTracks(library.musicAlbums().items[0]!.id).items.map(item => item.title)).toEqual(["A title", "Z title", "No track", "No disc"]);
});

test("album tracks reject oversized albums explicitly and retain unavailable entries", async () => {
  const { media, library, databasePath } = await setup();
  await Bun.write(join(media, "song.wav"), taggedWave({ TALB: "Album", TPE1: "Singer" }));
  const source = await library.addSource(media);
  await library.scan(source.id);
  const album = library.musicAlbums().items[0]!;
  await unlink(join(media, "song.wav"));
  await library.scan(source.id);
  expect(library.albumTracks(album.id).items[0]?.available).toBe(false);
  const db = new Database(databasePath);
  const item = db.query<Record<string, string | number | null>, []>("SELECT * FROM library_items").get()!;
  const columns = Object.keys(item);
  const insert = db.query(`INSERT INTO library_items (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  db.transaction(() => { for (let i = 0; i < 500; i++) insert.run(...columns.map(key => key === "id" || key === "path" ? `${i}` : item[key]!)); })();
  expect(() => library.albumTracks(album.id)).toThrow("more than 500");
  expect(() => library.albumTracks("missing")).toThrow("not found");
  db.close();
});

test.skipIf(!Bun.which("ffmpeg"))("maintained parser reads real tagged MP3 FLAC and M4A with the same ordered album", async () => {
  const { media, library } = await setup();
  for (const [extension, codec, disc, track] of [["mp3", "libmp3lame", "1", "2"], ["flac", "flac", "1", "10"], ["m4a", "aac", "2", "1"]]) {
    const process = Bun.spawn({ cmd: [Bun.which("ffmpeg")!, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", codec!,
      "-metadata", `title=${extension} title`, "-metadata", "artist=Guest Singer", "-metadata", "album_artist=Album Artist", "-metadata", "album=Real album",
      "-metadata", `disc=${disc}`, "-metadata", `track=${track}`, join(media, `track.${extension}`)], stdout: "ignore", stderr: "pipe" });
    const error = await new Response(process.stderr).text();
    expect(await process.exited, error).toBe(0);
  }
  const source = await library.addSource(media);
  expect((await library.scan(source.id)).warning).toBeNull();
  const album = library.musicAlbums().items[0]!;
  expect(album).toMatchObject({ title: "Real album", artist: "Album Artist", trackCount: 3 });
  const items = library.albumTracks(album.id).items;
  expect(items.map(item => item.title)).toEqual(["mp3 title", "flac title", "m4a title"]);
  expect(items.every(item => item.duration! > 0.9 && item.duration! < 1.2 && item.artists?.[0] === "Guest Singer")).toBe(true);
});
