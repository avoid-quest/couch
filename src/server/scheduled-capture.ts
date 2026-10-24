import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { createCaptureClock, type CaptureAudioPacket, type CapturePolicy } from "./capture-audio";
import { oggPackets, opusDuration } from "./audio-packets";

type Event = { type: "chunk"; wire: "opus" | "pcm"; at: number; duration: number; data: Buffer } | { type: "reset" } | { type: "error"; error: string };
// Streaming IEEE-float WAV: normalized 48 kHz stereo, unknown RIFF/data/sample
// lengths. Non-PCM has WAVEFORMATEX's empty extension and a fact sample count.
function captureWaveHeader() {
  const header = Buffer.alloc(58);
  header.write("RIFF", 0); header.writeUInt32LE(0xffffffff, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(18, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(384000, 28);
  header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34); // cbSize at 36 is zero.
  header.write("fact", 38); header.writeUInt32LE(4, 42); header.writeUInt32LE(0xffffffff, 46);
  header.write("data", 50); header.writeUInt32LE(0xffffffff, 54);
  return header;
}
/** One normalized capture and Opus encoder, shared by all of this publication's consumers. */
export function createScheduledCapture(policy: CapturePolicy, ffmpeg: () => Promise<string>, failed: (error: string) => void) {
  const clock = createCaptureClock(policy), listeners = new Set<(event: Event) => void>();
  let child: ChildProcessWithoutNullStreams | undefined, starting = false, closed = false, generation = 0;
  let error: string | undefined, baseUs = 0, offsetUs = 0, lateUs = 0;
  let pending: { at: number; pcm: Float32Array }[] = [], queuedFrames = 0;
  const emit = (event: Event) => { for (const listener of listeners) listener(event); };
  const fail = (message: string) => {
    if (closed || error) return;
    error = message; child?.kill("SIGKILL"); child = undefined; pending = []; queuedFrames = 0;
    emit({ type: "error", error }); failed(error);
  };
  const write = (block: { at: number; pcm: Float32Array }) => {
    if (!child || error) return;
    if (child.stdin.writableLength > 48_000 * 8 * .2) return fail("The audio encoder cannot keep up with capture.");
    child.stdin.write(Buffer.from(block.pcm.buffer, block.pcm.byteOffset, block.pcm.byteLength));
    if (policy.intent !== "live") {
      const pcm = Buffer.alloc(block.pcm.length * 2);
      for (let i = 0; i < block.pcm.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(block.pcm[i]! * 32768))), i * 2);
      emit({ type: "chunk", wire: "pcm", at: block.at, duration: block.pcm.length / 2 / 48_000 * 1e6, data: pcm });
    }
  };
  const start = async () => {
    starting = true;
    const attempt = generation;
    try {
      const executable = await ffmpeg();
      if (closed || error || attempt !== generation) return;
      // Raw PCM's demuxer batches 4096 frames (85 ms). WAV's documented max_size
      // bounds input packets to the existing 480-frame/10 ms Opus cadence.
      // https://ffmpeg.org/ffmpeg-formats.html#wav
      const process = child = spawn(executable, ["-hide_banner", "-loglevel", "error", "-nostdin", "-probesize", "32", "-analyzeduration", "0", "-f", "wav", "-ignore_length", "1", "-max_size", "3840", "-i", "pipe:0", "-c:a", "libopus", "-application", "lowdelay", "-b:a", "128k", "-frame_duration", "10", "-f", "ogg", "-page_duration", "10000", "-flush_packets", "1", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
      baseUs = pending[0]!.at; offsetUs = lateUs = 0;
      process.stdout.on("data", oggPackets(packet => {
        if (child !== process) return;
        const magic = packet.toString("latin1", 0, 8);
        if (magic === "OpusHead") { offsetUs = -packet.readUInt16LE(10) / 48_000 * 1e6; return; }
        if (magic === "OpusTags") return;
        const duration = opusDuration(packet), at = Math.round(baseUs + offsetUs);
        offsetUs += duration;
        // Startup/probe delays and late data are not repaired by moving healthy listeners.
        if (at <= serverNowUs()) {
          lateUs += duration;
          if (lateUs >= 500_000) fail("The audio encoder missed half a second of capture deadlines. Start sharing again.");
          return;
        }
        lateUs = 0;
        emit({ type: "chunk", wire: "opus", at, duration, data: packet });
      }));
      let diagnostic = "";
      process.stderr.on("data", (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-1024); });
      process.stdin.on("error", () => { if (child === process) fail("The capture encoder stopped accepting audio."); });
      process.on("error", () => { if (child === process) fail("Couch could not start the capture encoder."); });
      process.on("close", () => { if (child === process) fail(`The capture encoder stopped. ${diagnostic.trim()}`); });
      process.stdin.write(captureWaveHeader());
      for (const block of pending) write(block);
      pending = []; queuedFrames = 0;
    } catch (reason) { if (attempt === generation) fail(reason instanceof Error ? reason.message : "Capture encoding failed."); }
    finally { if (attempt === generation) starting = false; }
  };
  return {
    write(packet: CaptureAudioPacket) {
      if (closed || error) return false;
      try {
        const normalized = clock.push(packet, serverNowUs());
        if (normalized.reset) {
          generation++; const old = child; child = undefined; old?.kill("SIGKILL");
          pending = []; queuedFrames = 0; starting = false; emit({ type: "reset" });
        }
        const block = { at: normalized.atUs, pcm: normalized.pcm };
        if (!block.pcm.length) return true;
        if (child) write(block);
        else {
          queuedFrames += block.pcm.length / 2;
          if (queuedFrames > 48_000 * 2) throw new Error("The capture encoder did not start within two seconds.");
          pending.push(block);
          if (!starting) void start();
        }
        return !error;
      } catch (reason) { fail(reason instanceof Error ? reason.message : "Invalid capture audio."); return false; }
    },
    subscribe(listener: (event: Event) => void) {
      listeners.add(listener);
      if (error) queueMicrotask(() => { if (listeners.has(listener)) listener({ type: "error", error: error! }); });
      return () => { listeners.delete(listener); };
    },
    error: () => error,
    close() { closed = true; generation++; const old = child; child = undefined; old?.kill("SIGKILL"); pending = []; listeners.clear(); },
  };
}
