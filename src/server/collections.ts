import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { CollectionDefinition, CollectionFilter, CollectionPreview, SavedCollection } from "../shared/collections";
import type { LibraryItem } from "../shared/library";
import type { QueueEntry } from "../shared/protocol";
import { ControllerError } from "./controllers";
import type { createLibrary } from "./library";

type Options = {
  databasePath: string;
  library: Pick<ReturnType<typeof createLibrary>, "getItem" | "collectionItems">;
  onChange: () => void;
  queue: () => QueueEntry[];
  loadQueue: (entries: QueueEntry[], mode: "append" | "play", authorize: () => void) => void;
};
type Row = { id: string; revision: number; updatedAt: number; definition: string };
class CollectionError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const methods = (allow: string) => Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: allow } });
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new CollectionError("Unsupported collection field.");
}
function text(value: unknown, limit = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new CollectionError(`Enter text with 1 to ${limit} characters.`);
  return value.trim().normalize("NFC");
}
async function body(request: Request) {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new CollectionError("Send a JSON object.");
  // A full definition may contain 500 cached titles of up to 300 UTF-16 units.
  const maxBytes = 1_048_576;
  if (Number(request.headers.get("Content-Length")) > maxBytes) throw new CollectionError("Collection command is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CollectionError("Send a JSON object.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) { await reader.cancel(); throw new CollectionError("Collection command is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const raw = Buffer.concat(chunks).toString("utf8");
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new CollectionError("Invalid JSON body."); }
  if (!object(input)) throw new CollectionError("Send a JSON object.");
  return input;
}
const saved = (row: Row): SavedCollection => ({ ...JSON.parse(row.definition) as CollectionDefinition, id: row.id, revision: row.revision, updatedAt: row.updatedAt });

export function createCollections({ databasePath, library, onChange, queue, loadQueue }: Options) {
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
  db.run("CREATE TABLE IF NOT EXISTS library_collections (id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL, definition TEXT NOT NULL)");
  let closed = false;
  const assertOpen = () => { if (closed) throw new CollectionError("Collections are closing.", 503); };
  const get = (id: string) => {
    assertOpen();
    const row = db.query<Row, [string]>("SELECT id, revision, updatedAt, definition FROM library_collections WHERE id = ?").get(id);
    if (!row) throw new CollectionError("Collection not found.", 404);
    return saved(row);
  };
  const revision = (collection: SavedCollection, value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new CollectionError("Use the current collection revision.");
    if (collection.revision !== value) throw new CollectionError("This collection changed on another controller. Reload before saving.", 409);
  };
  const definition = (input: unknown, previous?: SavedCollection): CollectionDefinition => {
    if (!object(input)) throw new CollectionError("Enter a collection definition.");
    fields(input, ["name", "sort", "descending", "filter", "members"]);
    const name = text(input.name, 80);
    if (!["manual", "title", "year", "album"].includes(String(input.sort)) || typeof input.descending !== "boolean") throw new CollectionError("Choose an explicit sort order.");
    let filter: CollectionFilter | null = null;
    if (input.filter !== null) {
      if (!object(input.filter) || !["movie", "episode", "audio"].includes(String(input.filter.kind))) throw new CollectionError("Choose movies, episodes or music.");
      fields(input.filter, ["kind", "title", "artist", "album", "show", "genre", "year"]);
      filter = { kind: input.filter.kind as CollectionFilter["kind"] };
      for (const field of ["title", "artist", "album", "show", "genre"] as const) if (input.filter[field] !== undefined) filter[field] = text(input.filter[field]);
      if (input.filter.year !== undefined) {
        if (!Number.isInteger(input.filter.year) || Number(input.filter.year) < 1 || Number(input.filter.year) > 9999) throw new CollectionError("Enter a year from 1 to 9999.");
        filter.year = Number(input.filter.year);
      }
      if (filter.kind === "audio" ? filter.show || filter.genre || filter.year !== undefined : filter.artist || filter.album || filter.kind === "movie" && filter.show) throw new CollectionError("Choose fields supported by this media type.");
      if (input.sort === "manual" || filter.kind === "audio" && input.sort === "year" || filter.kind !== "audio" && input.sort === "album") throw new CollectionError("Choose a sort supported by this media type.");
    }
    if (!Array.isArray(input.members) || input.members.length > 500 || filter && input.members.length) throw new CollectionError("Use up to 500 manual members or a saved filter.");
    if (!filter && input.sort === "album") throw new CollectionError("Movie collections support manual, title or year order.");
    const ids = new Set<string>();
    const members = input.members.map(value => {
      if (!object(value) || !identifier(value.id) || ids.has(value.id)) throw new CollectionError("Choose unique library members.");
      fields(value, ["id", "title"]);
      ids.add(value.id);
      const item = library.getItem(value.id);
      const retained = previous?.members.find(member => member.id === value.id);
      if (!retained && item?.video?.type !== "movie") throw new CollectionError("Manual film collections accept library movies.");
      return { id: value.id, title: item?.title.slice(0, 300) ?? retained!.title };
    });
    return { name, filter, sort: input.sort as CollectionDefinition["sort"], descending: input.descending, members };
  };
  const preview = (collection: SavedCollection): CollectionPreview => {
    let items: LibraryItem[];
    let total: number;
    if (collection.filter) ({ items, total } = library.collectionItems(collection.filter, collection.sort, collection.descending));
    else {
      items = collection.members.map(member => library.getItem(member.id) ?? { ...member, kind: "video", duration: null, artist: null, album: null, available: false });
      if (collection.sort !== "manual") items.sort((a, b) => ((collection.sort === "year" ? (a.video?.year ?? 0) - (b.video?.year ?? 0) : 0) || a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id)) * (collection.descending ? -1 : 1));
      else if (collection.descending) items.reverse();
      total = items.length;
    }
    const digest = createHash("sha256").update(JSON.stringify({ revision: collection.revision, total, items })).digest("hex");
    return { collection, items, total, digest };
  };
  return {
    async handle(request: Request, authorize = () => {}): Promise<Response> {
      try {
        assertOpen();
        const path = new URL(request.url).pathname;
        if (path === "/api/collections") {
          if (request.method === "GET") return Response.json({ collections: db.query<Row, []>("SELECT id, revision, updatedAt, definition FROM library_collections ORDER BY name_key, id").all().map(saved) });
          if (request.method !== "POST") return methods("GET, POST");
          const input = await body(request);
          authorize();
          assertOpen();
          fields(input, ["definition"]);
          const value = definition(input.definition);
          const collection = db.transaction(() => {
            if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM library_collections").get()!.count >= 100) throw new CollectionError("You can save up to 100 collections and filters.");
            if (db.query("SELECT 1 FROM library_collections WHERE name_key = ?").get(value.name.toLowerCase())) throw new CollectionError("A collection already has this name.", 409);
            const id = crypto.randomUUID();
            db.query("INSERT INTO library_collections VALUES (?, ?, 1, ?, ?)").run(id, value.name.toLowerCase(), Date.now(), JSON.stringify(value));
            return get(id);
          })();
          onChange();
          return Response.json(preview(collection), { status: 201 });
        }
        const match = /^\/api\/collections\/([\w-]{1,80})(\/load)?$/.exec(path);
        if (!match) throw new CollectionError("Collection endpoint not found.", 404);
        const id = match[1]!;
        if (match[2]) {
          if (request.method !== "POST") return methods("POST");
          const input = await body(request);
          authorize();
          assertOpen();
          fields(input, ["revision", "digest", "mode"]);
          if (input.mode !== "append" && input.mode !== "play") throw new CollectionError("Choose append or play.");
          const collection = get(id);
          revision(collection, input.revision);
          const current = preview(collection);
          if (input.digest !== current.digest) throw new CollectionError("The library changed. Review the refreshed preview before loading it.", 409);
          const available = current.items.filter(item => item.available);
          if (!available.length) throw new CollectionError("No available items in this preview.");
          if (input.mode === "append" && queue().length + available.length > 500) throw new CollectionError("The queue can contain up to 500 entries. Remove some entries first.");
          loadQueue(available.map(item => ({ id: item.id, title: item.title.slice(0, 300), source: `library:${item.id}`, ...(item.artworkId ? { artworkId: item.artworkId } : {}), ...(item.duration !== null ? { duration: item.duration } : {}) })), input.mode, authorize);
          return Response.json({ ok: true, loaded: available.length, missing: current.items.length - available.length });
        }
        if (request.method === "GET") return Response.json(preview(get(id)));
        if (request.method !== "POST" && request.method !== "DELETE") return methods("GET, POST, DELETE");
        const input = await body(request);
        authorize();
        assertOpen();
        fields(input, request.method === "DELETE" ? ["revision"] : ["revision", "definition"]);
        const collection = db.transaction(() => {
          const previous = get(id);
          revision(previous, input.revision);
          if (request.method === "DELETE") { db.query("DELETE FROM library_collections WHERE id = ?").run(id); return null; }
          const value = definition(input.definition, previous);
          if (db.query("SELECT 1 FROM library_collections WHERE name_key = ? AND id != ?").get(value.name.toLowerCase(), id)) throw new CollectionError("A collection already has this name.", 409);
          db.query("UPDATE library_collections SET name_key = ?, revision = revision + 1, updatedAt = ?, definition = ? WHERE id = ?").run(value.name.toLowerCase(), Date.now(), JSON.stringify(value), id);
          return get(id);
        })();
        onChange();
        return Response.json(collection ? preview(collection) : { ok: true });
      } catch (error) {
        return Response.json({ error: error instanceof CollectionError || error instanceof ControllerError ? error.message : "Could not update the collection or load the queue." }, { status: error instanceof CollectionError || error instanceof ControllerError ? error.status : 500 });
      }
    },
    close() { if (!closed) { closed = true; db.close(); } },
  };
}
