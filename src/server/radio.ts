import { Database } from "./sqlite";
import { Resolver } from "node:dns/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { avoidRadioPlaylistId, avoidRadioPlaylistUrl, type AvoidRadioCatalog, type RadioPlaylist, type RadioStation, type RadioGuide, radioLabels, radioNow, radioNext, radioMatches } from "../shared/radio";
import { createRadioGuides } from "./radio-guides";
import { guideUrl } from "./iptv-feeds";
import { createRadioMetadata } from "./radio-metadata";
import { radioHttpUrl as httpUrl, radioId, readRadioSource } from "./radio-playlists";

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
    metadata[key] = key === "tvgId" ? value[key] : value[key].trim();
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > 100 || value.tags.some(tag => typeof tag !== "string" || tag.length > 500)) throw new RadioError("Invalid station tags.");
    metadata.tags = radioLabels(value.tags);
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
      tags: typeof value.tags === "string" ? radioLabels(value.tags.slice(0, 10_000).split(",")).slice(0, 100) : [],
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
  const db = new Database(databasePath);
  db.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE IF NOT EXISTS radio_favorites (id TEXT PRIMARY KEY, station TEXT NOT NULL)");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(radio_favorites)").all().some(column => column.name === "position")) {
    db.transaction(() => {
      db.exec("ALTER TABLE radio_favorites ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
      // Existing installs keep their alphabetical reading order as the start order.
      const rows = db.query<{ id: string }, []>("SELECT id FROM radio_favorites ORDER BY json_extract(station, '$.name') COLLATE NOCASE").all();
      for (const [index, row] of rows.entries()) db.query("UPDATE radio_favorites SET position = ? WHERE id = ?").run(index + 1, row.id);
    })();
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS radio_playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, updated_at INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS radio_playlist_stations (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, position INTEGER NOT NULL, station TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS radio_playlist_order ON radio_playlist_stations(source_id, position);
  `);
  for (const column of ["guide_url", "discovered_guide_url"]) {
    if (!db.query<{ name: string }, []>("PRAGMA table_info(radio_playlists)").all().some(row => row.name === column)) db.exec(`ALTER TABLE radio_playlists ADD COLUMN ${column} TEXT`);
  }
  const cache = new Map<string, { expires: number; stations: RadioStation[] }>();
  const pending = new Map<string, Promise<RadioStation[]>>();
  const refreshes = new Map<string, { promise: Promise<RadioPlaylist>; controller: AbortController }>();
  const shutdown = new AbortController();
  const liveMetadata = createRadioMetadata({ fetch: request, signal: shutdown.signal });
  const guides = createRadioGuides({ fetch: request, signal: shutdown.signal });
  let avoidRetryAt = 0;
  let closed = false;
  let directory: { expires: number; servers: string[] } | undefined;
  let discovery: Promise<string[]> | undefined;
  const assertOpen = () => { if (closed) throw new RadioError("The radio catalog is closing.", 503); };
  const playlistSelect = "SELECT p.id, p.name, p.url, p.updated_at AS updatedAt, p.error, p.guide_url AS guideUrl, p.discovered_guide_url AS discoveredGuideUrl, (SELECT COUNT(*) FROM radio_playlist_stations s WHERE s.source_id = p.id) AS stationCount FROM radio_playlists p";
  const getPlaylist = (id: string) => db.query<RadioPlaylist, [string]>(`${playlistSelect} WHERE p.id = ?`).get(id);
  const requirePlaylist = (id: string) => {
    assertOpen();
    if (!uuid.test(id)) throw new RadioError("Invalid radio playlist ID.");
    const playlist = getPlaylist(id.toLowerCase());
    if (!playlist) throw new RadioError("Radio playlist not found.", 404);
    return playlist;
  };

  function refreshPlaylist(id: string, authorize = () => {}): Promise<RadioPlaylist> {
    authorize();
    const playlist = requirePlaylist(id);
    id = playlist.id;
    const pending = refreshes.get(id);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, shutdown.signal, AbortSignal.timeout(10_000)]);
    const promise = (async () => {
      try {
        const { stations, discoveredGuideUrl } = await readRadioSource(playlist.url, id, request, signal);
        authorize();
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
          db.query("UPDATE radio_playlists SET updated_at = ?, discovered_guide_url = ?, error = NULL WHERE id = ?").run(Date.now(), discoveredGuideUrl, id);
        })();
        onChange();
        return getPlaylist(id)!;
      } catch (error) {
        authorize();
        if (closed) throw new RadioError("The radio catalog is closing.", 503);
        if (controller.signal.aborted) throw new RadioError("Radio playlist removed.", 404);
        const message = signal.aborted ? "The playlist server took too long to respond." : error instanceof Error ? error.message.slice(0, 300) : "Couldn't load the radio playlist.";
        db.query("UPDATE radio_playlists SET error = ? WHERE id = ?").run(message, id);
        onChange();
        throw new RadioError(message, 502);
      } finally { if (refreshes.get(id)?.controller === controller) refreshes.delete(id); }
    })();
    refreshes.set(id, { promise, controller });
    return promise;
  }

  async function avoid(refresh = false): Promise<AvoidRadioCatalog> {
    assertOpen();
    db.query("INSERT OR IGNORE INTO radio_playlists (id, name, url) VALUES (?, ?, ?)").run(avoidRadioPlaylistId, "avoid radio", avoidRadioPlaylistUrl);
    let playlist = getPlaylist(avoidRadioPlaylistId)!;
    if (refreshes.has(avoidRadioPlaylistId) || (refresh || !playlist.updatedAt || playlist.updatedAt < Date.now() - 60 * 60_000) && (refresh || avoidRetryAt <= Date.now())) {
      avoidRetryAt = Date.now() + 60_000;
      try { playlist = await refreshPlaylist(avoidRadioPlaylistId); }
      catch { assertOpen(); playlist = getPlaylist(avoidRadioPlaylistId)!; }
    }
    const stations = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE source_id = ? ORDER BY position").all(avoidRadioPlaylistId)
      .map(row => station(JSON.parse(row.station)));
    const { url: _url, guideUrl: _guide, discoveredGuideUrl: _discovered, ...summary } = playlist;
    return { playlist: summary, stations };
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

  async function directoryStations(path: string): Promise<RadioStation[]> {
    try {
      for (const server of (await servers()).slice(0, 3)) {
        try {
          const response = await request(`${server}/json/stations/${path}`, {
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

  const sourceStations = (id: string) => db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE source_id = ? ORDER BY position").all(id).map(row => station(JSON.parse(row.station)));

  async function stationGuide(current: RadioStation, callerSignal?: AbortSignal): Promise<{ guide: RadioGuide; retryAt: number }> {
    const source = current.sourceId ? getPlaylist(current.sourceId) : null;
    const [schedule, live] = await Promise.all([
      source ? guides.get(source, sourceStations(source.id)) : Promise.resolve({ programmes: new Map(), retryAt: Date.now() + 60_000 }),
      source?.url === avoidRadioPlaylistUrl && current.tvgId ? liveMetadata.get(current.tvgId, current.url, callerSignal) : Promise.resolve({ programme: null, retryAt: Date.now() + 60_000 }),
    ]);
    return { guide: { programmes: schedule.programmes.get(current.id) ?? [], live: live.programme }, retryAt: Math.min(schedule.retryAt, live.retryAt) };
  }

  async function programmes(callerSignal?: AbortSignal) {
    const result: Record<string, RadioGuide> = {};
    const signal = AbortSignal.any([shutdown.signal, callerSignal ?? shutdown.signal, AbortSignal.timeout(30_000)]);
    await avoid();
    const sources = db.query<RadioPlaylist, []>(playlistSelect).all();
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
      while (index < sources.length && !signal.aborted) {
        const source = sources[index++]!;
        const stations = sourceStations(source.id);
        const schedule = await guides.get(source, stations);
        if (closed || signal.aborted) return;
        for (const current of stations) {
          const entries = schedule.programmes.get(current.id);
          if (entries?.length) result[current.id] = { programmes: entries, live: null };
        }
        if (source.url === avoidRadioPlaylistUrl) {
          for (let offset = 0; offset < Math.min(stations.length, 50) && !signal.aborted; offset += 3) {
            await Promise.all(stations.slice(offset, Math.min(offset + 3, 50)).map(async current => {
              if (!current.tvgId) return;
              const live = await liveMetadata.get(current.tvgId, current.url, signal);
              if (live.programme && !signal.aborted) result[current.id] = { programmes: schedule.programmes.get(current.id) ?? [], live: live.programme };
            }));
          }
        }
      }
    }));
    return result;
  }

  return {
    metadata: {
      async get(id: string, streamUrl: string, signal?: AbortSignal) {
        if (closed || signal?.aborted) return { programme: null, retryAt: Date.now() + 60_000 };
        const row = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE id = ?").get(id);
        if (!row) return { programme: null, retryAt: Date.now() + 60_000 };
        const current = station(JSON.parse(row.station));
        if (current.url !== streamUrl) return { programme: null, retryAt: Date.now() + 60_000 };
        const { guide, retryAt } = await stationGuide(current, signal);
        if (closed || signal?.aborted) return { programme: null, retryAt: Date.now() + 60_000 };
        const latest = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE id = ?").get(id);
        if (!latest || station(JSON.parse(latest.station)).url !== streamUrl) return { programme: null, retryAt: Date.now() + 60_000 };
        const programme = radioNow(guide, current.id), next = radioNext(guide);
        return { programme, retryAt: Math.min(retryAt, programme?.expiresAt ?? Infinity, next?.start ?? Infinity) };
      },
    },
    programmes,
    avoid,
    async avoidProgrammes(signal?: AbortSignal) {
      return Object.fromEntries(Object.entries(await programmes(signal)).flatMap(([id, guide]) => {
        const current = radioNow(guide, id);
        return current ? [[id, current]] : [];
      }));
    },
    async search({ q = "", countrycode = "" }: { q?: string; countrycode?: string } = {}) {
      assertOpen();
      q = q.trim();
      countrycode = countrycode.trim().toUpperCase();
      if (q.length > 100 || !/^(?:[A-Z]{2})?$/.test(countrycode)) throw new RadioError("Use a station name of up to 100 characters and a two-letter country code.");
      // Omit countrycode when empty to search stations in every country.
      const query = new URLSearchParams({ name: q, ...(countrycode ? { countrycode } : {}), limit: "50", hidebroken: "true", order: "clickcount", reverse: "true" });
      const key = query.toString();
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.stations;
      let result = pending.get(key);
      if (!result) {
        result = directoryStations(`search?${query}`).then(stations => {
          if (cache.size >= 50) cache.delete(cache.keys().next().value!);
          cache.set(key, { stations, expires: Date.now() + 5 * 60_000 });
          return stations;
        }).finally(() => { pending.delete(key); });
        pending.set(key, result);
      }
      return result;
    },
    async getStation(id: string): Promise<RadioStation> {
      assertOpen();
      if (!uuid.test(id)) throw new RadioError("Invalid radio station ID.");
      id = id.toLowerCase();
      const row = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE id = ?").get(id)
        ?? db.query<{ station: string }, [string]>("SELECT station FROM radio_favorites WHERE id = ?").get(id);
      if (row) return station(JSON.parse(row.station));
      for (const { stations, expires } of [...cache.values()].reverse()) {
        const found = expires > Date.now() && stations.find(station => station.id === id);
        if (found) return found;
      }
      const current = (await directoryStations(`byuuid/${id}`)).find(station => station.id === id);
      if (!current) throw new RadioError("Radio station not found. Refresh its playlist or add it again.", 404);
      return current;
    },
    favorites(): RadioStation[] {
      assertOpen();
      return db.query<{ station: string }, []>("SELECT station FROM radio_favorites ORDER BY position, id").all()
        .flatMap(row => { try { return [station(JSON.parse(row.station))]; } catch { return []; } });
    },
    saveFavorite(value: unknown) {
      assertOpen();
      let favorite = station(value);
      const current = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE id = ?").get(favorite.id);
      if (current) favorite = station(JSON.parse(current.station));
      db.query("INSERT INTO radio_favorites (id, station, position) VALUES (?, ?, (SELECT COALESCE(MIN(position), 1) - 1 FROM radio_favorites)) ON CONFLICT(id) DO UPDATE SET station = excluded.station").run(favorite.id, JSON.stringify(favorite));
      onChange();
      return favorite;
    },
    reorderFavorites(order: unknown) {
      assertOpen();
      const ids = Array.isArray(order) && order.length <= 500 && order.every((id): id is string => typeof id === "string" && /^[\w-]{1,80}$/.test(id)) ? order.map(id => id.toLowerCase()) : null;
      if (!ids || !ids.length || new Set(ids).size !== ids.length) throw new RadioError("Send the saved stations in their new order.");
      if (ids.some(id => !db.query("SELECT 1 FROM radio_favorites WHERE id = ?").get(id))) throw new RadioError("Saved stations changed. Try the move again.");
      db.transaction(() => {
        for (const [index, id] of ids.entries()) db.query("UPDATE radio_favorites SET position = ? WHERE id = ?").run(index + 1, id);
      })();
      onChange();
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
    async addPlaylist({ name, url, guideUrl: explicitGuide }: { name: string; url: string; guideUrl?: string | null }, authorize = () => {}): Promise<RadioPlaylist> {
      authorize();
      assertOpen();
      if (typeof name !== "string" || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new RadioError("Enter a playlist name of 1 to 200 characters.");
      const parsed = httpUrl(typeof url === "string" ? url.trim() : url);
      if (!parsed) throw new RadioError("Enter an HTTP or HTTPS playlist URL without credentials or header directives.");
      const canonical = new URL(parsed);
      canonical.hash = "";
      url = canonical.href;
      const id = radioId(`playlist:${url}`);
      if (id !== avoidRadioPlaylistId && !getPlaylist(id) && db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM radio_playlists WHERE id != ?").get(avoidRadioPlaylistId)!.count >= 30) throw new RadioError("You can save up to 30 custom radio playlists.");
      if (typeof explicitGuide === "string" && !explicitGuide.trim()) explicitGuide = null;
      if (explicitGuide !== undefined && explicitGuide !== null) { try { explicitGuide = guideUrl(explicitGuide); } catch { throw new RadioError("Enter an HTTP or HTTPS guide URL without credentials or headers."); } }
      db.query("INSERT INTO radio_playlists (id, name, url) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").run(id, name.trim(), url);
      if (explicitGuide !== undefined) db.query("UPDATE radio_playlists SET guide_url = ? WHERE id = ?").run(explicitGuide, id);
      return refreshPlaylist(id, authorize);
    },
    refreshPlaylist,
    removePlaylist(id: string) {
      const playlist = requirePlaylist(id);
      if (playlist.id === avoidRadioPlaylistId) throw new RadioError("avoid radio is included with Couch and cannot be removed.");
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
        .map(row => station(JSON.parse(row.station))).filter(station => !query || radioMatches(station, query));
    },
    programmeStation(source: string): { id: string; streamUrl: string } | null {
      assertOpen();
      if (!source.startsWith("radio:")) return null;
      const row = db.query<{ station: string }, [string]>("SELECT station FROM radio_playlist_stations WHERE id = ?").get(source.slice(6));
      const current = row ? station(JSON.parse(row.station)) : null;
      return current ? { id: current.id, streamUrl: current.url } : null;
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
