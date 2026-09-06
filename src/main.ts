import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import frontend from "./client/index.html";
import { createHub } from "./server/hub";
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
await mkdir(dataDir, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") await chmod(dataDir, 0o700);

function send(message: SidecarMessage) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const hub = createHub({
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
  await hub.close();
  process.exit(0);
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
        else if (message.type === "shutdown") await close();
      }
    }
  } catch (error) {
    console.error("Native connection failed:", error);
  } finally {
    await close();
  }
}
