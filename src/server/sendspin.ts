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
import type { LiveAudioSettings, LiveListenerStatus, PlaybackCommand, PlayerState } from "../shared/protocol";
import type { LiveTransportStatus } from "./live-transport";
import type { CaptureAudioPacket, CapturePolicy } from "./capture-audio";
import type { Member, SyncedLoad } from "./scheduled-audio";
import { createListenerFanout } from "./live-fanout";
export type { Member, SyncedLoad } from "./scheduled-audio";

/** Core owns authority/lifetimes. The worker owns clocks, encoding, encryption and fanout. */
export function createSendspin(options: { identity: string; name: string; admit: (clientId: string, loopback: boolean) => boolean; changed: () => void; ffmpeg?: () => Promise<string>; savedDelay?: (clientId: string) => number | undefined; saveDelay?: (clientId: string, delay: number) => void; sourceFailed?: (sourceId: string, error: string) => void }) {
  const secret = randomUUID();
  const beside = new URL("./audio-worker.mjs", import.meta.url);
  const worker = new Worker(existsSync(beside) ? beside : resolve("build/audio-worker.mjs"), { workerData: { identity: options.identity, name: options.name, secret } });
  const groups = new Map<string, (state: PlayerState) => void>(), sources = new Map<string, { epoch: string; queued: number; error?: string }>();
  const connections = new Set<WebSocket | Socket>();
  const uploads = new Map<string, WebSocket>();
  const listening = new Map<string, LiveTransportStatus>(), standing = new Map<string, string>();
  // Every window gets state again when a listener's standing changes, not for each of its once-a-second
  // measurements: with 50 listeners that would resend each window's whole state every second. The
  // operator reads the measurements themselves from liveStatus.
  const standingOf = (status: LiveTransportStatus) => JSON.stringify([status.leadMs, status.listeners.map(l => [l.deviceId, l.codec, l.status, l.behindMs && Math.ceil(l.behindMs / 10)])]);
  let clients = new Set<string>(), delays = new Map<string, number>(), receivers = new Map<string, string>();
  let closed = false, failed = false;
  const helpers = new Map<number, ReturnType<typeof useHelper>>();
  const releaseHelper = (id: number) => {
    const helper = helpers.get(id); helpers.delete(id);
    void helper?.then(lease => lease.release(), () => {});
  };
  let readyResolve: (port: number) => void, readyReject: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => {});
  const post = (message: Record<string, unknown>) => { if (!closed && !failed) worker.postMessage(message); };
  const fanout = createListenerFanout(post);
  const fail = (error: Error) => {
    if (closed || failed) return;
    failed = true; readyReject(error); clients.clear(); fanout.close();
    for (const [id, source] of sources) { source.error = error.message; options.sourceFailed?.(id, error.message); }
    for (const observe of groups.values()) observe({ playbackId: null, status: "error", error: error.message, position: 0, duration: null, volume: 100, seekable: false });
    options.changed();
  };
  worker.on("error", fail);
  worker.on("exit", code => { if (!closed) fail(new Error(`The audio worker stopped (${code}).`)); for (const id of helpers.keys()) releaseHelper(id); });
  worker.on("message", async message => {
    if (message.type.startsWith("listener")) return fanout.receive(message);
    if (message.type === "ffmpegRelease") { releaseHelper(message.id); return; }
    if (closed) return;
    if (message.type === "ready") readyResolve(message.port);
    else if (message.type === "admit") post({ type: "reply", id: message.id, value: options.admit(message.clientId, message.loopback) });
    else if (message.type === "ffmpeg") {
      try {
        const helper = options.ffmpeg ? options.ffmpeg().then(path => ({ path, release() {} })) : useHelper("ffmpeg");
        helpers.set(message.id, helper);
        const { path } = await helper;
        if (closed || failed) releaseHelper(message.id);
        else post({ type: "reply", id: message.id, value: { path, leaseId: message.id } });
      } catch (error) { releaseHelper(message.id); post({ type: "reply", id: message.id, value: { error: error instanceof Error ? error.message : "FFmpeg unavailable" } }); }
    } else if (message.type === "logError") logPlaybackError(message.group, "Synced", message.source, message.error);
    else if (message.type === "state") groups.get(message.group)?.(message.state);
    else if (message.type === "delay") options.saveDelay?.(message.clientId, message.delay);
    else if (message.type === "sourceFailed") { const source = sources.get(message.sourceId); if (!source || source.epoch !== message.epoch) return; source.error = message.error; options.sourceFailed?.(message.sourceId, message.error); options.changed(); }
    else if (message.type === "written") { const source = sources.get(message.sourceId); if (source && source.epoch === message.epoch) source.queued = Math.max(0, source.queued - message.bytes); }
    else if (message.type === "liveListeners") {
      if (sources.get(message.sourceId)?.epoch !== message.epoch) return;
      listening.set(message.sourceId, message.status);
      const signature = standingOf(message.status);
      if (standing.get(message.sourceId) !== signature) { standing.set(message.sourceId, signature); options.changed(); }
    }
    else if (message.type === "status") { clients = new Set(message.value.clients); delays = new Map(message.value.delays); receivers = new Map(message.value.receivers); options.changed(); }
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
      other.once("close", (code, reason) => { try { socket.close(code, reason); } catch { socket.close(); } });
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
  return {
    accept, upgrade,
    group(id: string, observe: (state: PlayerState) => void) {
      groups.set(id, observe);
      const call = (method: string, ...args: unknown[]) => post({ type: "group", group: id, method, args });
      return {
        members(next: Member[]) { call("members", next); },
        screens: (next: string[]) => call("screens", next),
        send(command: SyncedLoad | PlaybackCommand) { call("send", command); },
        close() { groups.delete(id); call("close"); },
      };
    },
    registerSource(id: string, policy: CapturePolicy, live?: LiveAudioSettings) { if (!sources.has(id)) { const epoch = randomUUID(); sources.set(id, { epoch, queued: 0 }); post({ type: "register", sourceId: id, epoch, ...policy.intent === "live" && live ? { live } : {} }); } },
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
    endSource(id: string) { const epoch = sources.get(id)?.epoch; sources.delete(id); listening.delete(id); standing.delete(id); const upload = uploads.get(id); uploads.delete(id); upload?.close(); post({ type: "end", sourceId: id, epoch }); },
    hasSource: (id: string) => sources.has(id),
    // Live audio listeners, after Hub authorizes them.
    listen: fanout.listen,
    liveLead: (sourceId: string) => listening.get(sourceId)?.leadMs,
    liveStatus: (sourceId: string) => listening.get(sourceId),
    // The operator's changes apply to every running Live stream at once.
    configureLive: (settings: LiveAudioSettings) => post({ type: "liveSettings", live: settings }),
    liveListener(sourceId: string, deviceId: string): LiveListenerStatus | undefined {
      const found = listening.get(sourceId)?.listeners.find(listener => listener.deviceId === deviceId);
      if (!found) return undefined;
      const { deviceId: _, ...status } = found;
      return status;
    },
    dropListener: (sourceId: string, deviceId: string, reason?: string) => post({ type: "dropListener", sourceId, clientId: deviceId, reason }),
    sourceError: (id: string) => sources.get(id)?.error,
    receiverError: (id: string) => receivers.get(id),
    connected: (id: string) => clients.has(id),
    delay: (id: string) => delays.get(id) ?? options.savedDelay?.(id) ?? (clients.has(id) ? 0 : undefined),
    setDelay(id: string, delay: number) {
      post({ type: "setDelay", clientId: id, delay });
    },
    drop: (id: string) => post({ type: "drop", clientId: id }),
    close() {
      post({ type: "close" }); closed = true; fanout.close();
      for (const connection of connections) { if (connection instanceof WebSocket) connection.terminate(); else connection.destroy(); }
      const timeout = setTimeout(() => void worker.terminate(), 3000); timeout.unref(); worker.once("exit", () => clearTimeout(timeout));
    },
  };
}
