import { linuxBluetooth } from "./server/bluetooth-linux";
import { createNativeDisplay } from "./server/display-native";
import { createNativeUpdates } from "./server/updates-native";
import { createNativeTvMode } from "./server/tv-mode-native";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { helpersCommand, startHelpers } from "./server/helpers";
import { createHelperUpdates } from "./server/helper-updates";
import { createHub } from "./server/hub";
import { liveTurnFromEnvironment } from "./server/live-ice";
import type { AppMessage, CoreMessage } from "./shared/protocol";
import { buildInfo } from "./server/build-info";

if (process.argv.includes("--version")) {
  console.log(JSON.stringify(buildInfo));
  process.exit(0);
}
// Recovery for the media helpers, run as the account Couch runs as with its COUCH_DATA_DIR (src/server/helpers.ts).
if (process.argv[2] === "--helpers") {
  try { console.log(await helpersCommand(join(process.env.COUCH_DATA_DIR ?? ".data", "helpers"), process.argv.slice(3))); }
  catch (error) { console.error((error as Error).message); process.exit(1); }
  process.exit(0);
}

// Inside the Couch app, Core runs in Electron's utilityProcess and talks to
// Main over its parent port. `node build/core.mjs` runs it standalone.
type ParentPort = { postMessage(message: CoreMessage): void; on(event: "message", listener: (event: { data: AppMessage }) => void): void };
const app = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
const native = !!app;
const allowLanHttp = process.env.COUCH_ALLOW_HTTP === "1";
const adminRecoveryCode = process.env.COUCH_ADMIN_RECOVERY_CODE;
// The one-time recovery secret must not reach media-helper subprocesses.
delete process.env.COUCH_ADMIN_RECOVERY_CODE;
const liveTurn = liveTurnFromEnvironment(process.env);
delete process.env.COUCH_LIVE_TURN_CREDENTIAL;
if (native && !process.env.COUCH_HOST_TOKEN) throw new Error("The Couch app must supply its private token");
const dataDir = process.env.COUCH_DATA_DIR ?? ".data";

const bluetooth = native && process.platform === "linux" ? linuxBluetooth() : undefined;
const nativeDisplay = createNativeDisplay(app && ((requestId, action) => app.postMessage({ type: "display", requestId, action })));
const nativeUpdates = createNativeUpdates(app && ((requestId, action) => app.postMessage({ type: "updates", requestId, action })));
const nativeTvMode = createNativeTvMode(app && ((requestId, enabled) => app.postMessage({ type: "tvMode", requestId, enabled })));
await mkdir(dataDir, { recursive: true, mode: 0o700 });
// Preserve the administrator's permissions on data shared with us through an ACL.
if (process.geteuid && (await stat(dataDir)).uid === process.geteuid()) await chmod(dataDir, 0o700);
startHelpers(join(dataDir, "helpers"));
const helperUpdates = createHelperUpdates(join(dataDir, "helpers"));
const hub = await createHub({
  managedLan: native || allowLanHttp,
  allowLanHttp,
  onAddresses: urls => app?.postMessage({ type: "addresses", urls }),
  remoteControlEnabled: !native,
  native,
  helperUpdates,
  nativeDisplay: nativeDisplay.request,
  ...(native ? { nativeUpdates: nativeUpdates.request, nativeTvMode: nativeTvMode.request } : {}),
  ...(bluetooth ? { nativeBluetooth: bluetooth.request } : {}),
  hostname: process.env.COUCH_HOST ?? "0.0.0.0",
  port: Number(process.env.COUCH_PORT ?? 4100),
  databasePath: join(dataDir, "couch.sqlite"),
  adminRecoveryCode,
  liveTurn,
  relayExecutable: process.env.COUCH_RELAY_PATH ?? join(import.meta.dirname, "live-relay", process.platform === "win32" ? "couch-relay.exe" : "couch-relay"),
  airplayExecutable: process.env.COUCH_AIRPLAY_PATH ?? join(import.meta.dirname, "airplay", "uxplay"),
  hostToken: process.env.COUCH_HOST_TOKEN ?? crypto.randomUUID(),
  advertisedUrls: process.env.COUCH_ADVERTISE_URLS?.split(",").map(value => value.trim()).filter(Boolean),
});

if (app) app.postMessage({ type: "ready", origin: hub.origin, urls: hub.urls, pairingCode: hub.pairingCode });
else {
  console.error(`Couch: ${hub.urls.join(" · ")}`);
  console.error(`Pairing code: ${hub.pairingCode}`);
}

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  nativeDisplay.close();
  nativeUpdates.close();
  nativeTvMode.close();
  bluetooth?.close();
  try { await hub.close(); } finally { process.exit(0); }
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
app?.on("message", ({ data }) => {
  if (data.type === "display") nativeDisplay.receive(data);
  else if (data.type === "updates") nativeUpdates.receive(data);
  else if (data.type === "tvMode") nativeTvMode.receive(data);
  else if (data.type === "renamed") hub.renamed();
  else if (data.type === "shutdown") void close();
});
