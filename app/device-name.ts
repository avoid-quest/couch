import { Database } from "../src/server/sqlite";
import { normalizeDeviceName } from "../src/shared/devices";

// This computer's one name is couch.sqlite's installation name, so the device and the Couch it hosts
// share it in both modes. "Couch", the name Core gives a Couch nobody named, counts as unnamed.
export function readDeviceName(path: string) {
  let db: Database | undefined;
  try {
    db = new Database(path, { readOnly: true });
    const name = db.query<{ name: string }, []>("SELECT name FROM installation WHERE id = 1").get()?.name;
    return name && name !== "Couch" ? name : null;
  } catch { return null; } // Neither Main nor Core has saved a name yet.
  finally { db?.close(); }
}

export function saveDeviceName(path: string, value: unknown) {
  const name = normalizeDeviceName(value);
  const db = new Database(path, { timeout: 5_000 });
  try {
    db.exec("CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL)");
    db.query("INSERT INTO installation (id, name) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").run(name);
  } finally { db.close(); }
  return name;
}
