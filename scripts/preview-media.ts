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
        ? db.query<{ id: string; path: string }, []>("SELECT id, path FROM library_sources WHERE path = '/media' OR path LIKE '/media/%'").all() : [];
      // Without the marker, "host" may be a real child of the old mounted directory.
      if (sources.some(source => source.path === "/media/host" || source.path.startsWith("/media/host/"))) throw new Error("Saved preview media layout is ambiguous. No paths were changed. Keep the data volume and follow the retained-mount recovery steps in tests/preview/README.md before restarting.");
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
