import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { connect, type Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { logPlaybackError } from "./playback-log";
import { useHelper } from "./helpers";
import { loopbackPeer } from "./lan-listener";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import type { CaptureAudioPacket } from "./capture-audio";
import type { Ffmpeg } from "./scheduled-capture";
import type { Member, SyncedLoad } from "./scheduled-audio";
import type { LiveSource } from "../shared/live-input";
export type { Member, SyncedLoad } from "./scheduled-audio";

/** Core owns authority/lifetimes. The worker owns clocks, encoding and Sendspin sessions. */
export function createSendspin(options: { serverId?: string; privateKey?: string; name: string; admit: (clientId: string, loopback: boolean) => boolean; changed: () => void; ffmpeg?: Ffmpeg; savedDelay?: (clientId: string) => number | undefined; saveDelay?: (clientId: string, delay: number) => void; sourceFailed?: (sourceId: string, error: string) => void }) {
  const secret = randomUUID();
  const beside = new URL("./audio-worker.mjs", import.meta.url);
  const worker = new Worker(existsSync(beside) ? beside : resolve("build/audio-worker.mjs"), { workerData: { serverId: options.serverId, privateKey: options.privateKey, name: options.name, secret } });
  // Keep each group's current item so worker failure reaches the Playback that was loading/playing.
  const groups = new Map<string, { epoch: string; observe: (state: PlayerState) => void; playbackId?: string }>(), sources = new Map<string, { epoch: string; queued: number; error?: string }>();
  const connections = new Set<WebSocket | Socket>();
  const devices = new Map<Socket, string>();
  const uploads = new Map<string, WebSocket>();
  let clients = new Set<string>(), delays = new Map<string, number>(), receivers = new Map<string, { error: string; group: string; epoch: string }>();
  let closed = false, failed: string | undefined;
  let closing: Promise<void> | undefined;
  const children = new Set<number>();
  const helpers = new Map<number, ReturnType<typeof useHelper>>();
  const releases = new Set<Promise<void>>();
  const releaseHelper = (id: number) => {
    const helper = helpers.get(id); helpers.delete(id);
    if (!helper) return;
    const released = helper.then(lease => lease.release(), () => {});
    releases.add(released); void released.then(() => releases.delete(released));
  };
  const closeConnections = () => {
    for (const connection of connections) { if (connection instanceof WebSocket) connection.terminate(); else connection.destroy(); }
    connections.clear(); devices.clear(); uploads.clear();
  };
  const retireChildren = async () => {
    // A terminated worker cannot run child.kill(). Only these reported, owned PIDs
    // may be stopped by Core; signaling alone is not proof of process retirement.
    for (const pid of children) { try { process.kill(pid, "SIGKILL"); } catch { /* Checked below. */ } }
    const deadline = Date.now() + 1000;
    while (children.size) {
      for (const pid of children) {
        try { process.kill(pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") children.delete(pid); }
      }
      if (!children.size) return;
      if (Date.now() >= deadline) {
        // After a worker crash, Node can no longer reap its exited children.
        // A confirmed zombie is stopped; keep failing for running/unknown PIDs.
        if (worker.threadId === -1 && process.platform !== "win32") {
          try {
            const { stdout } = await promisify(execFile)("ps", ["-o", "pid=,ppid=,stat=", "-p", [...children].join(",")], { timeout: 1000 });
            for (const line of stdout.trim().split("\n")) {
              const [pid, parent, state] = line.trim().split(/\s+/);
              if (Number(parent) === process.pid && state?.startsWith("Z")) children.delete(Number(pid));
            }
          } catch { /* An unavailable status check is not proof of retirement. */ }
        }
        for (const pid of children) {
          try { process.kill(pid, 0); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") children.delete(pid); }
        }
        if (children.size) throw new Error("An audio encoder did not stop.");
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  let readyResolve: (port: number) => void, readyReject: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => {});
  const post = (message: Record<string, unknown>) => { if (!closed && !failed) worker.postMessage(message); };
  const fail = (error: Error) => {
    if (closed || failed) return;
    failed = error.message || "The audio worker stopped."; readyReject(error); clients.clear();
    closeConnections();
    for (const [id, source] of sources) { source.error = failed; options.sourceFailed?.(id, failed); }
    for (const group of groups.values()) group.observe({ playbackId: group.playbackId ?? null, status: "error", error: failed, position: 0, duration: null, volume: 100, seekable: false });
    options.changed();
  };
  worker.on("error", fail);
  const retired = new Promise<void>(resolve => worker.once("exit", code => {
    if (!closed) { fail(new Error(`The audio worker stopped (${code}).`)); void retireChildren().catch(() => {}); }
    for (const id of helpers.keys()) releaseHelper(id);
    resolve();
  }));
  worker.on("message", async message => {
    if (message.type === "ffmpegRelease") { releaseHelper(message.id); return; }
    if (message.type === "child") { children.add(message.pid); return; }
    if (message.type === "childClosed") { children.delete(message.pid); return; }
    if (closed || failed) return;
    if (message.type === "ready") readyResolve(message.port);
    else if (message.type === "admit") post({ type: "reply", id: message.id, value: options.admit(message.clientId, message.loopback) });
    else if (message.type === "ffmpeg") {
      try {
        const helper = options.ffmpeg ? options.ffmpeg().then(selected => typeof selected === "string" ? { path: selected, release() {} } : selected) : useHelper("ffmpeg");
        helpers.set(message.id, helper);
        const { path } = await helper;
        if (closed || failed) releaseHelper(message.id);
        else post({ type: "reply", id: message.id, value: { path, leaseId: message.id } });
      } catch (error) { releaseHelper(message.id); post({ type: "reply", id: message.id, value: { error: error instanceof Error ? error.message : "FFmpeg unavailable" } }); }
    } else if (message.type === "logError") { const group = groups.get(message.group); if (group && group.epoch === message.epoch) logPlaybackError(message.group, "Synced", message.source, message.error); }
    else if (message.type === "state") { const group = groups.get(message.group); if (group && group.epoch === message.epoch) group.observe(message.state); }
    else if (message.type === "delay") options.saveDelay?.(message.clientId, message.delay);
    else if (message.type === "sourceFailed") { const source = sources.get(message.sourceId); if (!source || source.epoch !== message.epoch) return; source.error = message.error; options.sourceFailed?.(message.sourceId, message.error); options.changed(); }
    else if (message.type === "written") { const source = sources.get(message.sourceId); if (source && source.epoch === message.epoch) source.queued = Math.max(0, source.queued - message.bytes); }
    else if (message.type === "status") {
      clients = new Set(message.value.clients); delays = new Map(message.value.delays);
      receivers = new Map(message.value.receivers.map(([id, error, group, epoch]: [string, string, string, string]) => [id, { error, group, epoch }]));
      options.changed();
    }
  });
  const bridge = (socket: WebSocket, query: string) => {
    if (closed || failed) { socket.terminate(); return; }
    connections.add(socket); socket.pause();
    socket.on("error", () => socket.terminate());
    let upstream: WebSocket | undefined;
    socket.once("close", () => { connections.delete(socket); upstream?.terminate(); });
    void ready.then(port => {
      if (closed || failed || socket.readyState !== WebSocket.OPEN) { socket.terminate(); return; }
      upstream = new WebSocket(`ws://127.0.0.1:${port}/?secret=${secret}&${query}`, { perMessageDeflate: false, maxPayload: 1024 * 1024 });
      const other = upstream;
      connections.add(other); other.once("close", () => connections.delete(other));
      const forward = (from: WebSocket, to: WebSocket, data: WebSocket.RawData, binary: boolean) => {
        if (from.readyState !== WebSocket.OPEN || to.readyState !== WebSocket.OPEN) { socket.terminate(); other.terminate(); return; }
        to.send(data, { binary });
      };
      socket.on("message", (data, binary) => forward(socket, other, data, binary));
      other.on("message", (data, binary) => forward(other, socket, data, binary));
      other.once("open", () => socket.resume());
      other.on("error", () => socket.terminate());
      other.once("close", (code, reason) => { try { socket.close(code, reason); } catch { socket.close(); } });
    }).catch(() => socket.terminate());
  };
  const upgrade = (request: IncomingMessage, socket: Socket, head: Buffer, deviceId?: string) => {
    if (closed || failed) { socket.destroy(); return; }
    if (deviceId !== undefined && !options.admit(deviceId, loopbackPeer(request.socket.remoteAddress ?? ""))) { socket.destroy(); return; }
    socket.pause(); connections.add(socket);
    if (deviceId !== undefined) devices.set(socket, deviceId);
    socket.once("close", () => { connections.delete(socket); devices.delete(socket); });
    void ready.then(port => {
      if (closed || failed || socket.destroyed) { socket.destroy(); return; }
      const upstream = connect(port, "127.0.0.1");
      connections.add(upstream); upstream.once("close", () => connections.delete(upstream));
      const timeout = setTimeout(() => { upstream.destroy(); socket.destroy(); }, 10_000);
      upstream.once("connect", () => {
        clearTimeout(timeout);
        const headers = request.rawHeaders.reduce((all, value, i, list) => i % 2 ? all : all + `${value}: ${list[i + 1]}\r\n`, "");
        upstream.write(`GET /?secret=${secret}&loopback=${loopbackPeer(request.socket.remoteAddress ?? "")}${deviceId ? `&device=${encodeURIComponent(deviceId)}` : ""} HTTP/1.1\r\n${headers}\r\n`);
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket); socket.resume();
      });
      upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
      socket.once("close", () => { clearTimeout(timeout); upstream.destroy(); });
      upstream.once("close", () => socket.destroy());
    }).catch(() => socket.destroy());
  };
  const accept = Object.assign((socket: WebSocket, request: IncomingMessage) => bridge(socket, `loopback=${loopbackPeer(request.socket.remoteAddress ?? "")}`), { upgrade });
  return {
    accept, upgrade,
    group(id: string, observe: (state: PlayerState) => void) {
      const group = { epoch: randomUUID(), observe, playbackId: undefined as string | undefined };
      groups.set(id, group);
      const call = (method: string, ...args: unknown[]) => { if (groups.get(id) === group) post({ type: "group", group: id, epoch: group.epoch, method, args }); };
      call("create");
      return {
        members(next: Member[]) { call("members", next); },
        screens: (next: string[]) => call("screens", next),
        send(command: SyncedLoad | PlaybackCommand) {
          if (groups.get(id) !== group) return;
          if (command.type === "load") {
            group.playbackId = command.playbackId;
            if (failed && !closed) queueMicrotask(() => {
              if (groups.get(id) === group && group.playbackId === command.playbackId && !closed) observe({ playbackId: command.playbackId, status: "error", error: failed!, position: 0, duration: null, volume: 100, seekable: false });
            });
          } else if (command.type === "stop") group.playbackId = undefined;
          call("send", command);
        },
        duration: (playbackId: string, seconds: number) => call("duration", playbackId, seconds),
        close() { call("close"); if (groups.get(id) === group) groups.delete(id); },
      };
    },
    registerSource(id: string, details?: LiveSource) {
      if (closed || sources.has(id)) return;
      const source = { epoch: randomUUID(), queued: 0, error: failed };
      sources.set(id, source);
      if (source.error) queueMicrotask(() => { if (!closed && sources.get(id) === source) { options.sourceFailed?.(id, source.error!); options.changed(); } });
      post({ type: "register", sourceId: id, epoch: source.epoch, details });
    },
    updateSource(details: LiveSource) { post({ type: "sourceMetadata", sourceId: details.id, epoch: sources.get(details.id)?.epoch, details }); },
    writeSource(id: string, packet: CaptureAudioPacket) {
      const source = sources.get(id);
      if (!source || source.error || closed || failed) return false;
      if (source.queued + packet.pcm.byteLength > 768_000) { source.error = "The audio worker cannot keep up with capture."; options.sourceFailed?.(id, source.error); return false; }
      source.queued += packet.pcm.byteLength; post({ type: "write", sourceId: id, epoch: source.epoch, packet }); return true;
    },
    acceptSource(socket: WebSocket, id: string) {
      if (closed || failed || !sources.has(id) || sources.get(id)?.error || uploads.has(id)) return false;
      uploads.set(id, socket);
      socket.once("close", () => { if (uploads.get(id) === socket) uploads.delete(id); });
      bridge(socket, `source=${encodeURIComponent(id)}&epoch=${sources.get(id)!.epoch}`); return true;
    },
    endSource(id: string) { const epoch = sources.get(id)?.epoch; sources.delete(id); const upload = uploads.get(id); uploads.delete(id); upload?.close(); post({ type: "end", sourceId: id, epoch }); },
    hasSource: (id: string) => sources.has(id),
    sourceError: (id: string) => sources.get(id)?.error,
    receiverError(id: string) { const receiver = receivers.get(id); return receiver && groups.get(receiver.group)?.epoch === receiver.epoch ? receiver.error : undefined; },
    connected: (id: string) => clients.has(id),
    delay: (id: string) => delays.get(id) ?? options.savedDelay?.(id) ?? (clients.has(id) ? 0 : undefined),
    setDelay(id: string, delay: number) {
      post({ type: "setDelay", clientId: id, delay });
    },
    drop(id: string) {
      // Revoke the authenticated transport even before the SDK learns its identity.
      for (const [socket, deviceId] of devices) if (deviceId === id) socket.destroy();
      post({ type: "drop", clientId: id });
    },
    close() {
      if (closing) return closing;
      post({ type: "close" }); closed = true; readyReject(new Error("Sendspin closed."));
      closeConnections(); groups.clear(); sources.clear();
      // Give graceful teardown its existing budget. Reap the children while their
      // worker can still consume close events, then use Node's termination promise.
      const timeout = setTimeout(() => { void retireChildren().catch(() => {}).then(() => worker.terminate()); }, 3000);
      closing = (async () => {
        try { await retired; await retireChildren(); await Promise.all(releases); }
        finally { clearTimeout(timeout); }
      })();
      return closing;
    },
  };
}
