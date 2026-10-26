import { parentPort, workerData } from "node:worker_threads";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createScheduledAudio } from "./scheduled-audio";
import { acceptCaptureUpload } from "./capture-ingest";
import type { CaptureAudioPacket, CapturePolicy } from "./capture-audio";
import type { Member, SyncedLoad } from "./scheduled-audio";
import type { PlaybackCommand } from "../shared/protocol";

const port = parentPort!;
const pending = new Map<number, (value: unknown) => void>();
let requestId = 0;
const request = (type: string, data: Record<string, unknown> = {}) => new Promise<unknown>(resolve => { const id = ++requestId; pending.set(id, resolve); port.postMessage({ type, id, ...data }); });
const registrations = new Map<string, string>();
const notify = () => port.postMessage({ type: "status", value: engine.status() });
const engine = createScheduledAudio({ identity: workerData.identity, name: workerData.name, admit: () => true, changed: notify,
  ffmpeg: async () => {
    const result = await request("ffmpeg") as { path?: string; leaseId: number; error?: string };
    if (!result.path) throw new Error(result.error);
    return { path: result.path, release: () => port.postMessage({ type: "ffmpegRelease", id: result.leaseId }) };
  },
  logError: (id, source, error) => port.postMessage({ type: "logError", group: id, source, error }),
  saveDelay: (id, delay) => port.postMessage({ type: "delay", clientId: id, delay }),
  sourceFailed: (id, error) => port.postMessage({ type: "sourceFailed", sourceId: id, epoch: registrations.get(id), error }),
});
const uploads = new Map<string, import("ws").WebSocket>();
const groups = new Map<string, ReturnType<typeof engine.group>>();
const server = createServer((_req, response) => response.writeHead(404).end());
const websocket = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url!, "http://localhost");
  if (url.searchParams.get("secret") !== workerData.secret) { socket.destroy(); return; }
  websocket.handleUpgrade(req, socket, head, ws => {
    // Parser errors can occur before identity/admission. They belong to this
    // connection, never the shared worker or another receiver's source.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    ws.on("error", () => { clearTimeout(timeout); ws.terminate(); });
    ws.once("close", () => clearTimeout(timeout));
    if (url.searchParams.get("source")) {
      const sourceId = url.searchParams.get("source")!, epoch = url.searchParams.get("epoch");
      if (!engine.hasSource(sourceId) || epoch !== registrations.get(sourceId) || uploads.has(sourceId)) return ws.close(1008, "Source upload is already owned or unavailable");
      uploads.set(sourceId, ws);
      ws.once("close", () => { if (uploads.get(sourceId) === ws) uploads.delete(sourceId); });
      acceptCaptureUpload(ws, packet => uploads.get(sourceId) === ws && engine.writeSource(sourceId, packet), error => {
        if (uploads.get(sourceId) === ws && epoch === registrations.get(sourceId) && engine.hasSource(sourceId)) port.postMessage({ type: "sourceFailed", sourceId, epoch, error });
      });
      return;
    }
    timeout = setTimeout(() => ws.terminate(), 10_000);
    ws.once("message", async (data, binary) => {
      clearTimeout(timeout); ws.pause();
      let clientId: string | undefined;
      try { const init = JSON.parse(String(data)); if (!binary && init.type === "client/init" && typeof init.payload?.client_id === "string") clientId = init.payload.client_id; } catch { /* Refuse below. */ }
      const admitted = clientId && await request("admit", { clientId, loopback: url.searchParams.get("loopback") === "true" });
      if (!admitted || ws.readyState !== 1) { ws.terminate(); return; }
      engine.accept(ws, req);
      ws.emit("message", data, binary); ws.resume();
    });
  });
});
port.on("message", (message: { type: string; id?: number; value?: unknown; group?: string; method?: string; args?: unknown[]; sourceId?: string; epoch?: string; policy?: CapturePolicy; packet?: CaptureAudioPacket; clientId?: string; delay?: number }) => {
  if (message.type === "reply") { pending.get(message.id!)?.(message.value); pending.delete(message.id!); return; }
  if (message.type === "group") {
    let group = groups.get(message.group!);
    if (!group) { group = engine.group(message.group!, state => port.postMessage({ type: "state", group: message.group, state })); groups.set(message.group!, group); }
    if (message.method === "members") group.members(message.args![0] as Member[]);
    if (message.method === "screens") group.screens(message.args![0] as string[]);
    if (message.method === "send") group.send(message.args![0] as SyncedLoad | PlaybackCommand);
    if (message.method === "close") { group.close(); groups.delete(message.group!); }
  } else if (message.type === "register") { registrations.set(message.sourceId!, message.epoch!); engine.registerSource(message.sourceId!, message.policy!); }
  else if (message.type === "write" && registrations.get(message.sourceId!) === message.epoch) { engine.writeSource(message.sourceId!, message.packet!); port.postMessage({ type: "written", sourceId: message.sourceId, epoch: message.epoch, bytes: message.packet!.pcm.byteLength }); }
  else if (message.type === "end" && registrations.get(message.sourceId!) === message.epoch) { registrations.delete(message.sourceId!); const socket = uploads.get(message.sourceId!); uploads.delete(message.sourceId!); socket?.close(); engine.endSource(message.sourceId!); }
  else if (message.type === "drop") engine.drop(message.clientId!);
  else if (message.type === "setDelay") engine.setDelay(message.clientId!, message.delay!);
  else if (message.type === "close") { for (const group of groups.values()) group.close(); engine.close(); for (const socket of websocket.clients) socket.terminate(); server.close(() => { port.close(); }); }
});
server.listen(0, "127.0.0.1", () => port.postMessage({ type: "ready", port: (server.address() as { port: number }).port }));
