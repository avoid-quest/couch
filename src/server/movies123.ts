import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { movies123PageUrl } from "../shared/movies123";
import { movies123Title } from "./providers/movies123";
import { ProviderError, readProviderText } from "./providers/http";
import { ExtractionError } from "./yt-dlp";
import type { WebMediaMetadata } from "./web-media";
import type { ExternalSubtitle } from "../shared/protocol";

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
    return await readProviderText(response, maximum, cancellation, changed());
  } catch (error) { cancellation.throwIfAborted(); throw error; }
}

async function playerSubtitles(id: string, episode: number, preferred: string, signal: AbortSignal, request: typeof fetch): Promise<ExternalSubtitle[]> {
  // The public player XORs each byte of "id-episode" with the bytes of "player".
  const mask = Buffer.from("player").reduce((mask, byte) => mask ^ byte, 0);
  const token = Buffer.from(Buffer.from(`${id}-${episode}`).map(byte => byte ^ mask)).toString("hex");
  const path = `/sub/${token}/`, base = `${player}${path}`;
  try {
    const text = await playerText(`${base}index.json`, 64 * 1024, "application/json", AbortSignal.any([signal, AbortSignal.timeout(5000)]), request);
    const rows: unknown = JSON.parse(text);
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>(), labels = new Map<string, number>();
    const subtitles: ExternalSubtitle[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.file !== "string" || typeof row.label !== "string" || /[\u0000-\u0020\u007f\\]/.test(row.file)) continue;
      let url: URL;
      try { url = new URL(row.file, base); } catch { continue; }
      if (!url.href.startsWith(base) || url.username || url.password || url.search || url.hash || !/^[\w-]+\.vtt$/.test(url.pathname.slice(path.length)) || seen.has(url.href)) continue;
      const label = row.label.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100);
      if (!label) continue;
      seen.add(url.href);
      const count = (labels.get(label) ?? 0) + 1;
      labels.set(label, count);
      const language = typeof row.lang === "string" && row.lang.length <= 35 && /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(row.lang) ? row.lang : undefined;
      subtitles.push({ source: url.href, title: count > 1 ? `${label} ${count}` : label, ...(language ? { language } : {}) });
    }
    const rank = (track: ExternalSubtitle) => preferred && track.language?.toLowerCase().startsWith(preferred.toLowerCase().slice(0, 2)) ? 0 : 1;
    return subtitles.sort((a, b) => rank(a) - rank(b)).slice(0, 16);
  } catch { signal.throwIfAborted(); return []; }
}

export async function resolveMovies123Link(value: string, signal?: AbortSignal, request: typeof fetch = globalThis.fetch, subtitleLanguage = ""): Promise<{ url: string; headers: Record<string, string>; metadata: WebMediaMetadata; subtitles: ExternalSubtitle[] }> {
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
    const subtitles = await playerSubtitles(title.id, episode, subtitleLanguage, cancellation, request);
    cancellation.throwIfAborted();
    const { title: name, thumbnail, duration } = title.item;
    return { url: master, headers: { ...requestHeaders }, metadata: { title: name, ...(thumbnail ? { thumbnail } : {}), ...(duration !== undefined ? { duration } : {}) }, subtitles };
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted || error instanceof DOMException && error.name === "TimeoutError") throw new ExtractionError("123MoviesFree took too long to prepare this title. Try again shortly.");
    if (error instanceof ProviderError || error instanceof ExtractionError) throw error;
    throw unavailable();
  }
}
