import { publicFetch } from "./public-network";
import { animeUnityPageUrl } from "../shared/animeunity";
import type { ExternalSubtitle } from "../shared/protocol";
import { animeUnityTitle } from "./providers/animeunity";
import { ProviderError, readProviderText } from "./providers/http";
import { ExtractionError } from "./yt-dlp";
import type { WebMediaMetadata } from "./web-media";

const unavailable = () => new ExtractionError("AnimeUnity's direct stream is unavailable. Try again shortly or choose another source.");
const changed = () => new ExtractionError("AnimeUnity changed its player response. Try another episode or source.");

async function playerText(url: string, maximum: number, headers: Record<string, string>, signal: AbortSignal, request: typeof fetch): Promise<string> {
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  cancellation.throwIfAborted();
  const response = await request(url, { signal: cancellation, redirect: "error", credentials: "omit", headers });
  if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
  return readProviderText(response, maximum, cancellation, changed());
}

function embedTarget(value: string | undefined, id: number): URL {
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) throw changed();
  let url: URL;
  try { url = new URL(value); } catch { throw changed(); }
  if (url.protocol !== "https:" || !/^vixcloud\.[a-z]{2,63}$/.test(url.hostname) || url.username || url.password || url.port || url.hash || url.pathname !== `/embed/${id}`) throw changed();
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !["token", "expires", "canPlayFHD"].includes(key))
    || !/^[a-f\d]{32}$/i.test(url.searchParams.get("token") ?? "") || !/^[1-9]\d{8,12}$/.test(url.searchParams.get("expires") ?? "")
    || url.searchParams.has("canPlayFHD") && url.searchParams.get("canPlayFHD") !== "1") throw changed();
  return url;
}

// Read only the public player's literal playlist fields; never execute its scripts.
function playlistTarget(html: string, embed: URL, id: number): URL {
  const data = /window\.masterPlaylist\s*=\s*\{\s*params:\s*\{([^}]*)\}\s*,\s*url:\s*'([^']+)'\s*,?\s*\}/.exec(html);
  if (!data) throw changed();
  const fields = [...data[1]!.matchAll(/'([a-z]+)'\s*:\s*'([^']*)'/g)];
  if (fields.length < 2 || fields.length > 3 || data[1]!.replace(/'([a-z]+)'\s*:\s*'([^']*)'\s*,?/g, "").trim()) throw changed();
  const params = Object.fromEntries(fields.map(field => [field[1]!, field[2]!]));
  if (new Set(fields.map(field => field[1])).size !== fields.length || Object.keys(params).some(key => !["token", "expires", "asn"].includes(key))
    || !/^[a-f\d]{32}$/i.test(params.token ?? "") || !/^[1-9]\d{8,12}$/.test(params.expires ?? "") || params.asn !== undefined && !/^[a-z\d._-]{0,128}$/i.test(params.asn)) throw changed();
  let url: URL;
  try { url = new URL(data[2]!); } catch { throw changed(); }
  if (url.origin !== embed.origin || url.username || url.password || url.port || url.hash || url.pathname !== `/playlist/${id}` || url.search && url.search !== "?b=1") throw changed();
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value);
  if (embed.searchParams.get("canPlayFHD") === "1") url.searchParams.set("h", "1");
  return url;
}

export async function resolveAnimeUnityLink(value: string, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<{ url: string; headers: Record<string, string>; metadata: WebMediaMetadata; subtitles: ExternalSubtitle[] }> {
  signal?.throwIfAborted();
  const page = animeUnityPageUrl(value);
  if (!page) throw new ProviderError("Choose an AnimeUnity episode link.", 400);
  if (!/^\/anime\/[^/]+\/\d+$/.test(page.pathname)) throw new ProviderError("Choose an episode before playing this AnimeUnity anime.", 400);
  const deadline = AbortSignal.timeout(25_000);
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), deadline]);
  try {
    const title = await animeUnityTitle(page.href, cancellation, request);
    const episode = title.episode;
    if (!episode?.public) throw unavailable();
    const { title: name, thumbnail, duration } = title.item;
    const metadata = { title: name, ...(thumbnail ? { thumbnail } : {}), ...(duration !== undefined ? { duration } : {}) };
    if (!episode.scws_id) {
      // The site's older public player uses these progressive files directly.
      let direct: URL;
      try { direct = new URL(episode.link ?? ""); } catch { throw unavailable(); }
      if (direct.protocol !== "https:" || !/^(?:[a-z\d-]+\.)*sweetpixel\.org$/i.test(direct.hostname) || direct.username || direct.password || direct.port || direct.hash || !/\.mp4$/i.test(direct.pathname) || direct.href.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(episode.link ?? "")) throw unavailable();
      return { url: direct.href, headers: { "User-Agent": "Mozilla/5.0", Referer: `${title.origin}/` }, metadata, subtitles: [] };
    }
    const embed = embedTarget(title.embedUrl, episode.scws_id);
    const html = await playerText(embed.href, 512 * 1024, { "User-Agent": "Mozilla/5.0", Referer: `${title.origin}/`, Accept: "text/html" }, cancellation, request);
    const master = playlistTarget(html, embed, episode.scws_id);
    const headers = { "User-Agent": "Mozilla/5.0", Referer: `${embed.origin}/` };
    const manifest = await playerText(master.href, 512 * 1024, { ...headers, Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain" }, cancellation, request);
    if (!/^\uFEFF?#EXTM3U\r?\n/.test(manifest) || !/^#EXT-X-(?:STREAM-INF|TARGETDURATION):/m.test(manifest)) throw unavailable();
    cancellation.throwIfAborted();
    return { url: master.href, headers, metadata, subtitles: [] };
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted || error instanceof DOMException && error.name === "TimeoutError") throw new ExtractionError("AnimeUnity took too long to prepare this episode. Try again shortly.");
    if (error instanceof ProviderError || error instanceof ExtractionError) throw error;
    throw unavailable();
  }
}
