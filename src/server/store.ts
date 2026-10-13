import { streamingCommunityOrigin } from "../shared/streamingcommunity";
import { setupSteps, type SetupStep } from "../shared/setup";
import { Database } from "./sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlaybackPreferences, ProfilePlaybackPreferences, QueueEntry } from "../shared/protocol";
import type { HistoryItem, WatchingProfile } from "../shared/viewing";
import { defaultDeviceName, isDeviceId, UNNAMED_COUCH, type Device } from "../shared/devices";
import { ControllerError, deviceName } from "./devices";
import { ViewingError } from "./progress";
import { isInterfaceSize, type InterfaceSize } from "../shared/appearance";
import { CHANGED_ELSEWHERE } from "./messages";
import type { PlaybackContinuation } from "./continuation";

type ProgressRow = Omit<HistoryItem, "watched" | "playedBy"> & { watched: number; playedBy: string | null };
export type ProgressSnapshot = Array<ProgressRow & { profileId: string }>;
const progressView = ({ playedBy, ...row }: ProgressRow): HistoryItem => ({ ...row, watched: !!row.watched, ...(playedBy ? { playedBy: JSON.parse(playedBy) } : {}) });

function profileName(value: unknown) {
  if (typeof value !== "string") throw new ViewingError("Enter a watching profile name.");
  const name = value.trim();
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new ViewingError("Use a profile name with 1 to 60 characters.");
  return name;
}

export function openStore(path: string, remoteControlEnabled = false) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Main may save the name at the same time (app/device-name.ts).
  const db = new Database(path, { timeout: 5_000 });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      queue TEXT NOT NULL,
      volume REAL NOT NULL
    );
    INSERT OR IGNORE INTO session VALUES (1, '[]', 80);
    CREATE TABLE IF NOT EXISTS queue_position (id INTEGER PRIMARY KEY CHECK (id = 1), entryId TEXT);
    INSERT OR IGNORE INTO queue_position VALUES (1, NULL);
    CREATE TABLE IF NOT EXISTS playback_continuation (id INTEGER PRIMARY KEY CHECK (id = 1), context TEXT);
    INSERT OR IGNORE INTO playback_continuation VALUES (1, NULL);
    CREATE TABLE IF NOT EXISTS devices (token_hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS watching_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    INSERT OR IGNORE INTO watching_profiles (id, name) VALUES ('household', 'Household');
    CREATE TABLE IF NOT EXISTS watching_state (id INTEGER PRIMARY KEY CHECK (id = 1), profileId TEXT NOT NULL);
    INSERT OR IGNORE INTO watching_state VALUES (1, 'household');
    CREATE TABLE IF NOT EXISTS viewing_progress (
      profileId TEXT NOT NULL, mediaId TEXT NOT NULL, title TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0, duration REAL, watched INTEGER NOT NULL DEFAULT 0, lastPlayedAt INTEGER,
      PRIMARY KEY (profileId, mediaId)
    );
    CREATE INDEX IF NOT EXISTS viewing_history ON viewing_progress(profileId, lastPlayedAt DESC);
    CREATE INDEX IF NOT EXISTS shared_viewing_progress ON viewing_progress(mediaId, lastPlayedAt DESC);
    CREATE TABLE IF NOT EXISTS history_sources (mediaId TEXT PRIMARY KEY, entry TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS watching_preferences (profileId TEXT PRIMARY KEY, preferences TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bluetooth_output (id INTEGER PRIMARY KEY CHECK (id = 1), address TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audio_output (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, card TEXT, profile TEXT);
    CREATE TABLE IF NOT EXISTS playback_device (id INTEGER PRIMARY KEY CHECK (id = 1), audioDelay REAL NOT NULL);
    INSERT OR IGNORE INTO playback_device VALUES (1, 0);
  `);

  if (!db.query<{ name: string }, []>("PRAGMA table_info(watching_profiles)").all().some(column => column.name === "confirmedName")) {
    db.exec("ALTER TABLE watching_profiles ADD COLUMN confirmedName INTEGER NOT NULL DEFAULT 0");
  }
  if (!db.query<{ name: string }, []>("PRAGMA table_info(viewing_progress)").all().some(column => column.name === "playedBy")) {
    db.exec("ALTER TABLE viewing_progress ADD COLUMN playedBy TEXT");
  }
  const profileView = ({ id, name, confirmedName }: WatchingProfile & { confirmedName: number }): WatchingProfile => ({ id, name, ...(confirmedName ? { personName: name } : {}) });

  let legacyPairedInstallation = false;
  if (!db.query<{ name: string }, []>("PRAGMA table_info(devices)").all().some(column => column.name === "id")) {
    db.transaction(() => {
      db.exec(`CREATE TABLE devices_named (
        token_hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('controller', 'administrator')), createdAt INTEGER, lastSeenAt INTEGER
      )`);
      const devices = db.query<{ token_hash: string }, []>("SELECT token_hash FROM devices ORDER BY rowid").all();
      legacyPairedInstallation = devices.length > 0;
      for (const [index, device] of devices.entries()) db.query("INSERT INTO devices_named VALUES (?, ?, ?, 'controller', NULL, NULL)").run(device.token_hash, crypto.randomUUID(), `Remote ${index + 1}`);
      db.exec("DROP TABLE devices; ALTER TABLE devices_named RENAME TO devices;");
    }).immediate();
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS controller_claims (
      code_hash TEXT PRIMARY KEY, recovery INTEGER NOT NULL CHECK (recovery IN (0, 1)),
      expiresAt INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS streamingcommunity_origin (id INTEGER PRIMARY KEY CHECK (id = 1), origin TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL);
    INSERT OR IGNORE INTO installation (id, name) VALUES (1, '${UNNAMED_COUCH}');
    CREATE TABLE IF NOT EXISTS installation_identity (id INTEGER PRIMARY KEY CHECK (id = 1), installationId TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS installation_sharing (id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)));
    CREATE TABLE IF NOT EXISTS installation_origin_domain (id INTEGER PRIMARY KEY CHECK (id = 1), domain TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS installation_appearance (id INTEGER PRIMARY KEY CHECK (id = 1), scale REAL NOT NULL CHECK (scale IN (1, 1.15, 1.3)));
    INSERT OR IGNORE INTO installation_appearance VALUES (1, 1);
    CREATE TABLE IF NOT EXISTS sendspin_identity (id INTEGER PRIMARY KEY CHECK (id = 1), key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS device_sync_delay (id TEXT PRIMARY KEY, delay REAL NOT NULL);
  `);

  // Playbacks replace the one saved queue; it becomes the first Playback once (#644 ticket 9).
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'playback'").get()) db.transaction(() => {
    db.exec("CREATE TABLE playback (id TEXT PRIMARY KEY, queue TEXT NOT NULL, cursor TEXT, continuation TEXT)");
    const legacy = db.query<{ queue: string; cursor: string | null; context: string | null }, []>("SELECT s.queue, q.entryId AS cursor, c.context FROM session s, queue_position q, playback_continuation c").get();
    if (legacy && legacy.queue !== "[]") db.query("INSERT INTO playback VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), legacy.queue, legacy.cursor, legacy.context);
  }).immediate();
  // Each Playback keeps the Mixer's All trim; older rows play at the Devices' levels.
  if (!db.query<{ name: string }, []>("PRAGMA table_info(playback)").all().some(column => column.name === "mixTrim")) db.exec("ALTER TABLE playback ADD COLUMN mixTrim INTEGER NOT NULL DEFAULT 100");
  db.query("INSERT OR IGNORE INTO installation_identity VALUES (1, ?)").run(crypto.randomUUID());
  db.query("INSERT OR IGNORE INTO installation_sharing VALUES (1, ?)").run(Number(remoteControlEnabled));

  const hash = (token: string) => createHash("sha256").update(token).digest("hex");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(installation)").all().some(column => column.name === "deviceId")) {
    db.exec("ALTER TABLE installation ADD COLUMN deviceId TEXT");
  }
  // Every Device keeps one volume and mute; they start at the one volume Couch kept before.
  for (const table of ["devices", "installation"]) if (!db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some(column => column.name === "volume")) {
    const { volume } = db.query<{ volume: number }, []>("SELECT volume FROM session WHERE id = 1").get()!;
    db.exec(`ALTER TABLE ${table} ADD COLUMN volume REAL NOT NULL DEFAULT ${Number(volume)}; ALTER TABLE ${table} ADD COLUMN muted INTEGER NOT NULL DEFAULT 0`);
  }
  // Each row is a paired Device; the app window that runs this Couch is the
  // installation's Device, named by the installation name (#644 ticket 5).
  const deviceColumns = "id, name, role, createdAt, lastSeenAt";
  const pairedDevice = (id: string) => db.query<Device, [string]>(`SELECT ${deviceColumns} FROM devices WHERE id = ?`).get(id);
  const installation = () => db.query<{ name: string; deviceId: string | null }, []>("SELECT name, deviceId FROM installation WHERE id = 1").get()!;
  const hostDevice = (): Device | null => {
    const { name, deviceId } = installation();
    return deviceId ? { id: deviceId, name, role: "host", createdAt: null, lastSeenAt: null } : null;
  };
  const device = (id: string) => hostDevice()?.id === id ? hostDevice() : pairedDevice(id);
  const deviceForToken = (token: string) => token.length <= 128 ? db.query<Device, [string]>(`SELECT ${deviceColumns} FROM devices WHERE token_hash = ?`).get(hash(token)) : null;
  const administratorExists = () => db.query("SELECT 1 FROM devices WHERE role = 'administrator' LIMIT 1").get() !== null;
  const requireDevice = (id: string) => {
    const found = pairedDevice(id);
    if (!found) throw new ControllerError("This device is no longer paired.", 404);
    return found;
  };
  db.exec("CREATE TABLE IF NOT EXISTS installation_setup (id INTEGER PRIMARY KEY CHECK (id = 1), step TEXT NOT NULL)");
  db.query("INSERT OR IGNORE INTO installation_setup VALUES (1, ?)").run(administratorExists() || legacyPairedInstallation ? "complete" : "general");
  const setupStep = () => db.query<{ step: SetupStep }, []>("SELECT step FROM installation_setup WHERE id = 1").get()!.step;
  const claimRow = (code: string) => db.query<{ recovery: number; expiresAt: number; consumed: number }, [string]>("SELECT recovery, expiresAt, consumed FROM controller_claims WHERE code_hash = ?").get(hash(code));
  const progressColumns = "mediaId, title, position, duration, watched, lastPlayedAt, playedBy";
  const latestProgress = (mediaId: string) => db.query<ProgressRow & { profileId: string }, [string]>(`SELECT profileId, ${progressColumns} FROM viewing_progress WHERE mediaId = ? ORDER BY lastPlayedAt DESC, rowid DESC LIMIT 1`).get(mediaId);
  const activeProfile = () => profileView(db.query<WatchingProfile & { confirmedName: number }, []>("SELECT p.id, p.name, p.confirmedName FROM watching_profiles p JOIN watching_state s ON s.profileId = p.id WHERE s.id = 1").get()!);
  const availableProfileName = (value: unknown, id = "") => {
    const name = profileName(value);
    if (db.query("SELECT 1 FROM watching_profiles WHERE name = ? AND id != ?").get(name, id)) throw new ViewingError("A watching profile already has that name.");
    return name;
  };
  const unchangedProfile = (id: string, expectedName: string) => {
    const profile = db.query<WatchingProfile, [string]>("SELECT id, name FROM watching_profiles WHERE id = ?").get(id);
    if (!profile) throw new ViewingError("Watching profile not found. It may have been removed on another device.", 404);
    if (profile.name !== expectedName) throw new ViewingError(CHANGED_ELSEWHERE, 409);
    return profile;
  };

  return {
    installationId() { return db.query<{ installationId: string }, []>("SELECT installationId FROM installation_identity WHERE id = 1").get()!.installationId; },
    // Core's Sendspin server key (#644 ticket 10): clients know this Couch by it.
    sendspinKey(fresh: () => string) {
      if (!db.query("SELECT 1 FROM sendspin_identity").get()) db.query("INSERT INTO sendspin_identity VALUES (1, ?)").run(fresh());
      return db.query<{ key: string }, []>("SELECT key FROM sendspin_identity WHERE id = 1").get()!.key;
    },
    remoteControlEnabled() { return !!db.query<{ enabled: number }, []>("SELECT enabled FROM installation_sharing WHERE id = 1").get()!.enabled; },
    saveRemoteControlEnabled(enabled: boolean) { db.query("INSERT INTO installation_sharing VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled").run(Number(enabled)); },
    originDomain() { return db.query<{ domain: string }, []>("SELECT domain FROM installation_origin_domain WHERE id = 1").get()?.domain ?? ""; },
    saveOriginDomain(domain: string) { db.query("INSERT INTO installation_origin_domain VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET domain = excluded.domain").run(domain); },
    streamingCommunityOrigin: () => db.query<{ origin: string }, []>("SELECT origin FROM streamingcommunity_origin WHERE id = 1").get()?.origin ?? streamingCommunityOrigin,
    saveStreamingCommunityOrigin: (origin: string) => { db.query("INSERT INTO streamingcommunity_origin VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET origin = excluded.origin").run(origin); },
    audioOutput() { return db.query<{ name: string }, []>("SELECT name FROM audio_output WHERE id = 1").get()?.name ?? null; },
    setupStep,
    advanceSetup(expected: unknown) {
      return db.transaction(() => {
        const current = setupStep();
        if (expected !== current || current === "complete") throw new ControllerError("Setup changed. Review the current step and try again.", 409);
        const next = setupSteps[setupSteps.indexOf(current) + 1]!;
        db.query("UPDATE installation_setup SET step = ? WHERE id = 1").run(next);
        return next;
      }).immediate();
    },
    audioProfile() { const value = db.query<{ card: string | null; profile: string | null }, []>("SELECT card, profile FROM audio_output WHERE id = 1").get(); const bluetooth = db.query<{ address: string }, []>("SELECT address FROM bluetooth_output WHERE id = 1").get(); return value?.card && value.profile ? { card: value.card, profile: value.profile, ...(bluetooth ? { bluetoothAddress: bluetooth.address } : {}) } : null; },
    saveAudioOutput(name: string, profile?: import("../shared/sound").SavedSoundProfile | null) { db.transaction(() => { db.query("INSERT INTO audio_output VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,card=excluded.card,profile=excluded.profile").run(name, profile?.card ?? null, profile?.profile ?? null); if (profile?.bluetoothAddress) db.query("INSERT INTO bluetooth_output VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET address=excluded.address").run(profile.bluetoothAddress); else db.exec("DELETE FROM bluetooth_output"); })(); },
    tvInterfaceSize(): InterfaceSize { return db.query<{ scale: InterfaceSize }, []>("SELECT scale FROM installation_appearance WHERE id = 1").get()!.scale; },
    saveTvInterfaceSize(size: InterfaceSize) {
      if (!isInterfaceSize(size)) throw new ControllerError("Choose a supported interface size.");
      db.query("UPDATE installation_appearance SET scale = ? WHERE id = 1").run(size);
    },
    // Each Playback keeps its own Up next, cursor and Autoplay context (#644 ticket 9).
    playbackIds() { return db.query<{ id: string }, []>("SELECT id FROM playback ORDER BY rowid").all().map(row => row.id); },
    forgetPlayback(id: string) { db.query("DELETE FROM playback WHERE id = ?").run(id); },
    playback(id: string) {
      const row = () => db.query<{ queue: string; cursor: string | null; continuation: string | null; mixTrim: number }, [string]>("SELECT queue, cursor, continuation, mixTrim FROM playback WHERE id = ?").get(id);
      const save = (column: "queue" | "cursor" | "continuation" | "mixTrim", value: string | number | null) => {
        db.query("INSERT OR IGNORE INTO playback (id, queue) VALUES (?, '[]')").run(id);
        db.query(`UPDATE playback SET ${column} = ? WHERE id = ?`).run(value, id);
      };
      return {
        queue: JSON.parse(row()?.queue ?? "[]") as QueueEntry[],
        queueCursorEntryId() { return row()?.cursor ?? null; },
        playbackContinuation(): PlaybackContinuation | null { const value = row()?.continuation; return value ? JSON.parse(value) : null; },
        mixTrim() { return row()?.mixTrim ?? 100; },
        saveMixTrim(level: number) { save("mixTrim", level); },
        savePlaybackContinuation(context: PlaybackContinuation | null) { save("continuation", context ? JSON.stringify(context) : null); },
        saveQueueCursor(entryId: string, beforeCommit?: () => void) { db.transaction(() => {
          const previous = row()?.cursor ?? null;
          save("cursor", entryId); beforeCommit?.();
          // A live input is usable only while its capture exists, never after restart.
          const current = row();
          if (current?.cursor === entryId) {
            const queue = JSON.parse(current.queue) as QueueEntry[];
            if (!queue.some(entry => entry.id === entryId)) save("cursor", queue.some(entry => entry.id === previous) ? previous : null);
          }
        })(); },
        saveQueue(queue: QueueEntry[], cursorEntryId: string | null = null) { db.transaction(() => {
          const retained = queue.filter(entry => !entry.liveSourceId);
          const cursor = queue.findIndex(entry => entry.id === cursorEntryId);
          save("queue", JSON.stringify(retained));
          save("cursor", queue.slice(0, cursor + 1).findLast(entry => !entry.liveSourceId)?.id ?? null);
        })(); },
      };
    },
    profiles() { return db.query<WatchingProfile & { confirmedName: number }, []>("SELECT id, name, confirmedName FROM watching_profiles ORDER BY name COLLATE NOCASE, id").all().map(profileView); },
    activeProfile,
    playbackPreferences(profileId: string): PlaybackPreferences {
      const row = db.query<{ preferences: string }, [string]>("SELECT preferences FROM watching_preferences WHERE profileId = ?").get(profileId);
      const device = db.query<{ audioDelay: number }, []>("SELECT audioDelay FROM playback_device WHERE id = 1").get()!;
      // Older installations also saved replayGain; local music playback is gone.
      const { replayGain: _replayGain, ...profile } = row ? JSON.parse(row.preferences) : { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1 };
      return { profile, device };
    },
    saveProfilePreferences(profileId: string, preferences: ProfilePlaybackPreferences) {
      db.query("INSERT INTO watching_preferences VALUES (?, ?) ON CONFLICT(profileId) DO UPDATE SET preferences=excluded.preferences").run(profileId, JSON.stringify(preferences));
    },
    saveAudioDelay(delay: number) {
      db.query("UPDATE playback_device SET audioDelay = ? WHERE id = 1").run(delay);
    },
    createProfile(value: unknown) {
      return db.transaction(() => {
        const name = availableProfileName(value);
        if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM watching_profiles").get()!.count >= 20) throw new ViewingError("You can create up to 20 watching profiles.");
        const profile = { id: crypto.randomUUID(), name };
        db.query("INSERT INTO watching_profiles (id, name) VALUES (?, ?)").run(profile.id, profile.name);
        return profile;
      }).immediate();
    },
    renameProfile(id: string, value: unknown, expectedName: string) {
      return db.transaction(() => {
        unchangedProfile(id, expectedName);
        const name = availableProfileName(value, id);
        db.query("UPDATE watching_profiles SET name = ?, confirmedName = 0 WHERE id = ?").run(name, id);
        return { id, name };
      }).immediate();
    },
    namePerson(id: string, value: unknown, expectedName: string) {
      return db.transaction(() => {
        unchangedProfile(id, expectedName);
        if (typeof value !== "string" || !value.trim() || value.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(value)) throw new ViewingError("Enter your name using 1 to 60 characters.");
        const name = value.trim();
        if (db.query("SELECT 1 FROM watching_profiles WHERE name = ? AND id != ?").get(name, id)) throw new ViewingError("Name taken. Pick it from Existing histories.");
        db.query("UPDATE watching_profiles SET name = ?, confirmedName = 1 WHERE id = ?").run(name, id);
        return { id, name, personName: name };
      }).immediate();
    },
    removeProfile(id: string, expectedName: string) {
      return db.transaction(() => {
        unchangedProfile(id, expectedName);
        if (id === "household") throw new ViewingError("The shared default watching profile cannot be removed.", 409);
        if (activeProfile().id === id) db.exec("UPDATE playback SET continuation = NULL");
        db.query("UPDATE watching_state SET profileId = 'household' WHERE profileId = ?").run(id);
        db.query("DELETE FROM viewing_progress WHERE profileId = ?").run(id);
        db.query("DELETE FROM watching_preferences WHERE profileId = ?").run(id);
        db.query("DELETE FROM watching_profiles WHERE id = ?").run(id);
        return activeProfile();
      }).immediate();
    },
    selectProfile(id: string) {
      const profile = db.query<WatchingProfile & { confirmedName: number }, [string]>("SELECT id, name, confirmedName FROM watching_profiles WHERE id = ?").get(id);
      if (!profile) throw new ViewingError("Watching profile not found.", 404);
      db.transaction(() => {
        db.exec("UPDATE playback SET continuation = NULL");
        db.query("UPDATE watching_state SET profileId = ? WHERE id = 1").run(id);
      }).immediate();
      return profileView(profile);
    },
    progress(profileId: string, mediaId: string) {
      const row = db.query<ProgressRow, [string, string]>(`SELECT ${progressColumns} FROM viewing_progress WHERE profileId = ? AND mediaId = ?`).get(profileId, mediaId);
      return row ? progressView(row) : null;
    },
    history(profileId: string, limit = 40): HistoryItem[] {
      return db.query<ProgressRow, [string, number]>(`SELECT ${progressColumns} FROM viewing_progress WHERE profileId = ? AND lastPlayedAt IS NOT NULL ORDER BY lastPlayedAt DESC, mediaId LIMIT ?`)
        .all(profileId, Math.max(1, Math.min(100, Math.floor(limit) || 40))).map(progressView);
    },
    progressOwner(mediaId: string) { return latestProgress(mediaId)?.profileId ?? null; },
    sharedProgress(mediaId: string): HistoryItem | null {
      const row = latestProgress(mediaId);
      if (!row) return null;
      const { profileId: _profileId, ...progress } = row;
      return progressView(progress);
    },
    sharedProgressRows(mediaId: string): ProgressSnapshot {
      return db.query<ProgressRow & { profileId: string }, [string]>(`SELECT profileId, ${progressColumns} FROM viewing_progress WHERE mediaId = ? ORDER BY profileId`).all(mediaId);
    },
    sharedHistory(limit = 40, include: (mediaId: string) => boolean = () => true): HistoryItem[] {
      const items: HistoryItem[] = [];
      const maximum = Math.max(1, Math.min(100, Math.floor(limit) || 40));
      const statement = db.query<ProgressRow, []>(`SELECT ${progressColumns} FROM (
        SELECT ${progressColumns}, ROW_NUMBER() OVER (PARTITION BY mediaId ORDER BY lastPlayedAt DESC, rowid DESC) AS latest
        FROM viewing_progress WHERE lastPlayedAt IS NOT NULL
      ) WHERE latest = 1 ORDER BY lastPlayedAt DESC, mediaId`);
      for (const row of statement.iterate()) {
        if (include(row.mediaId)) items.push(progressView(row));
        if (items.length === maximum) break;
      }
      return items;
    },
    historySource(mediaId: string): QueueEntry | null {
      const row = db.query<{ entry: string }, [string]>("SELECT entry FROM history_sources WHERE mediaId = ?").get(mediaId);
      return row ? JSON.parse(row.entry) : null;
    },
    enrichHistorySource(mediaId: string, source: string, metadata: Pick<QueueEntry, "thumbnail" | "subtitle" | "description" | "collection">) {
      const row = db.query<{ entry: string }, [string]>("SELECT entry FROM history_sources WHERE mediaId = ? AND EXISTS (SELECT 1 FROM viewing_progress WHERE mediaId = history_sources.mediaId)").get(mediaId);
      if (!row) return false;
      const entry: QueueEntry = JSON.parse(row.entry);
      if (entry.source !== source) return false;
      const next = JSON.stringify({ ...entry, ...metadata, ...(entry.collection ? { collection: entry.collection } : {}) });
      if (next === row.entry) return false;
      db.query("UPDATE history_sources SET entry = ? WHERE mediaId = ? AND entry = ?").run(next, mediaId, row.entry);
      return true;
    },
    saveProgress(profileId: string, item: HistoryItem, entry?: QueueEntry) {
      db.transaction(() => {
        db.query(`INSERT INTO viewing_progress (profileId, mediaId, title, position, duration, watched, lastPlayedAt, playedBy)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profileId, mediaId) DO UPDATE SET
          title=excluded.title, position=excluded.position, duration=excluded.duration,
          watched=(viewing_progress.watched OR excluded.watched), lastPlayedAt=excluded.lastPlayedAt, playedBy=excluded.playedBy`)
          .run(profileId, item.mediaId, item.title, item.position, item.duration, Number(item.watched), item.lastPlayedAt, item.playedBy ? JSON.stringify(item.playedBy) : null);
        if (entry) {
          const saved = db.query<{ entry: string }, [string]>("SELECT entry FROM history_sources WHERE mediaId = ?").get(item.mediaId);
          const previous: QueueEntry | undefined = saved ? JSON.parse(saved.entry) : undefined;
          // A playing item's snapshot can predate a catalog refresh. Preserve its
          // trusted descriptive fields without changing transport or progress.
          const metadata = previous?.source === entry.source ? Object.fromEntries((["subtitle", "description", "thumbnail"] as const).flatMap(key => previous[key] ? [[key, previous[key]]] : [])) : {};
          db.query("INSERT INTO history_sources VALUES (?, ?) ON CONFLICT(mediaId) DO UPDATE SET entry=excluded.entry WHERE history_sources.entry != excluded.entry").run(item.mediaId, JSON.stringify({ ...entry, ...metadata, ...(!entry.collection && previous?.id === entry.id && previous.collection ? { collection: previous.collection } : {}) }));
        }
      })();
    },
    editSharedProgress(profileId: string, mediaId: string, changes: { watched?: boolean; clearResume?: boolean }, item: { title: string }) {
      db.transaction(() => {
        profileId = latestProgress(mediaId)?.profileId ?? profileId;
        db.query("INSERT OR IGNORE INTO viewing_progress (profileId, mediaId, title) VALUES (?, ?, ?)").run(profileId, mediaId, item.title);
        if (changes.watched !== undefined) db.query("UPDATE viewing_progress SET watched = ? WHERE profileId = ? AND mediaId = ?").run(Number(changes.watched), profileId, mediaId);
        if (changes.clearResume) db.query("UPDATE viewing_progress SET position = 0 WHERE profileId = ? AND mediaId = ?").run(profileId, mediaId);
      })();
    },
    takeSharedProgress(mediaId: string): ProgressSnapshot {
      return db.transaction(() => {
        const rows = db.query<ProgressRow & { profileId: string }, [string]>(`SELECT profileId, ${progressColumns} FROM viewing_progress WHERE mediaId = ? ORDER BY profileId`).all(mediaId);
        if (rows.length) db.query("DELETE FROM viewing_progress WHERE mediaId = ?").run(mediaId);
        return rows;
      }).immediate();
    },
    restoreSharedProgress(rows: ProgressSnapshot, expected: ProgressSnapshot = []) {
      db.transaction(() => {
        if (!rows.length) throw new ViewingError("This history item is no longer available to restore.", 410);
        const current = db.query<ProgressRow & { profileId: string }, [string]>(`SELECT profileId, ${progressColumns} FROM viewing_progress WHERE mediaId = ? ORDER BY profileId`).all(rows[0]!.mediaId);
        if (JSON.stringify(current) !== JSON.stringify(expected)) throw new ViewingError("This history item changed. Check the current history before trying again.", 409);
        db.query("DELETE FROM viewing_progress WHERE mediaId = ?").run(rows[0]!.mediaId);
        const restore = db.query(`INSERT INTO viewing_progress (profileId, mediaId, title, position, duration, watched, lastPlayedAt, playedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const row of rows) {
          if (!db.query("SELECT 1 FROM watching_profiles WHERE id = ?").get(row.profileId)) throw new ViewingError("A watching profile changed after removal. Check the current history.", 409);
          restore.run(row.profileId, row.mediaId, row.title, row.position, row.duration, row.watched, row.lastPlayedAt, row.playedBy);
        }
      }).immediate();
    },
    // The app window that runs this Couch keeps its volume with the installation; "host" until it has an ID.
    deviceSound(id: string): { volume: number; muted: boolean } {
      const row = id === (installation().deviceId ?? "host") ? db.query<{ volume: number; muted: number }, []>("SELECT volume, muted FROM installation WHERE id = 1").get()
        : db.query<{ volume: number; muted: number }, [string]>("SELECT volume, muted FROM devices WHERE id = ?").get(id);
      return { volume: row?.volume ?? 0, muted: !!row?.muted };
    },
    saveDeviceSound(id: string, { volume = null, muted = null }: { volume?: number | null; muted?: boolean | null }) {
      const sql = "SET volume = coalesce(?, volume), muted = coalesce(?, muted)";
      if (id === (installation().deviceId ?? "host")) db.query(`UPDATE installation ${sql} WHERE id = 1`).run(volume, muted === null ? null : Number(muted));
      else db.query(`UPDATE devices ${sql} WHERE id = ?`).run(volume, muted === null ? null : Number(muted), id);
    },
    // A speaker's Sendspin static delay as it last reported it; its player keeps the value itself.
    deviceSyncDelay: (id: string) => db.query<{ delay: number }, [string]>("SELECT delay FROM device_sync_delay WHERE id = ?").get(id)?.delay,
    saveDeviceSyncDelay(id: string, delay: number) { db.query("INSERT INTO device_sync_delay VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET delay = excluded.delay").run(id, delay); },
    /** Pairs the Device whose key is `id`, or gives an already paired key a new token. */
    pair(id: unknown, name?: unknown) {
      if (!isDeviceId(id)) throw new ControllerError("Update Couch on this device, then pair again.");
      if (id === installation().deviceId) throw new ControllerError("This device already runs this Couch.", 409);
      const label = name === undefined || name === "" ? defaultDeviceName(id) : deviceName(name);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const now = Date.now();
      db.transaction(() => {
        if (pairedDevice(id)) db.query("UPDATE devices SET token_hash = ?, name = ?, lastSeenAt = ? WHERE id = ?").run(hash(token), label, now, id);
        else {
          const role = db.query("SELECT 1 FROM devices LIMIT 1").get() ? "controller" : "administrator";
          db.query("INSERT INTO devices (token_hash, id, name, role, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)").run(hash(token), id, label, role, now, now);
        }
      }).immediate();
      return token;
    },
    /**
     * A connected Device presents its key. Pairings made before keys were IDs,
     * and Devices whose key changed, take the presented key as their ID. Returns
     * whether anything changed.
     */
    identify(token: string | null, id: unknown) {
      if (!isDeviceId(id)) return false;
      if (token === null) {
        if (installation().deviceId === id || pairedDevice(id)) return false;
        db.query("UPDATE installation SET deviceId = ? WHERE id = 1").run(id);
        return true;
      }
      const current = deviceForToken(token);
      if (!current || current.id === id || device(id)) return false;
      db.query("UPDATE devices SET id = ? WHERE id = ?").run(id, current.id);
      return true;
    },
    device,
    hostDevice,
    devices(): Device[] {
      const host = hostDevice();
      return [...host ? [host] : [], ...db.query<Device, []>(`SELECT ${deviceColumns} FROM devices ORDER BY createdAt, id`).all()];
    },
    renameDevice(id: string, value: unknown) {
      const name = deviceName(value);
      requireDevice(id);
      db.query("UPDATE devices SET name = ? WHERE id = ?").run(name, id);
      return pairedDevice(id)!;
    },
    setDeviceRole(id: string, role: unknown) {
      if (role !== "controller" && role !== "administrator") throw new ControllerError("Choose a role.");
      return db.transaction(() => {
        requireDevice(id);
        db.query("UPDATE devices SET role = ? WHERE id = ?").run(role, id);
        return pairedDevice(id)!;
      }).immediate();
    },
    revokeDevice(id: string) {
      db.transaction(() => {
        requireDevice(id);
        db.query("DELETE FROM devices WHERE id = ?").run(id);
        db.query("DELETE FROM device_sync_delay WHERE id = ?").run(id);
      }).immediate();
    },
    deviceForToken,
    touchDevice(id: string) {
      const now = Date.now();
      db.query("UPDATE devices SET lastSeenAt = ? WHERE id = ? AND (lastSeenAt IS NULL OR lastSeenAt <= ?)").run(now, id, now - 60_000);
    },
    administratorExists,
    controllerClaim(code: string) {
      const row = claimRow(code);
      return row ? { expiresAt: row.expiresAt, consumed: !!row.consumed } : null;
    },
    createControllerClaim(code: string, recovery: boolean) {
      return db.transaction(() => {
        if (!recovery) db.query("DELETE FROM controller_claims WHERE recovery = 0 AND consumed = 0 AND code_hash != ?").run(hash(code));
        // Reconfiguring a recovery code must never extend its first expiry or revive it.
        db.query("INSERT OR IGNORE INTO controller_claims (code_hash, recovery, expiresAt) VALUES (?, ?, ?)").run(hash(code), Number(recovery), Date.now() + 600_000);
        const row = claimRow(code)!;
        return { expiresAt: row.expiresAt, consumed: !!row.consumed };
      }).immediate();
    },
    consumeControllerClaim(id: string, code: string): Device {
      return db.transaction(() => {
        const claimant = pairedDevice(id);
        if (!claimant) throw new ControllerError("Pair this device first.", 401);
        if (claimant.role !== "controller") throw new ControllerError("This device is already an admin.", 409);
        const claim = claimRow(code);
        if (!claim || claim.consumed || claim.expiresAt <= Date.now()) throw new ControllerError("This admin code is wrong or expired.", 401);
        if (!claim.recovery && administratorExists()) throw new ControllerError("This Couch already has an admin.", 409);
        db.query("UPDATE devices SET role = 'administrator' WHERE id = ?").run(id);
        db.query("UPDATE controller_claims SET consumed = 1 WHERE code_hash = ?").run(hash(code));
        return pairedDevice(id)!;
      }).immediate();
    },
    installationName() { return db.query<{ name: string }, []>("SELECT name FROM installation WHERE id = 1").get()!.name; },
    renameInstallation(value: unknown) {
      const name = deviceName(value);
      db.query("UPDATE installation SET name = ? WHERE id = 1").run(name);
      return name;
    },
    close() { db.close(); },
  };
}

export type Store = ReturnType<typeof openStore>;
