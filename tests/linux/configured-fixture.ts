import { strict as assert } from "node:assert";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
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
  db.close();
}
