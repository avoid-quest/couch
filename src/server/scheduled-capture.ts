import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { validateCapturePacket, type CaptureAudioPacket } from "./capture-audio";
import { oggPackets, opusDuration } from "./audio-packets";

export type Ffmpeg = () => Promise<string | { path: string; release: () => void }>;
type Event = { type: "chunk"; wire: "opus" | "pcm"; at: number; duration: number; data: Buffer } | { type: "reset" } | { type: "error"; error: string };

// Streaming IEEE float WAV declares the acquired format and lets the demuxer
// emit ordinary-sized packets instead of raw PCM's fixed 4096-frame reads.
function captureWaveHeader(sampleRate: number, channels: number) {
  const header = Buffer.alloc(58), alignment = channels * 4;
  header.write("RIFF", 0); header.writeUInt32LE(0xffffffff, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(18, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * alignment, 28);
  header.writeUInt16LE(alignment, 32); header.writeUInt16LE(32, 34);
  header.write("fact", 38); header.writeUInt32LE(4, 42); header.writeUInt32LE(0xffffffff, 46);
  header.write("data", 50); header.writeUInt32LE(0xffffffff, 54);
  return header;
}

/** Native/browser float PCM -> standard Sendspin formats. FFmpeg owns sample conversion and encoding. */
export function createScheduledCapture(ffmpeg: Ffmpeg, failed: (error: string) => void) {
  const listeners = new Set<(event: Event) => void>();
  let child: ChildProcess | undefined, starting = false, closed = false, attempt = 0, error: string | undefined;
  let format: CaptureAudioPacket | undefined, nextSample = 0, sequence = -1;
  let pending: CaptureAudioPacket[] = [], queuedBytes = 0;
  let anchors: { offset: number; at: number }[] = [];
  const emit = (event: Event) => { for (const listener of listeners) listener(event); };
  const fail = (message: string) => {
    if (closed || error) return;
    error = message; child?.kill("SIGKILL"); child = undefined; pending = []; anchors = [];
    emit({ type: "error", error }); failed(error);
  };
  // Map encoded sample offsets back to actual capture blocks. A nominal sample
  // timeline alone drifts away from the input's hardware clock over a long share.
  const capturedAt = (offset: number) => {
    const anchor = anchors.findLast(block => block.offset <= offset) ?? anchors[0]!;
    return Math.round(anchor.at + offset - anchor.offset);
  };
  const write = (packet: CaptureAudioPacket) => {
    const stdin = child!.stdin!;
    if (stdin.writableLength > packet.sampleRate * packet.channels * 4 * 2) return fail("The capture encoder cannot keep up with audio.");
    stdin.write(Buffer.from(packet.pcm.buffer, packet.pcm.byteOffset, packet.pcm.byteLength));
  };
  const start = async () => {
    starting = true;
    const generation = attempt, input = format!;
    let lease: { path: string; release(): void } | undefined;
    try {
      const selected = await ffmpeg();
      lease = typeof selected === "string" ? { path: selected, release() {} } : selected;
      if (closed || error || generation !== attempt) return;
      const process = child = spawn(lease.path, ["-hide_banner", "-loglevel", "error", "-nostdin",
        "-probesize", "32", "-analyzeduration", "0", "-f", "wav", "-ignore_length", "1",
        "-max_size", String(input.sampleRate * input.channels * 4 / 200), "-i", "pipe:0",
        "-filter_complex", "[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[opus][pcm]",
        "-map", "[opus]", "-c:a", "libopus", "-application", "lowdelay", "-b:a", "160k", "-frame_duration", "5", "-f", "ogg", "-page_duration", "5000", "-flush_packets", "1", "pipe:1",
        "-map", "[pcm]", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:3"], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
      process.once("close", lease.release); lease = undefined;
      let opusOffset = 0, pcmOffset = 0, diagnostic = "", pcm: Buffer = Buffer.alloc(0);
      const output = (wire: "opus" | "pcm", offset: number, duration: number, data: Buffer) => {
        if (child !== process) return;
        emit({ type: "chunk", wire, at: capturedAt(offset), duration, data });
        // Both outputs may be buffered independently; retain the block that covers
        // the earlier cursor and the blocks after it, rather than a clock estimator.
        const through = Math.min(opusOffset, pcmOffset);
        while (anchors[1] && anchors[1].offset <= through) anchors.shift();
      };
      process.stdout!.on("data", oggPackets(packet => {
        if (child !== process) return;
        const magic = packet.toString("latin1", 0, 8);
        if (magic === "OpusHead") { opusOffset = -packet.readUInt16LE(10) / 48_000 * 1e6; return; }
        if (magic === "OpusTags") return;
        const duration = opusDuration(packet);
        output("opus", opusOffset, duration, packet); opusOffset += duration;
      }));
      (process.stdio[3] as Readable).on("data", (bytes: Buffer) => {
        if (child !== process) return;
        pcm = Buffer.concat([pcm, bytes]);
        const size = 960; // 5 ms: a chunk is sent only once it is full.
        while (pcm.length >= size) {
          output("pcm", pcmOffset, 5_000, pcm.subarray(0, size));
          pcmOffset += 5_000; pcm = pcm.subarray(size);
        }
      });
      process.stderr!.on("data", data => { diagnostic = (diagnostic + String(data)).slice(-1024); });
      (process.stdin as Writable).on("error", () => { if (child === process) fail("The capture encoder stopped accepting audio."); });
      process.on("error", () => { if (child === process) fail("Couch could not start the capture encoder."); });
      process.on("close", () => { if (child === process) fail(`The capture encoder stopped. ${diagnostic.trim()}`); });
      process.stdin!.write(captureWaveHeader(input.sampleRate, input.channels));
      for (const packet of pending) write(packet);
      pending = []; queuedBytes = 0;
    } catch (reason) { if (generation === attempt) fail(reason instanceof Error ? reason.message : "Capture encoding failed."); }
    finally { lease?.release(); if (generation === attempt) starting = false; }
  };
  return {
    write(packet: CaptureAudioPacket) {
      if (closed || error) return false;
      try {
        validateCapturePacket(packet);
        if (format?.generation !== packet.generation) {
          if (packet.sequence !== 0 || packet.samplePosition !== 0) throw new Error("A capture generation must start at sample zero.");
          attempt++; const old = child; child = undefined; old?.kill("SIGKILL");
          format = packet; sequence = -1; nextSample = 0; pending = []; anchors = []; queuedBytes = 0; starting = false;
          emit({ type: "reset" });
        }
        if (packet.sampleRate !== format!.sampleRate || packet.channels !== format!.channels) throw new Error("Capture format changed without a new generation.");
        const gap = packet.samplePosition - nextSample;
        if (packet.sequence <= sequence || gap < 0 || gap > packet.sampleRate * .04) throw new Error("Capture samples are missing or out of order.");
        const blocks = gap ? [{ ...packet, samplePosition: nextSample, capturedAtUs: packet.capturedAtUs - gap / packet.sampleRate * 1e6,
          pcm: new Float32Array(gap * packet.channels) }, packet] : [packet];
        sequence = packet.sequence; nextSample = packet.samplePosition + packet.pcm.length / packet.channels;
        for (const block of blocks) {
          anchors.push({ offset: block.samplePosition / block.sampleRate * 1e6, at: block.capturedAtUs });
          if (anchors.length > 4096) throw new Error("The capture encoder cannot keep up with audio.");
          if (child) write(block);
          else {
            queuedBytes += block.pcm.byteLength;
            if (queuedBytes > packet.sampleRate * packet.channels * 4 * 2) throw new Error("The capture encoder did not start.");
            pending.push(block);
            if (!starting) void start();
          }
        }
        return !closed && !error;
      } catch (reason) { fail(reason instanceof Error ? reason.message : "Invalid capture audio."); return false; }
    },
    subscribe(listener: (event: Event) => void) {
      listeners.add(listener);
      if (error) queueMicrotask(() => { if (listeners.has(listener)) listener({ type: "error", error: error! }); });
      return () => { listeners.delete(listener); };
    },
    error: () => error,
    close() { closed = true; attempt++; const old = child; child = undefined; old?.kill("SIGKILL"); pending = []; anchors = []; listeners.clear(); },
  };
}
