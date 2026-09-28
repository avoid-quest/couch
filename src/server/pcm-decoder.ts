import { createServer, Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { PlaybackCommand } from "../shared/protocol";
import { PlaybackError } from "./messages";
type Load = Extract<PlaybackCommand, { type: "load" }> & { duration?: number };
const blockBytes = 3840;

export function validatePcmSource(command: Load) {
  const source = command.audioSource ?? command.source;
  let url: URL;
  try { url = new URL(source); } catch { throw new PlaybackError("Choose one device for this source. Playing on several devices requires an HTTP audio source."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f\\]/.test(source)) throw new PlaybackError("Choose one device for this source. Playing on several devices requires an HTTP audio source without embedded credentials.");
  if (command.segment || command.subtitles?.length && !command.playbackOwner || command.preferences?.replayGain && command.preferences.replayGain !== "off" || command.audioOutput || command.preferences?.audioDelay) throw new PlaybackError("Choose one device for this source. Its playback features aren't supported on several devices.");
  let headers = "";
  for (const [name, value] of Object.entries(command.headers ?? {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid audio source headers.");
    headers += `${name}: ${value}\r\n`;
  }
  if (headers.length > 16_384) throw new Error("Audio source headers are too large.");
  return { source, headers };
}

async function bounded<T>(promise: Promise<T>, cancellation: AbortSignal, message: string, timeoutMs = 10_000): Promise<T> {
  const timer = new AbortController();
  try { return await Promise.race([promise, delay(timeoutMs, undefined, { signal: AbortSignal.any([timer.signal, cancellation]) }).then(() => { throw new Error(message); })]); }
  finally { timer.abort(); }
}
async function firstAudioTimestamp(stderr: ReadableStream<Uint8Array>, found: (seconds: number) => void) {
  const reader = stderr.getReader(), decoder = new TextDecoder();
  let remainder = "", captured = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = (remainder + decoder.decode(value, { stream: true })).split("\n");
      remainder = lines.pop()!.slice(-4096);
      if (captured) continue; // Still drain FFmpeg's stderr so a live decoder cannot block.
      for (const line of lines) {
        if (line.length > 4096) continue;
        const match = /^\[Parsed_ashowinfo_\d+ @ [^\]]+\] n:\s*0\b.*\bpts_time:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(line);
        const seconds = Number(match?.[1]);
        if (match && Number.isFinite(seconds)) { captured = true; found(seconds); break; }
      }
    }
  } finally { reader.releaseLock(); }
}
/** Pull-based raw 48 kHz, 16-bit stereo. Read serially; close releases the private decoder. */
export function createPcmDecoder(command: Load, options: { position: number; speed: number; ffmpeg?: string; signal: AbortSignal }) {
  const start = options.position, rate = options.speed;
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new Error("Invalid audio playback timing.");
  const { source, headers } = validatePcmSource(command);
  const timestamped = command.live === true && !command.radio;
  const cancellation = new AbortController();
  const filters = rate < 0.5 ? `atempo=0.5,atempo=${rate / 0.5}` : rate > 2 ? `atempo=2,atempo=${rate / 2}` : `atempo=${rate}`;
  let firstTimestampSeconds: number | null = null;
  const timestamp = timestamped ? Promise.withResolvers<number>() : null;
  void timestamp?.promise.catch(() => {});
  let resolveReader!: (reader: Socket) => void;
  let rejectReader!: (error: Error) => void;
  let resolveExit!: (code: number) => void;
  const accepted = new Promise<Socket>((resolve, reject) => { resolveReader = resolve; rejectReader = reject; });
  const exited = new Promise<number>(resolve => { resolveExit = resolve; });
  const listener = createServer(reader => {
    if (worker.reader || cancellation.signal.aborted || reader.remoteAddress !== "127.0.0.1") { reader.destroy(); return; }
    worker.reader = reader;
    reader.pause();
    reader.on("error", () => {});
    listener.close();
    resolveReader(reader);
  });
  const worker = { child: null as ReturnType<typeof Bun.spawn> | null, accepted, reader: null as Socket | null, cancellation };
  cancellation.signal.addEventListener("abort", () => {
    listener.close(); worker.reader?.destroy(); worker.child?.kill("SIGKILL");
    rejectReader(new Error("Audio preparation was cancelled."));
    if (!worker.child) resolveExit(1);
  }, { once: true });
  listener.once("error", () => { rejectReader(new Error("Could not open the private audio pipe.")); resolveExit(1); });
  listener.listen(0, "127.0.0.1", () => {
    if (cancellation.signal.aborted) { listener.close(); return; }
    const port = (listener.address() as { port: number }).port;
    try {
      // A private loopback pipe avoids Bun's stdout batching and child-pipe lifetime.
      // The paused socket provides bounded OS/Readable backpressure on every platform.
      worker.child = Bun.spawn({ cmd: [options.ffmpeg ?? process.env.COUCH_FFMPEG ?? "ffmpeg", "-hide_banner", "-loglevel", timestamped ? "info" : "error", "-nostdin",
        "-protocol_whitelist", "http,https,tcp,tls,crypto", "-rw_timeout", "10000000", ...(headers ? ["-headers", headers] : []), ...(timestamped ? ["-copyts"] : []),
        ...(!!command.duration && command.duration > 0 && !command.radio && !command.live && start > 0 ? ["-ss", String(start)] : []), "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", timestamped ? `ashowinfo,${filters}` : filters,
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-f", "s16le", `tcp://127.0.0.1:${port}`], stdin: "ignore", stdout: "ignore", stderr: timestamped ? "pipe" : "ignore", signal: cancellation.signal, killSignal: "SIGKILL" });
      if (timestamp) void firstAudioTimestamp(worker.child.stderr as ReadableStream<Uint8Array>, seconds => {
        firstTimestampSeconds = seconds; timestamp.resolve(seconds);
      }).then(() => { if (firstTimestampSeconds === null) timestamp.reject(new Error("The audio decoder did not provide a timestamp.")); },
        () => timestamp.reject(new Error("The audio decoder did not provide a timestamp.")));
      void worker.child.exited.then(code => { resolveExit(code); if (!worker.reader) rejectReader(new Error("The audio decoder failed.")); });
    } catch { resolveExit(1); rejectReader(new Error("Could not start the audio decoder.")); }
  });
  const abort = () => cancellation.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  // A caller may close before the first read; do not leak a rejected acceptance promise.
  void accepted.catch(() => {});
  let closing: Promise<void> | null = null;
  return {
    get firstTimestampSeconds() { return firstTimestampSeconds; },
    async read() {
      try {
        const pcm = await block(worker);
        if (!pcm.length && await bounded(exited, cancellation.signal, "The decoder did not finish.") !== 0) throw new Error("The audio decoder failed.");
        if (pcm.length && timestamp) await bounded(timestamp.promise, cancellation.signal, "The audio decoder did not provide a timestamp.");
        return pcm;
      } catch (error) { cancellation.abort(); throw error; }
    },
    close() {
      if (!closing) {
        options.signal.removeEventListener("abort", abort);
        cancellation.abort();
        closing = exited.then(() => {});
      }
      return closing;
    },
  };
}
async function block(worker: { accepted: Promise<Socket>; cancellation: AbortController }): Promise<Uint8Array> {
  const reader = await bounded(worker.accepted, worker.cancellation.signal, "The audio source stopped responding.");
  const block = Buffer.allocUnsafe(blockBytes);
  let filled = 0;
  while (filled < blockBytes) {
    worker.cancellation.signal.throwIfAborted();
    // Consume partial socket batches: read(3840) can repeatedly signal readable
    // without consuming a shorter batch on Bun, starving both IO and timers.
    const pcm = reader.read(Math.min(blockBytes - filled, Math.max(1, reader.readableLength))) as Buffer | null;
    if (pcm) { block.set(pcm, filled); filled += pcm.length; continue; }
    if (reader.readableEnded || reader.destroyed) break;
    await bounded(new Promise<void>((resolve, reject) => {
      const cleanup = () => { reader.off("readable", ready); reader.off("end", ready); reader.off("close", ready); reader.off("error", failed); worker.cancellation.signal.removeEventListener("abort", aborted); };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("The audio decoder failed.")); };
      const aborted = () => { cleanup(); reject(worker.cancellation.signal.reason); };
      reader.once("readable", ready); reader.once("end", ready); reader.once("close", ready); reader.once("error", failed);
      worker.cancellation.signal.addEventListener("abort", aborted, { once: true });
    }), worker.cancellation.signal, "The audio source stopped responding.");
  }
  if (filled % 4) throw new Error("The decoder returned incomplete audio frames.");
  return block.subarray(0, filled);
}
