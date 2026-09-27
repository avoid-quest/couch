import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type PlaybackRecord = { id: string; owner: string | null; storageKey: string | null; deviceIds: string[] };
type Row = Omit<PlaybackRecord, "deviceIds"> & { deviceIds: string };
const view = (row: Row): PlaybackRecord => ({ ...row, deviceIds: JSON.parse(row.deviceIds) as string[] });
const defaultKey = (clientId: string | null) => clientId === null ? "host" : `client:${clientId}`;

// Playback metadata shares Core's SQLite file; media state stays in its existing stores.
export function openPlaybackCatalog(databasePath: string, installationId: string) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS playback_catalog (
      id TEXT PRIMARY KEY, owner TEXT, storageKey TEXT, deviceIds TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS playback_defaults (
      clientKey TEXT PRIMARY KEY, playbackId TEXT NOT NULL REFERENCES playback_catalog(id)
    );
  `);
  const get = (id: string): PlaybackRecord | null => {
    const row = db.query<Row, [string]>("SELECT id, owner, storageKey, deviceIds FROM playback_catalog WHERE id = ?").get(id);
    return row ? view(row) : null;
  };
  const defaultFor = (clientId: string | null): PlaybackRecord => db.transaction(() => {
    const key = defaultKey(clientId);
    const selected = db.query<{ playbackId: string }, [string]>("SELECT playbackId FROM playback_defaults WHERE clientKey = ?").get(key);
    if (selected) return get(selected.playbackId)!;
    const id = clientId === null ? installationId : `personal:${clientId}`;
    // Existing household and personal session stores retain their exact IDs and file keys.
    db.query("INSERT OR IGNORE INTO playback_catalog (id, owner, storageKey) VALUES (?, ?, ?)").run(id, clientId, clientId);
    db.query("INSERT OR IGNORE INTO playback_defaults VALUES (?, ?)").run(key, id);
    return get(db.query<{ playbackId: string }, [string]>("SELECT playbackId FROM playback_defaults WHERE clientKey = ?").get(key)!.playbackId)!;
  }).immediate();
  return {
    defaultFor,
    create(clientId: string | null): PlaybackRecord {
      defaultFor(clientId);
      return db.transaction(() => {
        const id = `playback:${crypto.randomUUID()}`;
        db.query("INSERT INTO playback_catalog (id, owner, storageKey) VALUES (?, ?, ?)").run(id, clientId, id);
        return get(id)!;
      }).immediate();
    },
    select(clientId: string | null, id: string) {
      if (!get(id)) throw new Error("This playback is unavailable.");
      defaultFor(clientId);
      db.query("UPDATE playback_defaults SET playbackId = ? WHERE clientKey = ?").run(id, defaultKey(clientId));
    },
    get,
    all(): PlaybackRecord[] { return db.query<Row, []>("SELECT id, owner, storageKey, deviceIds FROM playback_catalog ORDER BY rowid").all().map(view); },
    assign(id: string, deviceIds: string[]): PlaybackRecord {
      if (!Array.isArray(deviceIds) || deviceIds.length > 32 || new Set(deviceIds).size !== deviceIds.length || !deviceIds.every(value => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value))) throw new Error("Choose up to 32 unique playback devices.");
      if (!get(id)) throw new Error("Playback not found.");
      db.query("UPDATE playback_catalog SET deviceIds = ? WHERE id = ?").run(JSON.stringify(deviceIds), id);
      return get(id)!;
    },
    close() { db.close(); },
  };
}
