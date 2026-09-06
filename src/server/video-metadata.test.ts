import { realpathSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdir, mkdtemp, realpath, rename, rm, stat, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMediaFolders } from "./media-folders";
import { createLibrary } from "./library";
import { openStore } from "./store";
import { parseVideoNfo, videoArtwork } from "./video-metadata";

const folders = createMediaFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null });

const cover = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=", "base64");
const bytes = (xml: string) => new TextEncoder().encode(xml);
const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "couch-video-")));
  const media = join(root, "media");
  const databasePath = join(root, "state.sqlite");
  await mkdir(media);
  cleanups.push(() => rm(root, { force: true, recursive: true }));
  const library = createLibrary({ folders, databasePath, ffprobePath: null });
  cleanups.push(() => library.close());
  const write = async (path: string, value: string | Uint8Array) => { await mkdir(join(media, path, ".."), { recursive: true }); await Bun.write(join(media, path), value); };
  return { root, media, databasePath, library, write };
}

test("NFO parser validates one bounded XML item and decodes text without importing extra fields", () => {
  const parsed = parseVideoNfo(bytes('<?xml version="1.0"?><movie><title>A &amp; B &#233;</title><plot><![CDATA[<b>Plain text</b>]]></plot><genre>Drama</genre><genre>Comedy</genre></movie>'));
  expect(parsed.type).toBe("movie");
  expect(parsed.fields).toMatchObject({ title: "A & B é", plot: "<b>Plain text</b>", genre: ["Drama", "Comedy"] });
  for (const xml of ["", "<movie><title>broken</movie>", "<movie/><movie/>", "<episodedetails/><episodedetails/>", "<html><title>wrong root</title></html>",
    '<!DOCTYPE movie [<!ENTITY ext SYSTEM "file:///etc/passwd">]><movie><title>&ext;</title></movie>',
    '<!DOCTYPE movie [<!ENTITY x "expansion">]><movie><title>&x;</title></movie>',
    "<movie>" + "<deep>".repeat(33) + "x" + "</deep>".repeat(33) + "</movie>",
    "<movie>" + "<tag>x</tag>".repeat(4097) + "</movie>", "<movie><plot>" + "x".repeat(256 * 1024) + "</plot></movie>"]) {
    expect(() => parseVideoNfo(bytes(xml))).toThrow();
  }
  expect(() => parseVideoNfo(new Uint8Array([255, 254, 60, 0, 109, 0]))).toThrow();
});

test("image input bounds reject malformed, oversized, excessive dimensions, SVG and animation", () => {
  expect(videoArtwork(cover)).toMatchObject({ mimeType: "image/png" });
  expect(videoArtwork(cover)!.id).toMatch(/^[a-f0-9]{64}$/);
  expect(videoArtwork(bytes('<svg width="1" height="1"/>'))).toBeNull();
  expect(videoArtwork(bytes("not an image"))).toBeNull();
  expect(videoArtwork(new Uint8Array(2 * 1024 * 1024 + 1))).toBeNull();
  const huge = Buffer.from(cover); huge.writeUInt32BE(50_000, 16);
  expect(videoArtwork(huge)).toBeNull();
  expect(videoArtwork(Buffer.concat([cover, Buffer.from("acTL")]))).toBeNull();
  expect(videoArtwork(cover.subarray(0, 10))).toBeNull();
});

test("movie and multi-season scans import the documented fields, sort episodes, and retain offline artwork", async () => {
  const { root, media, databasePath, library, write } = await fixture();
  await write("Movie/filename.mkv", "unit media");
  await write("Movie/filename.nfo", '<movie><title>NFO movie</title><originaltitle>Original film</originaltitle><plot>Local plot</plot><premiered>2020-05-02</premiered><year>1999</year><runtime>95</runtime><genre>Drama</genre><genre>Home</genre><playcount>7</playcount><resume><position>40</position></resume><file>/private.mkv</file><thumb>../../private.png</thumb></movie>');
  await write("Movie/poster.png", cover);
  await write("Movie/fanart.png", cover);
  await write("Show/tvshow.nfo", '<tvshow><title>Example show</title><originaltitle>Original series</originaltitle><plot>Show plot</plot><premiered>2021-04-01</premiered><genre>Documentary</genre></tvshow>');
  await write("Show/poster.png", cover);
  await write("Show/fanart.png", cover);
  await write("Show/season01-poster.png", cover);
  for (const [season, episode] of [[2, 1], [1, 10], [1, 2], [0, 1]]) {
    const path = `Show/Season ${season}/Example.S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    await write(`${path}.mkv`, "unit media");
    await write(`${path}.nfo`, `<episodedetails><title>Episode ${season}.${episode}</title><showtitle>Fallback show</showtitle><season>${season}</season><episode>${episode}</episode><aired>2022-02-03</aired><plot>Episode plot</plot><runtime>22</runtime></episodedetails>`);
    await write(`${path}-thumb.png`, cover);
  }
  const source = await library.addSource(media);
  expect((await library.scan(source.id)).status).toBe("ready");
  const movie = library.search({ videoType: "movie" }).items[0]!;
  expect(movie).toMatchObject({ title: "NFO movie", kind: "video", duration: 5700, video: { type: "movie", originalTitle: "Original film", plot: "Local plot", premiered: "2020-05-02", year: 2020, genres: ["Drama", "Home"], show: null } });
  expect(library.search({ query: "Original film" }).items[0]?.id).toBe(movie.id);
  expect(library.search({ query: "Documentary" }).total).toBe(4);
  const shows = library.videoShows();
  expect(shows.items).toHaveLength(1);
  const show = shows.items[0]!;
  expect(show).toMatchObject({ title: "Example show", originalTitle: "Original series", plot: "Show plot", seasonCount: 3, episodeCount: 4 });
  expect(library.videoShows({ query: "original" }).total).toBe(1);
  expect(library.videoSeasons(show.id).map(item => item.season)).toEqual([0, 1, 2]);
  expect(library.search({ showId: show.id }).items.map(item => item.title)).toEqual(["Episode 0.1", "Episode 1.2", "Episode 1.10", "Episode 2.1"]);
  expect(library.search({ showId: show.id, season: 1, limit: 1, offset: 1 }).items[0]?.title).toBe("Episode 1.10");
  expect(library.search({ query: "Example", videoType: "episode" }).total).toBe(4);
  for (const id of [movie.artworkId, movie.video?.fanartId, show.artworkId, show.fanartId, library.videoSeasons(show.id)[1]?.artworkId]) expect(library.artwork(id!)?.data).toEqual(cover);
  expect(JSON.stringify(library.search())).not.toContain(media);
  const store = openStore(databasePath);
  cleanups.push(() => store.close());
  store.saveProgress("household", { mediaId: `library:${movie.id}`, libraryItemId: movie.id, title: movie.title, position: 50, duration: 5700, watched: false, lastPlayedAt: 100 });
  await library.scan(source.id);
  expect(library.getItem(movie.id)?.title).toBe(movie.title);
  await rename(media, join(root, "offline"));
  expect((await library.scan(source.id)).status).toBe("unavailable");
  expect(library.search().items.every(item => !item.available)).toBe(true);
  const catalog = library.search();
  await library.close();
  const reopened = createLibrary({ folders, databasePath, ffprobePath: null });
  cleanups.push(() => reopened.close());
  expect(reopened.search()).toEqual(catalog);
  expect(reopened.videoShows()).toEqual(shows);
  expect(reopened.artwork(movie.artworkId!)?.data).toEqual(cover);
  expect(store.progress("household", `library:${movie.id}`)).toMatchObject({ position: 50, watched: false });
  await rename(join(root, "offline"), media);
  await reopened.scan(source.id);
  expect(reopened.getItem(movie.id)?.available).toBe(true);
});

test("sidecar edits and removal preserve IDs and embedded tag precedence without re-probing media", async () => {
  const { root, media, databasePath, library, write } = await fixture();
  await library.close();
  const executable = join(root, "ffprobe-test");
  const count = join(root, "count");
  await Bun.write(executable, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(count)}, 'probe\\n');console.log(JSON.stringify({format:{duration:'20',tags:{title:'Embedded title'}}}));`);
  await chmod(executable, 0o755);
  const scanned = createLibrary({ folders, databasePath, ffprobePath: executable });
  cleanups.push(() => scanned.close());
  await write("movie.mkv", "unit media");
  await write("movie.nfo", "<movie><title>NFO title</title><runtime>100</runtime></movie>");
  const source = await scanned.addSource(media);
  await scanned.scan(source.id);
  const id = scanned.search().items[0]!.id;
  expect(scanned.getItem(id)).toMatchObject({ title: "NFO title", duration: 20 });
  await write("movie.nfo", "<movie><title>Changed NFO</title><premiered>2022-99-99</premiered></movie>");
  await write("poster.png", cover);
  await scanned.scan(source.id);
  const artworkId = scanned.getItem(id)!.artworkId!;
  expect(scanned.getItem(id)).toMatchObject({ title: "Changed NFO", video: { premiered: null } });
  await unlink(join(media, "movie.nfo"));
  await unlink(join(media, "poster.png"));
  await scanned.scan(source.id);
  expect(scanned.getItem(id)).toMatchObject({ title: "Embedded title", artworkId: null });
  expect(scanned.artwork(artworkId)).toBeNull();
  expect(await Bun.file(count).text()).toBe("probe\n");
  expect(scanned.search({ query: "Changed" }).total).toBe(0);
});

for (const unavailableProbe of ["absent", "failing"]) for (const previouslyProbed of [0, 1]) test(`legacy video metadata (probed=${previouslyProbed}) survives ${unavailableProbe} ffprobe until successful probing`, async () => {
  const { root, media, write } = await fixture();
  await write("movie.mkv", "unchanged legacy media");
  await write("movie.nfo", "<movie><runtime>99</runtime></movie>");
  const info = await stat(join(media, "movie.mkv"));
  const databasePath = join(root, "legacy.sqlite");
  const sourceId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const legacy = new Database(databasePath);
  legacy.run(`CREATE TABLE library_items (
    id TEXT PRIMARY KEY, sourceId TEXT NOT NULL, path TEXT NOT NULL,
    title TEXT NOT NULL, kind TEXT NOT NULL, duration REAL, artist TEXT, album TEXT,
    size INTEGER NOT NULL, modified REAL NOT NULL, probed INTEGER NOT NULL DEFAULT 0,
    available INTEGER NOT NULL DEFAULT 1, seenScan TEXT NOT NULL, UNIQUE(sourceId, path)
  ); CREATE TABLE library_sources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle', lastScanned INTEGER, error TEXT, warning TEXT
  );`);
  legacy.query("INSERT INTO library_sources (id, name, path) VALUES (?, 'Legacy', ?)").run(sourceId, media);
  legacy.query(`INSERT INTO library_items (id, sourceId, path, title, kind, duration, size, modified, probed, seenScan)
    VALUES (?, ?, 'movie.mkv', 'Embedded title', 'video', 120, ?, ?, ?, 'legacy')`).run(itemId, sourceId, info.size, info.mtimeMs, previouslyProbed);
  legacy.close();
  const store = openStore(databasePath);
  cleanups.push(() => store.close());
  store.saveProgress("household", { mediaId: `library:${itemId}`, libraryItemId: itemId, title: "Embedded title", position: 40, duration: 120, watched: false, lastPlayedAt: 100 });
  const executable = join(root, "ffprobe-legacy");
  await Bun.write(executable, `#!${process.execPath}\nprocess.exit(1);`);
  await chmod(executable, 0o755);
  const scanned = createLibrary({ folders, databasePath, ffprobePath: unavailableProbe === "absent" ? null : executable });
  cleanups.push(() => scanned.close());
  expect(() => scanned.scan(sourceId)).toThrow("Verify");
  await scanned.testSource(sourceId, () => {}, true);
  for (let scan = 0; scan < 2; scan++) {
    expect((await scanned.scan(sourceId)).status).toBe("ready");
    expect(scanned.getItem(itemId)).toMatchObject({ title: "Embedded title", duration: 120 });
  }
  await scanned.close();
  await Bun.write(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({format:{duration:'125',tags:{title:'Reprobed title'}}}));`);
  const reopened = createLibrary({ folders, databasePath, ffprobePath: executable });
  cleanups.push(() => reopened.close());
  expect(reopened.getItem(itemId)).toMatchObject({ title: "Embedded title", duration: 120 });
  await reopened.scan(sourceId);
  expect(reopened.getItem(itemId)).toMatchObject({ title: "Reprobed title", duration: 125 });
  expect(store.progress("household", `library:${itemId}`)).toMatchObject({ position: 40, watched: false });
  await write("movie.mkv", "replaced media with different bytes and size");
  await Bun.write(executable, `#!${process.execPath}\nprocess.exit(1);`);
  await reopened.scan(sourceId);
  expect(reopened.getItem(itemId)).toMatchObject({ title: "movie", duration: 5940 });
});

test("current show metadata survives deleted episodes, search and whole-source offline restart", async () => {
  const { root, media, databasePath, library, write } = await fixture();
  await write("Show/Season 1/S01E01.mkv", "unit media");
  await write("Show/Season 2/S02E01.mkv", "unit media");
  await write("Show/tvshow.nfo", "<tvshow><title>A show</title><originaltitle>Current original</originaltitle><plot>Show plot</plot></tvshow>");
  const source = await library.addSource(media);
  await library.scan(source.id);
  const showId = library.videoShows().items[0]!.id;
  const episodes = library.search({ showId }).items;
  await unlink(join(media, "Show/Season 2/S02E01.mkv"));
  await write("Show/tvshow.nfo", "<tvshow><title>Z show</title><originaltitle>Current original</originaltitle><plot>Show plot</plot></tvshow>");
  await library.scan(source.id);
  const shows = library.videoShows();
  expect(shows.items).toEqual([expect.objectContaining({ id: showId, title: "Z show", plot: "Show plot", seasonCount: 2, episodeCount: 2 })]);
  expect(library.videoShows({ query: "Z show" })).toEqual(shows);
  expect(library.videoShows({ query: "Current original" })).toEqual(shows);
  expect(library.videoShows({ query: "A show" }).total).toBe(0);
  expect(library.search({ showId }).items.map(item => item.id)).toEqual(episodes.map(item => item.id));
  expect(library.getItem(episodes[1]!.id)?.available).toBe(false);
  expect(library.getItem(episodes[1]!.id)?.video?.show?.title).toBe("Z show");
  expect(library.search({ query: "Z show", videoType: "episode" }).total).toBe(2);
  expect(library.search({ query: "A show", videoType: "episode" }).total).toBe(0);
  await rename(media, join(root, "offline"));
  expect((await library.scan(source.id)).status).toBe("unavailable");
  await library.close();
  const reopened = createLibrary({ folders, databasePath, ffprobePath: null });
  cleanups.push(() => reopened.close());
  expect(reopened.videoShows()).toEqual(shows);
  expect(reopened.videoShows({ query: "Z show" })).toEqual(shows);
  expect(reopened.search({ showId }).items.every(item => !item.available)).toBe(true);
});

for (const metadata of ["mixed", "conflicting"]) for (const last of ["S01E01", "S01E02"]) test(`${metadata} episode show titles follow precedence when ${last} saves last`, async () => {
  const { root, media, databasePath, library, write } = await fixture();
  await library.close();
  await write("ZFolder/S01E01.mkv", "unit media");
  await write("ZFolder/S01E01.nfo", "<episodedetails><showtitle>AShow</showtitle></episodedetails>");
  await write("ZFolder/S01E02.mkv", "unit media");
  if (metadata === "conflicting") await write("ZFolder/S01E02.nfo", "<episodedetails><showtitle>BShow</showtitle></episodedetails>");
  const first = last === "S01E01" ? "S01E02" : "S01E01";
  const executable = join(root, "ffprobe-order");
  await Bun.write(executable, `#!${process.execPath}
import { Database } from "bun:sqlite";
if (process.argv.at(-1).endsWith(${JSON.stringify(`${last}.mkv`)})) {
  const db = new Database(${JSON.stringify(databasePath)}, { readonly: true });
  const saved = db.query("SELECT id FROM library_items WHERE path = ?");
  const deadline = Date.now() + 2000;
  while (!saved.get(${JSON.stringify(`ZFolder/${first}.mkv`)})) {
    if (Date.now() > deadline) process.exit(1);
    await Bun.sleep(5);
  }
  db.close();
}
console.log(JSON.stringify({format:{duration:"20"}}));`);
  await chmod(executable, 0o755);
  const scanned = createLibrary({ folders, databasePath, ffprobePath: executable });
  cleanups.push(() => scanned.close());
  const source = await scanned.addSource(media);
  expect((await scanned.scan(source.id)).status).toBe("ready");
  const db = new Database(databasePath, { readonly: true });
  cleanups.push(() => db.close());
  expect(db.query<{ path: string }, []>("SELECT path FROM library_items ORDER BY rowid").all().map(row => row.path)).toEqual([`ZFolder/${first}.mkv`, `ZFolder/${last}.mkv`]);
  const shows = scanned.videoShows();
  expect(shows.items).toEqual([expect.objectContaining({ title: "AShow", episodeCount: 2, seasonCount: 1 })]);
  expect(scanned.search({ query: "AShow" }).total).toBe(2);
  expect(scanned.search({ query: "ZFolder" }).total).toBe(0);
  expect(scanned.search({ query: "BShow" }).total).toBe(0);
  expect(scanned.search().items.every(item => item.video?.show?.title === "AShow")).toBe(true);
  await unlink(join(media, "ZFolder/S01E01.nfo"));
  if (metadata === "conflicting") await unlink(join(media, "ZFolder/S01E02.nfo"));
  await scanned.scan(source.id);
  expect(scanned.videoShows().items[0]).toMatchObject({ id: shows.items[0]!.id, title: "ZFolder", episodeCount: 2 });
  expect(scanned.search({ query: "AShow" }).total).toBe(0);
});

test("malformed and escaped sidecars stay isolated from playable entries and filename fallback", async () => {
  const { root, media, library, write } = await fixture();
  await write("Show/Season 2/Fallback.S02E10.mkv", "unit media");
  await write("Show/Season 2/Fallback.S02E10.nfo", "<episodedetails><title>broken");
  await write("Show/Season 2/Fallback.S02E10-thumb.png", bytes("bad PNG"));
  await write("Show/tvshow.nfo", "<tvshow><title>Safe show</title></tvshow>");
  await write("Show/fanart.jpg", new Uint8Array(2 * 1024 * 1024 + 1));
  await Bun.write(join(root, "private.png"), cover);
  await symlink(join(root, "private.png"), join(media, "Show/poster.png"));
  await write("Escape.mkv", "unit media");
  await Bun.write(join(root, "private.nfo"), "<movie><title>Private title</title></movie>");
  await symlink(join(root, "private.nfo"), join(media, "Escape.nfo"));
  const source = await library.addSource(media);
  const result = await library.scan(source.id);
  expect(result.status).toBe("ready");
  expect(result.warning).toContain("invalid or oversized NFO/artwork");
  expect(result.warning).not.toContain(root);
  const episode = library.search({ videoType: "episode" }).items[0]!;
  expect(episode).toMatchObject({ title: "Fallback.S02E10", available: true, artworkId: null, video: { season: 2, episode: 10, show: { title: "Safe show", artworkId: null }, fanartId: null } });
  expect(library.search({ query: "Private" }).total).toBe(0);
  expect((await library.getPlayable(episode.id)).source).toContain("Fallback.S02E10.mkv");
});

test("movie.nfo is only used in a single-video directory; unknown episode order remains reachable", async () => {
  const { media, library, write } = await fixture();
  await write("Single/file.mkv", "unit media");
  await write("Single/movie.nfo", "<movie><title>Folder movie</title></movie>");
  await write("Shared/first.mkv", "unit media");
  await write("Shared/second.mkv", "unit media");
  await write("Shared/movie.nfo", "<movie><title>Ambiguous</title></movie>");
  await write("Show/no-order.mkv", "unit media");
  await write("Show/no-order.nfo", "<episodedetails><title>Unknown order</title><season>-1</season><episode>bad</episode></episodedetails>");
  const source = await library.addSource(media);
  await library.scan(source.id);
  expect(library.search({ query: "Folder movie" }).total).toBe(1);
  expect(library.search({ query: "Ambiguous" }).total).toBe(0);
  const show = library.videoShows().items[0]!;
  expect(library.videoSeasons(show.id)).toMatchObject([{ season: null, episodeCount: 1 }]);
  expect(library.search({ showId: show.id, season: "unknown" }).items[0]?.title).toBe("Unknown order");
});

test("private bounded original NFO cache preserves unknown XML bytes and show identity across title edits", async () => {
  const { media, databasePath, library, write } = await fixture();
  const original = '<?xml version="1.0"?>\n<tvshow><title>First show title</title><unknown attribute="kept"><![CDATA[verbatim & data]]></unknown></tvshow>\n';
  await write("Show/S01E01.mkv", "unit media");
  await write("Show/tvshow.nfo", original);
  const source = await library.addSource(media);
  await library.scan(source.id);
  const showId = library.videoShows().items[0]!.id;
  const itemId = library.search().items[0]!.id;
  const db = new Database(databasePath);
  cleanups.push(() => db.close());
  const saved = () => db.query<{ data: Uint8Array; path: string; available: number }, []>("SELECT * FROM library_video_nfo").get()!;
  expect(Buffer.from(saved().data).toString()).toBe(original);
  expect(saved().path).toBe("Show/tvshow.nfo");
  expect(JSON.stringify(library.search())).not.toContain("verbatim");
  const edited = original.replace("First show title", "Revised show title");
  await write("Show/tvshow.nfo", edited);
  await library.scan(source.id);
  expect(library.videoShows().items[0]).toMatchObject({ id: showId, title: "Revised show title" });
  expect(library.search().items[0]!.id).toBe(itemId);
  expect(Buffer.from(saved().data).toString()).toBe(edited);
  await unlink(join(media, "Show/tvshow.nfo"));
  await library.scan(source.id);
  expect(saved().available).toBe(0);
  expect(Buffer.from(saved().data).toString()).toBe(edited);
  expect(library.videoShows().items[0]!.id).toBe(showId);
});
