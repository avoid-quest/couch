import { Database } from "./sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ForLaterReference } from "../shared/for-later";
import type { PlaybackActor, QueueEntry } from "../shared/protocol";
import { ControllerError, settingField } from "./devices";
import { capturePlaylistEntries } from "./playlists";
import { CHANGED_ELSEWHERE, PLAY_CANCELED } from "./messages";

type Options = {
  databasePath: string;
  onChange: () => void;
  lookup: (reference: Extract<ForLaterReference, { kind: "queue" }>) => Promise<QueueEntry>;
  webMetadata?: (url: string, collection?: Extract<ForLaterReference, { kind: "web" }>["collection"]) => Pick<QueueEntry, "subtitle" | "description" | "thumbnail" | "collection">;
  reservePlay: (playedBy?: PlaybackActor) => number;
  prepare: (entry: QueueEntry) => Promise<void>;
  enqueue: (entry: QueueEntry, intent: number | undefined, authorize: () => void, playedBy?: PlaybackActor) => void;
};
type Row = { id: string; entry: string };
type RemovedRow = Row & { source: string; savedAt: number; position: number };
const publicItem = (entry: QueueEntry) => { const { source, automaticTitle: _automaticTitle, ...item } = entry; return { ...item, ...(source.startsWith("web:") ? { url: source.slice(4) } : {}) }; };

export function createForLater({ databasePath, onChange, lookup, prepare, reservePlay, enqueue, webMetadata }: Options) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS for_later (id TEXT PRIMARY KEY, source TEXT NOT NULL UNIQUE, entry TEXT NOT NULL, savedAt INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS for_later_undo (token TEXT PRIMARY KEY, item TEXT NOT NULL, expiresAt INTEGER NOT NULL)");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(for_later)").all().some(column => column.name === "position")) {
    db.transaction(() => {
      db.exec("ALTER TABLE for_later ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
      // Existing installs keep their newest-first reading order as the start order.
      const rows = db.query<{ id: string }, []>("SELECT id FROM for_later ORDER BY savedAt DESC, id").all();
      for (const [index, row] of rows.entries()) db.query("UPDATE for_later SET position = ? WHERE id = ?").run(index + 1, row.id);
    })();
  }
  const get = (id: string) => {
    const row = db.query<Row, [string]>("SELECT id, entry FROM for_later WHERE id = ?").get(id);
    if (!row) throw new ControllerError("This item is no longer in For later.", 404);
    return JSON.parse(row.entry) as QueueEntry;
  };
  return {
    async handle(request: Request, authorize = () => {}, playedBy?: PlaybackActor): Promise<Response> {
      const path = new URL(request.url).pathname;
      try {
        authorize();
        if (path === "/api/for-later") {
          if (request.method === "GET") return Response.json({ items: db.query<Row, []>("SELECT id, entry FROM for_later ORDER BY position, id").all().map(row => publicItem(JSON.parse(row.entry))) });
          if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
          const reference = await settingField(request, "reference") as ForLaterReference;
          authorize();
          let entry: QueueEntry;
          if (reference && typeof reference === "object" && "kind" in reference && reference.kind === "web") {
            if (typeof reference.url !== "string" || typeof reference.title !== "string" || reference.url.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(reference.url)) throw new ControllerError("Choose an item to save.");
            let parsed: URL; try { parsed = new URL(reference.url); } catch { throw new ControllerError("Choose an item to save."); }
            if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new ControllerError("Choose an item to save.");
            if (reference.thumbnail !== undefined) {
              if (typeof reference.thumbnail !== "string" || reference.thumbnail.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(reference.thumbnail)) throw new ControllerError("Choose an item to save.");
              let thumbnail: URL; try { thumbnail = new URL(reference.thumbnail); } catch { throw new ControllerError("Choose an item to save."); }
              if (!["http:", "https:"].includes(thumbnail.protocol) || thumbnail.username || thumbnail.password) throw new ControllerError("Choose an item to save.");
            }
            if (reference.duration !== undefined && (typeof reference.duration !== "number" || !Number.isFinite(reference.duration) || reference.duration < 0 || reference.duration > 86_400)) throw new ControllerError("Choose an item to save.");
            if (reference.collection !== undefined && (!reference.collection || typeof reference.collection !== "object" || typeof reference.collection.url !== "string" || reference.collection.url.length > 2048 || reference.collection.index !== undefined && (!Number.isSafeInteger(reference.collection.index) || reference.collection.index < 0 || reference.collection.index > 2400))) throw new ControllerError("Choose an item to save.");
            entry = { id: crypto.randomUUID(), title: reference.title.trim().slice(0, 300), source: `web:${reference.url}`, ...(reference.thumbnail ? { thumbnail: reference.thumbnail } : {}), ...(reference.duration !== undefined ? { duration: reference.duration } : {}), ...webMetadata?.(reference.url, reference.collection) };
          } else {
            if (!reference || typeof reference !== "object" || Object.keys(reference).length !== 2 || (reference as ForLaterReference).kind !== "queue" || typeof (reference as { id?: unknown }).id !== "string" || !/^[\w-]{1,80}$/.test((reference as { id: string }).id)) throw new ControllerError("Choose a queue item to save.");
            const found = await lookup(reference as Extract<ForLaterReference, { kind: "queue" }>);
            entry = capturePlaylistEntries([{ ...found, id: crypto.randomUUID() }])[0]!;
          }
          authorize();
          const result = db.transaction(() => {
            const existing = db.query<Row, [string]>("SELECT id, entry FROM for_later WHERE source = ?").get(entry.source);
            if (existing) return { item: publicItem(JSON.parse(existing.entry)), changed: false };
            if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM for_later").get()!.count >= 500) throw new ControllerError("For later can hold 500 items. Remove something before saving more.");
            db.query("INSERT INTO for_later (id, source, entry, savedAt, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MIN(position), 1) - 1 FROM for_later))").run(entry.id, entry.source, JSON.stringify(entry), Date.now());
            return { item: publicItem(entry), changed: true };
          })();
          if (result.changed) onChange();
          return Response.json({ item: result.item }, { status: result.changed ? 201 : 200 });
        }
        if (path === "/api/for-later/reorder") {
          if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
          const body = await settingField(request, "order");
          authorize();
          const ids = Array.isArray(body) && body.every((id): id is string => typeof id === "string" && /^[\w-]{1,80}$/.test(id)) ? body : null;
          if (!ids || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) throw new ControllerError("Send the saved items in their new order.");
          if (ids.some(id => !db.query("SELECT 1 FROM for_later WHERE id = ?").get(id))) throw new ControllerError("For later changed. Try the move again.");
          db.transaction(() => {
            for (const [index, id] of ids.entries()) db.query("UPDATE for_later SET position = ? WHERE id = ?").run(index + 1, id);
          })();
          onChange();
          return Response.json({ ok: true });
        }
        if (path === "/api/for-later/restore") {
          if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
          const token = await settingField(request, "token");
          authorize();
          if (typeof token !== "string" || !/^[\w-]{1,80}$/.test(token)) throw new ControllerError("Choose an item to restore.");
          const item = db.transaction(() => {
            const saved = db.query<{ item: string; expiresAt: number }, [string]>("SELECT item, expiresAt FROM for_later_undo WHERE token = ?").get(token);
            if (!saved || saved.expiresAt <= Date.now()) throw new ControllerError("Undo has expired.", 404);
            const row = JSON.parse(saved.item) as RemovedRow;
            if (db.query("SELECT 1 FROM for_later WHERE source = ? OR id = ?").get(row.source, row.id)) throw new ControllerError(CHANGED_ELSEWHERE, 409);
            if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM for_later").get()!.count >= 500) throw new ControllerError("For later can hold 500 items. Remove something before restoring this one.");
            db.query("UPDATE for_later SET position = position + 1 WHERE position >= ?").run(row.position);
            db.query("INSERT INTO for_later (id, source, entry, savedAt, position) VALUES (?, ?, ?, ?, ?)").run(row.id, row.source, row.entry, row.savedAt, row.position);
            db.query("DELETE FROM for_later_undo WHERE token = ?").run(token);
            return publicItem(JSON.parse(row.entry) as QueueEntry);
          })();
          onChange();
          return Response.json({ item });
        }
        const match = /^\/api\/for-later\/([\w-]{1,80})(?:\/(load))?$/.exec(path);
        if (!match) throw new ControllerError("For later endpoint not found.", 404);
        const id = match[1]!;
        if (match[2]) {
          if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
          const mode = await settingField(request, "mode");
          authorize();
          if (mode !== "play" && mode !== "append") throw new ControllerError("Choose Play or Add to Up next.");
          const entry = get(id);
          const intent = mode === "play" ? reservePlay(playedBy) : undefined;
          await prepare(entry);
          authorize();
          get(id); // Another controller may have removed it while the source was checked.
          enqueue({ ...entry, id: crypto.randomUUID() }, intent, authorize, playedBy);
          return Response.json({ ok: true });
        }
        if (request.method !== "DELETE") return new Response(null, { status: 405, headers: { Allow: "DELETE" } });
        const undoToken = db.transaction(() => {
          db.query("DELETE FROM for_later_undo WHERE expiresAt <= ?").run(Date.now());
          const row = db.query<RemovedRow, [string]>("SELECT id, source, entry, savedAt, position FROM for_later WHERE id = ?").get(id);
          if (!row) return null;
          const token = crypto.randomUUID();
          db.query("DELETE FROM for_later WHERE id = ?").run(id);
          db.query("INSERT INTO for_later_undo VALUES (?, ?, ?)").run(token, JSON.stringify(row), Date.now() + 15_000);
          return token;
        })();
        if (undoToken) onChange();
        return Response.json({ ok: true, ...(undoToken ? { undoToken } : {}) });
      } catch (error) {
        if (error instanceof Error && error.message === PLAY_CANCELED) return Response.json({ error: error.message }, { status: 409 });
        return Response.json({ error: error instanceof ControllerError ? error.message : "Couldn't open this saved item. Its source may be gone." }, { status: error instanceof ControllerError ? error.status : 409 });
      }
    },
    close() { db.close(); },
  };
}
