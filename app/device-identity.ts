import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
import { Database } from "../src/server/sqlite";
import { defaultDeviceSharing, isDeviceSharing, normalizeDeviceName, type DeviceIdentityUpdate, type LocalDeviceIdentity } from "../src/shared/device-identity";

/** Main and Core share the installation's name, including while Core is stopped. */
export function createDeviceIdentity(path: string) {
  const open = () => new Database(path, { timeout: 5_000 });
  const initial = open();
  try {
    initial.exec("PRAGMA journal_mode = WAL");
    initial.transaction(() => {
      initial.exec("CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL); INSERT OR IGNORE INTO installation (id, name) VALUES (1, '')");
      const columns = new Set(initial.query<{ name: string }, []>("PRAGMA table_info(installation)").all().map(column => column.name));
      for (const column of ["deviceKey", "deviceSharing"]) if (!columns.has(column)) initial.exec(`ALTER TABLE installation ADD COLUMN ${column} TEXT`);
    }).immediate();
  } finally { initial.close(); }

  return (update: DeviceIdentityUpdate = {}): LocalDeviceIdentity => {
    const updatedName = update.name === undefined ? undefined : normalizeDeviceName(update.name);
    if (update.sharing !== undefined && !isDeviceSharing(update.sharing)) throw new Error("Choose which features to share.");
    const db = open();
    try {
      return db.transaction(() => {
        const saved = db.query<{ name: string; deviceKey: string | null; deviceSharing: string | null }, []>("SELECT name, deviceKey, deviceSharing FROM installation WHERE id = 1").get()!;
        let key = saved.deviceKey;
        loadSendspinClientIdentity({
          getItem: field => field === "sendspin-identity-sk" ? key ?? update.key ?? null : null,
          setItem: (field, value) => { if (field === "sendspin-identity-sk") key = value; },
        });
        // The SDK may reuse a migrated key without calling setItem.
        key ??= update.key ?? null;
        if (key !== saved.deviceKey) db.query("UPDATE installation SET deviceKey = ? WHERE id = 1").run(key);
        if (updatedName !== undefined) db.query("UPDATE installation SET name = ? WHERE id = 1").run(updatedName);
        if (update.sharing !== undefined) db.query("UPDATE installation SET deviceSharing = ? WHERE id = 1").run(JSON.stringify(update.sharing));
        let name: string | null = null;
        try { name = normalizeDeviceName(updatedName ?? saved.name); } catch { /* A fresh native installation has not been named. */ }
        let sharing = defaultDeviceSharing;
        try { const value: unknown = JSON.parse(saved.deviceSharing ?? "null"); if (isDeviceSharing(value)) sharing = value; } catch { /* Recover malformed sharing settings. */ }
        return { key: key!, name, sharing: update.sharing ?? sharing };
      }).immediate();
    } finally { db.close(); }
  };
}
