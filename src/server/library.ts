import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { LibraryItem, LibrarySearch, LibrarySource, MusicAlbum, MusicAlbums, MusicArtist, MusicArtists } from "../shared/library";
import { musicArtistId, musicMetadataVersion, readMusicMetadata, type MusicMetadata } from "./music-metadata";

const videoExtensions = new Set("mp4 mkv webm avi mov m4v ts m2ts mts mpg mpeg ogv flv wmv vob 3gp".split(" "));
const audioExtensions = new Set("mp3 flac m4a aac ogg opus wav aiff aif wma alac ape ac3 dts dsf dff".split(" "));
type SourceRow = LibrarySource & { path: string };
type Metadata = { title: string | null; duration: number | null; artist: string | null; album: string | null };
type ItemRow = LibraryItem & { sourceId: string; path: string; size: number; modified: number; probed: number; metadataVersion: number };
type PublicItemRow = Omit<LibraryItem, "available" | "artists"> & { available: number; artists: string };
const publicItem = (row: PublicItemRow): LibraryItem => ({ ...row, artists: JSON.parse(row.artists) as string[], available: !!row.available });
const itemColumns = `i.id, i.title, i.kind, i.duration, i.artist, i.album, i.artists, i.albumArtist, i.albumId,
  i.discNumber, i.trackNumber, i.artworkId, (i.available AND s.status <> 'unavailable') AS available`;
const albumColumns = `i.albumId AS id, MIN(i.album) AS title, MIN(i.albumArtist) AS artist,
  MIN(i.artworkId) AS artworkId, COUNT(*) AS trackCount,
  CASE WHEN COUNT(i.duration) = COUNT(*) THEN SUM(i.duration) ELSE NULL END AS duration`;

function page(options: { offset?: number; limit?: number }) {
  return {
    offset: Number.isFinite(options.offset) ? Math.max(0, Math.min(1_000_000, Math.floor(options.offset!))) : 0,
    limit: Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 40,
  };
}

const searchPattern = (query?: string) => `%${(query ?? "").trim().slice(0, 200).replace(/[\\%_]/g, "\\$&")}%`;

function within(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function textTag(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

export function createLibrary(options: { databasePath: string; onChange?: () => void; ffprobePath?: string | null }) {
  if (options.databasePath !== ":memory:") mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(options.databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.run(`
    CREATE TABLE IF NOT EXISTS library_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle', lastScanned INTEGER, error TEXT, warning TEXT
    );
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY, sourceId TEXT NOT NULL, path TEXT NOT NULL,
      title TEXT NOT NULL, kind TEXT NOT NULL, duration REAL, artist TEXT, album TEXT,
      size INTEGER NOT NULL, modified REAL NOT NULL, probed INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 1, seenScan TEXT NOT NULL, UNIQUE(sourceId, path)
    );
    CREATE INDEX IF NOT EXISTS library_items_source ON library_items(sourceId);
    CREATE VIRTUAL TABLE IF NOT EXISTS library_search USING fts5(id UNINDEXED, title, artist, album, tokenize = 'unicode61 remove_diacritics 2');
    UPDATE library_sources SET status = 'idle', error = 'Previous scan was interrupted.' WHERE status = 'scanning';
  `);
  const columns = new Set(db.query<{ name: string }, []>("PRAGMA table_info(library_items)").all().map(column => column.name));
  for (const [name, type] of Object.entries({ artists: "TEXT NOT NULL DEFAULT '[]'", albumArtist: "TEXT", albumId: "TEXT", discNumber: "INTEGER", trackNumber: "INTEGER", artworkId: "TEXT", metadataVersion: "INTEGER NOT NULL DEFAULT 0" })) {
    if (!columns.has(name)) db.run(`ALTER TABLE library_items ADD COLUMN ${name} ${type}`);
  }
  db.run(`
    CREATE INDEX IF NOT EXISTS library_items_album ON library_items(albumId, discNumber, trackNumber);
    CREATE TABLE IF NOT EXISTS library_music_artists (itemId TEXT NOT NULL, artistId TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(itemId, artistId));
    CREATE INDEX IF NOT EXISTS library_music_artists_artist ON library_music_artists(artistId);
    CREATE TABLE IF NOT EXISTS library_artwork (id TEXT PRIMARY KEY, data BLOB NOT NULL, mimeType TEXT NOT NULL);
  `);
  let closing = false;
  let scanQueue: Promise<unknown> = Promise.resolve();
  const scans = new Map<string, Promise<LibrarySource>>();
  const probes = new Set<{ kill(signal?: string | number): void }>();
  const sourceQuery = `SELECT s.*, (SELECT COUNT(*) FROM library_items i WHERE i.sourceId = s.id) AS itemCount FROM library_sources s`;
  const getSource = (id: string) => db.query<SourceRow, [string]>(`${sourceQuery} WHERE s.id = ?`).get(id);
  const notify = () => options.onChange?.();
  const assertOpen = () => { if (closing) throw new Error("The library is closing."); };

  async function probe(path: string, executable: string): Promise<Metadata | null> {
    const process = Bun.spawn({
      cmd: [executable, "-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=duration:format_tags=title,artist,album", "-of", "json", path],
      stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5_000, killSignal: "SIGKILL",
    });
    probes.add(process);
    try {
      const reader = process.stdout.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 256 * 1024) { process.kill("SIGKILL"); await reader.cancel(); return null; }
        chunks.push(value);
      }
      if (await process.exited !== 0) return null;
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { format?: { duration?: unknown; tags?: Record<string, unknown> } };
      const duration = Number(body.format?.duration);
      const tags = Object.fromEntries(Object.entries(body.format?.tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
      return { title: textTag(tags.title), artist: textTag(tags.artist), album: textTag(tags.album), duration: Number.isFinite(duration) && duration >= 0 ? duration : null };
    } catch {
      return null;
    } finally {
      probes.delete(process);
      if (process.exitCode === null) { process.kill("SIGKILL"); await process.exited; }
    }
  }

  async function* files(root: string, directory = root, depth = 0): AsyncGenerator<string> {
    assertOpen();
    if (depth > 64) throw new Error("Folder nesting exceeds the scan limit.");
    if (!within(root, await realpath(directory)) || (await lstat(directory)).isSymbolicLink()) return;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      assertOpen();
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) yield* files(root, path, depth + 1);
      else if (entry.isFile()) {
        const extension = extname(entry.name).slice(1).toLowerCase();
        if (videoExtensions.has(extension) || audioExtensions.has(extension)) yield path;
      }
    }
  }

  const saveItem = db.transaction((item: ItemRow, scanId: string, artwork: MusicMetadata["artwork"]) => {
    if (artwork) db.query("INSERT OR IGNORE INTO library_artwork (id, data, mimeType) VALUES (?, ?, ?)").run(artwork.id, artwork.data, artwork.mimeType);
    const row = db.query<{ rowid: number }, (string | number | null)[]>(`INSERT INTO library_items (id, sourceId, path, title, kind, duration, artist, album, size, modified, probed, available, seenScan, artists, albumArtist, albumId, discNumber, trackNumber, artworkId, metadataVersion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sourceId, path) DO UPDATE SET
      title=excluded.title, duration=excluded.duration, artist=excluded.artist, album=excluded.album,
      artists=excluded.artists, albumArtist=excluded.albumArtist, albumId=excluded.albumId, discNumber=excluded.discNumber,
      trackNumber=excluded.trackNumber, artworkId=excluded.artworkId, metadataVersion=excluded.metadataVersion,
      size=excluded.size, modified=excluded.modified, probed=excluded.probed, available=1, seenScan=excluded.seenScan RETURNING rowid`)
      .get(item.id, item.sourceId, item.path, item.title, item.kind, item.duration, item.artist, item.album, item.size, item.modified, item.probed, scanId,
        JSON.stringify(item.artists ?? []), item.albumArtist ?? null, item.albumId ?? null, item.discNumber ?? null, item.trackNumber ?? null, item.artworkId ?? null, item.metadataVersion)!;
    db.query("DELETE FROM library_search WHERE rowid = ?").run(row.rowid);
    db.query("INSERT INTO library_search (rowid, id, title, artist, album) VALUES (?, ?, ?, ?, ?)").run(row.rowid, item.id, item.title, [item.artist, ...(item.artists ?? []), item.albumArtist].filter(Boolean).join(" "), item.album);
    db.query("DELETE FROM library_music_artists WHERE itemId = ?").run(item.id);
    if (item.kind === "audio") for (const name of [...(item.artists ?? []), ...(item.albumArtist ? [item.albumArtist] : [])]) {
      db.query("INSERT OR IGNORE INTO library_music_artists (itemId, artistId, name) VALUES (?, ?, ?)").run(item.id, musicArtistId(name), name);
    }
  });

  async function runScan(source: SourceRow): Promise<LibrarySource> {
    const scanId = crypto.randomUUID();
    const executable = options.ffprobePath === undefined ? Bun.which("ffprobe") : options.ffprobePath;
    let metadataFailures = 0;
    let videosWithoutProbe = 0;
    const pending = new Set<Promise<void>>();
    try {
      assertOpen();
      let root: string;
      try {
        root = await realpath(source.path);
        if (root !== source.path || !(await lstat(root)).isDirectory()) throw new Error();
      } catch {
        db.query("UPDATE library_sources SET status = 'unavailable', error = 'Folder is unavailable. Reconnect the drive or network mount, then scan again.' WHERE id = ?").run(source.id);
        return getSource(source.id)!;
      }
      const inspect = async (path: string) => {
        assertOpen();
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || !within(root, await realpath(path))) return;
        const localPath = relative(root, path);
        const stored = db.query<Omit<ItemRow, "artists"> & { artists: string }, [string, string]>("SELECT * FROM library_items WHERE sourceId = ? AND path = ?").get(source.id, localPath);
        const previous = stored ? { ...stored, artists: JSON.parse(stored.artists) as string[] } : null;
        const unchanged = previous?.size === info.size && previous.modified === info.mtimeMs;
        const kind = videoExtensions.has(extname(path).slice(1).toLowerCase()) ? "video" : "audio";
        if (kind === "video" && !executable) videosWithoutProbe++;
        if (previous && unchanged && (kind === "audio" ? previous.metadataVersion === musicMetadataVersion && previous.probed : previous.probed || !executable)) {
          db.query("UPDATE library_items SET seenScan = ?, available = 1 WHERE id = ?").run(scanId, previous.id);
          return;
        }
        assertOpen();
        const music = kind === "audio" ? await readMusicMetadata(path, info.size) : null;
        const metadata = kind === "audio" ? music : executable ? await probe(path, executable) : null;
        const retained = !metadata && unchanged ? previous : null;
        assertOpen();
        if ((kind === "audio" || executable) && !metadata) metadataFailures++;
        saveItem({ id: previous?.id ?? crypto.randomUUID(), sourceId: source.id, path: localPath,
          title: metadata?.title ?? retained?.title ?? basename(path, extname(path)), kind, duration: metadata?.duration ?? retained?.duration ?? null,
          artist: metadata?.artist ?? retained?.artist ?? null, album: metadata?.album ?? retained?.album ?? null, size: info.size, modified: info.mtimeMs,
          artists: music?.artists ?? retained?.artists ?? [], albumArtist: music?.albumArtist ?? retained?.albumArtist ?? null, albumId: music?.albumId ?? retained?.albumId ?? null,
          discNumber: music?.discNumber ?? retained?.discNumber ?? null, trackNumber: music?.trackNumber ?? retained?.trackNumber ?? null, artworkId: music?.artwork?.id ?? retained?.artworkId ?? null,
          metadataVersion: kind === "audio" ? musicMetadataVersion : 0,
          probed: metadata ? 1 : 0, available: true }, scanId, music?.artwork ?? null);
      };
      let failure: unknown;
      for await (const path of files(root)) {
        if (failure) throw failure;
        let task: Promise<void>;
        task = inspect(path).catch(error => { failure = error; }).finally(() => pending.delete(task));
        pending.add(task);
        if (pending.size >= 2) await Promise.race(pending);
      }
      await Promise.all(pending);
      if (failure) throw failure;
      assertOpen();
      db.transaction(() => {
        db.query("UPDATE library_items SET available = 0 WHERE sourceId = ? AND seenScan <> ?").run(source.id, scanId);
        db.query("DELETE FROM library_artwork WHERE id NOT IN (SELECT artworkId FROM library_items WHERE artworkId IS NOT NULL)").run();
        db.query("UPDATE library_sources SET status = 'ready', lastScanned = ?, error = NULL, warning = ? WHERE id = ?")
          .run(Date.now(), [videosWithoutProbe ? "Install ffprobe to read video durations and tags. Files are still playable." : null,
            metadataFailures ? `Could not read metadata from ${metadataFailures} file${metadataFailures === 1 ? "" : "s"}. Audio metadata is limited to 512 MiB files.` : null].filter(Boolean).join(" ") || null, source.id);
      })();
    } catch (error) {
      await Promise.all(pending);
      db.query("UPDATE library_sources SET status = 'error', error = ? WHERE id = ?")
        .run(closing ? "Scan interrupted." : error instanceof Error ? `Scan failed: ${error.message}` : "Scan failed.", source.id);
    } finally {
      notify();
    }
    return getSource(source.id)!;
  }

  return {
    listSources(): LibrarySource[] { return db.query<SourceRow, []>(`${sourceQuery} ORDER BY s.name COLLATE NOCASE, s.id`).all(); },
    async addSource(path: string): Promise<LibrarySource> {
      assertOpen();
      if (typeof path !== "string" || !isAbsolute(path) || path.length > 4096 || /[\0\r\n]/.test(path)) throw new Error("Choose an absolute folder path on the player.");
      let root: string;
      try { root = await realpath(path); if (!(await lstat(root)).isDirectory()) throw new Error(); }
      catch { throw new Error("The selected folder cannot be opened."); }
      assertOpen();
      const id = crypto.randomUUID();
      db.query("INSERT OR IGNORE INTO library_sources (id, name, path) VALUES (?, ?, ?)").run(id, basename(root) || root, root);
      notify();
      return db.query<SourceRow, [string]>(`${sourceQuery} WHERE s.path = ?`).get(root)!;
    },
    scan(sourceId: string): Promise<LibrarySource> {
      assertOpen();
      const existing = scans.get(sourceId);
      if (existing) return existing;
      const source = getSource(sourceId);
      if (!source) throw new Error("Library folder not found.");
      db.query("UPDATE library_sources SET status = 'scanning', error = NULL WHERE id = ?").run(sourceId);
      const job = scanQueue.then(() => runScan(source)).finally(() => scans.delete(sourceId));
      scans.set(sourceId, job);
      scanQueue = job.catch(() => {});
      notify();
      return job;
    },
    search(options: { query?: string; offset?: number; limit?: number; artistId?: string } = {}): LibrarySearch {
      const { offset, limit } = page(options);
      const query = (options.query ?? "").trim().slice(0, 200);
      const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (query && terms.length === 0) return { items: [], total: 0, offset, limit };
      const match = terms.map(term => `"${term}"*`).join(" AND ");
      const clauses = [match ? "i.id IN (SELECT id FROM library_search WHERE library_search MATCH ?)" : "", options.artistId ? "i.id IN (SELECT itemId FROM library_music_artists WHERE artistId = ?)" : ""].filter(Boolean);
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const args = [...(match ? [match] : []), ...(options.artistId ? [options.artistId] : [])];
      const total = db.query<{ count: number }, string[]>(`SELECT COUNT(*) AS count FROM library_items i ${where}`).get(...args)!.count;
      const rows = db.query<PublicItemRow, (string | number)[]>(`
        SELECT ${itemColumns}
        FROM library_items i JOIN library_sources s ON s.id = i.sourceId ${where} ORDER BY i.title COLLATE NOCASE, i.id LIMIT ? OFFSET ?`)
        .all(...args, limit, offset);
      return { items: rows.map(publicItem), total, offset, limit };
    },
    getItem(id: string): LibraryItem | null {
      const row = db.query<PublicItemRow, [string]>(`
        SELECT ${itemColumns}
        FROM library_items i JOIN library_sources s ON s.id = i.sourceId WHERE i.id = ?`).get(id);
      return row ? publicItem(row) : null;
    },
    musicArtists(options: { query?: string; offset?: number; limit?: number } = {}): MusicArtists {
      const { offset, limit } = page(options);
      const pattern = searchPattern(options.query);
      const total = db.query<{ count: number }, [string]>(`SELECT COUNT(DISTINCT artistId) AS count FROM library_music_artists WHERE name LIKE ? ESCAPE '\\'`).get(pattern)!.count;
      const items = db.query<MusicArtist, [string, number, number]>(`SELECT a.artistId AS id, MIN(a.name) AS name,
        COUNT(DISTINCT i.albumId) AS albumCount, COUNT(*) AS trackCount, MIN(i.artworkId) AS artworkId
        FROM library_music_artists a JOIN library_items i ON i.id = a.itemId WHERE a.name LIKE ? ESCAPE '\\'
        GROUP BY a.artistId ORDER BY name COLLATE NOCASE, a.artistId LIMIT ? OFFSET ?`).all(pattern, limit, offset);
      return { items, total, offset, limit };
    },
    musicAlbums(options: { artistId?: string; query?: string; offset?: number; limit?: number } = {}): MusicAlbums {
      const { offset, limit } = page(options);
      const where = `i.albumId IS NOT NULL AND (i.album LIKE ? ESCAPE '\\' OR i.albumArtist LIKE ? ESCAPE '\\')${options.artistId ?
        " AND i.albumId IN (SELECT j.albumId FROM library_items j JOIN library_music_artists a ON a.itemId = j.id WHERE a.artistId = ?)" : ""}`;
      const pattern = searchPattern(options.query);
      const args = options.artistId ? [pattern, pattern, options.artistId] : [pattern, pattern];
      const total = db.query<{ count: number }, string[]>(`SELECT COUNT(DISTINCT i.albumId) AS count FROM library_items i WHERE ${where}`).get(...args)!.count;
      const items = db.query<MusicAlbum, (string | number)[]>(`SELECT ${albumColumns} FROM library_items i WHERE ${where}
        GROUP BY i.albumId ORDER BY title COLLATE NOCASE, artist COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...args, limit, offset);
      return { items, total, offset, limit };
    },
    albumTracks(id: string): { album: MusicAlbum; items: LibraryItem[] } {
      const album = db.query<MusicAlbum, [string]>(`SELECT ${albumColumns} FROM library_items i WHERE i.albumId = ? GROUP BY i.albumId`).get(id);
      if (!album) throw new Error("Music album not found.");
      if (album.trackCount > 500) throw new Error("This album has more than 500 tracks. Queue tracks from All media instead.");
      const rows = db.query<PublicItemRow, [string]>(`SELECT ${itemColumns} FROM library_items i
        JOIN library_sources s ON s.id = i.sourceId WHERE i.albumId = ?
        ORDER BY i.discNumber IS NULL, i.discNumber, i.trackNumber IS NULL, i.trackNumber, i.title COLLATE NOCASE, i.id LIMIT 500`).all(id);
      return { album, items: rows.map(publicItem) };
    },
    artwork(id: string): { data: Uint8Array; mimeType: string } | null {
      if (!/^[a-f0-9]{64}$/.test(id)) return null;
      return db.query<{ data: Uint8Array; mimeType: string }, [string]>("SELECT data, mimeType FROM library_artwork WHERE id = ?").get(id);
    },
    async getPlayable(id: string): Promise<{ source: string; title: string }> {
      assertOpen();
      const item = db.query<{ title: string; path: string; root: string }, [string]>(`
        SELECT i.title, i.path, s.path AS root FROM library_items i JOIN library_sources s ON s.id = i.sourceId WHERE i.id = ?`).get(id);
      if (!item) throw new Error("Library item not found.");
      try {
        const root = await realpath(item.root);
        const path = join(root, item.path);
        const canonical = await realpath(path);
        if (root !== item.root || !within(root, canonical) || (await lstat(path)).isSymbolicLink() || !(await lstat(canonical)).isFile()) throw new Error();
        return { source: pathToFileURL(canonical).href, title: item.title };
      } catch {
        if (!closing) {
          db.query("UPDATE library_items SET available = 0 WHERE id = ?").run(id);
          notify();
        }
        throw new Error("This file is unavailable. Reconnect its drive or scan the folder again.");
      }
    },
    async close() {
      closing = true;
      for (const process of probes) process.kill("SIGKILL");
      await scanQueue;
      db.close();
    },
  };
}

export type Library = ReturnType<typeof createLibrary>;
