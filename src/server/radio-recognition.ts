import { spawn } from "node:child_process";
import type { RadioRecognitionResult } from "../shared/radio-recognition";
import { ControllerError } from "./devices";
import { useHelper } from "./helpers";
import { createPublicMediaProxy } from "./public-media-proxy";
import { RadioError } from "./radio";
import { recognizeSong, SongRecognitionError } from "./song-recognition";

const sampleSeconds = 12;
const sampleRate = 16_000;
const sampleLimit = 512 * 1024;
const sampleError = () => new SongRecognitionError("Couldn't sample this station. Identification needs a reachable public radio stream.");

// A complete WAV header also works with decoders that reject FFmpeg's unseekable
// WAV output (whose RIFF/data lengths are unknown). Samples never touch disk.
function wave(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Read a short independent excerpt; this never changes the playing stream. */
export async function sampleRadio(source: string, signal: AbortSignal, {
  helper = useHelper, proxy: createProxy = createPublicMediaProxy,
}: { helper?: typeof useHelper; proxy?: typeof createPublicMediaProxy } = {}): Promise<Buffer> {
  signal.throwIfAborted();
  // Provisioning is shared with playback and can outlive this request. Stop
  // waiting on cancel, and release a lease that arrives after we have left.
  const executable = await new Promise<Awaited<ReturnType<typeof useHelper>>>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void helper("ffmpeg").then(lease => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) lease.release(); else resolve(lease);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
  let proxy: Awaited<ReturnType<typeof createPublicMediaProxy>> | undefined;
  try {
    signal.throwIfAborted();
    proxy = await createProxy(signal);
    signal.throwIfAborted();
    const pcm = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(executable.path, [
        "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error",
        "-protocol_whitelist", "http,https,tcp,tls,crypto,httpproxy",
        "-format_whitelist", "aac,ac3,aiff,ape,asf,flac,flv,hls,matroska,webm,mov,mp3,mpeg,mpegts,ogg,wav,wv",
        "-rw_timeout", "10000000", "-http_proxy", proxy!.url,
        ...new URL(source).pathname.toLowerCase().endsWith(".m3u8") ? ["-live_start_index", "-1"] : [],
        "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", String(sampleSeconds),
        "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
      ], { stdio: ["ignore", "pipe", "ignore"], env: {
        ...process.env, http_proxy: proxy!.url, https_proxy: proxy!.url, HTTP_PROXY: proxy!.url, HTTPS_PROXY: proxy!.url,
        all_proxy: "", ALL_PROXY: "", no_proxy: "", NO_PROXY: "",
      } });
      const chunks: Buffer[] = [];
      let size = 0, failure: Error | undefined;
      const abort = () => { child.kill("SIGKILL"); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => {
        if (failure) return;
        size += chunk.length;
        if (size > sampleLimit) { failure = sampleError(); child.kill("SIGKILL"); }
        else chunks.push(chunk);
      });
      child.once("error", () => { failure = sampleError(); });
      child.once("close", code => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else if (failure || code !== 0 || size < sampleRate * 2 || size % 2) reject(failure ?? sampleError());
        else resolve(Buffer.concat(chunks));
      });
    });
    return wave(pcm.subarray(0, sampleSeconds * sampleRate * 2));
  } finally {
    executable.release();
    await proxy?.close();
  }
}

export function createRadioRecognition({ station, signal: shutdown, sample = sampleRadio, recognize = recognizeSong }: {
  station: (stationId: string) => { source: string };
  signal: AbortSignal;
  sample?: (source: string, signal: AbortSignal) => Promise<Buffer>;
  recognize?: typeof recognizeSong;
}) {
  // Manual requests only. One decoder/recognizer at a time bounds Core's work.
  let busy = false;
  return {
    async handle(request: Request, authorize: () => void): Promise<Response> {
      let acquired = false;
      const signal = AbortSignal.any([request.signal, shutdown, AbortSignal.timeout(45_000)]);
      const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
      try {
        authorize();
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
        if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new RadioError("Send a JSON object.", 415);
        const body: unknown = await request.json().catch(() => { throw new RadioError("Invalid JSON body."); });
        authorize();
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("stationId" in body)
          || typeof body.stationId !== "string" || body.stationId.length > 80) throw new RadioError("Choose a saved radio station to identify.");
        const { source } = station(body.stationId);
        signal.throwIfAborted();
        if (busy) return respond({ error: "A song is already being identified. Try again shortly." }, 429);
        busy = acquired = true;
        const sampledAt = Date.now();
        const audio = await sample(source, signal);
        signal.throwIfAborted();
        authorize();
        const track = await recognize(audio, signal, undefined, authorize);
        signal.throwIfAborted();
        authorize();
        return respond({ track, sampledAt } satisfies RadioRecognitionResult);
      } catch (error) {
        try { authorize(); } catch (rejected) { error = rejected; }
        if (error instanceof ControllerError || error instanceof RadioError || error instanceof SongRecognitionError) return respond({ error: error.message }, error.status);
        if (signal.aborted) return respond({ error: signal.reason?.name === "TimeoutError" ? "Identification took too long. Try again." : "Identification canceled." }, signal.reason?.name === "TimeoutError" ? 504 : 499);
        return respond({ error: "Couldn't identify this song. Try again." }, 502);
      } finally { if (acquired) busy = false; }
    },
  };
}
