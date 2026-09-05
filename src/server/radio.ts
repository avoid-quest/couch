import { Database } from "bun:sqlite";
import { Resolver } from "node:dns/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RadioPlaylist, RadioStation } from "../shared/radio";
import { radioHttpUrl as httpUrl, radioId, readRadioPlaylist } from "./radio-playlists";

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export class RadioError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function station(value: unknown): RadioStation {
  if (!object(value) || typeof value.id !== "string" || !uuid.test(value.id)
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 200
    || typeof value.countryCode !== "string" || !/^(?:[A-Z]{2})?$/.test(value.countryCode)
    || typeof value.codec !== "string" || value.codec.length > 40
    || typeof value.bitrate !== "number" || !Number.isInteger(value.bitrate) || value.bitrate < 0 || value.bitrate > 1_000_000) {
    throw new RadioError("Invalid radio station.");
  }
  const url = httpUrl(value.url);
  const homepage = value.homepage === null ? null : httpUrl(value.homepage);
  if (!url || (value.homepage !== null && !homepage)) throw new RadioError("Radio stations need an HTTP or HTTPS URL without embedded credentials.");
  const metadata: Partial<RadioStation> = {};
  if (value.logoUrl !== undefined) {
    const logoUrl = httpUrl(value.logoUrl);
    if (!logoUrl) throw new RadioError("Station logos need an HTTP or HTTPS URL without embedded credentials.");
    metadata.logoUrl = logoUrl;
  }
  for (const key of ["groupTitle", "tvgId"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || value[key].length > 200 || /[\u0000-\u001f\u007f]/.test(value[key])) throw new RadioError("Invalid station metadata.");
    metadata[key] = value[key].trim();
  }
  if (value.sourceId !== undefined) {
    if (typeof value.sourceId !== "string" || !uuid.test(value.sourceId)) throw new RadioError("Invalid radio playlist ID.");
    metadata.sourceId = value.sourceId.toLowerCase();
  }
  return { id: value.id.toLowerCase(), name: value.name.trim(), url, homepage, countryCode: value.countryCode, codec: value.codec, bitrate: value.bitrate, ...metadata };
}

function providerStation(value: unknown): RadioStation | null {
  if (!object(value)) return null;
  try {
    return station({
      id: value.stationuuid,
      name: typeof value.name === "string" ? value.name.slice(0, 200) : value.name,
      url: httpUrl(value.url_resolved) ?? httpUrl(value.url),
      homepage: httpUrl(value.homepage),
      countryCode: typeof value.countrycode === "string" && /^[A-Z]{2}$/.test(value.countrycode) ? value.countrycode : "",
      codec: typeof value.codec === "string" ? value.codec.slice(0, 40) : "",
      bitrate: typeof value.bitrate === "number" ? value.bitrate : 0,
    });
  } catch { return null; }
}

// Radio Browser documents SRV discovery as an alternative to A + reverse DNS.
// https://api.radio-browser.info/
async function discoverServers() {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });
  const records = await resolver.resolveSrv("_api._tcp.radio-browser.info");
  const servers = records.filter(record => /^[a-z\d.-]+\.api\.radio-browser\.info\.?$/i.test(record.name))
    .map(record => `https://${record.name.replace(/\.$/, "")}${record.port === 443 ? "" : `:${record.port}`}`);
  for (let index = servers.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [servers[index], servers[other]] = [servers[other]!, servers[index]!];
  }
  return [...new Set(servers)];
}

export function createRadio({ databasePath, fetch: request = globalThis.fetch, discover = discoverServers, onChange = () => {} }: {
  databasePath: string;
  fetch?: typeof globalThis.fetch;
  discover?: () => Promise<string[]>;
  onChange?: () => void;
}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
  db.run("CREATE TABLE IF NOT EXISTS radio_favorites (id TEXT PRIMARY KEY, station TEXT NOT NULL)");
  db.run(`
    CREATE TABLE IF NOT EXISTS radio_playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, updated_at INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS radio_playlist_stations (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, position INTEGER NOT NULL, station TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS radio_playlist_order ON radio_playlist_stations(source_id, position);
  `);
  const cache = new Map<string, { expires: number; stations: RadioStation[] }>();
  const pending = new Map<string, Promise<RadioStation[]>>();
  const refreshes = new Map<string, { promise: Promise<RadioPlaylist>; controller: AbortController }>();
  const shutdown = new AbortController();
  let closed = false;
  let directory: { expires: number; servers: string[] } | undefined;
  let discovery: Promise<string[]> | undefined;
  const assertOpen = () => { if (closed) throw new RadioError("The radio catalog is closing.", 503); };
  const playlistSelect = "SELECT p.id, p.name, p.url, p.updated_at AS updatedAt, p.error, (SELECT COUNT(*) FROM radio_playlist_stations s WHERE s.source_id = p.id) AS stationCount FROM radio_playlists p";
  const getPlaylist = (id: string) => db.query<RadioPlaylist, [string]>(`${playlistSelect} WHERE p.id = ?`).get(id);
  const requirePlaylist = (id: string) => {
    assertOpen();
    if (!uuid.test(id)) throw new RadioError("Invalid radio playlist ID.");
    const playlist = getPlaylist(id.toLowerCase());
    if (!playlist) throw new RadioError("Radio playlist not found.", 404);
    return playlist;
  };

  function refreshPlaylist(id: string): Promise<RadioPlaylist> {
    const playlist = requirePlaylist(id);
    id = playlist.id;
    const pending = refreshes.get(id);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, shutdown.signal, AbortSignal.timeout(10_000)]);
    const promise = (async () => {
      try {
        const stations = await readRadioPlaylist(playlist.url, id, request, signal);
        assertOpen();
        signal.throwIfAborted();
        db.transaction(() => {
          db.query("DELETE FROM radio_playlist_stations WHERE source_id = ?").run(id);
          const insert = db.query("INSERT INTO radio_playlist_stations VALUES (?, ?, ?, ?)");
          const updateFavorite = db.query("UPDATE radio_favorites SET station = ? WHERE id = ?");
          stations.forEach((station, index) => {
            const json = JSON.stringify(station);
            insert.run(station.id, id, index, json);
            updateFavorite.run(json, station.id);
          });
          db.query("UPDATE radio_playlists SET updated_at = ?, error = NULL WHERE id = ?").run(Date.now(), id);
        })();
        onChange();
        return getPlaylist(id)!;
      } catch (error) {
        if (closed) throw new RadioError("The radio catalog is closing.", 503);
        if (controller.signal.aborted) throw new RadioError("Radio playlist removed.", 404);
        const message = signal.aborted ? "The playlist server took too long to respond." : error instanceof Error ? error.message.slice(0, 300) : "The radio playlist could not be loaded.";
        db.query("UPDATE radio_playlists SET error = ? WHERE id = ?").run(message, id);
        onChange();
        throw new RadioError(message, 502);
      } finally { if (refreshes.get(id)?.controller === controller) refreshes.delete(id); }
    })();
    refreshes.set(id, { promise, controller });
    return promise;
  }

  async function servers() {
    if (directory && directory.expires > Date.now()) return directory.servers;
    discovery ??= discover().then(result => {
      if (!result.length) throw new Error("No radio directory servers available.");
      directory = { servers: result, expires: Date.now() + 30 * 60_000 };
      return result;
    }).finally(() => { discovery = undefined; });
    return discovery;
  }

  async function searchProvider(query: URLSearchParams): Promise<RadioStation[]> {
    try {
      for (const server of (await servers()).slice(0, 3)) {
        try {
          const response = await request(`${server}/json/stations/search?${query}`, {
            headers: { "User-Agent": "Couch/0.1", Accept: "application/json" },
            signal: AbortSignal.timeout(3_000),
          });
          if (!response.ok) { await response.body?.cancel(); continue; }
          const raw: unknown = await response.json();
          if (!Array.isArray(raw)) continue;
          return [...new Map(raw.slice(0, 50).map(providerStation).filter(value => value !== null).map(value => [value.id, value])).values()];
        } catch { /* Try the next discovered mirror. */ }
      }
    } catch { /* Discovery failures use the same recoverable directory error. */ }
    directory = undefined;
    throw new RadioError("Radio Browser is unavailable. Try again shortly. Your saved stations are still available.", 503);
  }

  return {
    async search({ q = "", countrycode = "" }: { q?: string; countrycode?: string } = {}) {
      assertOpen();
      q = q.trim();
      countrycode = countrycode.trim().toUpperCase();
      if (q.length > 100 || !/^(?:[A-Z]{2})?$/.test(countrycode)) throw new RadioError("Use a station name of up to 100 characters and a two-letter country code.");
      const query = new URLSearchParams({ name: q, countrycode, limit: "50", hidebroken: "true", order: "clickcount", reverse: "true" });
      const key = query.toString();
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.stations;
      let result = pending.get(key);
      if (!result) {
        result = searchProvider(query).then(stations => {
          if (cache.size >= 50) cache.delete(cache.keys().next().value!);
          cache.set(key, { stations, expires: Date.now() + 5 * 60_000 });
          return stations;
        }).finally(() => { pending.delete(key); });
        pending.set(key, result);
      }
      return result;
    },
    favorites(): RadioStation[] {
      assertOpen();
      return db.query<{ station: string }, []>("SELECT station FROM radio_favorites ORDER BY json_extract(station, '$.name') COLLATE NOCASE").all()
        .flatMap(row => { try { return [station(JSON.parse(row.station))]; } catch { return []; } });
    },
    saveFavorite(value: unknown) {
      assertOpen();
      let favorite = station(value);
      const current = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE id = ?").get(favorite.id);
      if (current) favorite = station(JSON.parse(current.station));
      db.query("INSERT INTO radio_favorites VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET station = excluded.station").run(favorite.id, JSON.stringify(favorite));
      onChange();
      return favorite;
    },
    removeFavorite(id: string) {
      assertOpen();
      if (!uuid.test(id)) throw new RadioError("Invalid radio station ID.");
      const result = db.query("DELETE FROM radio_favorites WHERE id = ?").run(id.toLowerCase());
      if (result.changes) onChange();
    },
    playlists(): RadioPlaylist[] {
      assertOpen();
      return db.query<RadioPlaylist, []>(`${playlistSelect} ORDER BY p.rowid`).all();
    },
    async addPlaylist({ name, url }: { name: string; url: string }): Promise<RadioPlaylist> {
      assertOpen();
      if (typeof name !== "string" || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new RadioError("Enter a playlist name of 1 to 200 characters.");
      const parsed = httpUrl(typeof url === "string" ? url.trim() : url);
      if (!parsed) throw new RadioError("Enter an HTTP or HTTPS playlist URL without credentials or header directives.");
      const canonical = new URL(parsed);
      canonical.hash = "";
      url = canonical.href;
      const id = radioId(`playlist:${url}`);
      if (!getPlaylist(id) && db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM radio_playlists").get()!.count >= 30) throw new RadioError("You can save up to 30 radio playlists.");
      db.query("INSERT INTO radio_playlists (id, name, url) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").run(id, name.trim(), url);
      return refreshPlaylist(id);
    },
    refreshPlaylist,
    removePlaylist(id: string) {
      const playlist = requirePlaylist(id);
      refreshes.get(playlist.id)?.controller.abort();
      refreshes.delete(playlist.id);
      db.transaction(() => {
        db.query("DELETE FROM radio_playlist_stations WHERE source_id = ?").run(playlist.id);
        db.query("DELETE FROM radio_playlists WHERE id = ?").run(playlist.id);
      })();
      onChange();
    },
    playlistStations({ playlistId, q = "" }: { playlistId: string; q?: string }): RadioStation[] {
      const playlist = requirePlaylist(playlistId);
      if (typeof q !== "string" || q.length > 100) throw new RadioError("Use a station name of up to 100 characters.");
      const query = q.trim().toLocaleLowerCase();
      return db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE source_id = ? ORDER BY position").all(playlist.id)
        .map(row => station(JSON.parse(row.station))).filter(station => !query || `${station.name} ${station.groupTitle ?? ""}`.toLocaleLowerCase().includes(query));
    },
    getPlayable(id: string): { source: string; title: string; metadata?: { thumbnail: string } } {
      assertOpen();
      if (!uuid.test(id)) throw new RadioError("Invalid radio station ID.");
      id = id.toLowerCase();
      const row = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE id = ?").get(id)
        ?? db.query<{ station: string }, [string]>("SELECT station FROM radio_favorites WHERE id = ?").get(id);
      if (!row) throw new RadioError("Radio station not found. Refresh its playlist or add it again.", 404);
      const current = station(JSON.parse(row.station));
      return { source: current.url, title: current.name, ...(current.logoUrl ? { metadata: { thumbnail: current.logoUrl } } : {}) };
    },
    close() {
      if (closed) return;
      closed = true;
      shutdown.abort();
      db.close();
    },
  };
}
