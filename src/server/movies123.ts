import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { movies123PageUrl } from "../shared/movies123";
import { movies123Title } from "./providers/movies123";
import { ProviderError } from "./providers/http";
import { ExtractionError } from "./yt-dlp";
import type { WebMediaMetadata } from "./web-media";

const player = "https://ployan.me";
const requestHeaders = { "User-Agent": "Mozilla/5.0", Referer: `${player}/watch/` };
const unavailable = () => new ExtractionError("123MoviesFree's direct stream is unavailable. Try again shortly or choose another source.");
const changed = () => new ExtractionError("123MoviesFree changed its player response. Choose another source and try again later.");

// The public player encrypts its metadata request with this published protocol.
// Its script is never downloaded or executed by Couch. See docs/123moviesfree.md.
function playbackToken(id: string, episode: number): string {
  const salt = randomBytes(8), iv = randomBytes(12);
  const key = pbkdf2Sync("player", salt, 1000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = `${id}+${episode}+1+${Math.floor(Date.now() / 1000)}`;
  const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [salt, iv, encrypted].map(value => value.toString("hex")).join("-");
}

async function playerText(url: string, maximum: number, accept: string, signal: AbortSignal, request: typeof fetch): Promise<string> {
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  try {
    cancellation.throwIfAborted();
    const response = await request(url, { signal: cancellation, redirect: "error", credentials: "omit", headers: { ...requestHeaders, Accept: accept } });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
    if (Number(response.headers.get("Content-Length")) > maximum) { await response.body?.cancel().catch(() => {}); throw changed(); }
    const reader = response.body?.getReader();
    if (!reader) throw changed();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    cancellation.addEventListener("abort", abort, { once: true });
    try {
      cancellation.throwIfAborted();
      for (;;) {
        const { value, done } = await reader.read();
        cancellation.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > maximum) throw changed();
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally { cancellation.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch (error) { cancellation.throwIfAborted(); throw error; }
}

export async function resolveMovies123Link(value: string, signal?: AbortSignal, request: typeof fetch = globalThis.fetch): Promise<{ url: string; headers: Record<string, string>; metadata: WebMediaMetadata }> {
  signal?.throwIfAborted();
  const url = movies123PageUrl(value);
  if (!url) throw new ProviderError("Choose a 123MoviesFree film or episode link.", 400);
  if (url.pathname.startsWith("/season/") && !url.searchParams.has("episode")) throw new ProviderError("Choose an episode before playing this 123MoviesFree season.", 400);
  const deadline = AbortSignal.timeout(25_000);
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), deadline]);
  try {
    const title = await movies123Title(url.href, cancellation, request);
    cancellation.throwIfAborted();
    if (!title.servers.includes(1)) throw new ExtractionError("123MoviesFree has no direct stream for this title. Choose another source.");
    const episode = Number(url.searchParams.get("episode") ?? 1);
    const response = await playerText(`${player}/get/${playbackToken(title.id, episode)}`, 16 * 1024, "application/json", cancellation, request);
    let info: unknown;
    try { info = JSON.parse(response); } catch { throw changed(); }
    if (!info || typeof info !== "object" || Array.isArray(info)) throw changed();
    const data = info as Record<string, unknown>;
    if (data.code !== 200) throw unavailable();
    if (data.mode === "embed") throw new ExtractionError("123MoviesFree only offers an embedded player for this title. Choose another source.");
    if (data.mode !== "direct" || typeof data.info !== "string" || !/^[\da-f]{16}-[\da-f]{24}-[\da-f]{34,2048}$/i.test(data.info) || data.info.length % 2 !== 0) throw changed();
    const master = `${player}/hls/${data.info}/master.m3u8`;
    const manifest = await playerText(master, 512 * 1024, "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain", cancellation, request);
    if (!/^\uFEFF?#EXTM3U\r?\n/.test(manifest) || !/^#EXT-X-(?:STREAM-INF|TARGETDURATION):/m.test(manifest)) throw unavailable();
    cancellation.throwIfAborted();
    const { title: name, thumbnail, duration } = title.item;
    return { url: master, headers: { ...requestHeaders }, metadata: { title: name, ...(thumbnail ? { thumbnail } : {}), ...(duration !== undefined ? { duration } : {}) } };
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted || error instanceof DOMException && error.name === "TimeoutError") throw new ExtractionError("123MoviesFree took too long to prepare this title. Try again shortly.");
    if (error instanceof ProviderError || error instanceof ExtractionError) throw error;
    throw unavailable();
  }
}
