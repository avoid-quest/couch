import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlaybackPreferences, ProfilePlaybackPreferences, QueueEntry } from "../shared/protocol";
import type { HistoryItem, WatchingProfile } from "../shared/library";
import { ViewingError } from "./progress";

type ProgressRow = Omit<HistoryItem, "watched"> & { watched: number };
const progressView = (row: ProgressRow): HistoryItem => ({ ...row, watched: !!row.watched });

export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      queue TEXT NOT NULL,
      volume REAL NOT NULL
    );
    INSERT OR IGNORE INTO session VALUES (1, '[]', 80);
    CREATE TABLE IF NOT EXISTS devices (token_hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS watching_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    INSERT OR IGNORE INTO watching_profiles VALUES ('household', 'Household');
    CREATE TABLE IF NOT EXISTS watching_state (id INTEGER PRIMARY KEY CHECK (id = 1), profileId TEXT NOT NULL);
    INSERT OR IGNORE INTO watching_state VALUES (1, 'household');
    CREATE TABLE IF NOT EXISTS viewing_progress (
      profileId TEXT NOT NULL, mediaId TEXT NOT NULL, title TEXT NOT NULL, libraryItemId TEXT,
      position REAL NOT NULL DEFAULT 0, duration REAL, watched INTEGER NOT NULL DEFAULT 0, lastPlayedAt INTEGER,
      PRIMARY KEY (profileId, mediaId)
    );
    CREATE INDEX IF NOT EXISTS viewing_history ON viewing_progress(profileId, lastPlayedAt DESC);
    CREATE TABLE IF NOT EXISTS watching_preferences (profileId TEXT PRIMARY KEY, preferences TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS playback_device (id INTEGER PRIMARY KEY CHECK (id = 1), audioDelay REAL NOT NULL);
    INSERT OR IGNORE INTO playback_device VALUES (1, 0);
  `);

  const stored = db.query<{ queue: string; volume: number }, []>("SELECT queue, volume FROM session WHERE id = 1").get()!;
  const hash = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");
  const progressColumns = "mediaId, title, libraryItemId, position, duration, watched, lastPlayedAt";

  return {
    queue: JSON.parse(stored.queue) as QueueEntry[],
    volume: stored.volume,
    profiles() { return db.query<WatchingProfile, []>("SELECT id, name FROM watching_profiles ORDER BY name COLLATE NOCASE, id").all(); },
    activeProfile() { return db.query<WatchingProfile, []>("SELECT p.id, p.name FROM watching_profiles p JOIN watching_state s ON s.profileId = p.id WHERE s.id = 1").get()!; },
    playbackPreferences(profileId: string): PlaybackPreferences {
      const row = db.query<{ preferences: string }, [string]>("SELECT preferences FROM watching_preferences WHERE profileId = ?").get(profileId);
      const device = db.query<{ audioDelay: number }, []>("SELECT audioDelay FROM playback_device WHERE id = 1").get()!;
      return { profile: row ? JSON.parse(row.preferences) : { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1 }, device };
    },
    saveProfilePreferences(profileId: string, preferences: ProfilePlaybackPreferences) {
      db.query("INSERT INTO watching_preferences VALUES (?, ?) ON CONFLICT(profileId) DO UPDATE SET preferences=excluded.preferences").run(profileId, JSON.stringify(preferences));
    },
    saveAudioDelay(delay: number) {
      db.query("UPDATE playback_device SET audioDelay = ? WHERE id = 1").run(delay);
    },
    createProfile(name: string) {
      name = name.trim();
      if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new ViewingError("Use a profile name with 1 to 60 characters.");
      if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM watching_profiles").get()!.count >= 20) throw new ViewingError("You can create up to 20 watching profiles.");
      if (db.query("SELECT 1 FROM watching_profiles WHERE name = ?").get(name)) throw new ViewingError("A watching profile already has that name.");
      const profile = { id: crypto.randomUUID(), name };
      db.query("INSERT INTO watching_profiles VALUES (?, ?)").run(profile.id, profile.name);
      return profile;
    },
    selectProfile(id: string) {
      const profile = db.query<WatchingProfile, [string]>("SELECT id, name FROM watching_profiles WHERE id = ?").get(id);
      if (!profile) throw new ViewingError("Watching profile not found.", 404);
      db.query("UPDATE watching_state SET profileId = ? WHERE id = 1").run(id);
      return profile;
    },
    progress(profileId: string, mediaId: string) {
      const row = db.query<ProgressRow, [string, string]>(`SELECT ${progressColumns} FROM viewing_progress WHERE profileId = ? AND mediaId = ?`).get(profileId, mediaId);
      return row ? progressView(row) : null;
    },
    history(profileId: string, limit = 40): HistoryItem[] {
      return db.query<ProgressRow, [string, number]>(`SELECT ${progressColumns} FROM viewing_progress WHERE profileId = ? AND lastPlayedAt IS NOT NULL ORDER BY lastPlayedAt DESC, mediaId LIMIT ?`)
        .all(profileId, Math.max(1, Math.min(100, Math.floor(limit) || 40))).map(progressView);
    },
    saveProgress(profileId: string, item: HistoryItem) {
      db.query(`INSERT INTO viewing_progress (profileId, mediaId, title, libraryItemId, position, duration, watched, lastPlayedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profileId, mediaId) DO UPDATE SET
        title=excluded.title, libraryItemId=excluded.libraryItemId, position=excluded.position, duration=excluded.duration,
        watched=(viewing_progress.watched OR excluded.watched), lastPlayedAt=excluded.lastPlayedAt`)
        .run(profileId, item.mediaId, item.title, item.libraryItemId, item.position, item.duration, Number(item.watched), item.lastPlayedAt);
    },
    editProgress(profileId: string, mediaId: string, changes: { watched?: boolean; clearResume?: boolean }, item: { title: string; libraryItemId: string | null }) {
      db.transaction(() => {
        db.query("INSERT OR IGNORE INTO viewing_progress (profileId, mediaId, title, libraryItemId) VALUES (?, ?, ?, ?)").run(profileId, mediaId, item.title, item.libraryItemId);
        if (changes.watched !== undefined) db.query("UPDATE viewing_progress SET watched = ? WHERE profileId = ? AND mediaId = ?").run(Number(changes.watched), profileId, mediaId);
        if (changes.clearResume) db.query("UPDATE viewing_progress SET position = 0 WHERE profileId = ? AND mediaId = ?").run(profileId, mediaId);
      })();
    },
    saveQueue(queue: QueueEntry[]) {
      db.query("UPDATE session SET queue = ? WHERE id = 1").run(JSON.stringify(queue));
    },
    saveVolume(volume: number) {
      db.query("UPDATE session SET volume = ? WHERE id = 1").run(volume);
    },
    pair() {
      const token = crypto.randomUUID() + crypto.randomUUID();
      db.query("INSERT INTO devices VALUES (?)").run(hash(token));
      return token;
    },
    isPaired(token: string) {
      return token.length <= 128 && db.query("SELECT 1 FROM devices WHERE token_hash = ?").get(hash(token)) !== null;
    },
    close() { db.close(); },
  };
}

export type Store = ReturnType<typeof openStore>;
