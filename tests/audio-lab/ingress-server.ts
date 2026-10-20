// C1/C2 TEST-OWNED PROTOTYPE. Never mounted by Couch. PCM is a two-client
// feasibility experiment, not evidence of 50 compressed listeners.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { WebSocket, WebSocketServer } from "ws";
import { AudioCodec, Identity, PlaybackStateType, PlayerCommand, SENTINEL_RESOLVED, SendspinCore, serverNowUs, type SendspinSession } from "@sonn-audio/node-sendspin";
import type { openStore } from "../../src/server/store";

export const ingressMagic = 0x314d4350; // PCM1, little endian; 16-byte header.
export type IngressOptions = {
  store: ReturnType<typeof openStore>;
  publisherId: string;
  receiverIds: string[];
  allowedOrigin?: string;
  allowedOrigins?: string[];
  packetMs: 10 | 20;
  leadMs: number;
  host?: string;
  port?: number;
  tls?: { certFile: string; keyFile: string };
};

export async function startIngressLab(options: IngressOptions) {
  const { store, packetMs, leadMs } = options;
  assert(packetMs === 10 || packetMs === 20);
  assert(Number.isFinite(leadMs) && leadMs >= packetMs && leadMs <= 1000);
  assert(options.receiverIds.length === 2 && new Set(options.receiverIds).size === 2, "Two receivers only");
  assert(!options.receiverIds.includes(options.publisherId));
  const origins = new Set(options.allowedOrigins ?? (options.allowedOrigin ? [options.allowedOrigin] : []));
  assert(origins.size && [...origins].every(origin => new URL(origin).origin === origin), "Explicit browser origins required");
  const frameSamples = packetMs * 48, frameBytes = frameSamples * 4;
  const core = new SendspinCore();
  core.configureServer({ name: "Couch test-only PCM ingress" });
  // A distinct ephemeral *lab* server identity; the paired receiver keys remain
  // Couch identities. The allowlist plus Noise key proof enforce admission.
  core.enableEncryption(Identity.generate(), () => SENTINEL_RESOLVED);
  const sockets = new Set<WebSocket>();
  const transports = new WeakMap<WebSocket, { localAddress: string | null; localPort: number | null; remoteAddress: string | null; remotePort: number | null }>();
  const receiverTimeouts = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  const receivers = new Map<string, { socket: WebSocket; session: SendspinSession; blockedSince?: number }>();
  let generation = 0, publisher: { socket: WebSocket; token: string; generation: number } | undefined;
  let timeline: { originUs: number; firstSample: number; nextSample: number; uncertaintyUs: number } | undefined;
  let lastFrameAt = 0;
  const metrics = { acceptedFrames: 0, lateFrames: 0, missingSamples: 0, rejected: 0, stopped: 0,
    sentFrames: {} as Record<string, number>, sentPcmBytes: {} as Record<string, number>, excluded: {} as Record<string, string>,
    maxIngressAgeUs: 0, maxSocketBytes: 0, stopReason: "idle" };
  const admitted = (id: string) => options.receiverIds.includes(id) && !!store.device(id);
  const authorized = (token: string) => {
    const device = store.deviceForToken(token);
    return device?.id === options.publisherId && (device.role === "administrator" || device.role === "controller");
  };
  function end(reason: string) {
    timeline = undefined;
    metrics.stopReason = reason; metrics.stopped++;
    for (const { session } of receivers.values()) {
      session.sendStreamClear(); session.sendStreamEnd();
      session.sendGroupUpdate(PlaybackStateType.STOPPED, "lab-ingress");
    }
  }
  function stop(reason = "source stopped") {
    const current = publisher; publisher = undefined;
    end(reason);
    current?.socket.close(1000, reason);
  }
  const reject = (socket: WebSocket, reason: string) => {
    metrics.rejected++;
    if (publisher?.socket === socket) stop(reason);
    socket.close(1008, reason);
  };
  function begin(session: SendspinSession) {
    session.sendStreamStart({ codec: AudioCodec.PCM, sampleRate: 48_000, channels: 2, bitDepth: 16 });
    session.sendServerCommand({ player: { command: PlayerCommand.VOLUME, volume: 100 } });
    session.sendGroupUpdate(PlaybackStateType.PLAYING, "lab-ingress", "Test-only live PCM");
  }
  function exclude(id: string, reason: string) {
    const current = receivers.get(id);
    metrics.excluded[id] = reason;
    current?.session.sendStreamClear(); current?.session.sendStreamEnd();
    current?.socket.terminate();
    receivers.delete(id);
  }
  for (const id of options.receiverIds) core.registerHooks(id, {
    onIdentified(session) {
      const socket = [...sockets].find(socket => core.getSessionBySocket(socket) === session)!;
      // getClientId is the proven static key only after Noise completes. SDK
      // identification alone also accepts its legacy plaintext protocol.
      if (socket.readyState !== WebSocket.OPEN || !session.isEncrypted() || session.getClientId() !== id || !admitted(id) || receivers.has(id) || metrics.excluded[id]) return void socket.terminate();
      const pcm = session.getPlayerSupportedFormats().some(format => format.codec === AudioCodec.PCM && format.sample_rate === 48_000 && format.channels === 2 && format.bit_depth === 16);
      if (!pcm) return void socket.terminate();
      receivers.set(id, { socket, session });
      clearTimeout(receiverTimeouts.get(socket)); receiverTimeouts.delete(socket);
      if (timeline) begin(session);
    },
    onDisconnected(session) { if (receivers.get(id)?.session === session) receivers.delete(id); },
  });
  const server = options.tls ? createSecureServer({
    cert: readFileSync(options.tls.certFile), key: readFileSync(options.tls.keyFile),
  }) : createServer();
  server.on("request", (_request, response) => response.writeHead(404).end("Test-only PCM ingress"));
  const ws = new WebSocketServer({ noServer: true, maxPayload: frameBytes + 1024, perMessageDeflate: false });
  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url!, "http://lab").pathname;
    if (!origins.has(request.headers.origin ?? "") || !["/sendspin", "/__lab/pcm"].includes(path) || sockets.size >= 6) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    ws.handleUpgrade(request, socket, head, client => {
      sockets.add(client);
      transports.set(client, {
        localAddress: request.socket.localAddress ?? null, localPort: request.socket.localPort ?? null,
        remoteAddress: request.socket.remoteAddress ?? null, remotePort: request.socket.remotePort ?? null,
      });
      client.on("error", () => {});
      const timeout = setTimeout(() => client.terminate(), 3000);
      client.once("close", () => {
        sockets.delete(client); clearTimeout(timeout);
        receiverTimeouts.delete(client);
        if (publisher?.socket === client) { publisher = undefined; end("source disconnected"); }
      });
      if (path === "/sendspin") {
        receiverTimeouts.set(client, timeout);
        let session: SendspinSession | undefined;
        // This listener precedes the SDK's. Its async PSK lookup leaves a
        // plaintext window. Closing here prevents sends; admission also checks
        // OPEN because EventEmitter still delivers this event to the SDK.
        client.on("message", (data, binary) => {
          if (client.readyState !== WebSocket.OPEN) return;
          try {
            if (session) {
              if (session.isEncrypted() ? !binary : binary || JSON.parse(String(data)).type !== "noise/handshake") reject(client, "expected encrypted receiver handshake");
              return;
            }
            const init = JSON.parse(String(data));
            if (binary || init.type !== "client/init" || !admitted(init.payload?.client_id) || metrics.excluded[init.payload.client_id]) return reject(client, "receiver not admitted");
            core.handleConnection(client, request);
            session = core.getSessionBySocket(client)!;
            session.handleText(String(data));
          } catch { reject(client, "invalid receiver handshake"); }
        });
        return;
      }
      let authenticated = false, windowAt = serverNowUs(), messages = 0;
      client.on("message", (data, binary) => {
        const now = serverNowUs();
        if (now - windowAt > 1e6) { windowAt = now; messages = 0; }
        if (++messages > 256) return reject(client, "source rate exceeded");
        try {
          if (!authenticated) {
            const auth = JSON.parse(String(data));
            if (binary || auth.type !== "auth" || typeof auth.token !== "string" || !authorized(auth.token) || publisher) return reject(client, "source not admitted");
            clearTimeout(timeout); authenticated = true;
            publisher = { socket: client, token: auth.token, generation: ++generation };
            lastFrameAt = now;
            client.send(JSON.stringify({ type: "ready", generation, packetMs, leadMs }));
            return;
          }
          if (publisher?.socket !== client || !authorized(publisher.token)) return reject(client, "publisher revoked or stopped");
          if (!binary) {
            const message = JSON.parse(String(data));
            if (message.type === "sync" && Number.isFinite(message.sentUs)) {
              lastFrameAt = now;
              client.send(JSON.stringify({ type: "sync", sentUs: message.sentUs, receivedUs: now, sentServerUs: serverNowUs() }));
            } else if (message.type === "start" && !timeline && Number.isFinite(message.originUs) && Number.isSafeInteger(message.firstSample) && message.firstSample >= 0 && Number.isFinite(message.uncertaintyUs) && message.uncertaintyUs >= 0 && message.uncertaintyUs <= 10_000 && Math.abs(now - message.originUs) < 100_000) {
              timeline = { originUs: message.originUs, firstSample: message.firstSample, nextSample: message.firstSample, uncertaintyUs: message.uncertaintyUs };
              lastFrameAt = now; metrics.stopReason = "running";
              for (const { session } of receivers.values()) begin(session);
            } else if (message.type === "stop") stop();
            else reject(client, "invalid source control");
            return;
          }
          const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (!timeline || frame.length !== frameBytes + 16 || frame.readUInt32LE(0) !== ingressMagic || frame.readUInt32LE(4) !== publisher.generation) return reject(client, "invalid PCM generation or format");
          const sample = frame.readDoubleLE(8);
          if (!Number.isSafeInteger(sample) || sample < timeline.nextSample || (sample - timeline.firstSample) % frameSamples) return reject(client, "replayed or unordered samples");
          const sourceUs = timeline.originUs + (sample - timeline.firstSample) * 1e6 / 48_000;
          const timestampUs = Math.round(sourceUs + leadMs * 1000);
          if (sourceUs > now + timeline.uncertaintyUs) return reject(client, "future source samples");
          metrics.missingSamples += sample - timeline.nextSample;
          timeline.nextSample = sample + frameSamples; lastFrameAt = now;
          metrics.maxIngressAgeUs = Math.max(metrics.maxIngressAgeUs, now - sourceUs);
          // No application queue, no now+lead reset: late input never shifts the
          // shared timeline. Excluded receivers cannot push the others later.
          if (timestampUs <= now + timeline.uncertaintyUs) { metrics.lateFrames++; return; }
          metrics.acceptedFrames++;
          for (const [id, { session, socket }] of receivers) {
            metrics.maxSocketBytes = Math.max(metrics.maxSocketBytes, socket.bufferedAmount);
            if (!admitted(id)) { exclude(id, "receiver revoked"); continue; }
            // Stay far below the SDK's 512 KiB wait-and-send branch. Closing
            // makes any already queued generation ineligible for further sends.
            if (socket.bufferedAmount > frameBytes * 2) { exclude(id, "receiver byte budget"); continue; }
            session.sendPcmAudioFrame({ data: frame.subarray(16), timestampUs });
            metrics.sentFrames[id] = (metrics.sentFrames[id] ?? 0) + 1;
            metrics.sentPcmBytes[id] = (metrics.sentPcmBytes[id] ?? 0) + frameBytes;
          }
        } catch { reject(client, "invalid source message"); }
      });
    });
  });
  const watchdog = setInterval(() => {
    const now = serverNowUs();
    if (publisher && !authorized(publisher.token)) stop("publisher revoked");
    if (publisher && now - lastFrameAt > (timeline ? 250_000 : 10_000_000)) stop("source timeout");
    for (const [id, current] of receivers) {
      if (!admitted(id)) { exclude(id, "receiver revoked"); continue; }
      if (!current.socket.bufferedAmount) current.blockedSince = undefined;
      else {
        current.blockedSince ??= now;
        if (now - current.blockedSince >= packetMs * 2000) exclude(id, "receiver queue age");
      }
    }
  }, 10);
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve); }); }
  catch (error) { clearInterval(watchdog); throw error; }
  const address = server.address(); assert(address && typeof address === "object");
  return {
    origin: `${options.tls ? "https" : "http"}://${options.host === "0.0.0.0" ? "127.0.0.1" : options.host ?? "127.0.0.1"}:${address.port}`,
    snapshot: () => ({ prototype: true, codec: "pcm-s16le", sampleRate: 48_000, channels: 2, packetMs, leadMs,
      generation, publisherConnected: !!publisher, timeline: timeline ? { ...timeline } : null, metrics: structuredClone(metrics),
      receivers: [...receivers].map(([id, { session, socket }]) => ({ id, transport: { ...transports.get(socket)! }, timing: session.getPlayerTiming(), bufferedBytes: socket.bufferedAmount, encrypted: session.isEncrypted() })) }),
    stop,
    async close() {
      clearInterval(watchdog); stop("lab closed");
      for (const socket of sockets) socket.terminate();
      await new Promise<void>(resolve => ws.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
