import { Database } from "bun:sqlite";
import type { DiagnosticLog, NativeDiagnostics } from "../shared/diagnostics";
import { buildInfo } from "./build-info";
import { diagnosticLimits, redactDiagnosticText } from "./diagnostics-redaction";
import { diagnosticBuild } from "./diagnostics-system";

// Use the existing local SQLite database. Only sanitized, bounded JSON reaches it.
export function createDiagnosticLog(secrets: readonly string[] = [], databasePath = ":memory:", build: NativeDiagnostics["build"] = diagnosticBuild(buildInfo)) {
  const sessionId = crypto.randomUUID();
  const sessionStartedAt = new Date().toISOString();
  let entries: DiagnosticLog[] = [];
  let db: Database | undefined;
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let duplicateTimer: ReturnType<typeof setTimeout> | undefined;
  const safe = (value: unknown, maximum?: number) => redactDiagnosticText(value, secrets, maximum);
  const safeBuild = (value: unknown) => {
    const result = diagnosticBuild(value);
    for (const key of ["version", "revision", "target"] as const) if (result[key] && secrets.some(secret => secret && (result[key]!.includes(secret) || result[key]!.includes(encodeURIComponent(secret))))) result[key] = null;
    return result;
  };
  const originBuild = safeBuild(build);

  function bound() {
    const cutoff = Date.now() - diagnosticLimits.retentionDays * 86_400_000;
    entries = entries.filter(entry => Date.parse(entry.at) > cutoff).slice(-diagnosticLimits.recentEntries);
    while (Buffer.byteLength(JSON.stringify(entries)) > diagnosticLimits.historyBytes) entries.shift();
  }

  function save() {
    if (closed) return;
    clearTimeout(duplicateTimer);
    duplicateTimer = undefined;
    bound();
    if (db) {
      try {
        db.query("INSERT INTO diagnostic_history VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET entries = excluded.entries").run(JSON.stringify(entries));
        error = null;
      } catch { error = "Couldn't save recent errors. They may be lost on restart."; }
    }
    clearTimeout(timer);
    // Expire even while Advanced is closed. Failed writes retry without logging themselves.
    if (entries.length || db && error) {
      const expiry = entries.length ? Math.min(...entries.map(entry => Date.parse(entry.at))) + diagnosticLimits.retentionDays * 86_400_000 - Date.now() : 60_000;
      // Clock corrections can leave timestamps beyond the signed 32-bit timer range.
      timer = setTimeout(save, Math.max(1, Math.min(expiry, error ? 60_000 : 2_147_483_647)));
      timer.unref();
    }
  }

  try {
    db = new Database(databasePath, { create: true, strict: true });
    db.run("PRAGMA busy_timeout = 0");
    db.run(`CREATE TABLE IF NOT EXISTS diagnostic_history (id INTEGER PRIMARY KEY CHECK (id = 1), entries TEXT NOT NULL CHECK (length(CAST(entries AS BLOB)) <= ${diagnosticLimits.historyBytes}))`);
    const row = db.query<{ entries: string }, []>(`SELECT substr(entries, 1, ${diagnosticLimits.historyBytes + 1}) AS entries FROM diagnostic_history WHERE id = 1`).get();
    const retained: unknown = row ? JSON.parse(row.entries) : [];
    if (!Array.isArray(retained) || retained.length > diagnosticLimits.recentEntries) throw new Error("Invalid history");
    entries = retained.map(entry => {
      if (!entry || typeof entry.at !== "string" || !Number.isFinite(Date.parse(entry.at)) || typeof entry.lastAt !== "string" || !Number.isFinite(Date.parse(entry.lastAt)) || Date.parse(entry.lastAt) < Date.parse(entry.at) || typeof entry.source !== "string" || typeof entry.message !== "string" || !Number.isSafeInteger(entry.count) || entry.count < 1 || typeof entry.sessionId !== "string" || !/^[a-f0-9-]{36}$/.test(entry.sessionId)) throw new Error("Invalid history");
      return { at: new Date(entry.at).toISOString(), lastAt: new Date(entry.lastAt).toISOString(), count: entry.count, source: safe(entry.source, 60), message: safe(entry.message), sessionId: entry.sessionId, build: safeBuild(entry.build) };
    });
    save();
  } catch {
    // Preserve an unreadable history for investigation; do not overwrite it.
    try { db?.close(); } catch {}
    db = undefined;
    entries = [];
    error = "Couldn't read saved errors. Showing this session only.";
  }

  return {
    sessionId, sessionStartedAt,
    add(source: string, message: unknown) {
      if (closed) return;
      bound();
      const safeMessage = safe(message), safeSource = safe(source, 60);
      if (!safeMessage) return;
      const at = new Date().toISOString();
      const last = entries.at(-1);
      if (last?.message === safeMessage && last.source === safeSource && last.sessionId === sessionId) {
        last.lastAt = new Date(Math.max(Date.parse(last.lastAt), Date.parse(at))).toISOString();
        last.count = Math.min(Number.MAX_SAFE_INTEGER, last.count + 1);
        // Player-state notifications can repeat the same error many times a second.
        // Persist the first failure immediately and coalesce only its repeat count.
        duplicateTimer ??= setTimeout(save, 1_000);
        duplicateTimer.unref();
        return;
      } else entries.push({ at, lastAt: at, count: 1, source: safeSource, message: safeMessage, sessionId, build: { ...originBuild } });
      save();
    },
    recent() {
      const length = entries.length;
      bound();
      if (entries.length !== length) save();
      return entries.map(entry => ({ ...entry, build: { ...entry.build } }));
    },
    error: () => error,
    close() {
      save();
      closed = true;
      clearTimeout(timer);
      try { db?.close(); } catch {}
    },
  };
}
