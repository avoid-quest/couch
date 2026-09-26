import type { Database } from "bun:sqlite";
import { basename, extname } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { LibraryItem, VideoMetadata } from "../shared/library";
import type { MetadataMatch, MetadataOrigin, MetadataPreview, MetadataValues, MetadataView } from "../shared/metadata";
import { ControllerError } from "./controllers";
import { correctedNfo, correctedShowNfo, MetadataError, metadataChanges, metadataHash, metadataValues } from "./metadata-values";
import { createTmdb } from "./tmdb";
import { parseVideoNfo, videoArtwork, type OriginalVideoNfo, type VideoArtwork } from "./video-metadata";
import { ADMIN_ONLY, CHANGED_ELSEWHERE } from "./messages";

type Saved = { itemId: string; base: string; changes: string; origins: string; match: string | null; original: Uint8Array | null; originals: string };
type Row = { rowid: number; id: string; title: string; video: string; artworkId: string | null; path: string; duration: number | null; sourceId: string };
type Preview = MetadataPreview & { itemId: string; revision: string; image: VideoArtwork | null; owner: string };

export function createMetadata(db: Database, notify: () => void, reindex: (id: string) => void, fetcher?: typeof fetch) {
  db.run(`CREATE TABLE IF NOT EXISTS library_metadata (itemId TEXT PRIMARY KEY, base TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '{}', origins TEXT NOT NULL DEFAULT '{}', match TEXT, original BLOB, originals TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS metadata_provider (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL);`);
  const tmdb = createTmdb(fetcher);
  const previews = new Map<string, Preview>();
  const row = (id: string) => db.query<Row, [string]>("SELECT rowid, id, title, video, artworkId, path, duration, sourceId FROM library_items WHERE id=? AND kind='video'").get(id);
  const saved = (id: string) => db.query<Saved, [string]>("SELECT * FROM library_metadata WHERE itemId=?").get(id);
  const item = (value: Row): LibraryItem => ({ id: value.id, title: value.title, kind: "video", video: JSON.parse(value.video), artworkId: value.artworkId, available: true, duration: value.duration, artist: null, album: null });
  const token = () => db.query<{ token: string }, []>("SELECT token FROM metadata_provider WHERE id=1").get()?.token ?? "";
  const match = (value: Saved | null): MetadataMatch | null => value?.match ? JSON.parse(value.match) : null;
  const view = (id: string): MetadataView => {
    const current = row(id);
    if (!current?.video) throw new MetadataError("Video not found. Scan the library first.", 404);
    const values = metadataValues(item(current));
    const state = saved(id);
    const origins = Object.fromEntries(Object.keys(values).map(key => [key, "Imported/local"])) as MetadataView["origins"];
    Object.assign(origins, state ? JSON.parse(state.origins) : {});
    return { id, type: item(current).video!.type, values, origins, match: match(state), revision: metadataHash([values, origins, state?.match ?? null, state?.base, state?.original && metadataHash([...state.original])]) };
  };
  function apply(id: string) {
    const current = row(id), state = saved(id);
    if (!current || !state) return;
    const values: MetadataValues = { ...JSON.parse(state.base), ...JSON.parse(state.changes) };
    const video: VideoMetadata = JSON.parse(current.video);
    const { title, artworkId, showTitle, ...description } = values;
    Object.assign(video, description);
    if (video.show && showTitle && "showTitle" in JSON.parse(state.changes)) video.show.title = showTitle;
    db.query("UPDATE library_items SET title=?, artworkId=?, video=? WHERE id=?").run(title, artworkId, JSON.stringify(video), id);
    reindex(id);
  }
  function capture(current: LibraryItem, originals: OriginalVideoNfo[]) {
    if (!current.video) return;
    const original = originals.find(nfo => { try { return parseVideoNfo(nfo.data).type === (current.video!.type === "episode" ? "episodedetails" : "movie"); } catch { return false; } })?.data ?? null;
    db.query(`INSERT INTO library_metadata (itemId, base, original, originals) VALUES (?, ?, ?, ?)
      ON CONFLICT(itemId) DO UPDATE SET base=excluded.base, original=excluded.original, originals=excluded.originals`).run(current.id, JSON.stringify(metadataValues(current)), original,
      JSON.stringify(originals.map(nfo => ({ name: basename(nfo.path), data: Buffer.from(nfo.data).toString("base64") }))));
    apply(current.id);
  }
  function commit(id: string, revision: unknown, changes: Partial<MetadataValues>, origin: MetadataOrigin, selected: MetadataMatch | null | undefined, image: VideoArtwork | null, authorize: () => void) {
    db.transaction(() => {
      authorize();
      const current = view(id);
      if (current.revision !== revision) throw new MetadataError(CHANGED_ELSEWHERE, 409);
      const state = saved(id);
      if (!state) throw new MetadataError("Rescan this item once before correcting metadata.", 409);
      if (image) db.query("INSERT OR IGNORE INTO library_artwork (id, data, mimeType) VALUES (?, ?, ?)").run(image.id, image.data, image.mimeType);
      if (changes.artworkId && !db.query("SELECT 1 FROM library_artwork WHERE id=?").get(changes.artworkId)) throw new MetadataError("Selected artwork is no longer available.", 409);
      const merged = { ...current.values, ...changes };
      if (merged.premiered && merged.year !== Number(merged.premiered.slice(0, 4))) throw new MetadataError("Release year must match the release date. Correct or clear the date too.");
      const origins = { ...JSON.parse(state.origins), ...Object.fromEntries(Object.keys(changes).map(key => [key, origin])) };
      db.query("UPDATE library_metadata SET changes=?, origins=?, match=? WHERE itemId=?").run(JSON.stringify({ ...JSON.parse(state.changes), ...changes }), JSON.stringify(origins), selected === undefined ? state.match : JSON.stringify(selected), id);
      apply(id);
    })();
    notify();
    return view(id);
  }
  async function exportItem(id: string, revision: unknown, authorize: () => void) {
    authorize();
    if (view(id).revision !== revision) throw new MetadataError("Metadata changed. Reload before exporting.", 409);
    const current = row(id)!;
    const state = saved(id);
    if (!state) throw new MetadataError("Rescan once before exporting this item.", 409);
    // Archive names are fixed; source names are instructions, never extraction paths.
    const files: Record<string, string | Uint8Array> = { "metadata.nfo": correctedNfo(state.original, item(current), match(state), state.match !== null) };
    const stem = basename(current.path, extname(current.path));
    const placements: Record<string, string> = { "metadata.nfo": `${stem}.nfo` };
    const video = item(current).video!;
    const showPoster = video.type === "episode" && current.artworkId === video.show?.artworkId && !("artworkId" in JSON.parse(state.changes));
    const arts = [[current.artworkId, showPoster ? "poster" : video.type === "episode" ? `${stem}-thumb` : `${stem}-poster`],
      [video.fanartId, video.type === "episode" ? "fanart" : `${stem}-fanart`]] as const;
    for (const [index, [id, name]] of arts.entries()) {
      if (!id) continue;
      const image = db.query<VideoArtwork, [string]>("SELECT * FROM library_artwork WHERE id=?").get(id);
      if (!image) throw new MetadataError("Artwork is no longer available. Reload before exporting.", 409);
      const filename = `artwork-${index}.${image.mimeType === "image/png" ? "png" : "jpg"}`;
      files[filename] = image.data;
      placements[filename] = `${name}.${image.mimeType === "image/png" ? "png" : "jpg"}${showPoster && index === 0 ? " in the original show folder" : ""}`;
    }
    const originals: Array<{ name: string; data: string }> = JSON.parse(state.originals);
    if (video.show) {
      const showOriginal = originals.find(nfo => parseVideoNfo(Buffer.from(nfo.data, "base64")).type === "tvshow");
      files["show.nfo"] = correctedShowNfo(showOriginal ? Buffer.from(showOriginal.data, "base64") : null, video.show.title);
      placements["show.nfo"] = "tvshow.nfo in the original show folder";
    }
    originals.forEach((nfo, index) => { files[`original-${index}.nfo`] = Buffer.from(nfo.data, "base64"); });
    files["placement.json"] = JSON.stringify({ mediaFilename: basename(current.path), placements, originals: originals.map((nfo, index) => ({ file: `original-${index}.nfo`, importedFilename: nfo.name })), metadata: view(id) }, null, 2);
    files["README.txt"] = "Couch metadata export\nSaved to your chosen download or file destination. No TV files were written.\nExtract into an empty folder, inspect metadata.nfo, and use placement.json to rename and place sidecars beside the original media. Back up existing sidecars before explicitly replacing them. Original media is not included. original-*.nfo files are unchanged imported snapshots, not replacement sidecars.\nSupported fields: title, originaltitle, plot, year, premiered/aired, genre; episode season, episode, showtitle; selected TMDB uniqueid. Other imported XML elements, attributes and comments are preserved. XML formatting may change. Runtime remains imported. PNG/JPEG poster or episode thumb and fanart are included when available. A show-level poster or fanart belongs beside tvshow.nfo. For episodes, place show.nfo as tvshow.nfo in the original show folder to preserve a corrected series title; its unknown imported fields are retained too.\n";
    const blob = await new Bun.Archive(files).blob();
    authorize();
    return new Response(blob, { headers: { "Content-Type": "application/x-tar", "Content-Disposition": `attachment; filename="couch-metadata-${id}.tar"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return {
    capture, apply,
    removeSource(sourceId: string) { db.query("DELETE FROM library_metadata WHERE itemId IN (SELECT id FROM library_items WHERE sourceId=?)").run(sourceId); },
    async handle(request: Request, identity: () => ControllerIdentity | null): Promise<Response> {
      const authorize = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this remote first.", 401);
        if (caller.authority === "controller") throw new ControllerError(ADMIN_ONLY, 403);
        if (request.signal.aborted) throw new MetadataError("Metadata request was cancelled.", 409);
      };
      try {
        authorize();
        const path = new URL(request.url).pathname;
        if (request.method === "GET") {
          if (path === "/api/metadata/provider") return Response.json({ configured: !!token(), provider: "TMDB" });
          const selected = /^\/api\/metadata\/items\/([\w-]{1,80})$/.exec(path);
          return selected ? Response.json(view(selected[1]!)) : new Response(null, { status: 404 });
        }
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
        if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") throw new MetadataError("Send a JSON object.", 415);
        const reader = request.body?.getReader();
        if (!reader) throw new MetadataError("Send a JSON object.");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 3 * 1024 * 1024) throw new MetadataError("Metadata input is too large.", 413); chunks.push(next.value); } }
        finally { await reader.cancel().catch(() => {}); }
        let value: Record<string, unknown>;
        try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new MetadataError("Invalid JSON."); }
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new MetadataError("Send a JSON object.");
        authorize();
        const only = (...keys: string[]) => { if (Object.keys(value).some(key => !keys.includes(key))) throw new MetadataError("Unknown metadata request field."); };
        if (path === "/api/metadata/provider") {
          only("token");
          if (typeof value.token !== "string" || value.token.length > 2048 || value.token && !/^[a-zA-Z0-9._-]+$/.test(value.token)) throw new MetadataError("Enter a TMDB API Read Access Token, or clear it.");
          db.query("INSERT INTO metadata_provider VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET token=excluded.token").run(value.token);
          previews.clear(); notify();
          return Response.json({ configured: !!value.token, provider: "TMDB" });
        }
        const selected = /^\/api\/metadata\/items\/([\w-]{1,80})\/(edit|search|preview|match|export)$/.exec(path);
        if (!selected) return new Response(null, { status: 404 });
        const id = selected[1]!, action = selected[2]!, current = view(id);
        if (action === "export") { only("revision"); return await exportItem(id, value.revision, authorize); }
        if (action === "search") {
          only("query");
          if (typeof value.query !== "string") throw new MetadataError("Enter a title.");
          const results = await tmdb.search(token(), current.type, value.query, request.signal);
          authorize(); return Response.json({ items: results });
        }
        const owner = identity()!.controller?.id ?? "host";
        for (const [key, preview] of previews) if (preview.expiresAt < Date.now()) previews.delete(key);
        if (action === "preview") {
          only("id", "season", "episode", "revision");
          if (current.revision !== value.revision) throw new MetadataError("Reload metadata before choosing a match.", 409);
          if (previews.size >= 20) throw new MetadataError("Too many previews. Wait five minutes and try again.", 429);
          const credential = token();
          const result = await tmdb.preview(credential, current.type, value.id as number, value.season as number ?? null, value.episode as number ?? null, request.signal);
          authorize();
          if (token() !== credential || view(id).revision !== current.revision) throw new MetadataError("Metadata or provider setup changed during lookup. Reload and try again.", 409);
          const preview: Preview = { id: crypto.randomUUID(), itemId: id, revision: current.revision, owner, expiresAt: Date.now() + 300_000, match: result.match,
            values: result.values, image: result.artwork, artwork: result.artwork ? `data:${result.artwork.mimeType};base64,${Buffer.from(result.artwork.data).toString("base64")}` : null };
          previews.set(preview.id, preview);
          const { image: _image, owner: _owner, itemId: _itemId, revision: _revision, ...publicPreview } = preview;
          return Response.json(publicPreview);
        }
        if (action === "match") {
          only("previewId", "revision");
          const preview = typeof value.previewId === "string" ? previews.get(value.previewId) : undefined;
          if (!preview || preview.owner !== owner || preview.itemId !== id || preview.revision !== value.revision) throw new MetadataError("Preview expired or changed. Search and preview again.", 409);
          const result = commit(id, value.revision, preview.values, "TMDB", preview.match, preview.image, authorize);
          previews.delete(preview.id);
          return Response.json(result);
        }
        only("revision", "changes", "artwork", "clearMatch");
        if (value.clearMatch !== undefined && value.clearMatch !== true) throw new MetadataError("Invalid match correction.");
        if (value.changes === undefined && (value.clearMatch || value.artwork !== undefined)) value.changes = {};
        const changes = value.changes && typeof value.changes === "object" && !Array.isArray(value.changes) && !Object.keys(value.changes).length && (value.clearMatch || value.artwork) ? {} : metadataChanges(value.changes, current.type === "episode");
        let image: VideoArtwork | null = null;
        if (value.artwork !== undefined) {
          if (typeof value.artwork !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.artwork)) throw new MetadataError("Choose a PNG or JPEG image.");
          image = videoArtwork(Buffer.from(value.artwork, "base64"));
          if (!image) throw new MetadataError("Artwork must be a bounded PNG or JPEG, up to 2 MiB and 4096 pixels per side.");
          changes.artworkId = image.id;
        }
        return Response.json(commit(id, value.revision, changes, "Manual", value.clearMatch ? null : undefined, image, authorize));
      } catch (error) {
        if (error instanceof MetadataError || error instanceof ControllerError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: "Couldn't save the correction." }, { status: 500 });
      }
    },
    close() { tmdb.close(); previews.clear(); },
  };
}
