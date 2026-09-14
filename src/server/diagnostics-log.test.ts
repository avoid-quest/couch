import { Database } from "bun:sqlite";
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiagnosticLog } from "./diagnostics-log";
import { diagnosticLimits } from "./diagnostics-redaction";

const roots: string[] = [];
const logs: ReturnType<typeof createDiagnosticLog>[] = [];
const build = { version: "0.1.0+build.49", revision: "aa8bb761d2381c41dcade83ed3c9aad014cb2244", target: "x86_64-unknown-linux-gnu", packaged: true };
function fixture() { const root = mkdtempSync(join(tmpdir(), "couch-diagnostic-log-")); roots.push(root); return join(root, "state.sqlite"); }
function log(path: string, secrets: string[] = [], metadata = build) { const result = createDiagnosticLog(secrets, path, metadata); logs.push(result); return result; }
function stored(path: string) { const db = new Database(path); try { return db.query<{ entries: string }, []>("SELECT entries FROM diagnostic_history").get()!.entries; } finally { db.close(); } }
afterEach(() => { for (const log of logs.splice(0)) log.close(); setSystemTime(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("restart keeps the original build and dates, and duplicates stay within one session", () => {
  const path = fixture();
  setSystemTime(new Date("2026-09-14T12:00:00Z"));
  const first = log(path);
  first.add("Playback", "Output unavailable");
  setSystemTime(new Date("2026-09-14T12:01:00Z"));
  first.add("Playback", "Output unavailable");
  const retained = first.recent()[0]!;
  expect(retained).toMatchObject({ at: "2026-09-14T12:00:00.000Z", lastAt: "2026-09-14T12:01:00.000Z", count: 2, build });
  first.close();
  const second = log(path, [], { ...build, version: "0.1.0+build.50" });
  expect(second.recent()).toEqual([retained]);
  expect(second.sessionId).not.toBe(retained.sessionId);
  second.add("Playback", "Output unavailable");
  expect(second.recent()).toHaveLength(2);
  expect(second.recent()[1]!.build.version).toBe("0.1.0+build.50");
  second.recent()[0]!.build.version = "changed";
  expect(second.recent()[0]!.build).toEqual(build);
});

test("count and UTF-8 size caps hold on disk under repeated errors", () => {
  const path = fixture(), history = log(path);
  for (let index = 0; index < 120; index++) history.add("Command", `Failed ${index}`);
  expect(history.recent()).toHaveLength(80);
  for (let index = 0; index < 120; index++) history.add(`Source ${index}`, "界".repeat(500));
  expect(Buffer.byteLength(stored(path))).toBeLessThanOrEqual(diagnosticLimits.historyBytes);
  expect(history.recent().length).toBeLessThan(80);
  expect(history.recent().at(-1)!.source).toBe("Source 119");
});

test("seven-day expiry uses the first observation, including after restart", () => {
  const path = fixture();
  const start = Date.parse("2026-09-01T00:00:00Z");
  setSystemTime(start);
  const first = log(path); first.add("Playback", "Old failure");
  setSystemTime(start + 6 * 86_400_000); first.add("Playback", "Old failure");
  first.add("Command", "New failure"); first.close();
  setSystemTime(start + 7 * 86_400_000);
  const second = log(path);
  expect(second.recent().map(entry => entry.message)).toEqual(["New failure"]);
  expect(stored(path)).not.toContain("Old failure");
  setSystemTime(start + 13 * 86_400_000);
  expect(second.recent()).toEqual([]);
  expect(stored(path)).toBe("[]");
});

test("idle retention timer removes expired data without a diagnostics request", async () => {
  const path = fixture();
  const first = log(path); first.add("Command", "Expiring"); first.close();
  const entries = JSON.parse(stored(path));
  entries[0].at = entries[0].lastAt = new Date(Date.now() - 7 * 86_400_000 + 100).toISOString();
  const db = new Database(path); db.query("UPDATE diagnostic_history SET entries = ?").run(JSON.stringify(entries)); db.close();
  log(path);
  await Bun.sleep(180);
  expect(stored(path)).toBe("[]");
});

test("credentials and media URLs never reach SQLite bytes", () => {
  const path = fixture(), history = log(path, ["host-value", "482913"]);
  for (const message of ["host-value 482913", 'password="quiet-word"', "Cookie: private-cookie", "Authorization: Bearer private-auth", "https://user:pass@media.test/private-media?signature=private-query", "rtsp://user:pass@media.test/private-stream", "https%3A%2F%2Fmedia.test%2Fprivate-encoded"]) history.add("Controller command", message);
  history.add("https://private-source.test", "Safe failure");
  const text = stored(path);
  history.close();
  const bytes = readFileSync(path).toString();
  for (const forbidden of ["host-value", "482913", "quiet-word", "private-cookie", "private-auth", "media.test", "private-media", "private-query", "private-stream", "private-encoded", "private-source"]) {
    expect(text).not.toContain(forbidden); expect(bytes).not.toContain(forbidden);
  }
});

test("write lock fails promptly, retains memory and recovers on the next write", () => {
  const path = fixture(), history = log(path);
  const lock = new Database(path);
  try {
    lock.run("BEGIN IMMEDIATE");
    const started = performance.now();
    history.add("Command", "Storage locked");
    expect(performance.now() - started).toBeLessThan(250);
    expect(history.error()).toContain("could not be saved");
    expect(history.recent()[0]!.message).toBe("Storage locked");
    lock.run("ROLLBACK");
    history.add("Command", "Recovered");
    expect(history.error()).toBeNull();
    history.close();
    expect(log(path).recent().map(entry => entry.message)).toEqual(["Storage locked", "Recovered"]);
  } finally { lock.close(); }
});

test("unreadable history preserves data and recovers after repair and restart", () => {
  const path = fixture();
  const first = log(path); first.close();
  const db = new Database(path); db.run("UPDATE diagnostic_history SET entries = 'not-json'");
  const failed = log(path);
  expect(failed.error()).toContain("could not be read");
  failed.add("Command", "Still usable");
  expect(failed.recent()[0]!.message).toBe("Still usable");
  expect(stored(path)).toBe("not-json");
  failed.close();
  db.run("UPDATE diagnostic_history SET entries = '[]'"); db.close();
  const recovered = log(path); recovered.add("Command", "Recovered"); recovered.close();
  expect(log(path).recent()[0]!.message).toBe("Recovered");
});

test("unavailable directory cannot prevent logging or shutdown", () => {
  const history = log(join(fixture(), "missing", "state.sqlite"));
  expect(history.error()).toContain("could not be read");
  expect(() => history.add("Playback", "Still usable")).not.toThrow();
  expect(history.recent()).toHaveLength(1);
  expect(() => history.close()).not.toThrow();
});
