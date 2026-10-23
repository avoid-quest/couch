import { publicFetch } from "./public-network";
import { animeSaturnPageUrl, animesaturnOrigin } from "../shared/animesaturn";
import { animeSaturnText, animeSaturnTitle } from "./providers/animesaturn";
import { ProviderError, readProviderText } from "./providers/http";
import { ExtractionError } from "./yt-dlp";
import type { WebMediaMetadata } from "./web-media";
import type { ExternalSubtitle } from "../shared/protocol";

const headers = { "User-Agent": "Mozilla/5.0", Referer: `${animesaturnOrigin}/` };
const unavailable = () => new ExtractionError("AnimeSaturn's direct stream is unavailable. Try again shortly or choose another source.");

function publicPlayerUrl(value: string, embed: boolean): URL | undefined {
  if (value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return;
    if (embed ? /^cdn\d{1,3}\.megaplay\.su$/.test(url.hostname) && /^\/e\/[a-f\d]{16,128}$/.test(url.pathname) && (!url.search || url.search === "?autoplay=1")
      : /^(?:cdn\d{1,3}\.megaplay\.su|srv\d{1,3}\.[a-z\d-]+\.streampeaker\.org)$/.test(url.hostname) && /\.(?:m3u8|mp4)$/.test(url.pathname)) return url;
  } catch { /* Only the observed public players and their media hosts are used. */ }
}

async function playerText(url: string, maximum: number, signal: AbortSignal, request: typeof fetch): Promise<string> {
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  cancellation.throwIfAborted();
  const response = await request(url, { signal: cancellation, credentials: "omit", redirect: "error", headers });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
  return readProviderText(response, maximum, cancellation, unavailable());
}

async function probeProgressive(url: string, signal: AbortSignal, request: typeof fetch): Promise<void> {
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  cancellation.throwIfAborted();
  const response = await request(url, { signal: cancellation, credentials: "omit", redirect: "error", headers: { ...headers, Range: "bytes=0-0" } });
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const abort = () => { void reader.cancel().catch(() => {}); };
  cancellation.addEventListener("abort", abort, { once: true });
  try {
    cancellation.throwIfAborted();
    if (!response.ok) throw unavailable();
    // Read only the first binary data, then cancel even if Range was ignored.
    for (;;) {
      const { value, done } = await reader.read();
      cancellation.throwIfAborted();
      if (done) throw unavailable();
      if (value.length) return;
    }
  } finally { cancellation.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Both public players publish JSON string literals. Read those values without
// downloading their libraries or evaluating any JavaScript (docs/animesaturn.md).
function directStream(html: string): URL | undefined {
  for (const match of html.matchAll(/\bvar\s+(?:src|primary)\s*=\s*("(?:\\.|[^"\\])*")\s*;/g)) {
    try {
      const value: unknown = JSON.parse(match[1]!);
      const url = typeof value === "string" && publicPlayerUrl(value, false);
      if (url) return url;
    } catch { /* A malformed literal is not executable player data. */ }
  }
}

export async function resolveAnimeSaturnLink(value: string, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<{ url: string; headers: Record<string, string>; metadata: WebMediaMetadata; subtitles: ExternalSubtitle[] }> {
  signal?.throwIfAborted();
  const url = animeSaturnPageUrl(value);
  if (!url || url.pathname.startsWith("/anime/")) throw new ProviderError("Choose an AnimeSaturn episode before playing.", 400);
  const deadline = AbortSignal.timeout(25_000);
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), deadline]);
  try {
    const title = await animeSaturnTitle(url.href, cancellation, request);
    // HD publishes HLS or progressive MP4; Mega adds one allowlisted iframe hop.
    const players = title.players.sort((a, b) => Number(new URL(b).searchParams.get("source") === "animesaturn_live") - Number(new URL(a).searchParams.get("source") === "animesaturn_live"));
    for (const player of players) {
      try {
        let html = await animeSaturnText(player, cancellation, request);
        let stream = directStream(html);
        if (!stream) {
          const source = /<iframe\b[^>]*\bsrc=["']([^"']+)["']/.exec(html)?.[1];
          const embed = source && publicPlayerUrl(source.replace(/&amp;|&#0*38;/g, "&"), true);
          if (!embed) continue;
          html = await playerText(embed.href, 256 * 1024, cancellation, request);
          stream = directStream(html);
          if (!stream || stream.origin !== embed.origin) continue;
        }
        if (stream.pathname.endsWith(".m3u8")) {
          const manifest = await playerText(stream.href, 512 * 1024, cancellation, request);
          if (!/^\uFEFF?#EXTM3U\r?\n/.test(manifest) || !/^#EXT-X-(?:STREAM-INF|TARGETDURATION):/m.test(manifest)) continue;
        } else await probeProgressive(stream.href, cancellation, request);
        cancellation.throwIfAborted();
        const { title: name, thumbnail, duration } = title.item;
        return { url: stream.href, headers: { ...headers }, metadata: { title: name, ...(thumbnail ? { thumbnail } : {}), ...(duration !== undefined ? { duration } : {}) }, subtitles: [] };
      } catch { cancellation.throwIfAborted(); }
    }
    throw unavailable();
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted || error instanceof DOMException && error.name === "TimeoutError") throw new ExtractionError("AnimeSaturn took too long to prepare this episode. Try again shortly.");
    if (error instanceof ProviderError || error instanceof ExtractionError) throw error;
    throw unavailable();
  }
}
