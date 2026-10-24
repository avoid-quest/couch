import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { connect, type Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { logPlaybackError } from "./playback-log";
import { useHelper } from "./helpers";
import { loopbackPeer } from "./lan-listener";
import type { OutputAdmission, PlaybackCommand, PlayerState } from "../shared/protocol";
import type { CaptureAudioPacket, CapturePolicy } from "./capture-audio";
import type { Member, SyncedLoad } from "./scheduled-audio";
export type { Member, SyncedLoad } from "./scheduled-audio";
export { audioRendition, liveHls } from "./source-preparation";

/** Core owns authority/lifetimes. The worker owns clocks, encoding, encryption and fanout. */
export function createSendspin(options: { identity: string; name: string; admit: (clientId: string, loopback: boolean) => boolean; changed: () => void; ffmpeg?: () => Promise<string>; savedDelay?: (clientId: string) => number | undefined; saveDelay?: (clientId: string, delay: number) => void; sourceFailed?: (sourceId: string, error: string) => void }) {
  const secret = randomUUID();
  const beside = new URL("./audio-worker.mjs", import.meta.url);
  const worker = new Worker(existsSync(beside) ? beside : resolve("build/audio-worker.mjs"), { workerData: { identity: options.identity, name: options.name, secret } });
  const groups = new Map<string, (state: PlayerState) => void>(), sources = new Map<string, { policy: CapturePolicy; epoch: string; queued: number; error?: string }>();
  const groupMembers = new Map<string, Member[]>(), groupIntents = new Map<string, string>();
  let timing = new Map<string, number | undefined>();
  let admissions = new Map<string, { group: string; receiverId?: string; admission: OutputAdmission }>();
  const connections = new Set<WebSocket | Socket>();
  const uploads = new Map<string, WebSocket>();
  let clients = new Set<string>(), delays = new Map<string, number>(), receivers = new Map<string, string>();
  let closed = false, failed = false;
  let helper: ReturnType<typeof useHelper> | undefined;
  let readyResolve: (port: number) => void, readyReject: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => {});
  const post = (message: Record<string, unknown>) => { if (!closed && !failed) worker.postMessage(message); };
  const fail = (error: Error) => {
    if (closed || failed) return;
    failed = true; readyReject(error); clients.clear(); admissions.clear();
    for (const [id, source] of sources) { source.error = error.message; options.sourceFailed?.(id, error.message); }
    for (const observe of groups.values()) observe({ playbackId: null, status: "error", error: error.message, position: 0, duration: null, volume: 100, seekable: false });
    options.changed();
  };
  worker.on("error", fail);
  worker.on("exit", code => { if (!closed) fail(new Error(`The audio worker stopped (${code}).`)); void helper?.then(lease => lease.release(), () => {}); });
  worker.on("message", async message => {
    if (closed) return;
    if (message.type === "ready") readyResolve(message.port);
    else if (message.type === "admit") post({ type: "reply", id: message.id, value: options.admit(message.clientId, message.loopback) });
    else if (message.type === "ffmpeg") {
      try { const path = options.ffmpeg ? await options.ffmpeg() : (await (helper ??= useHelper("ffmpeg"))).path; post({ type: "reply", id: message.id, value: { path } }); }
      catch (error) { post({ type: "reply", id: message.id, value: { error: error instanceof Error ? error.message : "FFmpeg unavailable" } }); }
    } else if (message.type === "logError") logPlaybackError(message.group, "Synced", message.source, message.error);
    else if (message.type === "state") groups.get(message.group)?.(message.state);
    else if (message.type === "delay") options.saveDelay?.(message.clientId, message.delay);
    else if (message.type === "sourceFailed") { const source = sources.get(message.sourceId); if (!source || source.epoch !== message.epoch) return; source.error = message.error; options.sourceFailed?.(message.sourceId, message.error); options.changed(); }
    else if (message.type === "written") { const source = sources.get(message.sourceId); if (source && source.epoch === message.epoch) source.queued = Math.max(0, source.queued - message.bytes); }
    else if (message.type === "status") { clients = new Set(message.value.clients); timing = new Map(message.value.timings); delays = new Map(message.value.delays); receivers = new Map(message.value.receivers); admissions = new Map(message.value.admissions); options.changed(); }
  });
  const bridge = (socket: WebSocket, query: string) => {
    connections.add(socket); socket.pause();
    socket.on("error", () => socket.terminate());
    let upstream: WebSocket | undefined;
    socket.once("close", () => { connections.delete(socket); upstream?.terminate(); });
    void ready.then(port => {
      if (closed || socket.readyState !== WebSocket.OPEN) return;
      upstream = new WebSocket(`ws://127.0.0.1:${port}/?secret=${secret}&${query}`, { perMessageDeflate: false, maxPayload: 1024 * 1024 });
      const other = upstream;
      const forward = (from: WebSocket, to: WebSocket, data: WebSocket.RawData, binary: boolean) => {
        if (from.readyState !== WebSocket.OPEN || to.readyState !== WebSocket.OPEN || to.bufferedAmount > 256 * 1024) { socket.terminate(); other.terminate(); return; }
        to.send(data, { binary });
      };
      socket.on("message", (data, binary) => forward(socket, other, data, binary));
      other.on("message", (data, binary) => forward(other, socket, data, binary));
      other.once("open", () => socket.resume());
      other.on("error", () => socket.terminate());
      other.once("close", () => socket.close());
    }).catch(() => socket.terminate());
  };
  const upgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    socket.pause(); connections.add(socket);
    void ready.then(port => {
      if (closed || socket.destroyed) return;
      const upstream = connect(port, "127.0.0.1");
      const timeout = setTimeout(() => { upstream.destroy(); socket.destroy(); }, 10_000);
      upstream.once("connect", () => {
        clearTimeout(timeout);
        const headers = request.rawHeaders.reduce((all, value, i, list) => i % 2 ? all : all + `${value}: ${list[i + 1]}\r\n`, "");
        upstream.write(`GET /?secret=${secret}&loopback=${loopbackPeer(request.socket.remoteAddress ?? "")} HTTP/1.1\r\n${headers}\r\n`);
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket); socket.resume();
      });
      upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
      socket.once("close", () => { clearTimeout(timeout); connections.delete(socket); upstream.destroy(); });
      upstream.once("close", () => socket.destroy());
    }).catch(() => socket.destroy());
  };
  const accept = Object.assign((socket: WebSocket, request: IncomingMessage) => bridge(socket, `loopback=${loopbackPeer(request.socket.remoteAddress ?? "")}`), { upgrade });
  const validateDelay = (id: string, delay: number, intent?: string) => {
    if (intent !== "live" || delay === 0) return;
    const required = timing.get(id);
    if (required === undefined || required + Math.max(0, delay) > 70) throw new Error("That output correction exceeds the remaining live audio deadline. Reduce the correction or use relaxed sharing.");
  };
  return {
    accept, upgrade, validateDelay,
    group(id: string, observe: (state: PlayerState) => void) {
      groups.set(id, observe);
      const call = (method: string, ...args: unknown[]) => post({ type: "group", group: id, method, args });
      return {
        members(next: Member[]) { groupMembers.set(id, next); call("members", next); },
        screens: (next: string[]) => call("screens", next),
        send(command: SyncedLoad | PlaybackCommand) { if (command.type === "load") groupIntents.set(id, (command as SyncedLoad).intent ?? "relaxed"); call("send", command); },
        close() { groups.delete(id); groupMembers.delete(id); groupIntents.delete(id); call("close"); },
      };
    },
    registerSource(id: string, policy: CapturePolicy) { if (!sources.has(id)) { const epoch = randomUUID(); sources.set(id, { policy, epoch, queued: 0 }); post({ type: "register", sourceId: id, policy, epoch }); } },
    writeSource(id: string, packet: CaptureAudioPacket) {
      const source = sources.get(id);
      if (!source || source.error || closed || failed) return false;
      if (source.queued + packet.pcm.byteLength > 768_000) { source.error = "The audio worker cannot keep up with capture."; options.sourceFailed?.(id, source.error); return false; }
      source.queued += packet.pcm.byteLength; post({ type: "write", sourceId: id, epoch: source.epoch, packet }); return true;
    },
    acceptSource(socket: WebSocket, id: string, _uploadId?: string) {
      if (!sources.has(id) || uploads.has(id)) return false;
      uploads.set(id, socket);
      socket.once("close", () => { if (uploads.get(id) === socket) uploads.delete(id); });
      bridge(socket, `source=${encodeURIComponent(id)}&epoch=${sources.get(id)!.epoch}`); return true;
    },
    endSource(id: string) { const epoch = sources.get(id)?.epoch; sources.delete(id); const upload = uploads.get(id); uploads.delete(id); upload?.close(); post({ type: "end", sourceId: id, epoch }); },
    hasSource: (id: string) => sources.has(id),
    sourceError: (id: string) => sources.get(id)?.error,
    receiverError: (id: string, _intent?: string) => receivers.get(id),
    receiverAdmission(id: string, receiverId?: string): OutputAdmission | undefined {
      const member = [...groupMembers].find(([group, members]) => (receiverId !== undefined || groupIntents.get(group) === "live") && members.some(member => member.deviceId === id && member.receiverId === receiverId));
      if (!member) return undefined;
      const current = admissions.get(id);
      return current && current.group === member[0] && current.receiverId === receiverId ? current.admission : receiverId ? { state: "preparing" } : undefined;
    },
    connected: (id: string) => clients.has(id),
    delay: (id: string) => delays.get(id) ?? options.savedDelay?.(id) ?? (clients.has(id) ? 0 : undefined),
    setDelay(id: string, delay: number) {
      const live = [...groupMembers].some(([group, members]) => groupIntents.get(group) === "live" && members.some(member => member.deviceId === id));
      validateDelay(id, delay, live ? "live" : undefined);
      post({ type: "setDelay", clientId: id, delay });
    },
    drop: (id: string) => post({ type: "drop", clientId: id }),
    close() {
      post({ type: "close" }); closed = true;
      for (const connection of connections) { if (connection instanceof WebSocket) connection.terminate(); else connection.destroy(); }
      const timeout = setTimeout(() => void worker.terminate(), 3000); timeout.unref(); worker.once("exit", () => clearTimeout(timeout));
    },
  };
}
