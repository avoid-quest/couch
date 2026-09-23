import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture({ trial = false, corrupt = false, development = false, packagedWithoutUpdater = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "couch-maintenance-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const db = new Database(join(directory, "couch.sqlite"));
  db.exec("CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES ('newer user data')"); db.close();
  const database = await Bun.file(join(directory, "couch.sqlite")).bytes();
  const helpers: Record<string, { version: string; sha256: string }> = {};
  for (const [name, version, script] of [
    ["yt-dlp", "2026.09.14", '#!/bin/sh\nfor arg; do last=$arg; done\nif [ "$last" = --version ]; then echo 2026.09.14; else echo "$last"; fi\n'],
    ["deno", "2.0.0", '#!/bin/sh\nif [ "$1" = --version ]; then echo "deno 2.0.0"; else echo 42; fi\n'],
    ["ffprobe", "8.0", '#!/bin/sh\necho "ffprobe version 8.0"\n'],
  ]) {
    await Bun.write(join(directory, name!), script!); await chmod(join(directory, name!), 0o700);
    helpers[name!] = { version: version!, sha256: new Bun.CryptoHasher("sha256").update(script!).digest("hex") };
  }
  const build = { version: "0.3.0", revision: "a".repeat(40), dataFormat: 1, packaged: !development, helpers };
  if (corrupt) await Bun.write(join(directory, "deno"), "changed");
  const messages: any[] = [];
  const format = development || packagedWithoutUpdater ? "null" : '"appimage"';
  const script = `import { runMaintenanceMode } from ${JSON.stringify(join(import.meta.dir, "maintenance-mode.ts"))}; await runMaintenanceMode(${JSON.stringify(directory)}, "local-secret", ${format}, "http://localhost:1420");`;
  const process = Bun.spawn([Bun.which("bun") ?? "bun", "--define", `COUCH_BUILD_INFO=${JSON.stringify(JSON.stringify(build))}`, "-e", script], { env: { ...globalThis.process.env, COUCH_BUNDLED_TOOLS: directory }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const send = (message: unknown) => process.stdin.write(JSON.stringify(message) + "\n");
  cleanup.push(async () => { send({ type: "shutdown" }); const timeout = setTimeout(() => process.kill(), 2000); await process.exited; clearTimeout(timeout); });
  void (async () => {
    let pending = "";
    for await (const chunk of process.stdout.pipeThrough(new TextDecoderStream())) {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const message = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1); messages.push(message);
        if (message.type === "appimageUpdate") send({ type: "appimageUpdate", requestId: message.requestId, ok: true, transaction: message.action.type === "status" && trial ? { phase: "trial" } : null, installationAvailable: true, repairCurrent: false, ...(message.action.type === "check" ? { candidate: null } : {}) });
        if (message.type === "readiness") send({ type: "readiness", nonce: message.nonce, ok: true, build });
      }
    }
  })();
  const wait = async (match: (message: any) => boolean) => {
    for (let n = 0; n < 300; n++) { const found = messages.find(match); if (found) return found; await Bun.sleep(10); }
    throw new Error(`No matching native message: ${JSON.stringify(messages)}`);
  };
  const ready = await wait(m => m.type === "ready");
  const fetchLocal = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(ready.origin + path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer local-secret", "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { directory, database, build, messages, wait, send, fetchLocal, ready };
}

test("remote maintenance owns only a private installation API and retains playback data", async () => {
  const f = await fixture();
  expect(f.ready.urls).toEqual([]); expect(f.ready.pairingCode).toBe("");
  expect((await f.fetchLocal("/api/updates", undefined, { Authorization: "Bearer remote-token" })).status).toBe(401);
  expect((await f.fetchLocal("/api/updates", undefined, { Origin: "https://other-couch.example" })).status).toBe(403);
  expect((await f.fetchLocal("/api/updates", undefined, { Origin: "http://localhost:1420" })).status).toBe(403);
  expect((await f.fetchLocal("/api/sources")).status).toBe(404);
  expect((await f.fetchLocal("/api/updates/repair", { repair: {} }, { Authorization: "Bearer remote-token" })).status).toBe(401);
  expect((await f.fetchLocal("/api/updates/repair", { repair: {} })).status).toBe(400);
  expect((await f.fetchLocal("/api/updates/channel", { channel: "preview" })).status).toBe(202);
  await f.wait(m => m.action?.type === "check");
  const state = await (await f.fetchLocal("/api/updates")).json();
  expect(state).toMatchObject({ channel: "preview", policy: "manual", running: { version: "0.3.0" }, installation: { enabled: true, repairAvailable: false } });
  await f.fetchLocal("/api/activity", { activity: true });
  f.send({ type: "appimageQuiesce", nonce: "late", whenIdle: true, confirmInterrupt: false });
  expect(await f.wait(m => m.nonce === "late")).toMatchObject({ type: "appimageQuiesced", closed: false, error: expect.stringContaining("ten continuous") });
  expect(await Bun.file(join(f.directory, "couch.sqlite")).bytes()).toEqual(f.database);
  expect((await readdir(f.directory)).some(name => name.includes("wal"))).toBe(false);
});

test("remote startup trial reports local readiness without probing media tools", async () => {
  const f = await fixture({ trial: true, corrupt: true });
  expect((await f.fetchLocal("/api/maintenance/frontend", { build: { ...f.build, revision: "wrong" } })).status).toBe(409);
  expect((await f.fetchLocal("/api/maintenance/frontend", { build: f.build })).status).toBe(204);
  const complete = await f.wait(m => m.action?.type === "complete");
  expect(complete.action.error).toBeNull();
  expect(await Bun.file(join(f.directory, "couch.sqlite")).bytes()).toEqual(f.database);
});

test("development maintenance accepts only its configured local webview origin and private token", async () => {
  const f = await fixture({ development: true });
  const build = { build: f.build };
  expect((await fetch(f.ready.origin + "/api/maintenance/frontend", { method: "OPTIONS", headers: { Origin: "http://localhost:1420", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } })).status).toBe(204);
  expect((await f.fetchLocal("/api/maintenance/frontend", build, { Origin: "http://localhost:1420" })).status).toBe(204);
  expect((await f.fetchLocal("/api/updates", undefined, { Origin: "http://localhost:1420" })).status).toBe(200);
  expect((await f.fetchLocal("/api/updates/policy", { policy: "manual" }, { Origin: "http://localhost:1420" })).status).toBe(409);
  expect((await f.fetchLocal("/api/maintenance/frontend", build, { Origin: "http://localhost:1420", Authorization: "Bearer remote-token" })).status).toBe(401);
  expect((await f.fetchLocal("/api/maintenance/frontend", build, { Origin: "http://192.168.1.10:4100" })).status).toBe(403);
  expect((await f.fetchLocal("/api/maintenance/frontend", { build: { ...f.build, revision: "other" } }, { Origin: "http://localhost:1420" })).status).toBe(409);
});

test("a packaged maintenance server ignores an inherited development origin without a native updater", async () => {
  const f = await fixture({ packagedWithoutUpdater: true });
  expect((await f.fetchLocal("/api/maintenance/frontend", { build: f.build }, { Origin: "http://localhost:1420" })).status).toBe(403);
  expect((await f.fetchLocal("/api/maintenance/frontend", { build: f.build }, { Origin: "tauri://localhost" })).status).toBe(204);
});
