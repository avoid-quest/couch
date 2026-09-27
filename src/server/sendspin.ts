import { isAbsolute } from "node:path";
import { isIP } from "node:net";
import type { PlaybackCommand, PlaybackTarget, PlayerState } from "../shared/protocol";
import { createPcmDecoder, validatePcmSource } from "./pcm-decoder";

type Load = Extract<PlaybackCommand, { type: "load" }> & { duration?: number };
export const sendspinDrainMs = 1000;
export type SendspinConfig = { python: string; script: string; stateDirectory: string; name: string; host?: string; port: number; ffmpeg?: string; qualifiedClientIds?: string[] };
type Member = NonNullable<PlaybackTarget["members"]>[number] & { paired?: boolean; methods?: string[]; qualified?: boolean };
type Pairing = { clientId: string; stage: string; methods: string[] };
const idle = (): PlayerState => ({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
export function validateSendspinConfig(config: SendspinConfig) {
  if (![config.python, config.script, config.stateDirectory].every(value => typeof value === "string" && isAbsolute(value)) || !config.name?.trim() || config.name.length > 256 || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || !isIP(config.host ?? "127.0.0.1") || (config.qualifiedClientIds?.length ?? 0) > 32 || config.qualifiedClientIds?.some(id => typeof id !== "string" || !id || id.length > 256)) throw new Error("Invalid Sendspin helper configuration.");
}

export function createSendspin(config: SendspinConfig, callbacks: { changed: (target: PlaybackTarget) => void; observe: (player: PlayerState) => void }) {
  validateSendspinConfig(config);
  let child: ReturnType<typeof Bun.spawn> | null = null;
  let closed = false, ready = false;
  let members: Member[] = [], pairing: Pairing | undefined;
  let state = idle();
  let load: Load | null = null;
  let epoch = 0, sequence = 0, connection = 0;
  let decoder: ReturnType<typeof createPcmDecoder> | null = null;
  let cancellation: AbortController | null = null;
  let transport = Promise.resolve(), pendingCommands = 0;
  let pumping: Promise<void> | null = null;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const qualified = () => members.some(member => member.joined) && members.filter(member => member.joined).every(member => member.qualified);
  const connected = () => ready && members.some(member => member.joined && member.connected && member.paired);
  const publish = () => callbacks.changed({ id: "sendspin-group", name: config.name, kind: "group", backend: "sendspin", connected: connected(), handoffSafety: qualified() ? "buffer-drain" : "unverified", error: state.error ?? undefined, members, pairing } as PlaybackTarget);
  const observe = () => { if (!closed) callbacks.observe({ ...state, positionEstimated: true, audioTracksKnown: false, tracks: load ? [{ id: "group-audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }] : [] } as PlayerState); };
  const cancel = () => { epoch++; cancellation?.abort(); void decoder?.close(); };
  const fail = (message: string) => {
    if (closed) return;
    ready = false; cancel(); state = { ...state, status: "unavailable", error: message };
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear(); child?.kill("SIGKILL"); publish(); observe();
  };
  const request = (op: string, values: Record<string, unknown> = {}, timeout = 10_000): Promise<any> => new Promise((resolve, reject) => {
    if (!child || closed || pending.size >= 32) { reject(new Error("Sendspin helper is unavailable or busy.")); return; }
    const id = ++sequence;
    const line = JSON.stringify({ v: 1, id, op, ...values }) + "\n";
    if (Buffer.byteLength(line) > 16_384) { reject(new Error("Sendspin command is too large.")); return; }
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Sendspin did not confirm the operation.")); }, timeout);
    pending.set(id, { resolve, reject, timer });
    try { (child.stdin as import("bun").FileSink).write(line); }
    catch { clearTimeout(timer); pending.delete(id); reject(new Error("Sendspin helper disconnected.")); }
  });
  const update = (message: any) => {
    if (message.event === "members") {
      if (!Array.isArray(message.members) || message.members.length > 32 || message.members.some((member: any) => typeof member.id !== "string" || typeof member.name !== "string" || typeof member.connected !== "boolean" || typeof member.joined !== "boolean" || !Number.isFinite(member.volume))) throw new Error("Invalid Sendspin members.");
      members = message.members;
      const joined = members.filter(member => member.joined);
      state.volume = joined.length ? Math.round(joined.reduce((sum, member) => sum + member.volume, 0) / joined.length) : 100;
      if (ready) { publish(); observe(); }
    } else if (message.event === "position" && message.epoch === epoch && message.playbackId === load?.playbackId && ["playing", "loading"].includes(state.status)) {
      if (!Number.isFinite(message.position) || message.position < 0) throw new Error("Invalid Sendspin position.");
      state = { ...state, position: message.position, status: message.buffering ? "loading" : "playing", buffering: !!message.buffering }; observe();
    } else if (message.event === "pairing") {
      if (typeof message.clientId !== "string" || !["pin", "complete", "error"].includes(message.stage)) throw new Error("Invalid pairing response.");
      pairing = message.stage === "complete" ? undefined : { clientId: message.clientId, stage: message.stage, methods: ["dynamic_pin"] }; publish();
    } else if (message.event === "error") fail("Sendspin outputs became unavailable. Reconnect before retrying.");
  };
  async function start() {
    const attempt = ++connection;
    child = Bun.spawn([config.python, "-u", config.script, config.stateDirectory], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    const process = child;
    void (async () => {
      let buffer = "";
      const reader = (process.stdout as ReadableStream<Uint8Array>).getReader();
      const utf8 = new TextDecoder();
      try {
        while (!closed && attempt === connection) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += utf8.decode(chunk.value, { stream: true });
          if (buffer.length > 262_144) throw new Error("Sendspin output overflow.");
          for (;;) {
            const end = buffer.indexOf("\n"); if (end < 0) break;
            if (end > 16_384) throw new Error("Sendspin frame overflow.");
            const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
            if (message.v !== 1) throw new Error("Invalid Sendspin protocol.");
            if (typeof message.id === "number") {
              const waiting = pending.get(message.id);
              if (waiting) { pending.delete(message.id); clearTimeout(waiting.timer); message.ok ? waiting.resolve(message) : waiting.reject(new Error("Sendspin rejected the operation.")); }
            } else update(message);
          }
          if (buffer.length > 16_384) throw new Error("Sendspin frame overflow.");
        }
        if (!closed && attempt === connection) fail("Sendspin helper disconnected.");
      } catch { if (attempt === connection) fail("Sendspin helper communication failed."); }
      finally { reader.releaseLock(); }
    })();
    await request("start", { name: config.name, host: config.host ?? "127.0.0.1", port: config.port, qualifiedClientIds: config.qualifiedClientIds ?? [] });
    await Bun.sleep(sendspinDrainMs);
    if (attempt !== connection || closed) return;
    ready = true; state = idle(); publish(); observe();
  }
  async function release() {
    const previous = decoder; decoder = null;
    await previous?.close();
    await pumping; pumping = null;
  }
  const guard = () => { if (!ready || closed) throw new Error("Sendspin is disconnected."); };
  const enqueue = (work: () => Promise<void>) => {
    if (pendingCommands >= 32) throw new Error("Too many pending Sendspin commands.");
    pendingCommands++;
    const task = transport.then(work).finally(() => { pendingCommands--; });
    transport = task.catch(() => {}); return task;
  };
  async function prepare(paused: boolean, at: number, attempt: number) {
    cancellation = new AbortController();
    decoder = createPcmDecoder(load!, { position: at, speed: state.speed ?? 1, ffmpeg: config.ffmpeg, signal: cancellation.signal });
    const worker = decoder;
    const first = await worker.read();
    if (attempt !== epoch || closed) return;
    if (!first.length) throw new Error("No decodable audio.");
    state = { ...state, position: at, status: paused ? "paused" : "loading", buffering: !paused, error: null }; observe();
    if (paused) return;
    await request("begin", { epoch: attempt, playbackId: load!.playbackId, position: at });
    pumping = (async () => {
      let pcm = first, position = at;
      while (attempt === epoch && !closed) {
        if (!pcm.length) {
          const result = await request("end", { epoch: attempt });
          if (attempt === epoch) { state = { ...state, position: result.position, status: "ended", buffering: false }; observe(); }
          return;
        }
        await request("pcm", { epoch: attempt, data: Buffer.from(pcm).toString("base64"), position, speed: state.speed ?? 1 });
        position += pcm.length / 192000 * (state.speed ?? 1);
        pcm = await worker.read();
      }
    })().catch(() => { if (attempt === epoch && !closed) fail("Sendspin audio stopped unexpectedly. Reconnect before retrying."); });
  }
  publish(); void start().catch(() => fail("Could not start the configured Sendspin helper."));
  return {
    send(command: PlaybackCommand) {
      guard();
      if (pendingCommands >= 32) { if (command.type === "stop") { fail("Sendspin command backlog was stopped. Reconnect before retrying."); return; } throw new Error("Too many pending Sendspin commands."); }
      if (command.type === "load") validatePcmSource(command);
      if (!["load", "pause", "seek", "speed", "stop", "volume"].includes(command.type) && !(command.type === "track" && command.kind === "audio" && command.index === 0)) throw new Error("That control is not supported by Sendspin.");
      if (command.type === "volume") {
        if (!Number.isInteger(command.volume) || command.volume < 0 || command.volume > 100) throw new Error("Invalid volume.");
        void enqueue(async () => { for (const member of members.filter(member => member.joined)) await request("volume", { clientId: member.id, volume: command.volume, muted: member.muted }); }).catch(() => fail("Sendspin volume could not be confirmed.")); return;
      }
      if (command.type === "track") { observe(); return; }
      if ("playbackId" in command && command.type !== "load" && command.playbackId !== load?.playbackId) throw new Error("The playback attempt changed.");
      if (command.type === "seek" && (!state.seekable || !Number.isFinite(command.position) || command.position < 0 || command.position > state.duration!)) throw new Error("This source cannot seek there.");
      if (command.type === "speed" && (!Number.isFinite(command.speed) || command.speed < .25 || command.speed > 4)) throw new Error("Invalid playback speed.");
      cancel(); const attempt = epoch;
      // Priority clear is sent before waiting for an old PCM request/backpressure.
      const clearing = request("clear", { epoch: attempt });
      void clearing.catch(() => {});
      void enqueue(async () => {
        const checkpoint = await clearing; await release();
        if (attempt !== epoch || closed) return;
        if (qualified()) await Bun.sleep(sendspinDrainMs);
        if (attempt !== epoch || closed) return;
        if (command.type === "stop") { load = null; state = { ...idle(), volume: state.volume }; observe(); return; }
        if (command.type === "load") {
          load = command; state = { ...idle(), volume: state.volume, playbackId: command.playbackId, duration: command.duration ?? null, seekable: !!command.duration && !command.radio, speed: command.preferences?.speed ?? 1 };
          await prepare(!!command.paused, command.startPosition ?? 0, attempt);
        } else {
          const wasPaused = state.status === "paused";
          if (!wasPaused && Number.isFinite(checkpoint.position)) state.position = checkpoint.position;
          if (command.type === "pause" && command.paused) { state = { ...state, status: "paused", buffering: false }; observe(); }
          else { if (command.type === "speed") state.speed = command.speed; await prepare(command.type === "pause" ? false : wasPaused, command.type === "seek" ? command.position : state.position, attempt); }
        }
      }).catch(() => { if (attempt === epoch && !closed) fail("Sendspin transport could not be confirmed. Reconnect before retrying."); });
    },
    async setMembers(ids: string[]) { guard(); if (ids.length > 32 || new Set(ids).size !== ids.length) throw new Error("Invalid Sendspin members."); await request("members", { ids }); },
    async setMemberVolume(id: string, volume: number, muted: boolean) { guard(); if (!Number.isInteger(volume) || volume < 0 || volume > 100 || typeof muted !== "boolean") throw new Error("Invalid member volume."); await request("volume", { clientId: id, volume, muted }); },
    async pair(clientId: string, pin?: string) { guard(); await request(pin === undefined ? "pair" : "pin", { clientId, ...(pin === undefined ? {} : { pin }) }); },
    async unpair(clientId: string) { guard(); await request("unpair", { clientId }); },
    async cancelPairing(clientId: string) { guard(); await request("pairCancel", { clientId }); pairing = undefined; publish(); },
    async reconnect() {
      if (closed) throw new Error("Couch is shutting down.");
      cancel(); ready = false; connection++; child?.kill("SIGKILL");
      for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error("Reconnecting.")); } pending.clear();
      await release(); await transport; await child?.exited;
      members = []; load = null; pairing = undefined; await start();
    },
    async close() {
      if (closed) return; cancel();
      const closing = request("close", {}, 3000).catch(() => {});
      closed = true; ready = false; connection++;
      await release(); await closing; child?.kill("SIGKILL"); await child?.exited;
      for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error("Couch is shutting down.")); } pending.clear();
    },
  };
}
