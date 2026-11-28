import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "./sqlite";
import { ControllerError } from "./devices";
import { normalizeDeviceName } from "../shared/devices";
import type { GroupMember, MixerGroup } from "../shared/mixer-groups";

/**
 * The Couch's Groups, which the host keeps for every device. Saving one only records its choices: nothing that plays
 * changes, and each use is checked again as the Mixer's own changes are.
 */
export function createMixerGroups(databasePath: string) {
  if (databasePath !== ":memory:")
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(
    "CREATE TABLE IF NOT EXISTS mixer_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, members TEXT NOT NULL, createdAt INTEGER NOT NULL)",
  );
  return {
    list(): MixerGroup[] {
      return db
        .query<{ id: string; name: string; members: string }, []>(
          "SELECT id, name, members FROM mixer_groups ORDER BY createdAt, id",
        )
        .all()
        .map((row) => ({ ...row, members: JSON.parse(row.members) as GroupMember[] }));
    },
    /** Creates a group, or replaces the one with its id (an edit, or Undo after Delete); validation.ts checked its shape. */
    save(group: Omit<MixerGroup, "id"> & { id?: string }, known: (deviceId: string) => boolean) {
      let name: string;
      try {
        name = normalizeDeviceName(group.name);
      } catch {
        throw new ControllerError("Use a name with 1 to 60 characters.");
      }
      const members = new Map<string, GroupMember>();
      for (const { deviceId, picture, sound } of group.members) {
        if (!known(deviceId)) throw new ControllerError("That device is no longer paired.");
        if (picture || sound) members.set(deviceId, { deviceId, picture, sound });
      }
      if (!members.size) throw new ControllerError("A group needs at least one screen or speaker.");
      const id = group.id ?? crypto.randomUUID();
      db.query(
        "INSERT INTO mixer_groups (id, name, members, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, members = excluded.members",
      ).run(id, name, JSON.stringify([...members.values()]), Date.now());
    },
    delete(id: string) {
      if (!db.query("DELETE FROM mixer_groups WHERE id = ?").run(id).changes)
        throw new ControllerError("That group was already deleted.", 409);
    },
    close() {
      db.close();
    },
  };
}
