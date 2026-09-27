import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { AudioCodec, Identity, PlaybackStateType, MediaCommand, RepeatMode, PlayerCommand, PskCategory, SendspinCore, pskIdFor, serverNowUs, type SendspinSession } from "@sonn-audio/node-sendspin";
import { createPcmDecoder, validatePcmSource } from "./pcm-decoder";
import type { PlaybackCommand, PlaybackTarget, PlayerState } from "../shared/protocol";

export type SendspinConfig = { host: string; port: number; name: string; publicUrl?: string; qualifiedClientIds?: string[]; ffmpeg?: string };
export type SendspinOptions = {
  identity: string;
  lookupPsk: (clientId: string) => string | null;
  isQualified?: (clientId: string) => boolean;
  describeClient?: (clientId: string) => { deviceId: string; name?: string } | undefined;
  initialMembers?: string[];
  control?: (clientId: string, command: "play" | "pause" | "stop" | "next") => void | Promise<void>;
  membersChanged?: (ids: string[]) => void;
  changed: (target: PlaybackTarget) => void;
  observe: (player: PlayerState) => void;
};
export const sendspinDrainMs = 1000;
const leadUs = 500_000, maxMembers = 32, maxSocketBytes = 65536;
const idle = (): PlayerState => ({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
type Load = Extract<PlaybackCommand, { type: "load" }> & { duration?: number };
type Member = { id: string; name: string; connected: boolean; volume: number; muted: boolean; joined: boolean };
export function validateSendspinConfig(config: SendspinConfig) {
  if (config?.qualifiedClientIds && (config.qualifiedClientIds.length > 32 || config.qualifiedClientIds.some(id => !/^[\w-]{43}$/.test(id)))) throw new Error("Invalid qualified Sendspin clients.");
  if (config?.publicUrl) { const url = new URL(config.publicUrl); if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid public Sendspin URL."); }
  if (!config || !isIP(config.host) || !Number.isInteger(config.port) || config.port < 0 || config.port > 65535 || typeof config.name !== "string" || !config.name.trim() || config.name.length > 128 || /[\u0000-\u001f\u007f]/.test(config.name)) throw new Error("Invalid Sendspin host configuration.");
}

/** The dependency owns Noise and protocol sessions; the official client owns clock synchronization. */
export function createSendspin(config: SendspinConfig, options: SendspinOptions) {
  validateSendspinConfig(config);
  const identity = Identity.fromPrivateB64u(options.identity);
  const core = new SendspinCore();
  core.configureServer({ name: config.name });
  const members = new Map<string, Member>();
  const activeStreams = new Set<string>();
  const selected = new Set(options.initialMembers ?? []);
  if (selected.size > maxMembers || [...selected].some(id => !/^[\w-]{43}$/.test(id))) throw new Error("Invalid Sendspin members.");
  for (const id of selected) members.set(id, { id, name: "Sendspin player", connected: false, joined: true, volume: 100, muted: false });
  const sockets = new Set<WebSocket>();
  let closed = false, listening = false, recovering = true, uncertain = false;
  let state = idle(), load: Load | undefined, generation = 0, intentGeneration = 0, queued = 0;
  let tail = Promise.resolve(), loop = Promise.resolve();
  let decoder: ReturnType<typeof createPcmDecoder> | undefined, cancellation: AbortController | undefined, prepared: Uint8Array | undefined;
  let startedUs = 0, startPosition = 0, sentSeconds = 0, progressAt = 0;
  const joined = () => [...members.values()].filter(member => member.joined);
  const connected = () => listening && !recovering && !uncertain && joined().length > 0 && joined().every(member => member.connected);
  const qualified = (id: string) => {
    const timing = core.getSessionByClientId(id)?.getPlayerTiming();
    return !!(options.isQualified?.(id) ?? config.qualifiedClientIds?.includes(id)) && timing?.staticDelayMs === 0 && typeof timing.requiredLeadTimeMs === "number" && timing.requiredLeadTimeMs >= 0 && timing.requiredLeadTimeMs <= 250 && typeof timing.minBufferMs === "number" && timing.minBufferMs >= 0 && timing.minBufferMs <= 250;
  };
  const publish = () => options.changed({ id: "sendspin-group", name: config.name, kind: "group", backend: "sendspin", connected: connected(), error: state.error ?? undefined, handoffSafety: joined().length > 0 && joined().every(member => qualified(member.id)) ? "buffer-drain" : "unverified", members: [...members.values()].map(member => { const device = options.describeClient?.(member.id); return { ...member, ...(device ? { deviceId: device.deviceId, name: device.name ?? member.name } : {}) }; }) });
  let metadataAt = 0;
  const observe = () => { const group = joined(); state = { ...state, volume: group.length ? Math.round(group.reduce((sum, member) => sum + member.volume, 0) / group.length) : 100 }; options.observe(state);
    if (serverNowUs() - metadataAt > 500000) { metadataAt = serverNowUs(); for (const member of group) core.sendMetadata(member.id, { progress: { track_progress: state.position * 1000, track_duration: (state.duration ?? 0) * 1000, playback_speed: state.status === "playing" ? (state.speed ?? 1) * 1000 : 0 } }); }
  };
  const position = () => state.status === "playing" && startedUs ? Math.min(state.duration ?? Infinity, startPosition + Math.min(sentSeconds, Math.max(0, (serverNowUs() - startedUs) / 1e6)) * (state.speed ?? 1)) : state.position;
  const cancel = () => { state = { ...state, position: position() }; generation++; cancellation?.abort(); };
  const clear = () => { for (const member of joined()) { if (activeStreams.delete(member.id)) core.sendStreamEnd(member.id); core.sendGroupUpdate(member.id, PlaybackStateType.STOPPED, "sendspin-group", config.name); } };
  const fail = (message: string) => {
    if (closed || uncertain) return;
    cancel(); uncertain = true; clear();
    state = { ...state, status: "unavailable", error: message }; publish(); observe();
    void decoder?.close().catch(() => {});
  };
  const enqueue = <T>(operation: () => Promise<T>) => {
    if (queued >= 32) return Promise.reject(new Error("Too many pending Sendspin commands."));
    queued++;
    const work = tail.then(() => { if (closed) throw new Error("Sendspin is closed."); return operation(); }).finally(() => { queued--; });
    tail = work.then(() => {}, () => {});
    return work;
  };
  const sessionReady = (session: SendspinSession) => session.isAvailable() === true && session.getRoles().includes("player@v1") && session.getPlayerSupportedFormats().some(format => format.codec === AudioCodec.PCM && format.sample_rate === 48000 && format.channels === 2 && format.bit_depth === 16);
  const update = (session: SendspinSession, volume?: number, muted?: boolean) => {
    const id = session.getClientId(); if (!id || closed) return;
    const old = members.get(id);
    const member = { id, name: session.getClientName()?.slice(0, 128) || "Sendspin player", connected: sessionReady(session), joined: selected.has(id), volume: volume ?? old?.volume ?? 100, muted: muted ?? old?.muted ?? false };
    members.set(id, member);
    if (member.joined && !member.connected) dropDisconnected(id);
    const timing = session.getPlayerTiming();
    if (load && member.joined && (timing.staticDelayMs !== 0 || (timing.minBufferMs ?? Infinity) > 250 || (timing.requiredLeadTimeMs ?? Infinity) > 250)) fail("Sendspin player timing changed. Reconnect before transferring playback.");
    publish(); observe();
  };
  core.enableEncryption(identity, id => {
    const value = options.lookupPsk(id);
    if (!value || !/^[\w-]{43}$/.test(value) || !members.has(id) && members.size >= maxMembers) return null;
    const psk = Buffer.from(value, "base64url");
    core.registerHooks(id, {
      onIdentified: session => { update(session); core.sendControllerState(id, { supported_commands: options.control ? [MediaCommand.PLAY, MediaCommand.PAUSE, MediaCommand.STOP, MediaCommand.NEXT] : [], volume: state.volume, muted: false, repeat: RepeatMode.OFF, shuffle: false }); },
      onGroupCommand: (_session, command) => { if (options.control && ["play", "pause", "stop", "next"].includes(command.command)) void Promise.resolve().then(() => options.control!(id, command.command as "play" | "pause" | "stop" | "next")).catch(() => {}); },
      onPlayerState: (session, updateState) => update(session, updateState.volume, updateState.muted),
      onDisconnected: () => { activeStreams.delete(id); const member = members.get(id); if (member) member.connected = false; if (selected.has(id)) dropDisconnected(id); else publish(); },
      onFormatChanged: () => { if (selected.has(id) && load) fail("A Sendspin member changed audio format."); },
    });
    return { psk, pskId: pskIdFor(psk), category: PskCategory.LONG_TERM };
  });
  const server = new WebSocketServer({ host: config.host, port: config.port, path: "/sendspin", maxPayload: 65536, perMessageDeflate: false });
  server.on("connection", (socket, request) => {
    if (closed || sockets.size >= maxMembers) { socket.close(1013); return; }
    sockets.add(socket);
    const timeout = setTimeout(() => { if (!core.getSessionBySocket(socket)?.isEncrypted()) socket.terminate(); }, 5000);
    socket.once("close", () => { clearTimeout(timeout); sockets.delete(socket); });
    // The upstream library also permits legacy plaintext. This host accepts encrypted clients only.
    socket.once("message", (data, binary) => {
      let init: unknown; try { init = JSON.parse(data.toString()); } catch {}
      if (binary || !init || (init as { type?: string }).type !== "client/init") { socket.terminate(); return; }
      core.handleConnection(socket, request); core.getSessionBySocket(socket)!.handleText(data.toString());
    });
  });
  server.on("error", () => fail("Sendspin could not listen on the configured address."));
  server.on("listening", () => { listening = true; void delay(sendspinDrainMs).then(() => { if (!closed) { recovering = false; publish(); observe(); } }); });
  publish();
  const retire = async () => { cancel(); clear(); await decoder?.close(); await loop; decoder = undefined; cancellation = undefined; prepared = undefined; startedUs = 0; await delay(sendspinDrainMs); };
  const openDecoder = () => {
    if (!load) throw new Error("No Sendspin source is loaded.");
    cancellation = new AbortController();
    return decoder = createPcmDecoder(load, { position: state.position, speed: state.speed ?? 1, ffmpeg: config.ffmpeg, signal: cancellation.signal });
  };
  const preparePaused = async () => {
    const epoch = generation, active = openDecoder();
    state = { ...state, status: "loading", error: null }; observe();
    const pcm = await active.read();
    if (epoch !== generation || closed) return;
    if (!pcm.length) throw new Error("The audio source has no decodable samples.");
    prepared = pcm;
    state = { ...state, status: "paused" }; observe();
  };
  const start = () => {
    if (!load) return;
    const command = load, epoch = generation, speed = state.speed ?? 1;
    const active = decoder ?? openDecoder();
    startPosition = state.position; sentSeconds = 0; startedUs = 0;
    state = { ...state, status: "loading", error: null }; observe();
    loop = (async () => {
      try {
        while (epoch === generation && !closed) {
          const pcm = prepared ?? await active.read();
          prepared = undefined;
          if (epoch !== generation || closed) return;
          if (!pcm.length) {
            const remaining = Math.max(0, (startedUs + sentSeconds * 1e6 - serverNowUs()) / 1000);
            await delay(remaining + sendspinDrainMs, undefined, { signal: cancellation!.signal });
            if (epoch !== generation) return;
            clear(); state = { ...state, position: Math.min(state.duration ?? Infinity, startPosition + sentSeconds * speed), status: "ended" }; observe(); return;
          }
          if (!startedUs) {
            startedUs = serverNowUs() + leadUs;
            for (const member of joined()) { core.sendStreamStart(member.id, { codec: AudioCodec.PCM, sampleRate: 48000, channels: 2, bitDepth: 16 }); activeStreams.add(member.id); core.sendGroupUpdate(member.id, PlaybackStateType.PLAYING, "sendspin-group", config.name); }
          }
          const timestampUs = Math.round(startedUs + sentSeconds * 1e6);
          await delay(Math.max(0, (timestampUs - serverNowUs() - leadUs) / 1000), undefined, { signal: cancellation!.signal });
          if (epoch !== generation) return;
          if (timestampUs < serverNowUs()) throw new Error("The audio producer missed its playback deadline.");
          for (const member of joined()) {
            const socket = [...sockets].find(socket => core.getSessionBySocket(socket)?.getClientId() === member.id);
            if (!member.connected || !socket || socket.bufferedAmount > maxSocketBytes) throw new Error("A Sendspin output could not keep up with playback.");
            core.sendPcmFrameToClient(member.id, { data: Buffer.from(pcm), timestampUs });
          }
          sentSeconds += pcm.byteLength / 192000;
          const publishProgress = state.status !== "playing" || serverNowUs() - progressAt >= 250000;
          state = { ...state, status: "playing", position: position(), positionEstimated: true };
          if (publishProgress) { progressAt = serverNowUs(); observe(); }
        }
      } catch (error) { if (epoch === generation && !closed) { const detail = error instanceof Error && ["The audio producer missed its playback deadline.", "A Sendspin output could not keep up with playback."].includes(error.message) ? error.message : "Sendspin audio delivery failed."; fail(`${detail} Reconnect before transferring playback.`); } }
      finally { await active.close(); }
    })();
  };
  const setMemberVolume = async (id: string, volume: number, muted: boolean) => {
    const member = members.get(id);
    if (!member?.connected || !Number.isFinite(volume) || volume < 0 || volume > 100 || typeof muted !== "boolean") throw new Error("Invalid Sendspin member volume.");
    await enqueue(async () => {
      core.sendServerCommand(id, { player: { command: PlayerCommand.VOLUME, volume } });
      core.sendServerCommand(id, { player: { command: PlayerCommand.MUTE, mute: muted } });
      const deadline = Date.now() + 3000;
      const confirmed = () => members.get(id)?.connected && members.get(id)?.volume === volume && members.get(id)?.muted === muted;
      while (!closed && !confirmed() && members.get(id)?.connected && Date.now() < deadline) await delay(20);
      if (closed || !confirmed()) throw new Error("Sendspin did not confirm the member volume.");
    });
  };
  const setMembers = async (ids: string[]) => {
    if (ids.length > maxMembers || new Set(ids).size !== ids.length || ids.some(id => !members.get(id)?.connected)) throw new Error("Select connected Sendspin members.");
    if (uncertain) throw new Error("Reconnect Sendspin before changing uncertain outputs.");
    await enqueue(async () => {
      const resume = state.status === "playing" || state.status === "loading";
      const intent = intentGeneration;
      await retire();
      if (closed) return;
      selected.clear(); for (const id of ids) selected.add(id);
      for (const member of members.values()) member.joined = selected.has(member.id);
      options.membersChanged?.([...selected]); publish();
      if (!ids.length) { load = undefined; state = idle(); observe(); } else if (resume && intent === intentGeneration) start(); else if (load) await preparePaused(); else observe();
    });
  };
  const dropDisconnected = (id: string) => {
    if (!selected.delete(id)) return;
    intentGeneration++; cancel();
    const member = members.get(id); if (member) member.joined = false;
    try { options.membersChanged?.([...selected]); } catch { fail("Could not save the remaining Sendspin members."); return; }
    clear(); publish();
    void setMembers([...selected]).catch(() => fail("A Sendspin member disconnected during group recovery."));
  };
  return {
    serverId: identity.peerId,
    get port() { const address = server.address(); return typeof address === "object" && address ? address.port : config.port; },
    send(command: PlaybackCommand) {
      if (closed) throw new Error("Sendspin is closed.");
      if (command.type === "load") { validatePcmSource(command); if (command.preferences?.speed !== undefined && (!Number.isFinite(command.preferences.speed) || command.preferences.speed < 0.25 || command.preferences.speed > 4)) throw new Error("Invalid playback speed."); }
      else if (!["stop", "pause", "seek", "speed", "volume", "track"].includes(command.type)) throw new Error("This playback command is not supported by Sendspin.");
      if (command.type === "track") { if (command.kind !== "audio" || command.index !== 0) throw new Error("Sendspin supports the sole audio track only."); observe(); return; }
      if (!connected() && command.type !== "stop") throw new Error("Sendspin is disconnected.");
      if (command.type === "seek" && (!Number.isFinite(command.position) || command.position < 0 || !state.seekable)) throw new Error("This Sendspin source cannot seek.");
      if (command.type === "speed" && (!Number.isFinite(command.speed) || command.speed < 0.25 || command.speed > 4)) throw new Error("Invalid playback speed.");
      if (command.type === "volume") { for (const member of joined()) void setMemberVolume(member.id, command.volume, member.muted).catch(() => fail("Sendspin volume was not confirmed.")); return; }
      if (command.type !== "load" && command.type !== "stop" && "playbackId" in command && command.playbackId !== load?.playbackId) return;
      if (queued >= 32) { if (command.type === "stop") { intentGeneration++; fail("Sendspin command backlog was cancelled. Reconnect before playback."); return; } throw new Error("Too many pending Sendspin commands."); }
      if (command.type === "load" || command.type === "stop") { intentGeneration++; cancel(); }
      const intent = intentGeneration;
      void enqueue(async () => {
        if (intent !== intentGeneration) return;
        const previousStatus = state.status;
        if (!(command.type === "pause" && !command.paused && previousStatus === "paused" && prepared)) await retire();
        if (closed || uncertain || intent !== intentGeneration) return;
        if (command.type === "stop") { load = undefined; state = idle(); observe(); return; }
        if (command.type === "load") {
          load = command; const duration = (command as Load).duration;
          state = { ...idle(), playbackId: command.playbackId, position: command.startPosition ?? 0, duration: duration && duration > 0 ? duration : null, seekable: !!duration && duration > 0 && !command.radio, live: !!command.radio, speed: command.preferences?.speed ?? 1, audioTracksKnown: false, tracks: [{ id: "sendspin-audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }], status: command.paused ? "paused" : "loading" };
          if (command.paused) await preparePaused(); else start();
        } else {
          if (command.type === "seek") state = { ...state, position: command.position };
          if (command.type === "speed") state = { ...state, speed: command.speed };
          if (command.type === "pause" ? command.paused : previousStatus === "paused") await preparePaused(); else start();
        }
      }).catch(() => fail("Sendspin could not complete the playback command."));
    },
    setMembers,
    setMemberVolume,
    refresh() { publish(); },
    disconnectAll() { intentGeneration++; fail("Sendspin remote access was disabled. Reconnect explicitly before playback."); for (const socket of sockets) socket.terminate(); },
    disconnectClient(id: string) { for (const socket of sockets) if (core.getSessionBySocket(socket)?.getClientId() === id) socket.terminate(); },
    async reconnect() { await enqueue(async () => { recovering = true; publish(); await retire(); if (closed) return; load = undefined; state = idle(); uncertain = false; recovering = false; publish(); observe(); }); },
    async close() { if (closed) return; closed = true; cancel(); clear(); await decoder?.close(); await loop; await tail; for (const socket of sockets) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
