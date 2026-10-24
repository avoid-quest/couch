import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, type RawData } from "ws";
import { useHelper } from "./helpers";

export type LiveRendition = "av" | "audio" | "video";
// Retained for recorder/video compatibility. Timestamped PCM uses scheduled audio.
type Stream = {
  directory?: string;
  child?: ChildProcessWithoutNullStreams;
  exited?: Promise<void>;
  setup?: Promise<void>;
  release?: () => void;
  socket?: WebSocket;
  timer?: ReturnType<typeof setInterval>;
  lastData: number;
  startedAt: number;
  polling: boolean;
  available: boolean;
  ended: boolean;
  ready: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

const uploadLimit = 4 * 1024 * 1024;
const timeoutMs = 30_000;

// Capture enters Couch once, and only while something plays it buffered. The resulting
// rolling HLS source uses the same URL renderer, Sendspin audio and picture clock as a
// TV stream. The caller owns publication authorization and gates every upload and media request.
export function createLiveStreams(options: { ffmpeg?: () => Promise<string>; failed?: (sourceId: string, error: string) => void }) {
  const streams = new Map<string, Stream>();
  const cleaning = new Set<Promise<void>>();
  let closed = false;

  const dispose = (stream: Stream, error = new Error("This input has stopped.")) => {
    if (stream.ended) return;
    stream.ended = true;
    clearInterval(stream.timer);
    stream.reject(error);
    stream.child?.kill("SIGKILL");
    stream.socket?.resume();
    stream.socket?.close(1000, "Input stopped");
    const cleanup = (async () => {
      await stream.setup?.catch(() => {});
      await stream.exited;
      stream.release?.();
      if (stream.directory) await rm(stream.directory, { recursive: true, force: true });
    })();
    cleaning.add(cleanup);
    void cleanup.finally(() => cleaning.delete(cleanup)).catch(() => {});
  };
  const fail = (sourceId: string, stream: Stream, message: string) => {
    if (stream.ended) return;
    if (stream.socket?.readyState === WebSocket.OPEN) stream.socket.send(JSON.stringify({ type: "error", error: message }));
    dispose(stream, new Error(message));
    if (streams.get(sourceId) === stream) streams.delete(sourceId);
    options.failed?.(sourceId, message);
  };

  return {
    async start(sourceId: string, source: { audio: boolean; video: boolean }) {
      if (closed || streams.has(sourceId)) throw new Error("This input is already sharing or has stopped.");
      if (!source.audio && !source.video) throw new Error("Choose an input with sound or picture.");
      const pending = Promise.withResolvers<void>();
      const stream: Stream = { lastData: Date.now(), startedAt: Date.now(), polling: false, available: false, ended: false, ready: pending.promise, resolve: pending.resolve, reject: pending.reject };
      // Readiness can fail before a receiver asks for the URL.
      void stream.ready.catch(() => {});
      streams.set(sourceId, stream);
      stream.setup = (async () => {
        // Assign the directory before awaiting the helper so cancellation also
        // cleans up a download or executable lookup still in flight.
        stream.directory = await mkdtemp(join(tmpdir(), "couch-live-stream-"));
        const ffmpeg = options.ffmpeg ? { path: await options.ffmpeg(), release() {} } : await useHelper("ffmpeg");
        stream.release = ffmpeg.release;
        if (stream.ended) throw new Error("This input has stopped.");
        const renditions: LiveRendition[] = source.video ? ["av", "audio", "video"] : ["av", "audio"];
        await Promise.all(renditions.map(rendition => mkdir(join(stream.directory!, rendition))));
        if (stream.ended) throw new Error("This input has stopped.");
        // Tee encodes once, then muxes only the selected packets into each HLS
        // output. Keep the encoded timestamps in every muxer so filtered picture
        // retains the audio clock (including AAC encoder delay). Relative paths
        // keep platform temp-directory syntax out of tee's parser.
        const outputs = renditions.map(rendition => `[f=hls${rendition === "av" ? "" : `:select=${rendition === "audio" ? "a" : "v"}`}:avoid_negative_ts=disabled:hls_segment_options=avoid_negative_ts=disabled:hls_time=1:hls_list_size=8:hls_delete_threshold=2:hls_flags=delete_segments+independent_segments+temp_file:hls_segment_filename=${rendition}/segment-%09d.ts]${rendition}/stream.m3u8`).join("|");
        const child = stream.child = spawn(ffmpeg.path, ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-protocol_whitelist", "pipe",
          "-probesize", "1000000", "-analyzeduration", "1000000", "-i", "pipe:0",
          // Adapter constraint: retained captured-video HLS provides AAC PTS to
          // the legacy follower until its video PTS reaches the shared clock.
          // Ordinary picture-only groups use a timeline without any audio track.
          ...source.audio ? [] : ["-re", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"],
          // MediaRecorder may advertise 1000 fps despite 30 fps capture. Bound
          // the inferred output rate without duplicating lower-rate inputs.
          ...source.video ? ["-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-fpsmax", "30", "-threads", "2", "-force_key_frames", "expr:gte(t,n_forced*1)", "-sc_threshold", "0"] : ["-vn"],
          "-map", source.audio ? "0:a:0" : "1:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", "-sn", "-dn",
          ...source.audio ? [] : ["-shortest"],
          "-avoid_negative_ts", "disabled", "-f", "tee", outputs], { cwd: stream.directory, stdio: ["pipe", "pipe", "pipe"] });
        stream.exited = new Promise(resolve => child.once("close", () => resolve()));
        child.stdout.resume();
        // Decoder diagnostics may contain attacker-controlled bytes; only the
        // stable error below crosses back into the client.
        child.stderr.resume();
        child.stdin.on("error", () => fail(sourceId, stream, "Couch couldn't read this live input."));
        child.on("error", () => fail(sourceId, stream, "Couch couldn't start the live input encoder."));
        child.on("close", () => fail(sourceId, stream, "The live input encoder stopped."));
        child.stdin.on("drain", () => { if (!stream.ended) stream.socket?.resume(); });
        await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
        if (stream.ended) throw new Error("This input has stopped.");
        stream.startedAt = stream.lastData = Date.now();
        stream.timer = setInterval(() => {
          if (stream.ended) return;
          if (Date.now() - stream.lastData > timeoutMs) return fail(sourceId, stream, "The live input stopped sending media.");
          if (!stream.available && Date.now() - stream.startedAt > timeoutMs) return fail(sourceId, stream, "Couch couldn't prepare this live input.");
          if (stream.available || stream.polling) return;
          stream.polling = true;
          void Promise.all(renditions.map(rendition => readFile(join(stream.directory!, rendition, "stream.m3u8"), "utf8"))).then(playlists => {
            if (stream.ended || !playlists.every(playlist => playlist.includes("#EXTINF:"))) return;
            stream.available = true;
            stream.resolve();
            if (stream.socket?.readyState === WebSocket.OPEN) stream.socket.send(JSON.stringify({ type: "ready" }));
          }, () => {}).finally(() => { stream.polling = false; });
        }, 250);
        stream.timer.unref();
      })();
      // Ending the input answers at once; a helper lookup still in flight is cleaned up after it.
      try { await Promise.race([stream.setup, stream.ready]); }
      catch (error) {
        fail(sourceId, stream, "Couch couldn't start the live input encoder.");
        throw error;
      }
    },
    has: (sourceId: string) => streams.has(sourceId),
    // Its first segment is playable.
    available: (sourceId: string) => !!streams.get(sourceId)?.available,
    fail(sourceId: string, message: string) {
      const stream = streams.get(sourceId);
      if (stream) fail(sourceId, stream, message);
    },
    accept(sourceId: string, socket: WebSocket) {
      const stream = streams.get(sourceId);
      if (!stream?.child || stream.ended || stream.socket) return false;
      stream.socket = socket;
      stream.startedAt = stream.lastData = Date.now();
      socket.on("message", (raw: RawData, binary: boolean) => {
        if (stream.ended) return;
        if (!binary) return fail(sourceId, stream, "The live input sent invalid media.");
        const data = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (!data.length) return;
        const input = stream.child!.stdin;
        if (data.length + input.writableLength > uploadLimit) return fail(sourceId, stream, "The live input is arriving faster than Couch can process it.");
        stream.lastData = Date.now();
        if (!input.write(data)) socket.pause();
      });
      socket.once("close", () => fail(sourceId, stream, "The device stopped sharing this input."));
      socket.once("error", () => fail(sourceId, stream, "The live input upload failed."));
      return true;
    },
    async ready(sourceId: string, signal?: AbortSignal) {
      const stream = streams.get(sourceId);
      if (!stream || stream.ended) throw new Error("This input has stopped.");
      // The stream's media deadline starts after helper provisioning. Every
      // waiter shares it; only its caller's cancellation can end this wait early.
      if (!signal) return stream.ready;
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        void stream.ready.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    },
    async response(sourceId: string, file: string, rendition: LiveRendition = "av") {
      const stream = streams.get(sourceId);
      if (!stream?.directory || stream.ended || !["av", "audio", "video"].includes(rendition) || !/^(?:stream\.m3u8|segment-\d{9,}\.ts)$/.test(file)) return new Response(null, { status: 404 });
      const body = await readFile(join(stream.directory, rendition, file)).catch(() => null);
      if (!body || stream.ended) return new Response(null, { status: 404 });
      return new Response(body, { headers: { "Content-Type": file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t", "Cache-Control": "no-store" } });
    },
    end(sourceId: string) {
      const stream = streams.get(sourceId);
      if (!stream) return;
      streams.delete(sourceId);
      dispose(stream);
    },
    async close() {
      closed = true;
      for (const stream of streams.values()) dispose(stream);
      streams.clear();
      await Promise.all(cleaning);
    },
  };
}
