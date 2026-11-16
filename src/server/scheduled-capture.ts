import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { validateCapturePacket, type CaptureAudioPacket } from "./capture-audio";
import { opusDuration, tsOpusPackets } from "./audio-packets";

export type Ffmpeg = () => Promise<string | { path: string; release: () => void }>;
type Event =
  | { type: "chunk"; wire: "opus" | "pcm"; at: number; duration: number; data: Buffer }
  | { type: "reset" }
  | { type: "error"; error: string };

// Streaming IEEE float WAV declares the acquired format and lets the demuxer
// emit ordinary-sized packets instead of raw PCM's fixed 4096-frame reads.
function captureWaveHeader(sampleRate: number, channels: number) {
  const header = Buffer.alloc(58),
    alignment = channels * 4;
  header.write("RIFF", 0);
  header.writeUInt32LE(0xffffffff, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(18, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * alignment, 28);
  header.writeUInt16LE(alignment, 32);
  header.writeUInt16LE(32, 34);
  header.write("fact", 38);
  header.writeUInt32LE(4, 42);
  header.writeUInt32LE(0xffffffff, 46);
  header.write("data", 50);
  header.writeUInt32LE(0xffffffff, 54);
  return header;
}

// Live frames are the spec's size: chunks of at least 15 ms (Opus has no 15 ms frame; it takes 2.5,
// 5, 10, 20, 40 or 60). 5 ms frames cost a frame's fill less, but three or four times the packets and encrypted
// writes per listener, and the player's per-chunk sync correction as much more often, which smears the sound.
const liveFrameMs = { opus: 20, pcm: 15 };
// Couch reads the Opus stream from the one MPEG-TS PID it asks FFmpeg for.
const opusPid = 0x100;

/** Native/browser float PCM -> standard Sendspin formats. FFmpeg owns sample conversion and encoding. */
export function createScheduledCapture(
  ffmpeg: Ffmpeg,
  failed: (error: string) => void,
  childStarted?: (child: ChildProcess) => void,
  relaxed = false,
) {
  // Live sends each frame as soon as it is encoded. A relaxed capture plays a second or more late,
  // so it uses the relaxed decoder's chunks (scheduled-audio.ts): 60 ms Opus frames, the longest
  // Opus has, and 100 ms of PCM: far fewer writes per speaker than Live's.
  const opusMs = relaxed ? 60 : liveFrameMs.opus,
    pcmMs = relaxed ? 100 : liveFrameMs.pcm;
  const listeners = new Set<(event: Event) => void>();
  let child: ChildProcess | undefined,
    starting = false,
    closed = false,
    attempt = 0,
    error: string | undefined;
  let format: CaptureAudioPacket | undefined,
    nextSample = 0,
    sequence = -1;
  let pending: CaptureAudioPacket[] = [],
    queuedBytes = 0;
  let anchors: { offset: number; at: number }[] = [];
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event);
  };
  const fail = (message: string) => {
    if (closed || error) return;
    error = message;
    child?.kill("SIGKILL");
    child = undefined;
    pending = [];
    anchors = [];
    emit({ type: "error", error });
    failed(error);
  };
  // Map encoded sample offsets back to actual capture blocks. A nominal sample
  // timeline alone drifts away from the input's hardware clock over a long share.
  const capturedAt = (offset: number) => {
    const anchor = anchors.findLast((block) => block.offset <= offset) ?? anchors[0]!;
    return Math.round(anchor.at + offset - anchor.offset);
  };
  const write = (packet: CaptureAudioPacket) => {
    const stdin = child!.stdin!;
    if (stdin.writableLength > packet.sampleRate * packet.channels * 4 * 2)
      return fail("The capture encoder cannot keep up with audio.");
    stdin.write(Buffer.from(packet.pcm.buffer, packet.pcm.byteOffset, packet.pcm.byteLength));
  };
  const start = async () => {
    starting = true;
    const generation = attempt,
      input = format!;
    let lease: { path: string; release(): void } | undefined;
    try {
      const selected = await ffmpeg();
      lease = typeof selected === "string" ? { path: selected, release() {} } : selected;
      if (closed || error || generation !== attempt) return;
      const process = (child = spawn(
        lease.path,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-probesize",
          "32",
          "-analyzeduration",
          "0",
          "-f",
          "wav",
          "-ignore_length",
          "1",
          "-max_size",
          String((input.sampleRate * input.channels * 4) / 200),
          "-i",
          "pipe:0",
          "-filter_complex",
          "[0:a]aresample=48000:filter_size=64,aformat=channel_layouts=stereo,asplit=2[opus][pcm]",
          "-map",
          "[opus]",
          "-c:a",
          "libopus",
          ...(relaxed ? [] : ["-application", "lowdelay"]),
          "-b:a",
          "160k",
          "-frame_duration",
          String(opusMs),
          // MPEG-TS, not Ogg: FFmpeg's Ogg muxer holds each page until the next one, a whole frame.
          // Each packet gets its own PES; the default gathers 2930 bytes (100+ ms) first.
          "-f",
          "mpegts",
          "-mpegts_start_pid",
          String(opusPid),
          "-pes_payload_size",
          "0",
          "-flush_packets",
          "1",
          "pipe:1",
          "-map",
          "[pcm]",
          "-c:a",
          "pcm_s16le",
          "-f",
          "s16le",
          "pipe:3",
        ],
        { stdio: ["pipe", "pipe", "pipe", "pipe"] },
      ));
      childStarted?.(process);
      process.once("close", lease.release);
      lease = undefined;
      let opusOffset = 0,
        pcmOffset = 0,
        diagnostic = "",
        pcm: Buffer = Buffer.alloc(0);
      const output = (wire: "opus" | "pcm", offset: number, duration: number, data: Buffer) => {
        if (child !== process) return;
        emit({ type: "chunk", wire, at: capturedAt(offset), duration, data });
        // Both outputs may be buffered independently; retain the block that covers
        // the earlier cursor and the blocks after it, rather than a clock estimator.
        const through = Math.min(opusOffset, pcmOffset);
        while (anchors[1] && anchors[1].offset <= through) anchors.shift();
      };
      const packets = tsOpusPackets(opusPid, (packet, trim) => {
        if (child !== process) return;
        // The first packet's start trim is the encoder's pre-skip: its first samples precede the input.
        if (trim) opusOffset = (-trim / 48_000) * 1e6;
        const duration = opusDuration(packet);
        output("opus", opusOffset, duration, packet);
        opusOffset += duration;
      });
      process.stdout!.on("data", (data: Buffer) => {
        if (child !== process) return;
        try {
          packets(data);
        } catch (error) {
          fail(
            error instanceof Error ? error.message : "The capture encoder sent a broken stream.",
          );
        }
      });
      (process.stdio[3] as Readable).on("data", (bytes: Buffer) => {
        if (child !== process) return;
        pcm = Buffer.concat([pcm, bytes]);
        const size = pcmMs * 192; // 48 kHz 16-bit stereo; a chunk is sent only once it is full.
        while (pcm.length >= size) {
          output("pcm", pcmOffset, pcmMs * 1000, pcm.subarray(0, size));
          pcmOffset += pcmMs * 1000;
          pcm = pcm.subarray(size);
        }
      });
      process.stderr!.on("data", (data) => {
        diagnostic = (diagnostic + String(data)).slice(-1024);
      });
      (process.stdin as Writable).on("error", () => {
        if (child === process) fail("The capture encoder stopped accepting audio.");
      });
      process.on("error", () => {
        if (child === process) fail("Couch could not start the capture encoder.");
      });
      process.on("close", () => {
        if (child === process) fail(`The capture encoder stopped. ${diagnostic.trim()}`);
      });
      process.stdin!.write(captureWaveHeader(input.sampleRate, input.channels));
      for (const packet of pending) write(packet);
      pending = [];
      queuedBytes = 0;
    } catch (reason) {
      if (generation === attempt)
        fail(reason instanceof Error ? reason.message : "Capture encoding failed.");
    } finally {
      lease?.release();
      if (generation === attempt) starting = false;
    }
  };
  return {
    write(packet: CaptureAudioPacket) {
      if (closed || error) return false;
      try {
        validateCapturePacket(packet);
        if (format?.generation !== packet.generation) {
          if (packet.sequence !== 0 || packet.samplePosition !== 0)
            throw new Error("A capture generation must start at sample zero.");
          attempt++;
          const old = child;
          child = undefined;
          old?.kill("SIGKILL");
          format = packet;
          sequence = -1;
          nextSample = 0;
          pending = [];
          anchors = [];
          queuedBytes = 0;
          starting = false;
          emit({ type: "reset" });
        }
        if (packet.sampleRate !== format!.sampleRate || packet.channels !== format!.channels)
          throw new Error("Capture format changed without a new generation.");
        const gap = packet.samplePosition - nextSample;
        if (packet.sequence <= sequence || gap < 0 || gap > packet.sampleRate * 0.04)
          throw new Error("Capture samples are missing or out of order.");
        const blocks = gap
          ? [
              {
                ...packet,
                samplePosition: nextSample,
                capturedAtUs: packet.capturedAtUs - (gap / packet.sampleRate) * 1e6,
                pcm: new Float32Array(gap * packet.channels),
              },
              packet,
            ]
          : [packet];
        sequence = packet.sequence;
        nextSample = packet.samplePosition + packet.pcm.length / packet.channels;
        for (const block of blocks) {
          anchors.push({
            offset: (block.samplePosition / block.sampleRate) * 1e6,
            at: block.capturedAtUs,
          });
          if (anchors.length > 4096)
            throw new Error("The capture encoder cannot keep up with audio.");
          if (child) write(block);
          else {
            queuedBytes += block.pcm.byteLength;
            if (queuedBytes > packet.sampleRate * packet.channels * 4 * 2)
              throw new Error("The capture encoder did not start.");
            pending.push(block);
            if (!starting) void start();
          }
        }
        return !closed && !error;
      } catch (reason) {
        fail(reason instanceof Error ? reason.message : "Invalid capture audio.");
        return false;
      }
    },
    subscribe(listener: (event: Event) => void) {
      listeners.add(listener);
      if (error)
        queueMicrotask(() => {
          if (listeners.has(listener)) listener({ type: "error", error: error! });
        });
      return () => {
        listeners.delete(listener);
      };
    },
    fail,
    close() {
      closed = true;
      attempt++;
      const old = child;
      child = undefined;
      old?.kill("SIGKILL");
      pending = [];
      anchors = [];
      listeners.clear();
    },
  };
}
