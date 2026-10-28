import { publicFetch } from "./public-network";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
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
function playbackToken(id: string, episode: number, server = 1): string {
  const salt = randomBytes(8), iv = randomBytes(12);
  const key = pbkdf2Sync("player", salt, 1000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = `${id}+${episode}+${server}+${Math.floor(Date.now() / 1000)}`;
  const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [salt, iv, encrypted].map(value => value.toString("hex")).join("-");
}

async function playerText(url: string, maximum: number, accept: string, signal: AbortSignal, request: typeof fetch, headers: Record<string, string> = requestHeaders): Promise<string> {
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  try {
    cancellation.throwIfAborted();
    const response = await request(url, { signal: cancellation, redirect: "error", credentials: "omit", headers: { ...headers, Accept: accept } });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
    return await readProviderText(response, maximum, cancellation, changed());
  } catch (error) { cancellation.throwIfAborted(); throw error; }
}

function playerJson(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw changed(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw changed();
  return value as Record<string, unknown>;
}

function encryptedInfo(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{16}-[\da-f]{24}-[\da-f]{34,2048}$/i.test(value) && value.length % 2 === 0;
}

function betaUrl(value: unknown, subtitle = false): string {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) throw changed();
  let url: URL;
  try { url = new URL(value); } catch { throw changed(); }
  if (url.origin !== "https://noisy-king-5904.streamed-7.workers.dev" || url.username || url.password || url.port || url.search || url.hash || !(subtitle ? /^\/sub\/[\w-]+$/ : /^\/hls\/[\w-]+\/master\.m3u8$/).test(url.pathname)) throw changed();
  // publicFetch also checks DNS and pins every socket, including media requests.
  return url.href;
}

async function validateManifest(url: string, signal: AbortSignal, request: typeof fetch, headers = requestHeaders) {
  const manifest = await playerText(url, 512 * 1024, "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain", signal, request, headers);
  if (!/^\uFEFF?#EXTM3U\r?\n/.test(manifest) || !/^#EXT-X-(?:STREAM-INF|TARGETDURATION):/m.test(manifest)) throw unavailable();
}

// Server 2 advertises Emboser -> VidNest. Implement only its published Beta HLS
// contract; no iframe, provider script, arbitrary extractor or server retry loop.
async function embeddedStream(id: string, episode: number, series: boolean, signal: AbortSignal, request: typeof fetch) {
  const data = playerJson(await playerText(`${player}/get/${playbackToken(id, episode, 2)}`, 16 * 1024, "application/json", signal, request));
  if (data.code !== 200) throw unavailable();
  if (data.mode !== "embed" || !encryptedInfo(data.info)) throw changed();
  const [salt, iv, body] = data.info.split("-").map(value => Buffer.from(value, "hex"));
  let destination: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", pbkdf2Sync("player", salt!, 1000, 32, "sha256"), iv!);
    decipher.setAuthTag(body!.subarray(-16));
    destination = Buffer.concat([decipher.update(body!.subarray(0, -16)), decipher.final()]).toString("utf8");
  } catch { throw changed(); }
  const movie = /^movie\/([1-9]\d{0,11})-\d{10}$/.exec(destination);
  const tv = /^tv\/([1-9]\d{0,11})\/([1-9]\d{0,2})-([1-9]\d{0,2})-\d{10}$/.exec(destination);
  if (series ? !tv || Number(tv[3]) !== episode : !movie) throw changed();
  const path = series ? `tv/${tv![1]}/${tv![2]}/${tv![3]}` : `movie/${movie![1]}`;
  const headers = { "User-Agent": requestHeaders["User-Agent"], Referer: `https://vidnest.fun/${path}` };
  const nonce = randomBytes(16).toString("base64url");
  const envelope = playerJson(await playerText(`https://new.vidnest.fun/flixhq/${path}?_n=${nonce}`, 16 * 1024, "application/json", signal, request, { ...headers, Origin: "https://vidnest.fun" }));
  if (envelope.v !== 2 || envelope.n !== nonce || typeof envelope.d !== "string" || !/^[\w-]{40,22000}$/.test(envelope.d)) throw changed();
  let stream: Record<string, unknown>;
  try {
    const encrypted = Buffer.from(envelope.d, "base64url");
    // Public cipher string from VidNest's published player, not a user credential.
    const key = createHash("sha256").update(`${nonce}|K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2`).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
    decipher.setAuthTag(encrypted.subarray(-16));
    stream = playerJson(Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]).toString("utf8"));
  } catch { throw changed(); }
  if (stream.status !== "success" || stream.type !== "hls") throw unavailable();
  const url = betaUrl(stream.url);
  await validateManifest(url, signal, request, headers);
  const subtitles: ExternalSubtitle[] = [];
  for (const row of Array.isArray(stream.subtitles) ? stream.subtitles : []) {
    if (!row || typeof row !== "object" || typeof row.lang !== "string" || !/^[a-z]{2,3}(?: \((?:SDH|forced|[1-9]\d?)\))?$/i.test(row.lang)) continue;
    try {
      const source = betaUrl(row.url, true), code = row.lang.split(" ")[0]!;
      const language = Intl.getCanonicalLocales(code)[0]!;
      const title = new Intl.DisplayNames(["en"], { type: "language" }).of(language) + row.lang.slice(code.length);
      subtitles.push({ source, title, language });
    } catch { /* An invalid optional subtitle must not prevent video. */ }
  }
  return { url, headers, subtitles };
}

async function playerSubtitles(id: string, episode: number, preferred: string, signal: AbortSignal | undefined, request: typeof fetch): Promise<ExternalSubtitle[]> {
  // The public player XORs each byte of "id-episode" with the bytes of "player".
  const mask = Buffer.from("player").reduce((mask, byte) => mask ^ byte, 0);
  const token = Buffer.from(Buffer.from(`${id}-${episode}`).map(byte => byte ^ mask)).toString("hex");
  const path = `/sub/${token}/`, base = `${player}${path}`;
  try {
    const text = await playerText(`${base}index.json`, 64 * 1024, "application/json", AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]), request);
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
  } catch { signal?.throwIfAborted(); return []; }
}

export async function resolveMovies123Link(value: string, signal?: AbortSignal, request: typeof fetch = publicFetch, subtitleLanguage = ""): Promise<{ url: string; headers: Record<string, string>; metadata: WebMediaMetadata; subtitles: ExternalSubtitle[] }> {
  signal?.throwIfAborted();
  const url = movies123PageUrl(value);
  if (!url) throw new ProviderError("Choose a 123MoviesFree film or episode link.", 400);
  if (url.pathname.startsWith("/season/") && !url.searchParams.has("episode")) throw new ProviderError("Choose an episode before playing this 123MoviesFree season.", 400);
  const deadline = AbortSignal.timeout(25_000);
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), deadline]);
  try {
    const title = await movies123Title(url.href, cancellation, request);
    cancellation.throwIfAborted();
    if (!title.servers.includes(1) && !title.servers.includes(2)) throw new ExtractionError("123MoviesFree has no direct stream for this title. Choose another source.");
    const episode = Number(url.searchParams.get("episode") ?? 1);
    let media: { url: string; headers: Record<string, string>; subtitles: ExternalSubtitle[] } | undefined;
    if (title.servers.includes(1)) {
      const data = playerJson(await playerText(`${player}/get/${playbackToken(title.id, episode)}`, 16 * 1024, "application/json", cancellation, request));
      if (data.code !== 200) throw unavailable();
      if (data.mode === "embed") throw new ExtractionError("123MoviesFree only offers an embedded player for this title. Choose another source.");
      if (data.mode !== "direct" || !encryptedInfo(data.info)) throw changed();
      const master = `${player}/hls/${data.info}/master.m3u8`;
      try {
        await validateManifest(master, cancellation, request);
        media = { url: master, headers: { ...requestHeaders }, subtitles: [] };
      } catch (error) {
        cancellation.throwIfAborted();
        if (!title.servers.includes(2) || error instanceof DOMException || error instanceof ExtractionError && error.message !== unavailable().message) throw error;
      }
    }
    media ??= await embeddedStream(title.id, episode, url.pathname.startsWith("/season/"), cancellation, request);
    cancellation.throwIfAborted();
    const tracks = media.subtitles.length ? media.subtitles : await playerSubtitles(title.id, episode, subtitleLanguage, signal, request);
    const seen = new Set<string>();
    const rank = (track: ExternalSubtitle) => subtitleLanguage && track.language?.toLowerCase().startsWith(subtitleLanguage.toLowerCase().slice(0, 2)) ? 0 : 1;
    const labels = new Set<string>();
    const subtitles = tracks.filter(track => { if (seen.has(track.source)) return false; seen.add(track.source); return true; }).sort((a, b) => rank(a) - rank(b)).slice(0, 16).map(track => {
      let title = track.title, count = 1;
      while (labels.has(title)) title = `${track.title} ${++count}`;
      labels.add(title);
      return { ...track, title };
    });
    signal?.throwIfAborted();
    const { title: name, thumbnail, duration } = title.item;
    return { url: media.url, headers: media.headers, metadata: { title: name, ...(thumbnail ? { thumbnail } : {}), ...(duration !== undefined ? { duration } : {}) }, subtitles };
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted || error instanceof DOMException && error.name === "TimeoutError") throw new ExtractionError("123MoviesFree took too long to prepare this title. Try again shortly.");
    if (error instanceof ProviderError || error instanceof ExtractionError) throw error;
    throw unavailable();
  }
}
