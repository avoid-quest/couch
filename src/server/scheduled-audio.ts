import { createPublicMediaProxy } from "./public-media-proxy";
import { stripCrossOriginHeaders } from "./public-network";
import type { IncomingMessage } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import type { WebSocket } from "ws";
import { AudioCodec, Identity, PlaybackStateType, PlayerCommand, SENTINEL_RESOLVED, SendspinCore, serverNowUs, type SendspinSession } from "@sonn-audio/node-sendspin";
import type { AudioSelection, OutputAdmission, PlaybackCommand, PlayerState } from "../shared/protocol";
import { liveOutputAdmission } from "./output-admission";
import { loopbackPeer } from "./lan-listener";
import { ffmpegErrorLog, logPlaybackError } from "./playback-log";
import { useHelper } from "./helpers";
import { audioInput } from "./source-preparation";
import { opusDuration, oggPackets } from "./audio-packets";
import { createScheduledCapture, type Ffmpeg } from "./scheduled-capture";
import type { CaptureAudioPacket, CapturePolicy } from "./capture-audio";
import { compressorFilter } from "../shared/compressor";

// Synced sound (#644 Delivery). Every Device plays sound over Sendspin with the official JS player;
// Core runs the server. One FFmpeg per Playback decodes the source once and encodes it once per
// wire format, and fan-out writes the same chunks with the same timestamps to every speaker. Each
// player applies its own level and delay. Muted pictures follow the same clock (ticket 11).
// live: the clock is the source's own timestamps, so a picture that joins the stream anywhere
// lines up with the sound (the RaiPlay stall of #643).
export type SyncedLoad = Extract<PlaybackCommand, { type: "load" }> & { headers?: Record<string, string>; live?: boolean; publicNetwork?: boolean; intent?: "relaxed" | "live"; hasAudio?: boolean; duration?: number; audioSelection?: AudioSelection; credentialOrigin?: string };
export type Member = { deviceId: string; level: number; receiverId?: string };
type Wire = "opus" | "pcm";
// offset and duration are microseconds of audio from where this FFmpeg started.
type Chunk = { offset: number; duration: number; data: Buffer };
// start: the position of the first sample, which a live run learns from FFmpeg (the source's timestamp).
// sent: released chunks that have not played yet, at their play times, so a speaker that joins late gets them too.
// cursors: the play time of the last chunk each speaker got.
type Run = { child?: ChildProcess; dispose?: () => void; fixed?: boolean; timelineOnly?: boolean; start: number; live: boolean; anchored: boolean; speed: number; wires: Set<Wire>; queues: Record<Wire, Chunk[]>; sent: Record<Wire, { at: number; end: number; data: Buffer }[]>; cursors: Map<SendspinSession, number>; pipes: Partial<Record<Wire, Readable>>; base?: number; released: number; exit?: number | null; timer: ReturnType<typeof setInterval> };

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

export function createScheduledAudio(options: { identity: string; name: string; admit: (clientId: string, loopback: boolean) => boolean; changed: () => void; ffmpeg?: Ffmpeg; sourceFailed?: (id: string, error: string) => void; logError?: (id: string, source: string | undefined, message: string) => void; savedDelay?: (clientId: string) => number | undefined; saveDelay?: (clientId: string, delay: number) => void }) {
  const core = new SendspinCore();
  core.configureServer({ name: options.name });
  const sockets = new Set<WebSocket>();
  const socketOf = new Map<SendspinSession, WebSocket>();
  const receiverErrors = new Map<string, { group: string; error: string }>();
  const readiness = new Map<string, string>();
  const sources = new Map<string, ReturnType<typeof createScheduledCapture>>();
  const sessions = new Map<string, SendspinSession>();
  // Candidates live only as long as their already-accepted sockets. The newest
  // control tab's expected token, not the newest Noise socket, owns live sound.
  const identified = new Set<SendspinSession>();
  const expected = new Map<string, { group: string; receiverId?: string }>();
  const admissions = new Map<string, { group: string; receiverId?: string; admission: OutputAdmission }>();
  const delays = new Map<string, number>();
  const groups = new Set<{ joined: (clientId: string) => void }>();
  const select = (clientId: string) => {
    const receiverId = expected.get(clientId)?.receiverId;
    const candidates = [...identified].filter(session => session.getClientId() === clientId && (!receiverId || session.getOutputPreparation()?.receiverId === receiverId));
    const next = candidates.at(-1), previous = sessions.get(clientId);
    if (next === previous) return false;
    if (next) sessions.set(clientId, next); else sessions.delete(clientId);
    readiness.delete(clientId);
    return true;
  };
  // Only this Couch's Devices get in: accept() admits the client_id, and the Noise handshake proves the client holds its key, its Device ID (#644 Model).
  core.enableEncryption(Identity.fromPrivateB64u(options.identity), clientId => {
    core.registerHooks(clientId, {
      onIdentified: session => { identified.add(session); if (select(clientId)) { for (const group of groups) group.joined(clientId); options.changed(); } },
      onPlayerState: (_session, update) => {
        const selected = select(clientId);
        if (sessions.get(clientId) !== _session) return;
        const timing = JSON.stringify([_session.getPlayerTiming(), _session.getOutputPreparation()]);
        const timingChanged = readiness.get(clientId) !== timing;
        if (timingChanged || selected) { readiness.set(clientId, timing); for (const group of groups) group.joined(clientId); }
        const delayChanged = update.staticDelayMs !== undefined && delays.get(clientId) !== update.staticDelayMs;
        if (delayChanged) {
          delays.set(clientId, update.staticDelayMs!);
          options.saveDelay?.(clientId, update.staticDelayMs!);
        }
        // The facade validates corrections before persistence. Lead/buffer changes
        // must reach it even when the persisted static delay did not change.
        if (timingChanged || delayChanged) options.changed();
      },
      onDisconnected: session => { identified.delete(session); if (select(clientId)) { for (const group of groups) group.joined(clientId); options.changed(); } },
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
    const diagnostics = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout>; pending?: object; coalesced: number }>();
    const clearReceiverError = (clientId: string) => {
      if (receiverErrors.get(clientId)?.group === id) { receiverErrors.delete(clientId); options.changed(); }
    };
    const clearAdmission = (clientId: string) => {
      const diagnostic = diagnostics.get(clientId); clearTimeout(diagnostic?.timer); diagnostics.delete(clientId);
      if (admissions.get(clientId)?.group === id) { admissions.delete(clientId); clearReceiverError(clientId); options.changed(); }
    };
    const admit = (member: Member, session: SendspinSession | undefined, wire: Wire | undefined) => {
      if (load?.intent !== "live" && !member.receiverId) { clearAdmission(member.deviceId); return true; }
      if (expected.get(member.deviceId)?.group !== id) return false;
      const admission = liveOutputAdmission(session, wire, member.receiverId), previous = admissions.get(member.deviceId);
      if (previous?.group !== id || previous?.receiverId !== member.receiverId || JSON.stringify(previous?.admission) !== JSON.stringify(admission)) {
        admissions.set(member.deviceId, { group: id, receiverId: member.receiverId, admission });
        if (admission.state === "failed") receiverErrors.set(member.deviceId, { group: id, error: admission.error }); else clearReceiverError(member.deviceId);
        options.changed();
        const diagnostic = diagnostics.get(member.deviceId) ?? { at: -Infinity, coalesced: 0 };
        diagnostics.set(member.deviceId, diagnostic);
        if (diagnostic.pending) diagnostic.coalesced++;
        // Never log the receiving-tab token, raw audio, URLs or credentials.
        diagnostic.pending = { deviceId: member.deviceId, group: id, sourceId: load?.liveSourceId, run: generation, state: admission.state,
          reason: admission.state === "failed" ? admission.reason : undefined, epoch: session?.getOutputPreparation()?.epoch,
          wire, capacity: session?.getPlayerBufferCapacity(), ...session?.getPlayerTiming() };
        const flush = () => { diagnostic.timer = undefined; if (diagnostic.pending) console.info("[audio-admission]", { ...diagnostic.pending, receiptUs: serverNowUs(), coalesced: diagnostic.coalesced }); diagnostic.pending = undefined; diagnostic.coalesced = 0; diagnostic.at = Date.now(); };
        if (Date.now() - diagnostic.at >= 1000) { clearTimeout(diagnostic.timer); flush(); }
        else diagnostic.timer ??= setTimeout(flush, 1000 - (Date.now() - diagnostic.at));
      }
      return admission.state === "ready";
    };
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
      const member = members.find(member => member.deviceId === clientId);
      if (!member) return;
      const allowed = admit(member, session, wire);
      for (const previous of run?.cursors.keys() ?? []) if (previous.getClientId() === clientId && (previous !== session || !allowed)) {
        run!.cursors.delete(previous); previous.sendStreamClear();
      }
      if (!allowed || !session || !run || run.timelineOnly || run.base === undefined) return;
      if (!wire) { receiverErrors.set(clientId, { group: id, error: "This output cannot meet live audio's Opus deadline. Use relaxed sharing." }); options.changed(); return; }
      if (load?.intent !== "live") clearReceiverError(clientId);
      if (run.cursors.has(session)) return;
      if (!run.wires.has(wire)) { void restart(); return; }
      session.sendStreamStart(wireFormat(wire));
      session.sendGroupUpdate(PlaybackStateType.PLAYING, id, options.name);
      const timing = session.getPlayerTiming();
      // Join at a deadline this output can still meet; keep the audience timeline fixed.
      const joinLeadMs = load?.intent === "live" ? (timing.requiredLeadTimeMs ?? 0) + Math.max(0, timing.staticDelayMs ?? 0) : 0;
      run.cursors.set(session, serverNowUs() + joinLeadMs * 1000);
    };
    const each = (action: (session: SendspinSession) => void) => { for (const member of members) { const session = listening(member.deviceId); if (session) action(session); } };
    // Ends FFmpeg. Speakers drop what they buffered: a paused or seeking Playback goes quiet at once.
    const halt = (end = false) => {
      generation++;
      if (!run) return;
      clearInterval(run.timer);
      run.child?.kill("SIGKILL");
      run.dispose?.();
      run = undefined;
      each(session => { if (end) { session.sendStreamEnd(); session.sendGroupUpdate(PlaybackStateType.STOPPED, id, options.name); } else session.sendStreamClear(); });
    };
    const fail = (message: string) => {
      if (options.logError) options.logError(id, load?.audioSource ?? load?.source, message);
      else logPlaybackError(id, "Synced", load?.audioSource ?? load?.source, message);
      halt(true); state = { ...state, status: "error", error: message }; report();
    };
    const restart = async () => { const at = position(); halt(); state = { ...state, position: at }; await start(); };
    const start = async () => {
      const current = load!, attempt = ++generation;
      const signal = AbortSignal.timeout(15_000);
      const inputUrl = current.audioSource ?? current.source;
      const credentialOrigin = current.credentialOrigin ?? current.source;
      let proxy: Awaited<ReturnType<typeof createPublicMediaProxy>> | undefined;
      let ffmpeg: ReturnType<typeof useHelper> | undefined;
      try {
        const headers = new Headers(current.headers);
        if (/^https?:/.test(inputUrl) && new URL(inputUrl).origin !== new URL(credentialOrigin).origin) stripCrossOriginHeaders(headers);
        if ((!members.length || current.hasAudio === false) && !current.liveSourceId) {
          const next: Run = { timelineOnly: true, start: state.position, live: false, anchored: true, speed: state.speed ?? 1, wires: new Set(), queues: { opus: [], pcm: [] }, sent: { opus: [], pcm: [] }, cursors: new Map(), pipes: {}, base: serverNowUs() + leadUs, released: Infinity, timer: setInterval(() => tick(next), 50) };
          run = next;
          state = { ...state, duration: current.duration ?? state.duration, seekable: !current.live, timeline: { mapping: current.live ? "unavailable" : "media", ...(current.live ? { error: "This picture-only broadcast has no source timestamp mapping." } : {}) } };
          report(); return;
        }
        if (current.liveSourceId && sources.has(current.liveSourceId)) {
          const source = sources.get(current.liveSourceId)!;
          const next: Run = { fixed: true, start: 0, live: true, anchored: true, speed: 1, wires: new Set(["opus", "pcm"]), queues: { opus: [], pcm: [] }, sent: { opus: [], pcm: [] }, cursors: new Map(), pipes: {}, released: 0, timer: setInterval(() => tick(next), 5) };
          run = next;
          next.dispose = source.subscribe(event => {
            if (run !== next) return;
            if (event.type === "error") { fail(event.error); return; }
            if (event.type === "reset") {
              next.queues = { opus: [], pcm: [] }; next.sent = { opus: [], pcm: [] };
              next.cursors.clear(); next.base = undefined; next.released = 0;
              each(session => session.sendStreamClear()); return;
            }
            if (!next.wires.has(event.wire)) return;
            if (next.base === undefined) {
              next.base = event.at;
              for (const member of members) begin(member.deviceId);
            }
            if (event.at <= serverNowUs()) return; // Missed input is silence, never a new audience deadline.
            next.queues[event.wire].push({ offset: event.at - next.base, duration: event.duration, data: event.data });
            // Relaxed's one-second lead can retain >200 small PCM blocks already sent.
            if (next.queues[event.wire].length + (current.intent === "live" ? next.sent[event.wire].length : 0) > 200) fail("Captured audio exceeded its bounded queue.");
            else if (current.intent === "live") tick(next);
          });
          report(); return;
        }
        input ??= audioInput(inputUrl, Object.fromEntries(headers), signal, !!current.publicNetwork, true, undefined,
          { audioSelection: current.audioSelection, audioTrack: current.audioTrack, audioLanguage: current.preferences?.audioLanguage });
        ffmpeg = options.ffmpeg ? options.ffmpeg().then(selected => typeof selected === "string" ? { path: selected, release() {} } : selected) : useHelper("ffmpeg");
        const [{ source, hls, audioStream = 0, audioSelection }, executable] = await Promise.all([input, ffmpeg]).catch(error => { input = undefined; throw error; });
        if (current.publicNetwork) proxy = await createPublicMediaProxy(new AbortController().signal, current.source);
        if (attempt !== generation) { await proxy?.close(); return; }
        if (audioSelection) state = { ...state, tracks: [{ ...audioSelection, id: `audio-${audioSelection.index}`, kind: "audio", selected: true }] };
        if (/^https?:/.test(source) && new URL(source).origin !== new URL(credentialOrigin).origin) stripCrossOriginHeaders(headers);
        const wires = new Set<Wire>(members.flatMap(member => { const session = listening(member.deviceId), wire = session && wireOf(session); return wire ? [wire] : []; }));
        if (!wires.size) wires.add("opus");
        const speed = state.speed ?? 1, start = state.position, live = !!current.live && !current.radio;
        const seek = start > 0 && !current.radio && !live && (state.duration !== null || !!current.startPosition);
        // A live run keeps the source's timestamps and prints its first one (ashowinfo, on one wire only).
        const compressed = current.compressor?.enabled && !current.liveSourceId;
        const graph = `[0:a:${audioStream}]${[...live ? ["ashowinfo"] : [], ...speed === 1 ? [] : [tempo(speed)], "aresample=48000", "aformat=channel_layouts=stereo", ...compressed ? [compressorFilter(current.compressor!)] : [], ...wires.size > 1 ? [`asplit=${wires.size}`] : []].join(",")}${[...wires].map(wire => `[${wire}]`).join("")}`;
        const shape = (wire: Wire, first: boolean) => {
          if (graph) return ["-map", `[${wire}]`, "-vn", "-sn", "-dn", "-ar", "48000", "-ac", "2"];
          const filters = [...live && first ? ["ashowinfo"] : [], ...speed === 1 ? [] : [tempo(speed)]];
          return ["-map", `0:a:${audioStream}`, "-vn", "-sn", "-dn", ...filters.length ? ["-af", filters.join(",")] : [], "-ar", "48000", "-ac", "2"];
        };
        // Network protocols only, and a 10 s timeout on every read (#644 FFmpeg safety).
        const child = spawn(executable.path, ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-protocol_whitelist", "http,https,tcp,tls,crypto,httpproxy", "-rw_timeout", "10000000",
          ...proxy ? ["-http_proxy", proxy.url, "-format_whitelist", "aac,ac3,aiff,ape,asf,flac,flv,hls,matroska,webm,mov,mp3,mpeg,mpegts,ogg,wav,wv"] : [],
          ...[...headers].length ? ["-headers", [...headers].map(([name, value]) => `${name}: ${value}\r\n`).join("")] : [],
          // Start live HLS at its newest complete segment and avoid probing ahead
          // through several seconds before anchoring the shared playback clock.
          ...live && hls ? ["-live_start_index", "-1", "-probesize", "32768", "-analyzeduration", "100000"] : [],
          ...live ? ["-copyts"] : [], ...seek ? ["-ss", String(start)] : [], "-i", source,
          ...graph ? ["-filter_complex", graph] : [],
          ...wires.has("opus") ? [...shape("opus", true), "-c:a", "libopus", "-b:a", "96k", "-frame_duration", "60", "-f", "ogg", "-page_duration", "60000", "pipe:1"] : [],
          ...wires.has("pcm") ? [...shape("pcm", !wires.has("opus")), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:3"] : []], { stdio: ["ignore", "pipe", "pipe", "pipe"], ...(proxy ? { env: { ...process.env, http_proxy: proxy.url, https_proxy: proxy.url, HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, all_proxy: "", ALL_PROXY: "", no_proxy: "", NO_PROXY: "" } } : {}) });
        child.once("close", executable.release);
        ffmpeg = undefined; // The child owns the lease until its process and pipes close.
        if (proxy) { const activeProxy = proxy; child.once("close", () => { void activeProxy.close(); }); }
        const next: Run = { child, start, live, anchored: !live, speed, wires, queues: { opus: [], pcm: [] }, sent: { opus: [], pcm: [] }, cursors: new Map(), pipes: {}, released: 0, timer: setInterval(() => tick(next), 20) };
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
      } finally { await ffmpeg?.then(using => using.release(), () => {}); }
    };
    // Sends every chunk that is due to every speaker on its wire: one write per speaker.
    const tick = (current: Run) => {
      const now = serverNowUs();
      for (const session of current.cursors.keys()) if (sessions.get(session.getClientId()!) !== session) current.cursors.delete(session);
      if (current.timelineOnly) {
        const ended = state.duration !== null && position() >= state.duration;
        const status = ended ? "ended" : now >= current.base! ? "playing" : "loading";
        if (status !== state.status || Date.now() - reportedAt >= 1000) { state = { ...state, status, buffering: false }; report(); }
        if (ended) { const at = position(); halt(true); state = { ...state, position: at }; }
        return;
      }
      const first = Math.min(...Object.values(current.queues).map(list => list[0]?.offset ?? Infinity));
      if (current.base === undefined) {
        if (first === Infinity || !current.anchored) return;
        // Chunk timestamps are shared by the group; each player adds its own delay.
        const delay = Math.max(0, ...members.map(member => delays.get(member.deviceId) ?? 0)) * 1000;
        current.base = now + leadUs + delay - first;
        for (const member of members) begin(member.deviceId);
        if (run !== current) return;
      } else if (!current.fixed && first !== Infinity && current.base + first < now + leadUs / 2) {
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
          if (current.fixed && at <= now) continue;
          sent.push({ at, end: at + chunk.duration, data: chunk.data });
          current.released = Math.max(current.released, chunk.offset + chunk.duration);
        }
        // Each speaker gets what fits its buffer_capacity: the bytes of chunks it holds that have not played,
        // with their 13-byte headers (Sendspin Player Buffer Accounting).
        each(session => {
          const from = current.cursors.get(session);
          if (wireOf(session) !== wire || from === undefined) return;
          const socket = socketOf.get(session);
          if (socket && socket.bufferedAmount > (current.fixed ? 64 * 1024 : 1024 * 1024)) {
            receiverErrors.set(session.getClientId()!, { group: id, error: "This output's connection cannot keep up with audio." });
            current.cursors.delete(session); socket.close(1013, "Audio output is too slow"); options.changed(); return;
          }
          const capacity = session.getPlayerBufferCapacity() || 1024 * 1024;
          let held = 0;
          for (const chunk of sent) {
            if (chunk.at <= from) { held += chunk.data.length + 13; continue; }
            if (held + chunk.data.length + 13 > capacity) break;
            session.sendPcmAudioFrame({ data: chunk.data, timestampUs: chunk.at });
            held += chunk.data.length + 13;
            current.cursors.set(session, chunk.at);
          }
        });
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
          if (expected.get(member.deviceId)?.group === id) expected.delete(member.deviceId);
          clearAdmission(member.deviceId); clearReceiverError(member.deviceId);
          for (const session of run?.cursors.keys() ?? []) if (session.getClientId() === member.deviceId) {
            run!.cursors.delete(session); session.sendStreamEnd(); session.sendGroupUpdate(PlaybackStateType.STOPPED, id, options.name);
          }
          select(member.deviceId);
        }
        for (const member of next) {
          expected.set(member.deviceId, { group: id, receiverId: member.receiverId });
          select(member.deviceId);
          const session = sessions.get(member.deviceId), old = before.find(item => item.deviceId === member.deviceId);
          if (session && old?.level !== member.level) session.sendServerCommand({ player: { command: PlayerCommand.VOLUME, volume: member.level } });
          begin(member.deviceId);
        }
        options.changed();
        if (run && !load?.liveSourceId && load?.hasAudio !== false && !!before.length !== !!next.length) { void restart(); return; }
        if (state.playbackId) report();
      },
      joined(clientId: string) {
        if (screens.includes(clientId)) watch(clientId);
        const member = members.find(item => item.deviceId === clientId);
        if (!member) return;
        sessions.get(clientId)?.sendServerCommand({ player: { command: PlayerCommand.VOLUME, volume: member.level } });
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
              tracks: load.hasAudio === false ? [] : [{ id: `audio-${load.audioSelection?.index ?? load.audioTrack ?? 0}`, index: load.audioSelection?.index ?? load.audioTrack ?? 0, kind: "audio", label: load.audioSelection?.label ?? "Audio", language: load.audioSelection?.language ?? "", selected: true }] };
            for (const member of members) begin(member.deviceId);
            if (command.paused) report(); else void start();
            break;
          case "pause": if (command.paused) pause(); else if (state.status === "paused") void start(); break;
          case "audioPause": pause(); break;
          case "seek": halt(); state = { ...state, position: command.position }; if (state.status === "paused") report(); else void start(); break;
          case "speed": { const at = position(), paused = state.status === "paused"; halt(); state = { ...state, position: at, speed: command.speed }; if (paused) report(); else void start(); break; }
          case "compressor":
            if (!load || load.liveSourceId) break;
            load = { ...load, compressor: command.settings };
            if (state.status === "playing" || state.status === "loading") void restart();
            break;
          case "stop": halt(true); load = undefined; state = idle(); report(); break;
        }
      },
      close() { halt(true); groups.delete(synced); for (const member of members) { if (expected.get(member.deviceId)?.group === id) expected.delete(member.deviceId); clearAdmission(member.deviceId); clearReceiverError(member.deviceId); select(member.deviceId); } },
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
        const session = core.getSessionBySocket(socket)!;
        socketOf.set(session, socket);
        socket.once("close", () => socketOf.delete(session));
        session.handleText(String(data));
      });
    },
    group,
    // A speaker's own delay, which its player applies and keeps (Sendspin static delay). Core saves its last
    // report, so it shows across disconnects and restarts until the speaker reports again.
    delay: (clientId: string) => delays.get(clientId) ?? options.savedDelay?.(clientId) ?? (sessions.has(clientId) ? 0 : undefined),
    connected: (clientId: string) => sessions.has(clientId),
    setDelay(clientId: string, delay: number) { sessions.get(clientId)?.sendServerCommand({ player: { command: PlayerCommand.SET_STATIC_DELAY, static_delay_ms: delay } }); },
    drop(clientId: string) { for (const socket of sockets) if (core.getSessionBySocket(socket)?.getClientId() === clientId) socket.terminate(); },
    status: () => ({ clients: [...sessions.keys()], timings: [...sessions].map(([id, session]) => [id, session.getPlayerTiming().requiredLeadTimeMs]), delays: [...delays], receivers: [...receiverErrors].map(([clientId, value]) => [clientId, value.error]), admissions: [...admissions], sources: [...sources].map(([id, source]) => [id, source.error()]) }),
    registerSource(id: string, policy: CapturePolicy) {
      if (sources.has(id)) return;
      sources.set(id, createScheduledCapture(policy, options.ffmpeg ?? (() => useHelper("ffmpeg")), error => { options.sourceFailed?.(id, error); options.changed(); }));
    },
    writeSource(id: string, packet: CaptureAudioPacket) { return sources.get(id)?.write(packet) ?? false; },
    endSource(id: string) { sources.get(id)?.close(); sources.delete(id); },
    hasSource: (id: string) => sources.has(id),
    sourceError: (id: string) => sources.get(id)?.error(),
    receiverError: (id: string, _intent?: string) => receiverErrors.get(id)?.error,
    close() { for (const source of sources.values()) source.close(); sources.clear(); for (const socket of sockets) socket.terminate(); },
  };
}
