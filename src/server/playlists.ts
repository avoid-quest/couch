import { Database } from "./sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlaylistLoadMode, PlaylistSource, SavedPlaylist, SavedPlaylistSummary } from "../shared/playlists";
import type { PlaybackActor, QueueEntry } from "../shared/protocol";
import { ControllerError } from "./devices";
import { ProviderError } from "./providers/http";
import { CHANGED_ELSEWHERE, QUEUE_FULL } from "./messages";

type Options = {
  databasePath: string;
  onChange: () => void;
  queue: (playedBy?: PlaybackActor) => QueueEntry[];
  upNext?: (playedBy?: PlaybackActor) => QueueEntry[];
  loadQueue: (entries: QueueEntry[], mode: PlaylistLoadMode, authorize?: () => void, playedBy?: PlaybackActor, contextTitle?: string) => void;
  resolveSource?: (source: PlaylistSource) => Promise<{ name: string; entries: QueueEntry[] }>;
};
type Row = Omit<SavedPlaylist, "entries" | "source"> & { entries: string; source: string | null };

class PlaylistError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const identifier = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const methods = (allow: string) => Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: allow } });
const columns = "id, name, revision, updatedAt, source, entries";
const sourceProviders = ["youtube", "raiplay", "bandcamp", "streamingcommunity", "movies123", "animesaturn", "animeunity"];

function playlistName(value: unknown) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) throw new PlaylistError("Use a playlist name with 1 to 80 characters.");
  const name = value.trim().normalize("NFC");
  if (!name || name.length > 80) throw new PlaylistError("Use a playlist name with 1 to 80 characters.");
  return name;
}

async function body(request: Request) {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new PlaylistError("Send a JSON object.");
  if (Number(request.headers.get("Content-Length")) > 8192) throw new PlaylistError("The playlist command is too large.", 413);
  const text = await request.text().catch(() => { throw new PlaylistError("Couldn't read the playlist command."); });
  if (text.length > 8192) throw new PlaylistError("The playlist command is too large.", 413);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new PlaylistError("Invalid JSON body."); }
  if (!object(value)) throw new PlaylistError("Send a JSON object.");
  return value;
}

function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new PlaylistError("Invalid playlist command.");
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

function originalSource(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  return /^iptv:[a-f0-9]{64}$/.test(value) || /^radio:[\w-]{1,80}$/.test(value) || httpUrl(value.startsWith("web:") ? value.slice(4) : value);
}

function playlistSource(value: unknown): PlaylistSource {
  if (!object(value) || !sourceProviders.includes(String(value.provider)) || typeof value.url !== "string" || !value.url || value.url.length > 2048) {
    throw new PlaylistError("Choose a YouTube playlist, RaiPlay programme, StreamingCommunity film or series, 123MoviesFree film or season, AnimeSaturn or AnimeUnity anime, or Bandcamp album to save.");
  }
  fields(value, ["provider", "url"]);
  return { provider: value.provider as PlaylistSource["provider"], url: value.url };
}

function resolvedSource(resolve: Options["resolveSource"], source: PlaylistSource): Promise<{ name: string; entries: QueueEntry[] }> {
  if (!resolve) return Promise.reject(new PlaylistError("Saving from sources is not available on this TV.", 503));
  return resolve(source).catch(reason => {
    if (reason instanceof PlaylistError) throw reason;
    if (reason instanceof ProviderError) throw new PlaylistError(reason.message, reason.status);
    throw new PlaylistError(reason instanceof Error && reason.message ? reason.message : "Couldn't read this source list. Try again.", 502);
  });
}

// Queue sources are original catalog references or user-selected URLs. Resolved
// provider streams belong to player loads and never enter this table.
export function capturePlaylistEntries(queue: QueueEntry[]): QueueEntry[] {
  queue = queue.filter(entry => !entry.liveSourceId);
  if (!queue.length) throw new PlaylistError("Add something to the queue before saving it.");
  if (queue.length > 500) throw new PlaylistError("A playlist can contain up to 500 entries.");
  const ids = new Set<string>();
  return queue.map(entry => {
    if (!identifier(entry.id) || ids.has(entry.id) || typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 300 || !originalSource(entry.source)) throw new PlaylistError("Up next has an item that can't be saved. Queue it again.");
    ids.add(entry.id);
    return {
      id: entry.id, title: entry.title, source: entry.source,
      ...(httpUrl(entry.thumbnail) ? { thumbnail: entry.thumbnail } : {}),
      ...(typeof entry.duration === "number" && Number.isFinite(entry.duration) && entry.duration >= 0 ? { duration: entry.duration } : {}),
      ...(typeof entry.live === "boolean" ? { live: entry.live } : {}),
      ...(entry.kind === "radio" ? { kind: entry.kind } : {}),
      ...(entry.quality && ["auto", "best", "1080p", "720p", "480p"].includes(entry.quality) ? { quality: entry.quality } : {}),
      ...(typeof entry.automaticTitle === "boolean" ? { automaticTitle: entry.automaticTitle } : {}),
      ...(typeof entry.subtitle === "string" ? { subtitle: entry.subtitle.slice(0, 300) } : {}),
      ...(typeof entry.description === "string" ? { description: entry.description.slice(0, 2000) } : {}),
      ...(entry.creator ? { creator: { title: entry.creator.title, url: entry.creator.url } } : {}),
      ...(entry.collection ? { collection: { title: entry.collection.title, url: entry.collection.url, ...(entry.collection.parent ? {parent: {...entry.collection.parent}} : {}), ...(entry.collection.index === undefined ? {} : { index: entry.collection.index }) } } : {}),
    };
  });
}

function sourceOf(value: string | null): PlaylistSource | null {
  return value ? JSON.parse(value) as PlaylistSource : null;
}

function view(row: Row): SavedPlaylist {
  const entries = JSON.parse(row.entries) as QueueEntry[];
  return { ...row, source: sourceOf(row.source), entries: entries.map(({ source: _source, automaticTitle: _automaticTitle, ...entry }) => entry) };
}

export function createPlaylists({ databasePath, onChange, queue, upNext, loadQueue, resolveSource }: Options) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS saved_playlists (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL, entries TEXT NOT NULL, source TEXT
  )`);
  db.exec("CREATE TABLE IF NOT EXISTS saved_playlist_undo (token TEXT PRIMARY KEY, playlist TEXT NOT NULL, expiresAt INTEGER NOT NULL)");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(saved_playlists)").all().some(column => column.name === "source")) db.exec("ALTER TABLE saved_playlists ADD COLUMN source TEXT");
  const get = (id: string) => {
    const row = db.query<Row, [string]>(`SELECT ${columns} FROM saved_playlists WHERE id = ?`).get(id);
    if (!row) throw new PlaylistError("Playlist not found.", 404);
    return row;
  };
  const requireRevision = (row: Row, revision: unknown) => {
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new PlaylistError("Use the current playlist revision.");
    if (row.revision !== revision) throw new PlaylistError(CHANGED_ELSEWHERE, 409);
  };
  const uniqueName = (name: string, id = "") => {
    if (db.query("SELECT 1 FROM saved_playlists WHERE name_key = ? AND id != ?").get(name.toLowerCase(), id)) throw new PlaylistError("A playlist already has that name.", 409);
  };

  return {
    async handle(request: Request, authorize = () => {}, playedBy?: PlaybackActor): Promise<Response> {
      const { pathname } = new URL(request.url);
      try {
        if (pathname === "/api/playlists") {
          if (request.method === "GET") {
            const playlists = db.query<Row, []>(`SELECT ${columns} FROM saved_playlists ORDER BY name_key, id`).all()
              .map(({ source, entries, ...summary }): SavedPlaylistSummary => {
                const items = JSON.parse(entries) as QueueEntry[];
                return { ...summary, source: sourceOf(source), entryCount: items.length, totalDuration: items.every(item => !item.live && Number.isFinite(item.duration)) ? items.reduce((total, item) => total + item.duration!, 0) : null };
              });
            return Response.json({ playlists });
          }
          if (request.method !== "POST") return methods("GET, POST");
          const input = await body(request);
          authorize();
          const source = input.source === undefined ? undefined : playlistSource(input.source);
          fields(input, source ? ["source"] : ["name", "scope"]);
          if (input.scope !== undefined && input.scope !== "upNext") throw new PlaylistError("Choose a valid queue scope.");
          if (input.scope === "upNext" && !upNext) throw new PlaylistError("Up next is not available on this TV.", 503);
          // Resolve source lists before opening the write transaction so a vanished
          // playlist or a failed resolver leaves no partial save behind.
          const resolution = source ? await resolvedSource(resolveSource, source) : { name: input.name, entries: input.scope === "upNext" ? upNext!(playedBy) : queue(playedBy) };
          if (source) authorize();
          const name = playlistName(resolution.name);
          const entries = capturePlaylistEntries(resolution.entries);
          const row = db.transaction(() => {
            if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM saved_playlists").get()!.count >= 100) throw new PlaylistError("You can save up to 100 playlists.");
            uniqueName(name);
            const saved: Row = { id: crypto.randomUUID(), name, revision: 1, updatedAt: Date.now(), entries: JSON.stringify(entries), source: source ? JSON.stringify(source) : null };
            db.query("INSERT INTO saved_playlists VALUES (?, ?, ?, ?, ?, ?, ?)").run(saved.id, name, name.toLowerCase(), saved.revision, saved.updatedAt, saved.entries, saved.source);
            return saved;
          })();
          onChange();
          return Response.json({ playlist: view(row) }, { status: 201 });
        }
        if (pathname === "/api/playlists/restore") {
          if (request.method !== "POST") return methods("POST");
          const input = await body(request);
          authorize();
          fields(input, ["token"]);
          if (typeof input.token !== "string" || !identifier(input.token)) throw new PlaylistError("Choose a list to restore.");
          const token = input.token;
          const row = db.transaction(() => {
            const saved = db.query<{ playlist: string; expiresAt: number }, [string]>("SELECT playlist, expiresAt FROM saved_playlist_undo WHERE token = ?").get(token);
            if (!saved || saved.expiresAt <= Date.now()) throw new PlaylistError("Undo has expired.", 404);
            const playlist = JSON.parse(saved.playlist) as Row;
            if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM saved_playlists").get()!.count >= 100) throw new PlaylistError("You can save up to 100 playlists.");
            uniqueName(playlist.name);
            db.query("INSERT INTO saved_playlists VALUES (?, ?, ?, ?, ?, ?, ?)").run(playlist.id, playlist.name, playlist.name.toLowerCase(), playlist.revision, playlist.updatedAt, playlist.entries, playlist.source);
            db.query("DELETE FROM saved_playlist_undo WHERE token = ?").run(token);
            return playlist;
          })();
          onChange();
          return Response.json({ playlist: view(row) });
        }
        const match = /^\/api\/playlists\/([\w-]{1,80})(?:\/(load))?$/.exec(pathname);
        if (!match) throw new PlaylistError("Playlist endpoint not found.", 404);
        const id = match[1]!;
        if (match[2]) {
          if (request.method !== "POST") return methods("POST");
          const input = await body(request);
          authorize();
          fields(input, ["revision", "mode"]);
          if (!["append", "replace", "play"].includes(String(input.mode))) throw new PlaylistError("Choose whether to add, replace or play the playlist.");
          const row = get(id);
          requireRevision(row, input.revision);
          const entries = JSON.parse(row.entries) as QueueEntry[];
          if (!entries.length) throw new PlaylistError("This playlist is empty. Save a queue before loading it.");
          if (input.mode === "append" && queue(playedBy).length + entries.length > 500) throw new PlaylistError(QUEUE_FULL);
          loadQueue(entries, input.mode as PlaylistLoadMode, authorize, playedBy, row.name);
          return Response.json({ ok: true });
        }
        if (request.method === "GET") return Response.json({ playlist: view(get(id)) });
        if (!["POST", "DELETE"].includes(request.method)) return methods("GET, POST, DELETE");
        const input = await body(request);
        authorize();
        const result = db.transaction(() => {
          const row = get(id);
          requireRevision(row, input.revision);
          if (request.method === "DELETE") {
            fields(input, ["revision"]);
            const token = crypto.randomUUID();
            db.query("DELETE FROM saved_playlist_undo WHERE expiresAt <= ?").run(Date.now());
            db.query("DELETE FROM saved_playlists WHERE id = ?").run(id);
            db.query("INSERT INTO saved_playlist_undo VALUES (?, ?, ?)").run(token, JSON.stringify(row), Date.now() + 15_000);
            return { changed: true, playlist: null, undoToken: token };
          }
          const entries = JSON.parse(row.entries) as QueueEntry[];
          switch (input.operation) {
            case "rename":
              fields(input, ["revision", "operation", "name"]);
              row.name = playlistName(input.name);
              uniqueName(row.name, id);
              break;
            case "saveQueue":
              fields(input, ["revision", "operation"]);
              row.entries = JSON.stringify(capturePlaylistEntries(queue(playedBy)));
              break;
            case "remove": case "move": {
              fields(input, input.operation === "remove" ? ["revision", "operation", "entryId"] : ["revision", "operation", "entryId", "beforeEntryId"]);
              if (!identifier(input.entryId)) throw new PlaylistError("Choose a playlist entry.");
              const index = entries.findIndex(entry => entry.id === input.entryId);
              if (index < 0) throw new PlaylistError("This entry is no longer in the playlist.", 404);
              if (input.operation === "move") {
                if (input.beforeEntryId !== null && !identifier(input.beforeEntryId)) throw new PlaylistError("Choose a valid playlist position.");
                if (input.beforeEntryId !== null && !entries.some(entry => entry.id === input.beforeEntryId)) throw new PlaylistError("This destination is no longer in the playlist.", 404);
                if (input.entryId === input.beforeEntryId) break;
              }
              const [entry] = entries.splice(index, 1);
              if (input.operation === "move") entries.splice(input.beforeEntryId === null ? entries.length : entries.findIndex(entry => entry.id === input.beforeEntryId), 0, entry!);
              row.entries = JSON.stringify(entries);
              break;
            }
            default: throw new PlaylistError("Choose a valid playlist operation.");
          }
          const previous = get(id);
          if (row.name === previous.name && row.entries === previous.entries) return { changed: false, playlist: view(row), undoToken: null };
          row.revision++;
          row.updatedAt = Date.now();
          db.query("UPDATE saved_playlists SET name = ?, name_key = ?, revision = ?, updatedAt = ?, entries = ? WHERE id = ?").run(row.name, row.name.toLowerCase(), row.revision, row.updatedAt, row.entries, id);
          return { changed: true, playlist: view(row), undoToken: null };
        })();
        if (result.changed) onChange();
        return Response.json(result.playlist ? { playlist: result.playlist } : { ok: true, undoToken: result.undoToken });
      } catch (error) {
        return Response.json({ error: error instanceof PlaylistError || error instanceof ControllerError ? error.message : "Couldn't update the list or load Up next." }, { status: error instanceof PlaylistError || error instanceof ControllerError ? error.status : 500 });
      }
    },
    close() { db.close(); },
  };
}
