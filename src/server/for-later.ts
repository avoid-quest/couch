import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ForLaterReference } from "../shared/for-later";
import type { PlaybackActor, QueueEntry } from "../shared/protocol";
import { ControllerError, settingField } from "./controllers";
import { capturePlaylistEntries } from "./playlists";

type Options = {
  databasePath: string;
  onChange: () => void;
  lookup: (reference: ForLaterReference) => Promise<QueueEntry>;
  reservePlay: () => number;
  prepare: (entry: QueueEntry) => Promise<void>;
  enqueue: (entry: QueueEntry, intent: number | undefined, authorize: () => void, playedBy?: PlaybackActor) => void;
};
type Row = { id: string; entry: string };
const publicItem = (entry: QueueEntry) => { const { source: _source, automaticTitle: _automaticTitle, ...item } = entry; return item; };

export function createForLater({ databasePath, onChange, lookup, prepare, reservePlay, enqueue }: Options) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE IF NOT EXISTS for_later (id TEXT PRIMARY KEY, source TEXT NOT NULL UNIQUE, entry TEXT NOT NULL, savedAt INTEGER NOT NULL)");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(for_later)").all().some(column => column.name === "position")) {
    db.transaction(() => {
      db.run("ALTER TABLE for_later ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
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
          if (!reference || typeof reference !== "object" || Object.keys(reference).length !== 2 || !["queue", "library", "jellyfin"].includes(reference.kind) || typeof reference.id !== "string" || !/^[\w-]{1,80}$/.test(reference.id)) throw new ControllerError("Choose a library or queue item to save.");
          const found = await lookup(reference);
          authorize();
          const entry = capturePlaylistEntries([{ ...found, id: crypto.randomUUID() }])[0]!;
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
        const match = /^\/api\/for-later\/([\w-]{1,80})(?:\/(load))?$/.exec(path);
        if (!match) throw new ControllerError("For later endpoint not found.", 404);
        const id = match[1]!;
        if (match[2]) {
          if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
          const mode = await settingField(request, "mode");
          authorize();
          if (mode !== "play" && mode !== "append") throw new ControllerError("Choose Play or Add to Up next.");
          const entry = get(id);
          const intent = mode === "play" ? reservePlay() : undefined;
          await prepare(entry);
          authorize();
          get(id); // Another controller may have removed it while the source was checked.
          enqueue({ ...entry, id: crypto.randomUUID() }, intent, authorize, playedBy);
          return Response.json({ ok: true });
        }
        if (request.method !== "DELETE") return new Response(null, { status: 405, headers: { Allow: "DELETE" } });
        const removed = db.query("DELETE FROM for_later WHERE id = ?").run(id);
        if (removed.changes) onChange();
        return Response.json({ ok: true });
      } catch (error) {
        // The session appended the item before a newer control canceled Play.
        if (error instanceof Error && error.message === "Added to the queue. Playback was canceled by a newer control.") return Response.json({ ok: true, notice: "Added to Up next. Playback was canceled by a newer control." });
        return Response.json({ error: error instanceof ControllerError ? error.message : "Could not use this saved item. Its source may be unavailable. Retry when connected, or remove it from For later." }, { status: error instanceof ControllerError ? error.status : 409 });
      }
    },
    close() { db.close(); },
  };
}
