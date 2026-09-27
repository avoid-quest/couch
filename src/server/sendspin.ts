import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { AudioCodec, Identity, MediaCommand, PskCategory, RepeatMode, SendspinCore, pskIdFor, type SendspinSession } from "@sonn-audio/node-sendspin";
import { createSendspinPlayback, sendspinDrainMs, type SendspinDevice, type SendspinPlaybackCallbacks } from "./sendspin-playback";

export { sendspinDrainMs } from "./sendspin-playback";
export type { SendspinDevice, SendspinPlaybackCallbacks } from "./sendspin-playback";
export type SendspinConfig = { host: string; port: number; name: string; publicUrl?: string; qualifiedClientIds?: string[]; ffmpeg?: string };
export type SendspinOptions = {
  identity: string;
  lookupPsk: (clientId: string) => string | null;
  isQualified?: (clientId: string) => boolean;
  describeClient?: (clientId: string) => { deviceId: string; name?: string } | undefined;
  devicesChanged?: () => void;
  listenerChanged?: () => void;
  control?: (playbackId: string, clientId: string, command: "play" | "pause" | "stop" | "next") => void | Promise<void>;
};
const maxClients = 32, maxSocketBytes = 65536;
export function validateSendspinConfig(config: SendspinConfig) {
  if (config?.qualifiedClientIds && (config.qualifiedClientIds.length > 32 || config.qualifiedClientIds.some(id => !/^[\w-]{43}$/.test(id)))) throw new Error("Invalid qualified Sendspin clients.");
  if (config?.publicUrl) { const url = new URL(config.publicUrl); if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid public Sendspin URL."); }
  if (!config || !isIP(config.host) || !Number.isInteger(config.port) || config.port < 0 || config.port > 65535 || typeof config.name !== "string" || !config.name.trim() || config.name.length > 128 || /[\u0000-\u001f\u007f]/.test(config.name)) throw new Error("Invalid Sendspin host configuration.");
}

/** The maintained dependency owns encryption and sessions; each playback owns only its decoded audio timeline. */
export function createSendspin(config: SendspinConfig, options: SendspinOptions) {
  validateSendspinConfig(config);
  const identity = Identity.fromPrivateB64u(options.identity), core = new SendspinCore();
  core.configureServer({ name: config.name });
  const devices = new Map<string, SendspinDevice>();
  const sockets = new Set<WebSocket>();
  const groups = new Map<string, ReturnType<typeof createSendspinPlayback>>();
  const ownerByClient = new Map<string, string>();
  let closed = false, listening = false, recovering = true, listenerError: string | null = null, closing: Promise<void> | undefined;
  const device = (clientId: string) => {
    const current = devices.get(clientId);
    if (!current) return undefined;
    const detail = options.describeClient?.(clientId);
    return { ...current, ...(detail ? { deviceId: detail.deviceId, name: detail.name ?? current.name } : {}) };
  };
  const qualified = (clientId: string) => {
    const timing = core.getSessionByClientId(clientId)?.getPlayerTiming();
    return !!(options.isQualified?.(clientId) ?? config.qualifiedClientIds?.includes(clientId)) && timing?.staticDelayMs === 0 && typeof timing.requiredLeadTimeMs === "number" && timing.requiredLeadTimeMs >= 0 && timing.requiredLeadTimeMs <= 250 && typeof timing.minBufferMs === "number" && timing.minBufferMs >= 0 && timing.minBufferMs <= 250;
  };
  const refresh = () => { options.devicesChanged?.(); for (const group of groups.values()) group.refresh(); };
  const sessionReady = (session: SendspinSession) => session.isAvailable() === true && session.getRoles().includes("player@v1") && session.getPlayerSupportedFormats().some(format => format.codec === AudioCodec.PCM && format.sample_rate === 48000 && format.channels === 2 && format.bit_depth === 16);
  const update = (session: SendspinSession, volume?: number, muted?: boolean) => {
    const clientId = session.getClientId(); if (!clientId || closed) return;
    const previous = devices.get(clientId);
    devices.set(clientId, { id: clientId, name: session.getClientName()?.slice(0, 128) || "Sendspin player", connected: sessionReady(session), volume: volume ?? previous?.volume ?? 100, muted: muted ?? previous?.muted ?? false });
    if (!sessionReady(session)) groups.get(ownerByClient.get(clientId) ?? "")?.disconnected(clientId);
    else {
      const timing = session.getPlayerTiming();
      if (ownerByClient.has(clientId) && (timing.staticDelayMs !== 0 || (timing.minBufferMs ?? Infinity) > 250 || (timing.requiredLeadTimeMs ?? Infinity) > 250)) groups.get(ownerByClient.get(clientId)!)?.failed("Sendspin player timing changed. Reconnect before transferring playback.");
    }
    refresh();
  };
  core.enableEncryption(identity, clientId => {
    const value = options.lookupPsk(clientId);
    if (!value || !/^[\w-]{43}$/.test(value)) return null;
    const psk = Buffer.from(value, "base64url");
    core.registerHooks(clientId, {
      onIdentified: session => { update(session); core.sendControllerState(clientId, { supported_commands: options.control ? [MediaCommand.PLAY, MediaCommand.PAUSE, MediaCommand.STOP, MediaCommand.NEXT] : [], volume: device(clientId)?.volume ?? 100, muted: false, repeat: RepeatMode.OFF, shuffle: false }); },
      onGroupCommand: (_session, command) => { const owner = ownerByClient.get(clientId); if (owner && options.control && ["play", "pause", "stop", "next"].includes(command.command)) void Promise.resolve().then(() => options.control!(owner, clientId, command.command as "play" | "pause" | "stop" | "next")).catch(() => {}); },
      onPlayerState: (session, next) => update(session, next.volume, next.muted),
      onDisconnected: () => { const current = devices.get(clientId); if (current) current.connected = false; groups.get(ownerByClient.get(clientId) ?? "")?.disconnected(clientId); devices.delete(clientId); refresh(); },
      onFormatChanged: () => { groups.get(ownerByClient.get(clientId) ?? "")?.failed("A Sendspin member changed audio format."); },
    });
    return { psk, pskId: pskIdFor(psk), category: PskCategory.LONG_TERM };
  });
  const server = new WebSocketServer({ host: config.host, port: config.port, path: "/sendspin", maxPayload: 65536, perMessageDeflate: false });
  server.on("connection", (socket, request) => {
    if (closed || sockets.size >= maxClients) { socket.close(1013); return; }
    sockets.add(socket);
    const timeout = setTimeout(() => { if (!core.getSessionBySocket(socket)?.isEncrypted()) socket.terminate(); }, 5000);
    socket.once("close", () => { clearTimeout(timeout); sockets.delete(socket); });
    // The dependency also permits legacy plaintext; Couch accepts encrypted clients only.
    socket.once("message", (data, binary) => {
      let init: unknown; try { init = JSON.parse(data.toString()); } catch {}
      if (binary || !init || (init as { type?: string }).type !== "client/init") { socket.terminate(); return; }
      core.handleConnection(socket, request); core.getSessionBySocket(socket)!.handleText(data.toString());
    });
  });
  server.on("error", () => { listening = false; listenerError = "Sendspin could not listen on the configured address."; for (const group of groups.values()) group.failed(listenerError); options.listenerChanged?.(); });
  server.on("listening", () => { listening = true; listenerError = null; options.listenerChanged?.(); void delay(sendspinDrainMs).then(() => { if (!closed) { recovering = false; refresh(); } }); });
  return {
    serverId: identity.peerId,
    get listening() { return listening && !closed; },
    get listenerError() { return listenerError; },
    get port() { const address = server.address(); return typeof address === "object" && address ? address.port : config.port; },
    get devices() { return [...devices.keys()].map(device).filter((item): item is SendspinDevice => !!item?.connected); },
    playback(id: string, callbacks: SendspinPlaybackCallbacks) {
      if (closed) throw new Error("Sendspin is closed.");
      if (!id || id.length > 128 || !/^[\w:-]+$/.test(id)) throw new Error("Invalid Sendspin playback identity.");
      const existing = groups.get(id);
      if (existing) return existing;
      const group = createSendspinPlayback(id, {
        core, name: config.name, ffmpeg: config.ffmpeg, ready: () => listening && !recovering && !closed,
        device, qualified,
        assign(playbackId, before, after) {
          const deviceIds = new Set<string>();
          for (const clientId of after) {
            if (!devices.get(clientId)?.connected) throw new Error("Select connected Sendspin members.");
            const owner = ownerByClient.get(clientId);
            if (owner && owner !== playbackId) throw new Error("That Sendspin device belongs to another playback.");
            const deviceId = device(clientId)?.deviceId;
            if (deviceId) {
              if (deviceIds.has(deviceId) || [...ownerByClient].some(([otherClient, otherOwner]) => otherOwner !== playbackId && device(otherClient)?.deviceId === deviceId)) throw new Error("That Sendspin device belongs to another playback.");
              deviceIds.add(deviceId);
            }
          }
          for (const clientId of before) if (!after.includes(clientId) && ownerByClient.get(clientId) === playbackId) ownerByClient.delete(clientId);
          for (const clientId of after) ownerByClient.set(clientId, playbackId);
        },
        sendPcm(clientId, pcm, timestampUs) {
          const socket = [...sockets].find(candidate => core.getSessionBySocket(candidate)?.getClientId() === clientId);
          if (!devices.get(clientId)?.connected || !socket || socket.bufferedAmount > maxSocketBytes) throw new Error("A Sendspin output could not keep up with playback.");
          core.sendPcmFrameToClient(clientId, { data: Buffer.from(pcm), timestampUs });
        },
        drop(playbackId, clientId) { if (ownerByClient.get(clientId) === playbackId) ownerByClient.delete(clientId); },
        release(playbackId) { for (const [clientId, owner] of ownerByClient) if (owner === playbackId) ownerByClient.delete(clientId); groups.delete(playbackId); },
      }, callbacks);
      groups.set(id, group);
      return group;
    },
    refresh,
    disconnectAll() { for (const group of groups.values()) group.failed("Sendspin remote access was disabled. Reconnect explicitly before playback."); for (const socket of sockets) socket.terminate(); },
    disconnectClient(clientId: string) { for (const socket of sockets) if (core.getSessionBySocket(socket)?.getClientId() === clientId) socket.terminate(); },
    async reconnect() { await Promise.all([...groups.values()].map(group => group.reconnect())); refresh(); },
    close() { return closing ??= (async () => {
      closed = true; listening = false;
      const results = await Promise.allSettled([...groups.values()].map(group => group.close()));
      for (const socket of sockets) socket.terminate();
      options.listenerChanged?.(); options.devicesChanged?.();
      await new Promise<void>(resolve => server.close(() => resolve()));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    })(); },
  };
}
