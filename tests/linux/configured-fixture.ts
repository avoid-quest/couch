import { strict as assert } from "node:assert";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Non-onboarding journeys start after setup, but keep their existing pairing and
// claim scenarios. This is fixture state, never evidence of first-run acceptance.
export function seedConfiguredFixture(directory = process.env.COUCH_DATA_DIR ?? "/work/configured-fixture") {
  process.env.COUCH_DATA_DIR = directory;
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "couch.sqlite");
  assert.equal(existsSync(path), false, "Seed only a fresh disposable qualification database");
  const db = new Database(path);
  db.run("CREATE TABLE installation_setup (id INTEGER PRIMARY KEY CHECK (id = 1), step TEXT NOT NULL); INSERT INTO installation_setup VALUES (1, 'complete')");
  db.run("CREATE TABLE installation_sharing (id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))); INSERT INTO installation_sharing VALUES (1, 1)");
  db.close();
  // Non-onboarding playback journeys exercise the configured local TV, not
  // first-use device selection; native startup reads this sidecar-side choice.
  const choice = JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true });
  writeFileSync(join(directory, "operating-mode.json"), choice);
  // WebDriver launches the native binary without this script's data override.
  const nativeData = join(homedir(), ".local/share/quest.avoid.couch");
  mkdirSync(nativeData, { recursive: true });
  writeFileSync(join(nativeData, "operating-mode.json"), choice);
}
