import { Database } from "bun:sqlite";
import { createMaintenance, manualUpdatesEnabled, type MaintenanceBuild } from "./server/maintenance";
import { createUpdaterClient } from "./server/updater-client";
import { createNativeReadiness } from "./server/readiness-native";
import { loadedBuild } from "./shared/build";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import frontend from "./client/index.html";
import { createNativeDiagnostics } from "./server/diagnostics-native";
import { createHub, type Hub } from "./server/hub";
import type { HostMessage, SidecarMessage } from "./shared/protocol";
import { buildInfo } from "./server/build-info";

if (process.argv.includes("--version")) {
  console.log(JSON.stringify(buildInfo));
  process.exit(0);
}

const native = process.env.COUCH_NATIVE === "1";
const adminRecoveryCode = process.env.COUCH_ADMIN_RECOVERY_CODE;
// The one-time recovery secret must not reach media-helper subprocesses.
delete process.env.COUCH_ADMIN_RECOVERY_CODE;
if (native && !process.env.COUCH_HOST_TOKEN) throw new Error("The native host must supply its private token");
const dataDir = process.env.COUCH_DATA_DIR ?? ".data";

function send(message: SidecarMessage) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const nativeDiagnostics = createNativeDiagnostics(native ? requestId => send({ type: "diagnostics", requestId }) : undefined);
const nativeReadiness = createNativeReadiness(nonce => send({ type: "readiness", nonce }));
let frontendBuild: MaintenanceBuild | null = null;
let hub: Hub;
const activated = native && buildInfo.packaged && process.platform === "linux" && manualUpdatesEnabled();
const maintenance = activated ? createMaintenance({
  build: loadedBuild,
  context: (): Promise<unknown> => updater!.request({ op: "context" }),
  player: () => hub.session.state.player.status,
  quiesce: () => hub.quiesce(),
  database: async () => {
    const db = new Database(join(dataDir, "couch.sqlite"), { readonly: true });
    try {
      const results = db.query<{ quick_check: string }, []>("PRAGMA quick_check").all();
      if (results.length !== 1 || results[0]?.quick_check !== "ok") throw new Error("The trial database failed its integrity check.");
    } finally { db.close(); }
  },
  native: () => nativeReadiness.collect(),
  frontend: () => frontendBuild,
}) : undefined;
const updater = maintenance ? createUpdaterClient(request => maintenance.handle(request), () => {
  maintenance.fail();
  if (hub) void hub.quiesce().then(() => process.exit(1), () => process.exit(1));
  else process.exit(1);
}) : undefined;
// Read root transaction authority before opening/migrating any application DB.
if (updater) { await updater.ready; await maintenance!.initialize(); }
await mkdir(dataDir, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") await chmod(dataDir, 0o700);
hub = createHub({
  updater,
  ...(maintenance ? {
    admitted: maintenance.admitted,
    frontendReady: (value: unknown) => {
      const build = value as MaintenanceBuild;
      if (!build || Object.keys(build).sort().join(",") !== "dataFormat,revision,version" || build.version !== loadedBuild.version || build.revision !== loadedBuild.revision || build.dataFormat !== loadedBuild.dataFormat) return false;
      frontendBuild = { ...build };
      return true;
    },
  } : {}),
  ...(native ? { nativeDiagnostics: nativeDiagnostics.collect } : {}),
  hostname: process.env.COUCH_HOST ?? "0.0.0.0",
  port: Number(process.env.COUCH_PORT ?? 4100),
  databasePath: join(dataDir, "couch.sqlite"),
  adminRecoveryCode,
  hostToken: process.env.COUCH_HOST_TOKEN ?? crypto.randomUUID(),
  frontend,
  development: !native && process.env.NODE_ENV !== "production",
  advertisedUrls: process.env.COUCH_ADVERTISE_URLS?.split(",").map(value => value.trim()).filter(Boolean),
  sendPlayer(command) {
    if (native) send({ type: "playback", command });
  },
});

if (native) {
  send({
    type: "ready",
    origin: hub.origin,
    urls: hub.urls,
    pairingCode: hub.pairingCode,
    token: process.env.COUCH_HOST_TOKEN!,
  });
} else {
  console.error(`Couch: ${hub.urls.join(" · ")}`);
  console.error(`Pairing code: ${hub.pairingCode}`);
  console.error("Start the desktop app for native playback. Browser clients control that player.");
}

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  nativeDiagnostics.close();
  nativeReadiness.close();
  await updater?.close();
  try { await hub.close(); } finally { process.exit(0); }
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

if (native) {
  // The sidecar's only playback authority is its owning Rust process.
  let pending = "";
  try {
    for await (const text of Bun.stdin.stream().pipeThrough(new TextDecoderStream())) {
      pending += text;
      if (pending.length > 64 * 1024) throw new Error("Native message exceeded its limit");
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line) continue;
        const message: HostMessage = JSON.parse(line);
        if (message.type === "player") hub.session.observe(message.state);
        else if (message.type === "readiness") nativeReadiness.receive(message.nonce, message.ok, message.build);
        else if (message.type === "diagnostics") nativeDiagnostics.receive(message.requestId, message.report);
        else if (message.type === "shutdown") await close();
      }
    }
  } catch (error) {
    console.error("Native connection failed:", error);
  } finally {
    await close();
  }
}
