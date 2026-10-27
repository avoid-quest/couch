import { readFileSync } from "node:fs";
import type { WebSocket, RawData } from "ws";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import opusFactory from "opusscript/build/opusscript_native_wasm.js";
import opusWasm from "opusscript/build/opusscript_native_wasm.wasm" with { type: "file" };
import { captureLeadUs, createCaptureClock, type CaptureAudioPacket } from "./capture-audio";
import { livePacket, opusCodec, pcmCodec } from "./live-packet";
import { createLeadController, type LeadListener, type LeadSnapshot, type LeadStats } from "./live-lead";
import type { LiveAudioSettings, LiveListenerStatus } from "../shared/protocol";

/*
 * Live audio listener contract (docs/live-audio.md). Times are microseconds on Core's audio worker clock
 * ("host clock"), positions are 48 kHz sample frames of the current capture generation.
 *
 * Endpoint: wss://<Couch>/api/live/listen?token=<paired token>&sourceId=<live source>. Hub accepts a
 * paired device (or the host token from this computer) whose Playback of that Live source plays its sound,
 * then proxies the socket into the audio worker. Unpaired: HTTP 401; not playing it: 403. Close codes:
 * 4001 removed by the host or unpaired (do not reconnect), 4002 fell behind (reconnect), 4003 replaced by
 * another window of the device, 1008 no longer playing that source, 1001 the share ended.
 *
 * Core → listener, binary: u8 codec (1 PCM, 2 Opus), u8 channels (2), u16 frames, u32 seq (per codec,
 * from 0 each session), f64 position, f64 captureUs (the first frame's capture time), then the payload:
 * interleaved s16le PCM (up to 128 frames) or one 2.5 ms Opus packet (RESTRICTED_LOWDELAY). An Opus
 * packet's position and captureUs are already moved back by the encoder's lookahead. Its deadline is
 * captureUs + the lead; a packet that can no longer make it is never sent. Core also sends WebSocket pings
 * every 100 ms, which browsers answer: a listener that leaves one unanswered for 0.5 s gets no audio until it
 * catches up, and after 2 s it is closed with 4002.
 * Core → listener, JSON:
 *   hello { leadMs, codec, opusFrames, session }: on connect and at each capture restart. A new session
 *     string means a new position timeline; a reconnect within one capture gets the same session.
 *   pong { t, s }: t echoes the ping, s is host time.
 *   lead { leadMs, atServerUs }: the shared lead changes from atServerUs (host time).
 *   lead-status { id, status, admission, needMs, startupNeedMs, debtMs, behindMs, requiredExtraMs, reason }:
 *     this listener's standing (warming, ok, limiting, behind, stale, removed) whenever it changes.
 *   dropped { reason }: then close 4001.
 * Listener → Core, JSON (at most 64 messages a second, 16 KiB each):
 *   ping { t }: any listener clock, echoed.
 *   stats { needMs?, leadMs?, deadlineMarginMinMs?, marginMinMs?, debtMs?, arrivalGapMaxMs?, headroomMinMs?,
 *     resyncs?, recovering?, missing?, concealEvents? }: one report per second at most; ms, each the worst of
 *     its interval; missing and concealEvents count that interval's gaps and concealments.
 */
export const pcmFrames = 128, opusFrames = 120;

// opusscript's own wrapper resolves its WASM from where it was installed, which a bundle cannot; this
// makes the same calls with the binary the bundle carries beside itself.
let opusModule: ReturnType<typeof opusFactory> | undefined;
export function createOpusEncoder(bitrate: number) {
  const native = opusModule ??= opusFactory({ wasmBinary: readFileSync(new URL(opusWasm, import.meta.url)) });
  const handler = new native.OpusScriptHandler(48_000, 2, 2051); // OPUS_APPLICATION_RESTRICTED_LOWDELAY
  const inputBytes = 2880 * 2 * 2, input = native._malloc(inputBytes), pcm = native.HEAPU16.subarray(input, input + inputBytes);
  const output = native._malloc(3828), lookahead = native._malloc(4);
  const control = (request: number, value: number) => { if (handler._encoder_ctl(request, value) < 0) throw new Error("The Opus encoder refused a setting."); };
  control(4002, bitrate); // OPUS_SET_BITRATE
  control(4027, lookahead); // OPUS_GET_LOOKAHEAD
  return {
    lookahead: native.HEAP32[lookahead >> 2]!,
    bitrate: (value: number) => control(4002, value),
    reset: () => control(4028, 0), // OPUS_RESET_STATE
    encode(frame: Buffer) {
      pcm.set(frame);
      const bytes = handler._encode(pcm.byteOffset, frame.length, output, frame.length / 4);
      if (bytes < 0) throw new Error("The Opus encoder failed.");
      return native.HEAPU8.subarray(output, output + bytes);
    },
    free() { native.OpusScriptHandler.destroy_handler(handler); for (const pointer of [input, output, lookahead]) native._free(pointer); },
  };
}

const finite = (value: unknown): value is number => Number.isFinite(value);
const reported = ["needMs", "leadMs", "deadlineMarginMinMs", "marginMinMs", "debtMs", "arrivalGapMaxMs", "headroomMinMs", "resyncs"] as const;
const count = (value: unknown) => finite(value) && value > 0 ? Math.floor(value) : 0;
const rounded = (value: number | null | undefined) => finite(value) ? Math.round(value) : null;
type Listener = { socket: WebSocket; lead?: LeadListener; signature?: string; gaps: number; concealments: number; marginMs: number | null; statsUs: number; windowUs: number; messages: number };
export type LiveTransportStatus = { leadMs: number; listeners: (LiveListenerStatus & { deviceId: string })[] };
// Fixed holds its lead exactly; the operator's bounds are Automatic's.
const leadPolicy = (settings: LiveAudioSettings) => settings.lead === "fixed" ? { fixed: true, minLeadMs: 0, maxLeadMs: Infinity }
  : { fixed: false, minLeadMs: settings.minLeadMs, maxLeadMs: settings.maxLeadMs, raiseForSlowest: settings.raiseForSlowest };

/** One Live source's stream: timestamped packets for each listener and the lead they share. */
export function createLiveTransport({ sourceId, epoch, settings, changed, log }: { sourceId: string; epoch: string; settings: LiveAudioSettings;
  changed: (status: LiveTransportStatus) => void; log: (line: string) => void }) {
  const lead = createLeadController({ initialLeadMs: settings.leadMs, ...leadPolicy(settings) });
  let name = settings.codec, codec = name === "opus" ? opusCodec : pcmCodec;
  let encoder = codec === opusCodec ? createOpusEncoder(settings.opusBitrate) : undefined;
  const listeners = new Map<string, Listener>(), opus = Buffer.alloc(opusFrames * 4);
  let generation: string | undefined, sessions = 0, session = `${epoch}:0`, seq = 0, published = "";
  let converter: ReturnType<typeof createCaptureClock> | undefined, converted = 0;
  let pendingFrames = 0, pendingPosition = 0, pendingUs = 0;
  // Capture → send age, logged per ten seconds as the evidence for the Main → Core hop.
  let ageMax = 0, ageTotal = 0, ages = 0, late = 0, windowUs = serverNowUs();
  const text = (socket: WebSocket, message: unknown) => { if (socket.readyState === 1) socket.send(JSON.stringify(message)); };
  const hello = (socket: WebSocket, us: number) => text(socket, { type: "hello", leadMs: lead.effectiveLeadMs(us), codec, opusFrames, session });

  const publish = () => {
    const snapshot = lead.current(serverNowUs());
    const status: LiveTransportStatus = { leadMs: Math.round(snapshot.leadMs), listeners: [...listeners].map(([deviceId, l]) => ({ deviceId, codec: name,
      status: l.lead?.status ?? "warming", latencyMs: rounded(l.lead?.needMs), marginMs: rounded(l.marginMs), gaps: l.gaps, concealments: l.concealments,
      behindMs: l.lead ? rounded(l.lead.behindMs) : 0 })) };
    const signature = JSON.stringify(status);
    if (signature !== published) { published = signature; changed(status); }
  };
  const apply = (snapshot: LeadSnapshot) => {
    for (const decision of snapshot.decisions) if (decision.type === "lead") log(`live ${sourceId.slice(0, 8)} lead ${decision.fromMs.toFixed(1)} → ${decision.leadMs} ms: ${decision.reason}`);
    if (snapshot.command) for (const l of listeners.values()) text(l.socket, snapshot.command);
    for (const status of snapshot.listeners) {
      const l = listeners.get(status.id);
      if (!l) continue;
      l.lead = status;
      const signature = JSON.stringify([status.status, status.reason, status.admission]);
      if (l.signature !== signature) { l.signature = signature; text(l.socket, { type: "lead-status", ...status }); }
    }
  };
  const tick = setInterval(() => { apply(lead.tick(serverNowUs())); publish(); }, 1000);
  tick.unref();

  const send = (packet: Buffer, captureUs: number) => {
    const now = serverNowUs(), age = now - captureUs;
    if (now - windowUs >= 10e6) {
      if (ages || late) log(`live ${sourceId.slice(0, 8)} send age ${name} max ${(ageMax / 1000).toFixed(2)} ms, mean ${(ageTotal / Math.max(1, ages) / 1000).toFixed(2)} ms over ${ages} packets${late ? `; ${late} past their deadline` : ""}`);
      ageMax = ageTotal = ages = late = 0; windowUs = now;
    }
    if (age >= lead.effectiveLeadMs(now) * 1000) { late++; return; }
    ageMax = Math.max(ageMax, age); ageTotal += age; ages++;
    for (const l of listeners.values()) if (l.socket.readyState === 1 && l.lead?.status !== "removed") l.socket.send(packet);
  };
  // A new position timeline: listeners start over from the next packet.
  const restart = () => {
    session = `${epoch}:${++sessions}`; seq = 0; pendingFrames = 0; encoder?.reset();
    const now = serverNowUs();
    for (const l of listeners.values()) hello(l.socket, now);
  };
  const s16 = (pcm: Float32Array, from: number, frames: number, into: Buffer, at = 0) => {
    for (let i = 0; i < frames * 2; i++) into.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[from * 2 + i]! * 32768))), (at * 2 + i) * 2);
    return into;
  };

  return {
    write(packet: CaptureAudioPacket) {
      // 48 kHz stereo keeps its own sample clock; listeners fit it. Other rates arrive resampled to 48 kHz.
      const raw = packet.sampleRate === 48_000 && packet.channels === 2, reset = packet.generation !== generation;
      if (reset) {
        generation = packet.generation; restart();
        converter = raw ? undefined : createCaptureClock({ intent: "live" }); converted = 0;
      }
      let position = packet.samplePosition, captureUs = packet.capturedAtUs, pcm = packet.pcm;
      if (converter) {
        const normalized = converter.push(packet, serverNowUs());
        position = converted; captureUs = normalized.atUs - captureLeadUs({ intent: "live" }); pcm = normalized.pcm; converted += pcm.length / 2;
      }
      const frames = pcm.length / 2;
      if (!encoder) {
        for (let at = 0; at < frames; at += pcmFrames) {
          const count = Math.min(pcmFrames, frames - at), atUs = captureUs + at / 48_000 * 1e6;
          send(livePacket(pcmCodec, count, seq++, position + at, atUs, s16(pcm, at, count, Buffer.allocUnsafe(count * 4))), atUs);
        }
        return;
      }
      // Opus frames are fixed; each one's time is its first sample's. A capture gap starts a new frame.
      if (pendingFrames && position !== pendingPosition + pendingFrames) pendingFrames = 0;
      for (let at = 0; at < frames;) {
        if (!pendingFrames) { pendingPosition = position + at; pendingUs = captureUs + at / 48_000 * 1e6; }
        const count = Math.min(opusFrames - pendingFrames, frames - at);
        s16(pcm, at, count, opus, pendingFrames); pendingFrames += count; at += count;
        if (pendingFrames < opusFrames) break;
        const atUs = pendingUs - encoder.lookahead / 48_000 * 1e6;
        send(livePacket(opusCodec, opusFrames, seq++, pendingPosition - encoder.lookahead, atUs, encoder.encode(opus)), atUs);
        pendingFrames = 0;
      }
    },
    accept(socket: WebSocket, deviceId: string) {
      listeners.get(deviceId)?.socket.close(4003, "This device is listening in another window.");
      const now = serverNowUs(), l: Listener = { socket, gaps: 0, concealments: 0, marginMs: null, statsUs: 0, windowUs: now, messages: 0 };
      listeners.set(deviceId, l);
      (socket as WebSocket & { _socket?: { setNoDelay(on: boolean): void } })._socket?.setNoDelay(true);
      socket.once("close", () => {
        if (listeners.get(deviceId) !== l) return;
        listeners.delete(deviceId); apply(lead.remove(deviceId, serverNowUs())); publish();
      });
      socket.on("message", (data: RawData, binary: boolean) => {
        const now = serverNowUs(), message = String(data);
        if (now - l.windowUs >= 1e6) { l.windowUs = now; l.messages = 0; }
        if (++l.messages > 64 || message.length > 16_384) return socket.close(1008, "This listener sent too much.");
        if (binary) return;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(message); } catch { return socket.close(1008, "Invalid listener message."); }
        if (parsed?.type === "ping" && finite(parsed.t)) text(socket, { type: "pong", t: parsed.t, s: now });
        else if (parsed?.type === "stats" && now - l.statsUs >= 500_000) {
          l.statsUs = now;
          const stats: LeadStats = { leadMs: lead.effectiveLeadMs(now), recovering: parsed.recovering === true };
          for (const key of reported) if (finite(parsed[key])) stats[key] = parsed[key];
          l.gaps += count(parsed.missing); l.concealments += count(parsed.concealEvents);
          if (finite(parsed.marginMinMs)) l.marginMs = parsed.marginMinMs;
          apply(lead.observe(deviceId, stats, now));
        }
      });
      const snapshot = lead.add(deviceId, now);
      hello(socket, now);
      if (snapshot.leadMs !== snapshot.effectiveLeadMs) text(socket, { type: "lead", leadMs: snapshot.leadMs, atServerUs: snapshot.atServerUs });
      apply(snapshot); publish();
    },
    // The operator's changes, live: the lead ramps, a bitrate applies to the next packet, and a codec starts a new session.
    configure(next: LiveAudioSettings) {
      apply(lead.configure({ ...leadPolicy(next), leadMs: next.leadMs }, serverNowUs()));
      if (next.codec !== name) {
        encoder?.free(); encoder = next.codec === "opus" ? createOpusEncoder(next.opusBitrate) : undefined;
        name = next.codec; codec = encoder ? opusCodec : pcmCodec;
        restart();
      } else if (next.opusBitrate !== settings.opusBitrate) encoder?.bitrate(next.opusBitrate);
      settings = next;
      publish();
    },
    // An operator's removal: only this removes a listener.
    drop(deviceId: string, reason = "Removed by the host.") {
      const l = listeners.get(deviceId);
      if (!l) return;
      apply(lead.drop(deviceId, serverNowUs(), reason));
      text(l.socket, { type: "dropped", reason }); l.socket.close(4001, reason);
    },
    close() {
      clearInterval(tick); encoder?.free();
      for (const l of listeners.values()) l.socket.close(1001, "This live audio ended.");
      listeners.clear();
    },
  };
}
