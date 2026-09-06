import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// This runs before the preview app opens its database, only when --media is supplied.
export function migratePreviewMedia(databasePath: string) {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  chmodSync(databasePath, 0o600);
  try {
    return db.transaction(() => {
      db.run("CREATE TABLE IF NOT EXISTS preview_migrations (id TEXT PRIMARY KEY)");
      if (db.query("SELECT 1 FROM preview_migrations WHERE id = 'media-child-v1'").get()) return 0;
      const sources = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'library_sources'").get()
        ? db.query<{ id: string; path: string }, []>("SELECT id, path FROM library_sources WHERE (path = '/media' OR path LIKE '/media/%') AND path <> '/media/host' AND path NOT LIKE '/media/host/%'").all() : [];
      // Existing child-layout paths are already current; never prefix them again.
      for (const source of sources) if (db.query("SELECT 1 FROM library_sources WHERE path = ?").get(`/media/host${source.path.slice(6)}`)) throw new Error("Saved preview source paths collide at /media/host. No paths were changed; resolve the duplicate definitions before restarting the preview.");
      for (const source of sources) db.query("UPDATE library_sources SET path = ? WHERE id = ?").run(`/media/host${source.path.slice(6)}`, source.id);
      db.query("INSERT INTO preview_migrations VALUES ('media-child-v1')").run();
      return sources.length;
    }).immediate();
  } finally { db.close(); }
}

if (import.meta.main) {
  if (process.env.COUCH_PREVIEW_MEDIA !== "1" || !process.env.COUCH_DATA_DIR) throw new Error("Preview media migration requires the preview startup environment.");
  const count = migratePreviewMedia(join(process.env.COUCH_DATA_DIR, "couch.sqlite"));
  if (count) console.log(`Moved ${count} saved preview source paths to /media/host; catalog identities, media files, queue and history are retained. Verify older sources in Settings > Sources before scanning.`);
}
