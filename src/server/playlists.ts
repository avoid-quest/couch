import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlaylistLoadMode, SavedPlaylist, SavedPlaylistSummary } from "../shared/playlists";
import type { QueueEntry } from "../shared/protocol";
import { ControllerError } from "./controllers";

type Options = {
  databasePath: string;
  onChange: () => void;
  queue: () => QueueEntry[];
  loadQueue: (entries: QueueEntry[], mode: PlaylistLoadMode, authorize?: () => void) => void;
};
type Row = Omit<SavedPlaylist, "entries"> & { entries: string };

class PlaylistError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const identifier = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const methods = (allow: string) => Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: allow } });
const columns = "id, name, revision, updatedAt, entries";

function playlistName(value: unknown) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) throw new PlaylistError("Use a playlist name with 1 to 80 characters.");
  const name = value.trim().normalize("NFC");
  if (!name || name.length > 80) throw new PlaylistError("Use a playlist name with 1 to 80 characters.");
  return name;
}

async function body(request: Request) {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new PlaylistError("Send a JSON object.");
  if (Number(request.headers.get("Content-Length")) > 8192) throw new PlaylistError("The playlist command is too large.", 413);
  const text = await request.text().catch(() => { throw new PlaylistError("Could not read the playlist command."); });
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
  if (/^iptv:[a-f0-9]{64}$/.test(value)) return true;
  if (/^(?:library|radio):[\w-]{1,80}$/.test(value) || /^jellyfin:[a-f0-9]{24}:[\w-]{1,80}$/.test(value)) return true;
  if (httpUrl(value.startsWith("web:") ? value.slice(4) : value)) return true;
  try { const url = new URL(value); return url.protocol === "file:" && !url.username && !url.password && !decodeURIComponent(url.pathname).includes("\0"); } catch { return false; }
}

// Queue sources are original catalog references or user-selected URLs. Resolved
// provider streams and headers belong to native loads and never enter this table.
function capture(queue: QueueEntry[]): QueueEntry[] {
  if (!queue.length) throw new PlaylistError("Add something to the queue before saving it.");
  if (queue.length > 500) throw new PlaylistError("A playlist can contain up to 500 entries.");
  const ids = new Set<string>();
  return queue.map(entry => {
    if (!identifier(entry.id) || ids.has(entry.id) || typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 300 || !originalSource(entry.source)) throw new PlaylistError("The queue contains an item that cannot be saved. Add it again and retry.");
    ids.add(entry.id);
    return {
      id: entry.id, title: entry.title, source: entry.source,
      ...(httpUrl(entry.thumbnail) ? { thumbnail: entry.thumbnail } : {}),
      ...(identifier(entry.artworkId) ? { artworkId: entry.artworkId } : {}),
      ...(typeof entry.duration === "number" && Number.isFinite(entry.duration) && entry.duration >= 0 ? { duration: entry.duration } : {}),
      ...(typeof entry.live === "boolean" ? { live: entry.live } : {}),
      ...(entry.kind === "radio" ? { kind: entry.kind } : {}),
      ...(entry.quality && ["best", "1080p", "720p", "480p"].includes(entry.quality) ? { quality: entry.quality } : {}),
      ...(typeof entry.automaticTitle === "boolean" ? { automaticTitle: entry.automaticTitle } : {}),
    };
  });
}

function view(row: Row): SavedPlaylist {
  const entries = JSON.parse(row.entries) as QueueEntry[];
  return { ...row, entries: entries.map(({ source: _source, automaticTitle: _automaticTitle, ...entry }) => entry) };
}

export function createPlaylists({ databasePath, onChange, queue, loadQueue }: Options) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS saved_playlists (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL, entries TEXT NOT NULL
  )`);
  const get = (id: string) => {
    const row = db.query<Row, [string]>(`SELECT ${columns} FROM saved_playlists WHERE id = ?`).get(id);
    if (!row) throw new PlaylistError("Playlist not found.", 404);
    return row;
  };
  const requireRevision = (row: Row, revision: unknown) => {
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new PlaylistError("Use the current playlist revision.");
    if (row.revision !== revision) throw new PlaylistError("This playlist changed on another controller. Refresh it and try again.", 409);
  };
  const uniqueName = (name: string, id = "") => {
    if (db.query("SELECT 1 FROM saved_playlists WHERE name_key = ? AND id != ?").get(name.toLowerCase(), id)) throw new PlaylistError("A playlist already has that name.", 409);
  };

  return {
    async handle(request: Request, authorize = () => {}): Promise<Response> {
      const { pathname } = new URL(request.url);
      try {
        if (pathname === "/api/playlists") {
          if (request.method === "GET") {
            const playlists = db.query<SavedPlaylistSummary, []>("SELECT id, name, revision, updatedAt, json_array_length(entries) AS entryCount FROM saved_playlists ORDER BY name_key, id").all();
            return Response.json({ playlists });
          }
          if (request.method !== "POST") return methods("GET, POST");
          const input = await body(request);
          authorize();
          fields(input, ["name"]);
          const name = playlistName(input.name);
          const row = db.transaction(() => {
            if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM saved_playlists").get()!.count >= 100) throw new PlaylistError("You can save up to 100 playlists.");
            uniqueName(name);
            const saved: Row = { id: crypto.randomUUID(), name, revision: 1, updatedAt: Date.now(), entries: JSON.stringify(capture(queue())) };
            db.query("INSERT INTO saved_playlists VALUES (?, ?, ?, ?, ?, ?)").run(saved.id, name, name.toLowerCase(), saved.revision, saved.updatedAt, saved.entries);
            return saved;
          })();
          onChange();
          return Response.json({ playlist: view(row) }, { status: 201 });
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
          if (input.mode === "append" && queue().length + entries.length > 500) throw new PlaylistError("The queue can contain up to 500 entries. Replace it or remove some entries first.");
          loadQueue(entries, input.mode as PlaylistLoadMode, authorize);
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
            db.query("DELETE FROM saved_playlists WHERE id = ?").run(id);
            return { changed: true, playlist: null };
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
              row.entries = JSON.stringify(capture(queue()));
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
          if (row.name === previous.name && row.entries === previous.entries) return { changed: false, playlist: view(row) };
          row.revision++;
          row.updatedAt = Date.now();
          db.query("UPDATE saved_playlists SET name = ?, name_key = ?, revision = ?, updatedAt = ?, entries = ? WHERE id = ?").run(row.name, row.name.toLowerCase(), row.revision, row.updatedAt, row.entries, id);
          return { changed: true, playlist: view(row) };
        })();
        if (result.changed) onChange();
        return Response.json(result.playlist ? { playlist: result.playlist } : { ok: true });
      } catch (error) {
        return Response.json({ error: error instanceof PlaylistError || error instanceof ControllerError ? error.message : "Could not update playlists or load the queue. Check the TV's storage and current playback." }, { status: error instanceof PlaylistError || error instanceof ControllerError ? error.status : 500 });
      }
    },
    close() { db.close(); },
  };
}
