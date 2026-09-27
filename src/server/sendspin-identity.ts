import { Identity } from "@sonn-audio/node-sendspin";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const validClientId = (id: string) => typeof id === "string" && /^[A-Za-z0-9_-]{43}$/.test(id)
  && Buffer.from(id, "base64url").length === 32 && Buffer.from(id, "base64url").toString("base64url") === id;

// Core authenticates enrollment callers; this store only owns their durable keys.
export function openSendspinIdentity(databasePath: string) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS sendspin_identity (id INTEGER PRIMARY KEY CHECK (id = 1), privateKey TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sendspin_enrollment (clientId TEXT PRIMARY KEY, owner TEXT NOT NULL, psk TEXT NOT NULL, softwareOutputQualified INTEGER NOT NULL DEFAULT 0, deviceId TEXT);
    CREATE TABLE IF NOT EXISTS sendspin_members (clientId TEXT PRIMARY KEY, position INTEGER NOT NULL);
  `);
  if (!db.query<{ name: string }, []>("PRAGMA table_info(sendspin_enrollment)").all().some(column => column.name === "softwareOutputQualified")) db.run("ALTER TABLE sendspin_enrollment ADD COLUMN softwareOutputQualified INTEGER NOT NULL DEFAULT 0");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(sendspin_enrollment)").all().some(column => column.name === "deviceId")) db.run("ALTER TABLE sendspin_enrollment ADD COLUMN deviceId TEXT");
  const identity = db.transaction(() => {
    const saved = db.query<{ privateKey: string }, []>("SELECT privateKey FROM sendspin_identity WHERE id = 1").get();
    if (saved) return Identity.fromPrivateB64u(saved.privateKey);
    const created = Identity.generate();
    db.query("INSERT INTO sendspin_identity VALUES (1, ?)").run(created.privateB64u);
    return created;
  }).immediate();
  return {
    privateKey: identity.privateB64u,
    serverId: identity.peerId,
    enroll(ownerControllerId: string, clientId: string, deviceId?: string) {
      if (typeof ownerControllerId !== "string" || !ownerControllerId.trim()) throw new Error("Choose an authenticated controller.");
      if (!validClientId(clientId)) throw new Error("Invalid Sendspin client identity.");
      return db.transaction(() => {
        const existing = db.query<{ owner: string; psk: string; softwareOutputQualified: number; deviceId: string | null }, [string]>("SELECT owner, psk, softwareOutputQualified, deviceId FROM sendspin_enrollment WHERE clientId = ?").get(clientId);
        if (existing && existing.owner !== ownerControllerId) throw new Error("This Sendspin client belongs to another controller.");
        if (existing?.deviceId && deviceId && existing.deviceId !== deviceId) throw new Error("This Sendspin client belongs to another device.");
        const psk = existing?.psk ?? randomBytes(32).toString("base64url");
        if (!existing) db.query("INSERT INTO sendspin_enrollment (clientId, owner, psk, softwareOutputQualified, deviceId) VALUES (?, ?, ?, ?, ?)").run(clientId, ownerControllerId, psk, Number(!!deviceId), deviceId ?? null);
        else if (deviceId) db.query("UPDATE sendspin_enrollment SET softwareOutputQualified = 1, deviceId = ? WHERE clientId = ?").run(deviceId, clientId);
        return { psk, serverId: identity.peerId, softwareOutputQualified: !!(existing?.softwareOutputQualified || deviceId) };
      }).immediate();
    },
    lookup(clientId: string) {
      if (!validClientId(clientId)) return null;
      return db.query<{ psk: string }, [string]>("SELECT psk FROM sendspin_enrollment WHERE clientId = ?").get(clientId)?.psk ?? null;
    },
    owner(clientId: string) {
      if (!validClientId(clientId)) return null;
      return db.query<{ owner: string }, [string]>("SELECT owner FROM sendspin_enrollment WHERE clientId = ?").get(clientId)?.owner ?? null;
    },
    softwareOutputQualified(clientId: string) {
      if (!validClientId(clientId)) return false;
      return db.query<{ softwareOutputQualified: number }, [string]>("SELECT softwareOutputQualified FROM sendspin_enrollment WHERE clientId = ?").get(clientId)?.softwareOutputQualified === 1;
    },
    deviceId(clientId: string) {
      if (!validClientId(clientId)) return null;
      return db.query<{ deviceId: string | null }, [string]>("SELECT deviceId FROM sendspin_enrollment WHERE clientId = ?").get(clientId)?.deviceId ?? null;
    },
    members() {
      return db.query<{ clientId: string }, []>("SELECT clientId FROM sendspin_members ORDER BY position").all().map(member => member.clientId);
    },
    saveMembers(ids: string[]) {
      if (!Array.isArray(ids) || ids.length > 32 || new Set(ids).size !== ids.length || !ids.every(validClientId)) throw new Error("Choose up to 32 unique Sendspin client identities.");
      db.transaction(() => {
        db.run("DELETE FROM sendspin_members");
        const insert = db.query("INSERT INTO sendspin_members VALUES (?, ?)");
        ids.forEach((id, position) => insert.run(id, position));
      }).immediate();
    },
    revoke(owner: string) {
      return db.transaction(() => {
        const clients = db.query<{ clientId: string }, [string]>("SELECT clientId FROM sendspin_enrollment WHERE owner = ? ORDER BY clientId").all(owner);
        db.query("DELETE FROM sendspin_members WHERE clientId IN (SELECT clientId FROM sendspin_enrollment WHERE owner = ?)").run(owner);
        db.query("DELETE FROM sendspin_enrollment WHERE owner = ?").run(owner);
        return clients.map(client => client.clientId);
      }).immediate();
    },
    close() { db.close(); },
  };
}
