import { spawn } from "node:child_process";
import type { RadioRecognitionEntry } from "../shared/radio-recognition";
import type { PlaybackActor } from "../shared/protocol";
import { Database } from "./sqlite";
import { ControllerError } from "./devices";
import { useHelper } from "./helpers";
import { createPublicMediaProxy } from "./public-media-proxy";
import { RadioError } from "./radio";
import { recognizeSong, SongRecognitionError } from "./song-recognition";

const sampleSeconds = 12;
const sampleRate = 16_000;
const sampleLimit = 512 * 1024;
const sampleError = () => new SongRecognitionError("Couldn't sample this station. Identification needs a reachable public radio stream.");

type RadioSample = { pcm: Buffer; sampledAt: number };

/** Read a short independent excerpt; this never changes the playing stream. */
export async function sampleRadio(source: string, signal: AbortSignal, {
  helper = useHelper, proxy: createProxy = createPublicMediaProxy,
}: { helper?: typeof useHelper; proxy?: typeof createPublicMediaProxy } = {}): Promise<RadioSample> {
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
    const sampledAt = Date.now();
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
    return { pcm: pcm.subarray(0, sampleSeconds * sampleRate * 2), sampledAt };
  } finally {
    executable.release();
    await proxy?.close();
  }
}

export function createRadioRecognition({ databasePath, onChange, station, programme, signal: shutdown, sample = sampleRadio, recognize = recognizeSong }: {
  databasePath: string;
  onChange: () => void;
  station: (stationId: string) => { source: string; title: string };
  programme?: (stationId: string, source: string, sampledAt: number, signal: AbortSignal) => Promise<string | undefined>;
  signal: AbortSignal;
  sample?: (source: string, signal: AbortSignal) => Promise<RadioSample>;
  recognize?: typeof recognizeSong;
}) {
  const db = new Database(databasePath);
  db.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE IF NOT EXISTS radio_recognitions (id TEXT PRIMARY KEY, sampledAt INTEGER NOT NULL, entry TEXT NOT NULL)");
  // Manual requests only. One decoder/recognizer at a time bounds Core's work.
  let busy = false;
  return {
    close: () => db.close(),
    async handle(request: Request, authorize: () => void, requestedBy: PlaybackActor): Promise<Response> {
      let acquired = false;
      const signal = AbortSignal.any([request.signal, shutdown, AbortSignal.timeout(45_000)]);
      const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
      try {
        authorize();
        if (new URL(request.url).pathname === "/api/radio/recognitions") {
          if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
          const items = db.query<{ entry: string }, []>("SELECT entry FROM radio_recognitions ORDER BY sampledAt DESC, id DESC").all().map(row => JSON.parse(row.entry) as RadioRecognitionEntry);
          return respond({ items });
        }
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
        if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new RadioError("Send a JSON object.", 415);
        const body: unknown = await request.json().catch(() => { throw new RadioError("Invalid JSON body."); });
        authorize();
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("stationId" in body)
          || typeof body.stationId !== "string" || body.stationId.length > 80) throw new RadioError("Choose a saved radio station to identify.");
        const { source, title } = station(body.stationId);
        const requester = { ...requestedBy };
        signal.throwIfAborted();
        if (busy) return respond({ error: "A song is already being identified. Try again shortly." }, 429);
        busy = acquired = true;
        const { pcm, sampledAt } = await sample(source, signal);
        signal.throwIfAborted();
        authorize();
        // Programme metadata is optional; a guide outage must not lose a match.
        const programmeTitle = await programme?.(body.stationId, source, sampledAt, signal).catch(() => undefined);
        signal.throwIfAborted();
        authorize();
        const track = await recognize(pcm, signal, undefined, authorize);
        signal.throwIfAborted();
        authorize();
        const entry: RadioRecognitionEntry = { id: crypto.randomUUID(), track, sampledAt,
          station: { id: body.stationId, name: title }, requestedBy: requester, ...(programmeTitle ? { programme: programmeTitle } : {}) };
        db.query("INSERT INTO radio_recognitions (id, sampledAt, entry) VALUES (?, ?, ?)").run(entry.id, sampledAt, JSON.stringify(entry));
        onChange();
        return respond(entry);
      } catch (error) {
        try { authorize(); } catch (rejected) { error = rejected; }
        if (error instanceof ControllerError || error instanceof RadioError || error instanceof SongRecognitionError) return respond({ error: error.message }, error.status);
        if (signal.aborted) return respond({ error: signal.reason?.name === "TimeoutError" ? "Identification took too long. Try again." : "Identification canceled." }, signal.reason?.name === "TimeoutError" ? 504 : 499);
        return respond({ error: "Couldn't identify this song. Try again." }, 502);
      } finally { if (acquired) busy = false; }
    },
  };
}
