import { createPublicMediaProxy } from "./public-media-proxy";
import type { IncomingMessage } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import type { WebSocket } from "ws";
import { AudioCodec, Identity, PlaybackStateType, PlayerCommand, SENTINEL_RESOLVED, SendspinCore, serverNowUs, type SendspinSession } from "@sonn-audio/node-sendspin";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { loopbackPeer } from "./lan-listener";
import { ffmpegErrorLog, logPlaybackError } from "./playback-log";

// Synced sound (#644 Delivery). Every Device plays sound over Sendspin with the official JS player;
// Core runs the server. One FFmpeg per Playback decodes the source once and encodes it once per
// wire format, and fan-out writes the same chunks with the same timestamps to every speaker. Each
// player applies its own level and delay. Muted pictures follow the same clock (ticket 11).
// live: the clock is the source's own timestamps, so a picture that joins the stream anywhere
// lines up with the sound (the RaiPlay stall of #643).
export type SyncedLoad = Extract<PlaybackCommand, { type: "load" }> & { headers?: Record<string, string>; live?: boolean; publicNetwork?: boolean };
export type Member = { deviceId: string; level: number };
type Wire = "opus" | "pcm";
// offset and duration are microseconds of audio from where this FFmpeg started.
type Chunk = { offset: number; duration: number; data: Buffer };
// start: the position of the first sample, which a live run learns from FFmpeg (the source's timestamp).
// sent: chunks speakers hold that have not played yet, at their play times, so a speaker that joins late gets them too.
type Run = { child: ChildProcess; start: number; live: boolean; anchored: boolean; speed: number; wires: Set<Wire>; queues: Record<Wire, Chunk[]>; sent: Record<Wire, { at: number; end: number; data: Buffer }[]>; pipes: Partial<Record<Wire, Readable>>; base?: number; released: number; exit?: number | null; timer: ReturnType<typeof setInterval> };

const leadUs = 1_000_000; // A run's first chunk plays this long after Core has it.
// Chunks go out this far ahead of their play time. Players schedule what they hold, so a page whose
// timers stall or a radio that dozes (a locked Android phone) keeps playing instead of dropping late chunks.
const sendUs = 8_000_000;
const aheadUs = 8_000_000; // Decoded audio that may wait in Core before FFmpeg is held back.
const pcmBytes = 19_200; // 100 ms of 48 kHz 16-bit stereo.
const wireFormat = (wire: Wire) => ({ codec: wire === "opus" ? AudioCodec.OPUS : AudioCodec.PCM, sampleRate: 48_000, channels: 2, bitDepth: 16 });
// Outputs ask for Opus first (#644 Fan-out). Firefox's player offers only FLAC and PCM, so PCM is the second wire.
const chosen = new WeakMap<SendspinSession, Wire | undefined>();
const wireOf = (session: SendspinSession): Wire | undefined => {
  if (chosen.has(session)) return chosen.get(session);
  chosen.set(session, undefined);
  for (const format of session.getPlayerSupportedFormats()) {
    if (format.sample_rate !== 48_000 || format.channels !== 2) continue;
    const wire = format.codec === AudioCodec.OPUS ? "opus" : format.codec === AudioCodec.PCM && format.bit_depth === 16 ? "pcm" : undefined;
    if (wire) { chosen.set(session, wire); return wire; }
  }
};
const tempo = (speed: number) => speed < 0.5 ? `atempo=0.5,atempo=${speed / 0.5}` : speed > 2 ? `atempo=2,atempo=${speed / 2}` : `atempo=${speed}`;

// An Opus packet's length from its TOC byte (RFC 6716 3.1), in microseconds.
const opusDuration = (packet: Buffer) => {
  const config = packet[0]! >> 3, code = packet[0]! & 3;
  const frame = config < 12 ? [10, 20, 40, 60][config & 3]! : config < 16 ? [10, 20][config & 1]! : [2.5, 5, 10, 20][config & 3]!;
  return frame * 1000 * (code === 0 ? 1 : code === 3 ? packet[1]! & 0x3f : 2);
};
// Splits an Ogg stream into its packets (RFC 3533).
function oggPackets(onPacket: (packet: Buffer) => void) {
  let pending: Buffer = Buffer.alloc(0);
  let partial: Buffer[] = [];
  return (data: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    while (pending.length >= 27) {
      if (pending.toString("latin1", 0, 4) !== "OggS") throw new Error("FFmpeg sent a broken Ogg stream.");
      const segments = pending[26]!, header = 27 + segments;
      if (pending.length < header) return;
      let size = 0;
      for (let index = 0; index < segments; index++) size += pending[27 + index]!;
      if (pending.length < header + size) return;
      for (let index = 0, at = header; index < segments; index++) {
        const lace = pending[27 + index]!;
        partial.push(pending.subarray(at, at += lace));
        if (lace < 255) { onPacket(Buffer.concat(partial)); partial = []; }
      }
      pending = pending.subarray(header + size);
    }
  };
}

// An HLS playlist's lines and final URL, or null when the URL is something else.
async function playlist(url: string, headers: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(url, { headers, signal }).catch(() => null);
  if (!response?.ok || !/mpegurl/i.test(response.headers.get("content-type") ?? "") && !/\.m3u8$/.test(new URL(response.url || url).pathname)) {
    void response?.body?.cancel().catch(() => {});
    return null;
  }
  return { url: response.url || url, lines: (await response.text()).split(/\r?\n/) };
}

// An HLS master's audio-only rendition when it has one (a separate audio playlist, or an
// audio-only variant like Twitch's), else its smallest variant. Other sources are read as they are.
async function audioInput(url: string, headers: Record<string, string>, signal: AbortSignal) {
  const master = await playlist(url, headers, signal);
  if (!master?.lines.some(line => line.startsWith("#EXT-X-STREAM-INF:"))) return { source: url, hls: !!master };
  const { lines } = master;
  const audio = lines.find(line => line.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/.test(line))?.match(/URI="([^"]+)"/)?.[1];
  const variants = lines.flatMap((line, index) => line.startsWith("#EXT-X-STREAM-INF:") && lines[index + 1] && !lines[index + 1]!.startsWith("#") ? [{ info: line, uri: lines[index + 1]!.trim() }] : []);
  const only = variants.find(variant => /CODECS="/.test(variant.info) && !/avc1|avc3|hvc1|hev1|vp09|av01|mp4v/.test(variant.info));
  const bandwidth = (info: string) => Number(/BANDWIDTH=(\d+)/.exec(info)?.[1] ?? Infinity);
  const smallest = variants.sort((a, b) => bandwidth(a.info) - bandwidth(b.info))[0]?.uri;
  return { source: new URL(audio ?? only?.uri ?? smallest ?? url, master.url).href, hls: true };
}

export async function audioRendition(url: string, headers: Record<string, string>, signal: AbortSignal) {
  return (await audioInput(url, headers, signal)).source;
}

// A direct link has no metadata to say it is live, so an HLS playlist is live while it has no
// end (RFC 8216 EXT-X-ENDLIST); a master is judged by its first variant.
export async function liveHls(url: string, signal: AbortSignal) {
  let media = await playlist(url, {}, signal);
  const variant = media?.lines.find((_line, index) => index > 0 && media!.lines[index - 1]!.startsWith("#EXT-X-STREAM-INF:"));
  if (variant) media = await playlist(new URL(variant.trim(), media!.url).href, {}, signal);
  return !!media?.lines.some(line => line.startsWith("#EXTINF:")) && !media.lines.some(line => line.startsWith("#EXT-X-ENDLIST"));
}

export function createSendspin(options: { identity: string; name: string; admit: (clientId: string, loopback: boolean) => boolean; changed: () => void; ffmpeg: () => Promise<string>; savedDelay?: (clientId: string) => number | undefined; saveDelay?: (clientId: string, delay: number) => void }) {
  const core = new SendspinCore();
  core.configureServer({ name: options.name });
  const sockets = new Set<WebSocket>();
  const sessions = new Map<string, SendspinSession>();
  const delays = new Map<string, number>();
  const groups = new Set<{ joined: (clientId: string) => void }>();
  // Only this Couch's Devices get in: accept() admits the client_id, and the Noise handshake proves the client holds its key, its Device ID (#644 Model).
  core.enableEncryption(Identity.fromPrivateB64u(options.identity), clientId => {
    core.registerHooks(clientId, {
      onIdentified: session => { sessions.set(clientId, session); for (const group of groups) group.joined(clientId); options.changed(); },
      onPlayerState: (_session, update) => {
        if (update.staticDelayMs === undefined || delays.get(clientId) === update.staticDelayMs) return;
        delays.set(clientId, update.staticDelayMs);
        options.saveDelay?.(clientId, update.staticDelayMs);
        options.changed();
      },
      onDisconnected: session => { if (sessions.get(clientId) === session) { sessions.delete(clientId); options.changed(); } },
    });
    return SENTINEL_RESOLVED;
  });

  // One Playback's speakers: its Sendspin group. It is the Playback's player while its outputs span Devices.
  function group(id: string, observe: (state: PlayerState) => void) {
    let members: Member[] = [];
    let screens: string[] = [];
    let load: SyncedLoad | undefined;
    let input: ReturnType<typeof audioInput> | undefined;
    let run: Run | undefined;
    let generation = 0;
    let reportedAt = 0;
    const idle = (): PlayerState => ({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
    let state = idle();
    const listening = (clientId: string) => { const session = sessions.get(clientId); return session && members.some(member => member.deviceId === clientId) ? session : undefined; };
    const report = () => {
      reportedAt = Date.now();
      const volume = members[0]?.level ?? 100;
      observe(state = { ...state, volume, ...run?.base !== undefined && state.status !== "ended" ? { position: position() } : {} });
      for (const screen of screens) sessions.get(screen)?.sendMetadata({ progress: timeline() });
    };
    // Where the sound is on the Sendspin clock (Sendspin metadata progress): pictures follow it.
    // None until a live source has given its first timestamp.
    const timeline = () => !load || (run ? !run.anchored : load.live && !load.radio && !state.position) ? null
      : { track_progress: Math.round(position() * 1000), track_duration: Math.round((state.duration ?? 0) * 1000), playback_speed: state.status === "playing" ? Math.round((run?.speed ?? 1) * 1000) : 0 };
    // A screen learns its group, so it never follows another Playback's clock.
    const watch = (clientId: string) => {
      const session = sessions.get(clientId);
      session?.sendGroupUpdate(run?.base !== undefined ? PlaybackStateType.PLAYING : PlaybackStateType.STOPPED, id, options.name);
      session?.sendMetadata({ progress: timeline() });
    };
    const position = () => {
      if (!run || run.base === undefined) return state.position;
      const heard = Math.min(Math.max(0, serverNowUs() - run.base), run.released);
      return Math.min(state.duration ?? Infinity, run.start + heard / 1e6 * run.speed);
    };
    const begin = (clientId: string) => {
      const session = listening(clientId), wire = session && wireOf(session);
      if (!session || !wire || !run || run.base === undefined) return;
      if (!run.wires.has(wire)) { void restart(); return; }
      session.sendStreamStart(wireFormat(wire));
      session.sendGroupUpdate(PlaybackStateType.PLAYING, id, options.name);
      const now = serverNowUs();
      for (const chunk of run.sent[wire]) if (chunk.at > now) session.sendPcmAudioFrame({ data: chunk.data, timestampUs: chunk.at });
    };
    const each = (action: (session: SendspinSession) => void) => { for (const member of members) { const session = listening(member.deviceId); if (session) action(session); } };
    // Ends FFmpeg. Speakers drop what they buffered: a paused or seeking Playback goes quiet at once.
    const halt = (end = false) => {
      generation++;
      if (!run) return;
      clearInterval(run.timer);
      run.child.kill("SIGKILL");
      run = undefined;
      each(session => { if (end) { session.sendStreamEnd(); session.sendGroupUpdate(PlaybackStateType.STOPPED, id, options.name); } else session.sendStreamClear(); });
    };
    const fail = (message: string) => {
      logPlaybackError(id, "Synced", load?.audioSource ?? load?.source, message);
      halt(true); state = { ...state, status: "error", error: message }; report();
    };
    const restart = async () => { const at = position(); halt(); state = { ...state, position: at }; await start(); };
    const start = async () => {
      const current = load!, attempt = ++generation;
      const signal = AbortSignal.timeout(15_000);
      const headers = current.headers ?? {};
      let proxy: Awaited<ReturnType<typeof createPublicMediaProxy>> | undefined;
      try {
        input ??= audioInput(current.audioSource ?? current.source, headers, signal);
        const [{ source, hls }, ffmpeg] = await Promise.all([input, options.ffmpeg()]).catch(error => { input = undefined; throw error; });
        if (current.publicNetwork) proxy = await createPublicMediaProxy(new AbortController().signal, current.source);
        if (attempt !== generation) { await proxy?.close(); return; }
        const wires = new Set<Wire>(members.flatMap(member => { const session = listening(member.deviceId), wire = session && wireOf(session); return wire ? [wire] : []; }));
        if (!wires.size) wires.add("opus");
        const speed = state.speed ?? 1, start = state.position, live = !!current.live && !current.radio;
        const seek = start > 0 && !current.radio && !live && (state.duration !== null || !!current.startPosition);
        // A live run keeps the source's timestamps and prints its first one (ashowinfo, on one wire only).
        const shape = (first: boolean) => {
          const filters = [...live && first ? ["ashowinfo"] : [], ...speed === 1 ? [] : [tempo(speed)]];
          return ["-map", "0:a:0", "-vn", "-sn", "-dn", ...filters.length ? ["-af", filters.join(",")] : [], "-ar", "48000", "-ac", "2"];
        };
        // Network protocols only, and a 10 s timeout on every read (#644 FFmpeg safety).
        const child = spawn(ffmpeg, ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-protocol_whitelist", "http,https,tcp,tls,crypto,httpproxy", "-rw_timeout", "10000000",
          ...proxy ? ["-http_proxy", proxy.url, "-format_whitelist", "aac,ac3,aiff,ape,asf,flac,flv,hls,matroska,webm,mov,mp3,mpeg,mpegts,ogg,wav,wv"] : [],
          ...Object.keys(headers).length ? ["-headers", Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join("")] : [],
          // Start live HLS at its newest complete segment and avoid probing ahead
          // through several seconds before anchoring the shared playback clock.
          ...live && hls ? ["-live_start_index", "-1", "-probesize", "32768", "-analyzeduration", "100000"] : [],
          ...live ? ["-copyts"] : [], ...seek ? ["-ss", String(start)] : [], "-i", source,
          ...wires.has("opus") ? [...shape(true), "-c:a", "libopus", "-b:a", "96k", "-frame_duration", "60", "-f", "ogg", "-page_duration", "60000", "pipe:1"] : [],
          ...wires.has("pcm") ? [...shape(!wires.has("opus")), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:3"] : []], { stdio: ["ignore", "pipe", "pipe", "pipe"], ...(proxy ? { env: { ...process.env, http_proxy: proxy.url, https_proxy: proxy.url, HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, all_proxy: "", ALL_PROXY: "", no_proxy: "", NO_PROXY: "" } } : {}) });
        if (proxy) { const activeProxy = proxy; child.once("close", () => { void activeProxy.close(); }); }
        const next: Run = { child, start, live, anchored: !live, speed, wires, queues: { opus: [], pcm: [] }, sent: { opus: [], pcm: [] }, pipes: {}, released: 0, timer: setInterval(() => tick(next), 20) };
        run = next;
        state = { ...state, status: "loading", buffering: false, error: null };
        report();
        const diagnostic = ffmpegErrorLog();
        let partial = "";
        child.stderr!.setEncoding("utf8").on("data", (text: string) => {
          diagnostic.write(text);
          const lines = (partial + text).split("\n");
          partial = lines.pop()!;
          for (const line of lines) {
            if (line.includes("Parsed_ashowinfo")) {
              const first = !next.anchored && /\bn:\s*0\s.*?pts_time:(-?[\d.]+)/.exec(line);
              if (first) { next.start = Number(first[1]); next.anchored = true; }
              continue;
            }
            const duration = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(line);
            if (duration && state.duration === null) state = { ...state, duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]), seekable: !current.radio };
          }
        });
        child.on("error", () => { if (run === next) fail("Couch couldn't start FFmpeg."); });
        child.on("close", code => {
          if (run !== next) return;
          next.exit = code;
          if (code !== 0) fail(`The audio couldn't play here (${diagnostic.last() || `FFmpeg exited with ${code}`}).`);
        });
        const queue = (wire: Wire, pipe: Readable, chunk: Chunk) => {
          const list = next.queues[wire];
          list.push(chunk);
          if (list.length && list.at(-1)!.offset - list[0]!.offset > aheadUs) pipe.pause();
        };
        if (wires.has("opus")) {
          const pipe = next.pipes.opus = child.stdout!;
          let offset = 0;
          pipe.on("data", oggPackets(packet => {
            // OpusHead's pre-skip is the encoder's delay; timestamps drop it so every wire lines up.
            const magic = packet.toString("latin1", 0, 8);
            if (magic === "OpusHead") { offset = -packet.readUInt16LE(10) / 48_000 * 1e6; return; }
            if (magic === "OpusTags") return;
            const duration = opusDuration(packet);
            queue("opus", pipe, { offset, duration, data: packet });
            offset += duration;
          }));
        }
        if (wires.has("pcm")) {
          const pipe = next.pipes.pcm = child.stdio[3] as Readable;
          let pending: Buffer = Buffer.alloc(0), offset = 0;
          const flush = (data: Buffer) => { queue("pcm", pipe, { offset, duration: data.length / 192_000 * 1e6, data }); offset += data.length / 192_000 * 1e6; };
          pipe.on("data", (data: Buffer) => {
            pending = Buffer.concat([pending, data]);
            while (pending.length >= pcmBytes) { flush(pending.subarray(0, pcmBytes)); pending = pending.subarray(pcmBytes); }
          });
          pipe.on("end", () => { if (pending.length >= 4) flush(pending.subarray(0, pending.length - pending.length % 4)); });
        }
      } catch (error) {
        await proxy?.close();
        if (attempt === generation) fail(error instanceof Error && error.name !== "TimeoutError" ? error.message : "The audio source didn't answer.");
      }
    };
    // Sends every chunk that is due to every speaker on its wire: one write per speaker.
    const tick = (current: Run) => {
      const now = serverNowUs();
      const first = Math.min(...Object.values(current.queues).map(list => list[0]?.offset ?? Infinity));
      if (current.base === undefined) {
        if (first === Infinity || !current.anchored) return;
        // Chunk timestamps are shared by the group; each player adds its own delay.
        const delay = Math.max(0, ...members.map(member => delays.get(member.deviceId) ?? 0)) * 1000;
        current.base = now + leadUs + delay - first;
        for (const member of members) begin(member.deviceId);
        if (run !== current) return;
      } else if (first !== Infinity && current.base + first < now + leadUs / 2) {
        // The source fell behind real time: later chunks play later instead of arriving too late,
        // and the pictures learn the new timeline at once.
        current.base = now + leadUs - first;
        report();
      }
      for (const wire of current.wires) {
        const list = current.queues[wire], sent = current.sent[wire];
        while (sent[0] && sent[0].end <= now) sent.shift();
        while (list[0] && current.base + list[0].offset - sendUs <= now) {
          const chunk = list.shift()!, at = current.base + chunk.offset;
          each(session => { if (wireOf(session) === wire) session.sendPcmAudioFrame({ data: chunk.data, timestampUs: at }); });
          sent.push({ at, end: at + chunk.duration, data: chunk.data });
          current.released = Math.max(current.released, chunk.offset + chunk.duration);
        }
        if (current.pipes[wire]?.isPaused() && (!list.length || list.at(-1)!.offset - list[0]!.offset < aheadUs / 2)) current.pipes[wire]!.resume();
      }
      // Waiting for the source: the speakers have played everything they were sent.
      const starving = current.exit === undefined && Object.values(current.queues).every(list => !list.length) && now >= current.base + current.released;
      const status = now >= current.base && !starving ? "playing" : "loading";
      if (current.exit === 0 && Object.values(current.queues).every(list => !list.length) && now >= current.base + current.released) {
        halt(true);
        state = { ...state, position: position(), status: "ended" };
        report();
      } else if (status !== state.status || starving !== !!state.buffering || Date.now() - reportedAt >= 1000) {
        state = { ...state, status, buffering: starving };
        report();
      }
    };
    const pause = () => {
      const at = position();
      halt();
      state = { ...state, position: at, status: "paused", buffering: false };
      report();
    };

    const synced = {
      // The screens: Devices whose picture follows this group's clock.
      screens(next: string[]) {
        const added = next.filter(clientId => !screens.includes(clientId));
        screens = next;
        for (const clientId of added) watch(clientId);
      },
      // The speakers: Devices whose sound is in this Playback, each with its level.
      members(next: Member[]) {
        const before = members;
        members = next;
        for (const member of before) if (!next.some(item => item.deviceId === member.deviceId)) {
          const session = sessions.get(member.deviceId);
          session?.sendStreamEnd();
          session?.sendGroupUpdate(PlaybackStateType.STOPPED, id, options.name);
        }
        for (const member of next) {
          const session = sessions.get(member.deviceId), old = before.find(item => item.deviceId === member.deviceId);
          if (session && old?.level !== member.level) session.sendServerCommand({ player: { command: PlayerCommand.VOLUME, volume: member.level } });
          if (!old) begin(member.deviceId);
        }
        if (state.playbackId) report();
      },
      joined(clientId: string) {
        if (screens.includes(clientId)) watch(clientId);
        const member = members.find(item => item.deviceId === clientId);
        if (!member) return;
        sessions.get(clientId)!.sendServerCommand({ player: { command: PlayerCommand.VOLUME, volume: member.level } });
        begin(clientId);
      },
      send(command: SyncedLoad | PlaybackCommand) {
        if (command.type !== "load" && command.type !== "stop" && "playbackId" in command && command.playbackId !== state.playbackId) return;
        switch (command.type) {
          case "load":
            halt();
            load = command;
            input = undefined;
            state = { ...idle(), playbackId: command.playbackId, status: command.paused ? "paused" : "loading", position: command.startPosition ?? 0, speed: command.preferences?.speed ?? 1,
              tracks: [{ id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }] };
            if (command.paused) report(); else void start();
            break;
          case "pause": if (command.paused) pause(); else if (state.status === "paused") void start(); break;
          case "audioPause": pause(); break;
          case "seek": halt(); state = { ...state, position: command.position }; if (state.status === "paused") report(); else void start(); break;
          case "speed": { const at = position(), paused = state.status === "paused"; halt(); state = { ...state, position: at, speed: command.speed }; if (paused) report(); else void start(); break; }
          case "stop": halt(true); load = undefined; state = idle(); report(); break;
        }
      },
      close() { halt(true); groups.delete(synced); },
    };
    groups.add(synced);
    return synced;
  }

  return {
    // wss://<Couch>/sendspin. Only Noise clients: a plaintext hello would skip the key check.
    accept(socket: WebSocket, request: IncomingMessage) {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      const timer = setTimeout(() => socket.terminate(), 10_000);
      socket.once("message", (data, binary) => {
        clearTimeout(timer);
        let init: { type?: string; payload?: { client_id?: unknown } } | undefined;
        try { init = JSON.parse(String(data)); } catch { /* Refused below. */ }
        if (binary || init?.type !== "client/init" || !options.admit(String(init.payload?.client_id), loopbackPeer(request.socket.remoteAddress ?? ""))) return void socket.terminate();
        core.handleConnection(socket, request);
        core.getSessionBySocket(socket)!.handleText(String(data));
      });
    },
    group,
    // A speaker's own delay, which its player applies and keeps (Sendspin static delay). Core saves its last
    // report, so it shows across disconnects and restarts until the speaker reports again.
    delay: (clientId: string) => delays.get(clientId) ?? options.savedDelay?.(clientId) ?? (sessions.has(clientId) ? 0 : undefined),
    connected: (clientId: string) => sessions.has(clientId),
    setDelay(clientId: string, delay: number) { sessions.get(clientId)?.sendServerCommand({ player: { command: PlayerCommand.SET_STATIC_DELAY, static_delay_ms: delay } }); },
    drop(clientId: string) { for (const socket of sockets) if (core.getSessionBySocket(socket)?.getClientId() === clientId) socket.terminate(); },
    close() { for (const socket of sockets) socket.terminate(); },
  };
}
