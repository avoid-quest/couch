import { Database } from "./sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { HiddenRule } from "../shared/hidden";
import { ControllerError, settingField } from "./devices";

const limit = 1000;
const text = (value: unknown, max: number) => typeof value === "string" && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim().slice(0, max) : "";

/** The Couch's hidden items and words, shared by every paired device (docs/design/browse.md, Hide). */
export function createHidden({ databasePath, onChange }: { databasePath: string; onChange: () => void }) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS hidden (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('item', 'word')), value TEXT NOT NULL, label TEXT NOT NULL, createdAt INTEGER NOT NULL, UNIQUE (kind, value))");
  return {
    async handle(request: Request, authorize = () => {}): Promise<Response> {
      const path = new URL(request.url).pathname;
      try {
        authorize();
        if (path === "/api/hidden") {
          if (request.method === "GET") return Response.json({ rules: db.query<HiddenRule, []>("SELECT id, kind, value, label, createdAt FROM hidden ORDER BY createdAt DESC, id").all() });
          if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
          const rule = await settingField(request, "rule") as Partial<HiddenRule> | null;
          authorize();
          const kind = rule?.kind;
          // Words match case-insensitively, so one word is one rule whatever its case.
          const value = kind === "word" ? text(rule?.value, 100).toLocaleLowerCase() : text(rule?.value, 2100);
          if (kind !== "item" && kind !== "word" || !value) throw new ControllerError(kind === "word" ? "Enter a word to hide." : "Choose something to hide.");
          const label = text(rule?.label, 300) || value;
          const result = db.transaction(() => {
            const existing = db.query<HiddenRule, [string, string]>("SELECT id, kind, value, label, createdAt FROM hidden WHERE kind = ? AND value = ?").get(kind, value);
            if (existing) return { rule: existing, changed: false };
            if (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM hidden").get()!.count >= limit) throw new ControllerError(`Couch can hide ${limit} things. Remove one before hiding more.`);
            const added: HiddenRule = { id: crypto.randomUUID(), kind, value, label, createdAt: Date.now() };
            db.query("INSERT INTO hidden (id, kind, value, label, createdAt) VALUES (?, ?, ?, ?, ?)").run(added.id, added.kind, added.value, added.label, added.createdAt);
            return { rule: added, changed: true };
          })();
          if (result.changed) onChange();
          return Response.json({ rule: result.rule }, { status: result.changed ? 201 : 200 });
        }
        const match = /^\/api\/hidden\/([\w-]{1,80})$/.exec(path);
        if (!match) throw new ControllerError("Hidden endpoint not found.", 404);
        if (request.method !== "DELETE") return new Response(null, { status: 405, headers: { Allow: "DELETE" } });
        if (db.query("DELETE FROM hidden WHERE id = ?").run(match[1]!).changes) onChange();
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ error: error instanceof ControllerError ? error.message : "Couldn't change what's hidden." }, { status: error instanceof ControllerError ? error.status : 500 });
      }
    },
    close() { db.close(); },
  };
}
