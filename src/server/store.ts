import { streamingCommunityOrigin } from "../shared/streamingcommunity";
import { setupSteps, type SetupStep } from "../shared/setup";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlaybackPreferences, ProfilePlaybackPreferences, QueueEntry } from "../shared/protocol";
import type { HistoryItem, WatchingProfile } from "../shared/library";
import type { Controller } from "../shared/controllers";
import { ControllerError, controllerName } from "./controllers";
import { ViewingError } from "./progress";
import { isInterfaceSize, type InterfaceSize } from "../shared/appearance";

type ProgressRow = Omit<HistoryItem, "watched"> & { watched: number };
const progressView = (row: ProgressRow): HistoryItem => ({ ...row, watched: !!row.watched });

function profileName(value: unknown) {
  if (typeof value !== "string") throw new ViewingError("Enter a watching profile name.");
  const name = value.trim();
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new ViewingError("Use a profile name with 1 to 60 characters.");
  return name;
}

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
    CREATE TABLE IF NOT EXISTS queue_position (id INTEGER PRIMARY KEY CHECK (id = 1), entryId TEXT);
    INSERT OR IGNORE INTO queue_position VALUES (1, NULL);
    CREATE TABLE IF NOT EXISTS devices (token_hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS watching_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    INSERT OR IGNORE INTO watching_profiles (id, name) VALUES ('household', 'Household');
    CREATE TABLE IF NOT EXISTS watching_state (id INTEGER PRIMARY KEY CHECK (id = 1), profileId TEXT NOT NULL);
    INSERT OR IGNORE INTO watching_state VALUES (1, 'household');
    CREATE TABLE IF NOT EXISTS viewing_progress (
      profileId TEXT NOT NULL, mediaId TEXT NOT NULL, title TEXT NOT NULL, libraryItemId TEXT,
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
    db.run("ALTER TABLE watching_profiles ADD COLUMN confirmedName INTEGER NOT NULL DEFAULT 0");
  }
  const profileView = ({ id, name, confirmedName }: WatchingProfile & { confirmedName: number }): WatchingProfile => ({ id, name, ...(confirmedName ? { personName: name } : {}) });

  let legacyPairedInstallation = false;
  if (!db.query<{ name: string }, []>("PRAGMA table_info(devices)").all().some(column => column.name === "id")) {
    db.transaction(() => {
      db.run(`CREATE TABLE devices_named (
        token_hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('controller', 'administrator')), createdAt INTEGER, lastSeenAt INTEGER
      )`);
      const devices = db.query<{ token_hash: string }, []>("SELECT token_hash FROM devices ORDER BY rowid").all();
      legacyPairedInstallation = devices.length > 0;
      for (const [index, device] of devices.entries()) db.query("INSERT INTO devices_named VALUES (?, ?, ?, 'controller', NULL, NULL)").run(device.token_hash, crypto.randomUUID(), `Remote ${index + 1}`);
      db.run("DROP TABLE devices; ALTER TABLE devices_named RENAME TO devices;");
    }).immediate();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS controller_claims (
      code_hash TEXT PRIMARY KEY, recovery INTEGER NOT NULL CHECK (recovery IN (0, 1)),
      expiresAt INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS streamingcommunity_origin (id INTEGER PRIMARY KEY CHECK (id = 1), origin TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL);
    INSERT OR IGNORE INTO installation VALUES (1, 'Couch');
    CREATE TABLE IF NOT EXISTS installation_appearance (id INTEGER PRIMARY KEY CHECK (id = 1), scale REAL NOT NULL CHECK (scale IN (1, 1.15, 1.3)));
    INSERT OR IGNORE INTO installation_appearance VALUES (1, 1);
  `);

  const stored = db.query<{ queue: string; volume: number }, []>("SELECT queue, volume FROM session WHERE id = 1").get()!;
  const hash = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");
  const controllerColumns = "id, name, role, createdAt, lastSeenAt";
  const controller = (id: string) => db.query<Controller, [string]>(`SELECT ${controllerColumns} FROM devices WHERE id = ?`).get(id);
  const administratorExists = () => db.query("SELECT 1 FROM devices WHERE role = 'administrator' LIMIT 1").get() !== null;
  const requireController = (id: string) => {
    const device = controller(id);
    if (!device) throw new ControllerError("This remote is no longer paired.", 404);
    return device;
  };
  const protectAdministrator = (device: Controller) => {
    if (device.role === "administrator" && !db.query("SELECT 1 FROM devices WHERE role = 'administrator' AND id != ? LIMIT 1").get(device.id)) throw new ControllerError("Keep at least one administrator. Approve another remote first.", 409);
  };
  db.run("CREATE TABLE IF NOT EXISTS installation_setup (id INTEGER PRIMARY KEY CHECK (id = 1), step TEXT NOT NULL)");
  db.query("INSERT OR IGNORE INTO installation_setup VALUES (1, ?)").run(administratorExists() || legacyPairedInstallation ? "complete" : "general");
  const setupStep = () => db.query<{ step: SetupStep }, []>("SELECT step FROM installation_setup WHERE id = 1").get()!.step;
  const claimRow = (code: string) => db.query<{ recovery: number; expiresAt: number; consumed: number }, [string]>("SELECT recovery, expiresAt, consumed FROM controller_claims WHERE code_hash = ?").get(hash(code));
  const progressColumns = "mediaId, title, libraryItemId, position, duration, watched, lastPlayedAt";
  const latestProgress = (mediaId: string) => db.query<ProgressRow & { profileId: string }, [string]>(`SELECT profileId, ${progressColumns} FROM viewing_progress WHERE mediaId = ? ORDER BY lastPlayedAt DESC, rowid DESC LIMIT 1`).get(mediaId);
  const activeProfile = () => profileView(db.query<WatchingProfile & { confirmedName: number }, []>("SELECT p.id, p.name, p.confirmedName FROM watching_profiles p JOIN watching_state s ON s.profileId = p.id WHERE s.id = 1").get()!);
  const availableProfileName = (value: unknown, id = "") => {
    const name = profileName(value);
    if (db.query("SELECT 1 FROM watching_profiles WHERE name = ? AND id != ?").get(name, id)) throw new ViewingError("A watching profile already has that name.");
    return name;
  };
  const unchangedProfile = (id: string, expectedName: string) => {
    const profile = db.query<WatchingProfile, [string]>("SELECT id, name FROM watching_profiles WHERE id = ?").get(id);
    if (!profile) throw new ViewingError("Watching profile not found. It may have been removed on another remote.", 404);
    if (profile.name !== expectedName) throw new ViewingError("This watching profile was renamed on another remote. Review its current name and try again.", 409);
    return profile;
  };

  return {
    streamingCommunityOrigin: () => db.query<{ origin: string }, []>("SELECT origin FROM streamingcommunity_origin WHERE id = 1").get()?.origin ?? streamingCommunityOrigin,
    saveStreamingCommunityOrigin: (origin: string) => { db.query("INSERT INTO streamingcommunity_origin VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET origin = excluded.origin").run(origin); },
    audioOutput() { return db.query<{ name: string }, []>("SELECT name FROM audio_output WHERE id = 1").get()?.name ?? null; },
    setupStep,
    advanceSetup(expected: unknown) {
      return db.transaction(() => {
        if (!administratorExists()) throw new ControllerError("Claim an administrator before continuing setup.", 409);
        const current = setupStep();
        if (expected !== current || current === "complete") throw new ControllerError("Setup changed. Review the current step and try again.", 409);
        const next = setupSteps[setupSteps.indexOf(current) + 1]!;
        db.query("UPDATE installation_setup SET step = ? WHERE id = 1").run(next);
        return next;
      }).immediate();
    },
    audioProfile() { const value = db.query<{ card: string | null; profile: string | null }, []>("SELECT card, profile FROM audio_output WHERE id = 1").get(); const bluetooth = db.query<{ address: string }, []>("SELECT address FROM bluetooth_output WHERE id = 1").get(); return value?.card && value.profile ? { card: value.card, profile: value.profile, ...(bluetooth ? { bluetoothAddress: bluetooth.address } : {}) } : null; },
    saveAudioOutput(name: string, profile?: import("../shared/sound").SavedSoundProfile | null) { db.transaction(() => { db.query("INSERT INTO audio_output VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,card=excluded.card,profile=excluded.profile").run(name, profile?.card ?? null, profile?.profile ?? null); if (profile?.bluetoothAddress) db.query("INSERT INTO bluetooth_output VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET address=excluded.address").run(profile.bluetoothAddress); else db.run("DELETE FROM bluetooth_output"); })(); },
    tvInterfaceSize(): InterfaceSize { return db.query<{ scale: InterfaceSize }, []>("SELECT scale FROM installation_appearance WHERE id = 1").get()!.scale; },
    saveTvInterfaceSize(size: InterfaceSize) {
      if (!isInterfaceSize(size)) throw new ControllerError("Choose a supported interface size.");
      db.query("UPDATE installation_appearance SET scale = ? WHERE id = 1").run(size);
    },
    queue: JSON.parse(stored.queue) as QueueEntry[],
    queueCursorEntryId() { return db.query<{ entryId: string | null }, []>("SELECT entryId FROM queue_position WHERE id = 1").get()!.entryId; },
    saveQueueCursor(entryId: string, beforeCommit?: () => void) {
      db.transaction(() => {
        db.query("UPDATE queue_position SET entryId = ? WHERE id = 1").run(entryId);
        beforeCommit?.();
      })();
    },
    volume: stored.volume,
    profiles() { return db.query<WatchingProfile & { confirmedName: number }, []>("SELECT id, name, confirmedName FROM watching_profiles ORDER BY name COLLATE NOCASE, id").all().map(profileView); },
    activeProfile,
    playbackPreferences(profileId: string): PlaybackPreferences {
      const row = db.query<{ preferences: string }, [string]>("SELECT preferences FROM watching_preferences WHERE profileId = ?").get(profileId);
      const device = db.query<{ audioDelay: number }, []>("SELECT audioDelay FROM playback_device WHERE id = 1").get()!;
      return { profile: { replayGain: "off", ...(row ? JSON.parse(row.preferences) : { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1 }) }, device };
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
        if (db.query("SELECT 1 FROM watching_profiles WHERE name = ? AND id != ?").get(name, id)) throw new ViewingError("That name already has a saved history. Choose it under Existing histories or use another name.");
        db.query("UPDATE watching_profiles SET name = ?, confirmedName = 1 WHERE id = ?").run(name, id);
        return { id, name, personName: name };
      }).immediate();
    },
    removeProfile(id: string, expectedName: string) {
      return db.transaction(() => {
        unchangedProfile(id, expectedName);
        if (id === "household") throw new ViewingError("The shared default watching profile cannot be removed.", 409);
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
      db.query("UPDATE watching_state SET profileId = ? WHERE id = 1").run(id);
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
    sharedHistory(limit = 40): HistoryItem[] {
      return db.query<ProgressRow, [number]>(`SELECT ${progressColumns} FROM (
        SELECT ${progressColumns}, ROW_NUMBER() OVER (PARTITION BY mediaId ORDER BY lastPlayedAt DESC, rowid DESC) AS latest
        FROM viewing_progress WHERE lastPlayedAt IS NOT NULL
      ) WHERE latest = 1 ORDER BY lastPlayedAt DESC, mediaId LIMIT ?`)
        .all(Math.max(1, Math.min(100, Math.floor(limit) || 40))).map(progressView);
    },
    historySource(mediaId: string): QueueEntry | null {
      const row = db.query<{ entry: string }, [string]>("SELECT entry FROM history_sources WHERE mediaId = ?").get(mediaId);
      return row ? JSON.parse(row.entry) : null;
    },
    saveProgress(profileId: string, item: HistoryItem, entry?: QueueEntry) {
      db.transaction(() => {
        db.query(`INSERT INTO viewing_progress (profileId, mediaId, title, libraryItemId, position, duration, watched, lastPlayedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profileId, mediaId) DO UPDATE SET
          title=excluded.title, libraryItemId=excluded.libraryItemId, position=excluded.position, duration=excluded.duration,
          watched=(viewing_progress.watched OR excluded.watched), lastPlayedAt=excluded.lastPlayedAt`)
          .run(profileId, item.mediaId, item.title, item.libraryItemId, item.position, item.duration, Number(item.watched), item.lastPlayedAt);
        if (entry) db.query("INSERT INTO history_sources VALUES (?, ?) ON CONFLICT(mediaId) DO UPDATE SET entry=excluded.entry WHERE history_sources.entry != excluded.entry").run(item.mediaId, JSON.stringify(entry));
      })();
    },
    editSharedProgress(profileId: string, mediaId: string, changes: { watched?: boolean; clearResume?: boolean }, item: { title: string; libraryItemId: string | null }) {
      db.transaction(() => {
        profileId = latestProgress(mediaId)?.profileId ?? profileId;
        db.query("INSERT OR IGNORE INTO viewing_progress (profileId, mediaId, title, libraryItemId) VALUES (?, ?, ?, ?)").run(profileId, mediaId, item.title, item.libraryItemId);
        if (changes.watched !== undefined) db.query("UPDATE viewing_progress SET watched = ? WHERE profileId = ? AND mediaId = ?").run(Number(changes.watched), profileId, mediaId);
        if (changes.clearResume) db.query("UPDATE viewing_progress SET position = 0 WHERE profileId = ? AND mediaId = ?").run(profileId, mediaId);
      })();
    },
    saveQueue(queue: QueueEntry[], cursorEntryId: string | null = null) {
      db.transaction(() => {
        db.query("UPDATE session SET queue = ? WHERE id = 1").run(JSON.stringify(queue));
        db.query("UPDATE queue_position SET entryId = ? WHERE id = 1").run(cursorEntryId);
      })();
    },
    saveVolume(volume: number) {
      db.query("UPDATE session SET volume = ? WHERE id = 1").run(volume);
    },
    pair(name?: unknown) {
      const label = controllerName(name === undefined ? "Remote" : name);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const now = Date.now();
      db.query("INSERT INTO devices VALUES (?, ?, ?, 'controller', ?, ?)").run(hash(token), crypto.randomUUID(), label, now, now);
      return token;
    },
    isPaired(token: string) {
      return token.length <= 128 && db.query("SELECT 1 FROM devices WHERE token_hash = ?").get(hash(token)) !== null;
    },
    controller,
    controllers() { return db.query<Controller, []>(`SELECT ${controllerColumns} FROM devices ORDER BY createdAt, id`).all(); },
    renameController(id: string, value: unknown) {
      const name = controllerName(value);
      requireController(id);
      db.query("UPDATE devices SET name = ? WHERE id = ?").run(name, id);
      return controller(id)!;
    },
    setControllerRole(id: string, role: unknown) {
      if (role !== "controller" && role !== "administrator") throw new ControllerError("Choose Controller or Administrator.");
      return db.transaction(() => {
        const device = requireController(id);
        if (role === "controller") protectAdministrator(device);
        db.query("UPDATE devices SET role = ? WHERE id = ?").run(role, id);
        return controller(id)!;
      }).immediate();
    },
    revokeController(id: string) {
      db.transaction(() => {
        protectAdministrator(requireController(id));
        db.query("DELETE FROM devices WHERE id = ?").run(id);
      }).immediate();
    },
    controllerForToken(token: string) {
      return token.length <= 128 ? db.query<Controller, [string]>(`SELECT ${controllerColumns} FROM devices WHERE token_hash = ?`).get(hash(token)) : null;
    },
    touchController(id: string) {
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
    consumeControllerClaim(id: string, code: string): Controller {
      return db.transaction(() => {
        const device = controller(id);
        if (!device) throw new ControllerError("Pair this device before connecting.", 401);
        if (device.role !== "controller") throw new ControllerError("This remote is already an administrator.", 409);
        const claim = claimRow(code);
        if (!claim || claim.consumed || claim.expiresAt <= Date.now()) throw new ControllerError("The administrator code is invalid or expired.", 401);
        if (!claim.recovery && administratorExists()) throw new ControllerError("This TV already has an administrator.", 409);
        db.query("UPDATE devices SET role = 'administrator' WHERE id = ?").run(id);
        db.query("UPDATE controller_claims SET consumed = 1 WHERE code_hash = ?").run(hash(code));
        return controller(id)!;
      }).immediate();
    },
    installationName() { return db.query<{ name: string }, []>("SELECT name FROM installation WHERE id = 1").get()!.name; },
    renameInstallation(value: unknown) {
      const name = controllerName(value);
      db.query("UPDATE installation SET name = ? WHERE id = 1").run(name);
      return name;
    },
    close() { db.close(); },
  };
}

export type Store = ReturnType<typeof openStore>;
