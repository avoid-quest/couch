import { Database } from "bun:sqlite";
import { join } from "node:path";
import { loadedBuild } from "../shared/build";
import type { HostMessage, SidecarMessage } from "../shared/protocol";
import { checkpointAppImage } from "./appimage-checkpoint";
import { createNativeAppImageUpdates } from "./appimage-update-native";
import { createNativeDebUpdates } from "./deb-update-native";
import { createManualUpdate } from "./manual-update";
import { createNativeReadiness } from "./readiness-native";
import { createUpdateIdle } from "./update-idle";
import { createUpdates } from "./updates";

// The same compiled backend keeps installation maintenance available in remote mode.
// It opens no media catalog, player, LAN listener or pairing endpoint.
export async function runMaintenanceMode(directory: string, token: string, format: "appimage" | "deb" | null): Promise<never> {
  const send = (message: SidecarMessage) => { process.stdout.write(`${JSON.stringify(message)}\n`); };
  const native = format === "deb"
    ? createNativeDebUpdates((requestId, action) => send({ type: "debUpdate", requestId, action }))
    : createNativeAppImageUpdates((requestId, action) => send({ type: "appimageUpdate", requestId, action }));
  const installed = format !== null;
  const readiness = createNativeReadiness(nonce => send({ type: "readiness", nonce }));
  const idle = createUpdateIdle();
  idle.playback("idle", false);
  let admitted = !installed;
  let frontendReady = false;
  const manual = createManualUpdate(native, () => admitted, id => updates.candidateReady(id), () => updates.canRepair());
  const updates = createUpdates(join(directory, "updates"), loadedBuild, installed ? native.feed : undefined, undefined, () => admitted, installed ? {
    busy: manual.busy, idle: () => idle.reason(), status: manual.status,
    install: manual.automatic,
  } : undefined);
  const origins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);
  const identity = () => ({ authority: "host" as const, controller: null, claimAvailable: false });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const origin = request.headers.get("Origin");
      const reply = (response: Response) => {
        if (origin && origins.has(origin)) response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.headers.set("Cache-Control", "no-store");
        return response;
      };
      if (origin && !origins.has(origin)) return new Response(null, { status: 403 });
      if (request.method === "OPTIONS") return reply(new Response(null, { status: 204 }));
      if (request.headers.get("Authorization") !== `Bearer ${token}`) return reply(new Response(null, { status: 401 }));
      const path = new URL(request.url).pathname;
      if (path === "/api/maintenance/frontend" && request.method === "POST") {
        const value = await request.json().catch(() => null);
        frontendReady = value?.build?.version === loadedBuild.version && value.build.revision === loadedBuild.revision && value.build.dataFormat === loadedBuild.dataFormat;
        return reply(new Response(null, { status: frontendReady ? 204 : 409 }));
      }
      if (path === "/api/activity" && request.method === "POST") { idle.activity(); return reply(new Response(null, { status: 204 })); }
      if (path === "/api/updates" && request.method === "GET") {
        try {
          const requestId = new URL(request.url).searchParams.get("requestId") ?? undefined;
          return reply(Response.json({ ...updates.state, installation: installed ? await manual.read(identity, requestId) : undefined }));
        } catch { return reply(Response.json({ error: "This installation's updater is unavailable." }, { status: 503 })); }
      }
      if (path === "/api/updates/install" && request.method === "POST") return reply(await manual.install(request, identity));
      if (path.startsWith("/api/updates/")) return reply(await updates.handle(request, identity));
      return reply(new Response(null, { status: 404 }));
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  send({ type: "ready", origin, urls: [], pairingCode: "", token });
  const close = async () => { admitted = false; await updates.close(); native.close(); readiness.close(); await server.stop(true); process.exit(0); };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
  if (installed) void (async () => {
    try {
      const status = await native.request({ op: "status" });
      if (status.transaction?.phase === "trial") {
        const deadline = Date.now() + 30_000;
        while (!frontendReady && Date.now() < deadline) await Bun.sleep(100);
        if (!frontendReady) throw new Error("The bundled app did not acknowledge the running build.");
        const running = await readiness.collect();
        if (JSON.stringify(running) !== JSON.stringify(loadedBuild)) throw new Error("The native and backend builds differ.");
        if (await Bun.file(join(directory, "couch.sqlite")).exists()) {
          const database = new Database(join(directory, "couch.sqlite"), { readonly: true });
          try { if (database.query<{ quick_check: string }, []>("PRAGMA quick_check").all().some(row => row.quick_check !== "ok")) throw new Error("The retained database failed its integrity check."); }
          finally { database.close(); }
        }
        await native.complete(null);
      }
    } catch (reason) { await native.complete(reason instanceof Error ? reason.message : "Startup verification failed.").catch(() => {}); }
    finally { admitted = true; }
  })();
  let pending = "";
  for await (const text of Bun.stdin.stream().pipeThrough(new TextDecoderStream())) {
    pending += text;
    if (pending.length > 64 * 1024) throw new Error("Native message exceeded its limit.");
    let end: number;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (!line) continue;
      const message: HostMessage = JSON.parse(line);
      if (message.type === "shutdown") await close();
      else if (message.type === "appimageUpdate" || message.type === "debUpdate") native.receive(message);
      else if (message.type === "readiness") readiness.receive(message.nonce, message.ok, message.build);
      else if (message.type === "appimageQuiesce") void (async () => {
        const result = await checkpointAppImage({ ...message, idle: () => idle.reason(), player: () => "idle", closeAdmission: () => { admitted = false; }, quiesce: async () => {
          // Settings writes are awaited by createUpdates before the native request begins.
          // Do not close its in-flight automatic request while acknowledging this checkpoint.
          return { progressSaved: true, admissionClosed: true };
        } });
        send({ type: "appimageQuiesced", nonce: message.nonce, ...result });
      })();
    }
  }
  await close();
  throw new Error("Unreachable");
}
