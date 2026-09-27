import { setTimeout as delay } from "node:timers/promises";
import { AudioCodec, PlaybackStateType, PlayerCommand, serverNowUs, type SendspinCore } from "@sonn-audio/node-sendspin";
import { createPcmDecoder, validatePcmSource } from "./pcm-decoder";
import type { PlaybackCommand, PlaybackTarget, PlayerState } from "../shared/protocol";

export const sendspinDrainMs = 1000;
const leadUs = 500_000, maxMembers = 32;
type Load = Extract<PlaybackCommand, { type: "load" }> & { duration?: number };
export type SendspinDevice = { id: string; deviceId?: string; name: string; connected: boolean; volume: number; muted: boolean };
export type SendspinPlaybackCallbacks = { changed: (target: PlaybackTarget) => void; observe: (player: PlayerState) => void };
export type SendspinPlaybackEnvironment = {
  core: SendspinCore;
  name: string;
  ffmpeg?: string;
  ready: () => boolean;
  device: (id: string) => SendspinDevice | undefined;
  qualified: (id: string) => boolean;
  assign: (playbackId: string, before: readonly string[], after: readonly string[]) => void;
  drop: (playbackId: string, clientId: string) => void;
  sendPcm: (id: string, pcm: Uint8Array, timestampUs: number) => void;
  release: (playbackId: string) => void;
};
const idle = (): PlayerState => ({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });

/** One decoded timeline; the host owns sockets, encryption, and the device-to-playback index. */
export function createSendspinPlayback(id: string, env: SendspinPlaybackEnvironment, callbacks: SendspinPlaybackCallbacks) {
  const targetId = `sendspin:${id}`;
  const selected = new Set<string>();
  const activeStreams = new Set<string>();
  let state = idle(), load: Load | undefined, decoder: ReturnType<typeof createPcmDecoder> | undefined;
  let cancellation: AbortController | undefined, prepared: Uint8Array | undefined;
  let generation = 0, intentGeneration = 0, queued = 0, closed = false, uncertain = false;
  let tail = Promise.resolve(), loop = Promise.resolve();
  let startedUs = 0, startPosition = 0, sentSeconds = 0, progressAt = 0, metadataAt = 0, drainUntil = 0;
  const devices = () => [...selected].map(clientId => env.device(clientId)).filter((device): device is SendspinDevice => !!device);
  const connected = () => env.ready() && !uncertain && selected.size > 0 && devices().length === selected.size && devices().every(device => device.connected);
  const publish = () => callbacks.changed({ id: targetId, name: env.name, kind: "group", backend: "sendspin", connected: connected(), error: state.error ?? undefined,
    handoffSafety: selected.size > 0 && [...selected].every(env.qualified) ? "buffer-drain" : "unverified",
    members: [...selected].map(clientId => ({ ...env.device(clientId) ?? { id: clientId, name: "Sendspin player", connected: false, volume: 100, muted: false }, joined: true })) });
  const observe = () => {
    const group = devices();
    state = { ...state, volume: group.length ? Math.round(group.reduce((sum, device) => sum + device.volume, 0) / group.length) : 100 };
    callbacks.observe(state);
    if (serverNowUs() - metadataAt > 500_000) {
      metadataAt = serverNowUs();
      for (const device of group) env.core.sendMetadata(device.id, { progress: { track_progress: state.position * 1000, track_duration: (state.duration ?? 0) * 1000, playback_speed: state.status === "playing" ? (state.speed ?? 1) * 1000 : 0 } });
    }
  };
  const position = () => state.status === "playing" && startedUs ? Math.min(state.duration ?? Infinity, startPosition + Math.min(sentSeconds, Math.max(0, (serverNowUs() - startedUs) / 1e6)) * (state.speed ?? 1)) : state.position;
  const cancel = () => { state = { ...state, position: position() }; generation++; cancellation?.abort(); };
  const end = (clientId: string) => {
    if (activeStreams.delete(clientId)) { env.core.sendStreamEnd(clientId); drainUntil = Math.max(drainUntil, Date.now() + sendspinDrainMs); }
    env.core.sendGroupUpdate(clientId, PlaybackStateType.STOPPED, targetId, env.name);
  };
  const clear = () => { for (const clientId of selected) end(clientId); };
  const fail = (message: string) => {
    if (closed || uncertain) return;
    cancel(); uncertain = true; clear(); state = { ...state, status: "unavailable", error: message }; publish(); observe();
    void decoder?.close().catch(() => {});
  };
  const enqueue = <T>(operation: () => Promise<T>) => {
    if (queued >= 32) return Promise.reject(new Error("Too many pending Sendspin commands."));
    queued++;
    const work = tail.then(() => { if (closed) throw new Error("Sendspin playback is closed."); return operation(); }).finally(() => { queued--; });
    tail = work.then(() => {}, () => {});
    return work;
  };
  const retire = async () => { cancel(); clear(); await decoder?.close(); await loop; decoder = undefined; cancellation = undefined; prepared = undefined; startedUs = 0; await delay(Math.max(0, drainUntil - Date.now())); };
  const openDecoder = () => {
    if (!load) throw new Error("No Sendspin source is loaded.");
    cancellation = new AbortController();
    return decoder = createPcmDecoder(load, { position: state.position, speed: state.speed ?? 1, ffmpeg: env.ffmpeg, signal: cancellation.signal });
  };
  const preparePaused = async () => {
    const epoch = generation, active = openDecoder();
    state = { ...state, status: "loading", error: null }; observe();
    const pcm = await active.read();
    if (epoch !== generation || closed) return;
    if (!pcm.length) throw new Error("The audio source has no decodable samples.");
    prepared = pcm; state = { ...state, status: "paused" }; observe();
  };
  const startStream = (clientId: string) => {
    env.core.sendStreamStart(clientId, { codec: AudioCodec.PCM, sampleRate: 48000, channels: 2, bitDepth: 16 });
    activeStreams.add(clientId);
    env.core.sendGroupUpdate(clientId, PlaybackStateType.PLAYING, targetId, env.name);
  };
  const start = () => {
    if (!load) return;
    const epoch = generation, speed = state.speed ?? 1, active = decoder ?? openDecoder();
    startPosition = state.position; sentSeconds = 0; startedUs = 0;
    state = { ...state, status: "loading", error: null }; observe();
    loop = (async () => {
      try {
        while (epoch === generation && !closed) {
          const pcm = prepared ?? await active.read(); prepared = undefined;
          if (epoch !== generation || closed) return;
          if (!pcm.length) {
            const remaining = Math.max(0, (startedUs + sentSeconds * 1e6 - serverNowUs()) / 1000);
            await delay(remaining + sendspinDrainMs, undefined, { signal: cancellation!.signal });
            if (epoch !== generation) return;
            clear(); state = { ...state, position: Math.min(state.duration ?? Infinity, startPosition + sentSeconds * speed), status: "ended" }; observe(); return;
          }
          if (!startedUs) { startedUs = serverNowUs() + leadUs; for (const clientId of selected) startStream(clientId); }
          const timestampUs = Math.round(startedUs + sentSeconds * 1e6);
          await delay(Math.max(0, (timestampUs - serverNowUs() - leadUs) / 1000), undefined, { signal: cancellation!.signal });
          if (epoch !== generation) return;
          if (timestampUs < serverNowUs()) throw new Error("The audio producer missed its playback deadline.");
          for (const clientId of selected) env.sendPcm(clientId, pcm, timestampUs);
          sentSeconds += pcm.byteLength / 192000;
          const publishProgress = state.status !== "playing" || serverNowUs() - progressAt >= 250_000;
          state = { ...state, status: "playing", position: position(), positionEstimated: true };
          if (publishProgress) { progressAt = serverNowUs(); observe(); }
        }
      } catch (error) {
        if (epoch === generation && !closed) {
          const detail = error instanceof Error && ["The audio producer missed its playback deadline.", "A Sendspin output could not keep up with playback."].includes(error.message) ? error.message : "Sendspin audio delivery failed.";
          fail(`${detail} Reconnect before transferring playback.`);
        }
      } finally { await active.close(); }
    })();
  };
  const setMembers = async (ids: string[]) => {
    if (ids.length > maxMembers || new Set(ids).size !== ids.length || ids.some(clientId => !env.device(clientId)?.connected)) throw new Error("Select connected Sendspin members.");
    if (uncertain) throw new Error("Reconnect Sendspin before changing uncertain outputs.");
    await enqueue(async () => {
      const previous = [...selected];
      if (ids.length === previous.length && ids.every((value, index) => value === previous[index])) return;
      env.assign(id, previous, ids);
      const removed = previous.filter(clientId => !ids.includes(clientId));
      const added = ids.filter(clientId => !selected.has(clientId));
      for (const clientId of removed) { end(clientId); selected.delete(clientId); }
      for (const clientId of added) { selected.add(clientId); if (startedUs) startStream(clientId); }
      publish(); observe();
      if (!selected.size) { await retire(); load = undefined; state = idle(); observe(); }
      else if (removed.length) await delay(sendspinDrainMs);
    });
  };
  const setMemberVolume = async (clientId: string, volume: number, muted: boolean) => {
    if (!selected.has(clientId) || !env.device(clientId)?.connected || !Number.isFinite(volume) || volume < 0 || volume > 100 || typeof muted !== "boolean") throw new Error("Invalid Sendspin member volume.");
    await enqueue(async () => {
      env.core.sendServerCommand(clientId, { player: { command: PlayerCommand.VOLUME, volume } });
      env.core.sendServerCommand(clientId, { player: { command: PlayerCommand.MUTE, mute: muted } });
      const deadline = Date.now() + 3000;
      const confirmed = () => env.device(clientId)?.connected && env.device(clientId)?.volume === volume && env.device(clientId)?.muted === muted;
      while (!closed && !confirmed() && env.device(clientId)?.connected && Date.now() < deadline) await delay(20);
      if (closed || !confirmed()) throw new Error("Sendspin did not confirm the member volume.");
    });
  };
  publish();
  return {
    id: targetId,
    get members() { return [...selected]; },
    setMembers,
    setMemberVolume,
    send(command: PlaybackCommand) {
      if (closed) throw new Error("Sendspin playback is closed.");
      if (command.type === "load") { validatePcmSource(command); if (command.preferences?.speed !== undefined && (!Number.isFinite(command.preferences.speed) || command.preferences.speed < 0.25 || command.preferences.speed > 4)) throw new Error("Invalid playback speed."); }
      else if (!["stop", "pause", "seek", "speed", "volume", "track"].includes(command.type)) throw new Error("This playback command is not supported by Sendspin.");
      if (command.type === "track") { if (command.kind !== "audio" || command.index !== 0) throw new Error("Sendspin supports the sole audio track only."); observe(); return; }
      if (!connected() && command.type !== "stop") throw new Error("Sendspin is disconnected.");
      if (command.type === "seek" && (!Number.isFinite(command.position) || command.position < 0 || !state.seekable)) throw new Error("This Sendspin source cannot seek.");
      if (command.type === "speed" && (!Number.isFinite(command.speed) || command.speed < 0.25 || command.speed > 4)) throw new Error("Invalid playback speed.");
      if (command.type === "volume") { for (const clientId of selected) void setMemberVolume(clientId, command.volume, env.device(clientId)?.muted ?? false).catch(() => fail("Sendspin volume was not confirmed.")); return; }
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
    refresh() { publish(); observe(); },
    disconnected(clientId: string) {
      if (!selected.delete(clientId)) return;
      activeStreams.delete(clientId);
      env.drop(id, clientId);
      publish(); observe();
      if (!selected.size) { cancel(); void enqueue(async () => { await retire(); load = undefined; state = idle(); observe(); }).catch(() => {}); }
    },
    failed(message: string) { fail(message); },
    async reconnect() { await enqueue(async () => { await retire(); if (closed) return; load = undefined; state = idle(); uncertain = false; publish(); observe(); }); },
    async close() {
      if (closed) return;
      closed = true; cancel(); clear(); await decoder?.close(); await loop; await tail;
      await delay(sendspinDrainMs);
      env.release(id); selected.clear(); publish();
    },
  };
}
