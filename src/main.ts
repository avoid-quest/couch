import { checkpointAppImage } from "./server/appimage-checkpoint";
import { createNativeAppImageUpdates } from "./server/appimage-update-native";
import { createNativeBluetooth } from "./server/bluetooth-native";
import { createNativeDisplay } from "./server/display-native";
import { Database } from "bun:sqlite";
type MaintenanceBuild = { version: string; revision: string; dataFormat: number };
import { createNativeReadiness } from "./server/readiness-native";
import { loadedBuild } from "./shared/build";
import { chmod, mkdir, stat } from "node:fs/promises";
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

const appimage = native && process.env.COUCH_APPIMAGE === "1";
const appimageUpdates = createNativeAppImageUpdates((requestId, action) => send({ type: "appimageUpdate", requestId, action }));
const nativeBluetooth = createNativeBluetooth(native ? (requestId, action) => send({ type: "bluetooth", requestId, action }) : undefined);
const nativeDisplay = createNativeDisplay(native ? (requestId, action) => send({ type: "display", requestId, action }) : undefined);
const nativeDiagnostics = createNativeDiagnostics(native ? requestId => send({ type: "diagnostics", requestId }) : undefined);
const nativeReadiness = createNativeReadiness(nonce => send({ type: "readiness", nonce }));
let frontendBuild: MaintenanceBuild | null = null;
let hub: Hub;
let admission = !appimage;
const updater = appimage ? appimageUpdates : undefined;
await mkdir(dataDir, { recursive: true, mode: 0o700 });
// Preserve the administrator's permissions on data shared with us through an ACL.
if (process.geteuid && (await stat(dataDir)).uid === process.geteuid()) await chmod(dataDir, 0o700);
hub = createHub({
  updater,
  ...(appimage ? { restart: appimageUpdates.restart } : {}),
  ...(appimage ? { appimageFeed: appimageUpdates.feed } : {}),
  nativeDisplay: nativeDisplay.request,
  ...(native ? { nativeBluetooth: nativeBluetooth.request } : {}),
  ...(appimage ? {
    admitted: () => admission,
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
  nativeDisplay.close();
  nativeBluetooth.close();
  appimageUpdates.close();
  nativeReadiness.close();
  try { await hub.close(); } finally { process.exit(0); }
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

if (appimage) void (async () => {
  try {
    const status = await appimageUpdates.request({ op: "status" });
    if (status.transaction?.phase === "trial") {
      const deadline = Date.now() + 30_000;
      while (!frontendBuild && Date.now() < deadline) await Bun.sleep(100);
      if (!frontendBuild) throw new Error("The frontend did not acknowledge the running build.");
      const running = await nativeReadiness.collect();
      if (JSON.stringify(running) !== JSON.stringify(loadedBuild)) throw new Error("The native and server builds do not match.");
      const db = new Database(join(dataDir, "couch.sqlite"), { readonly: true });
      try { if (db.query<{ quick_check: string }, []>("PRAGMA quick_check").all().some(row => row.quick_check !== "ok")) throw new Error("The database integrity check failed."); } finally { db.close(); }
      await hub.verifyTools(status.transaction.repairRuntime === true);
      await appimageUpdates.complete(null);
    }
  } catch (error) { await appimageUpdates.complete(error instanceof Error ? error.message : "Startup verification failed.").catch(() => {}); }
  finally { admission = true; send({ type: "observe" }); }
})();

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
        else if (message.type === "appimageQuiesce") {
          void (async () => {
            if (message.restart) {
              try {
                if (!message.confirmInterrupt) throw new Error("Confirm interruption before restarting Couch.");
                hub.prepareRestart();
                send({ type: "appimageQuiesced", nonce: message.nonce, closed: true, error: null });
              } catch (error) { send({ type: "appimageQuiesced", nonce: message.nonce, closed: false, error: error instanceof Error ? error.message : "The checkpoint failed." }); }
              return;
            }
            // Let the accepted HTTP response leave before closing its listener.
            await Bun.sleep(250);
            const result = await checkpointAppImage({ ...message, idle: hub.idleAdmission, player: () => hub.session.state.player.status, closeAdmission: () => { admission = false; }, quiesce: hub.quiesce });
            send({ type: "appimageQuiesced", nonce: message.nonce, ...result });
          })();
        }
        else if (message.type === "appimageUpdate") appimageUpdates.receive(message);
        else if (message.type === "bluetooth") nativeBluetooth.receive(message);
        else if (message.type === "display") nativeDisplay.receive(message);
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
