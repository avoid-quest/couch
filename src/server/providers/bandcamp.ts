import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { runYtDlp } from "../yt-dlp";
import { ProviderError, providerItemId, providerJson, withProviderItem } from "./http";

type Metadata = Record<string, unknown>;
type Target = { url: string; kind: "track" | "album"; host: string };
const object = (value: unknown): value is Metadata => typeof value === "object" && value !== null && !Array.isArray(value);
const label = (value: unknown, limit = 200) => typeof value === "string" ? value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, limit) || undefined : undefined;
const invalidCatalog = () => new ProviderError("Bandcamp returned invalid catalog information. Update yt-dlp and try again.");

function target(value: unknown): Target {
  const invalid = () => new ProviderError("Enter a public Bandcamp track or album link, such as https://artist.bandcamp.com/album/title.", 400);
  if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u0020\u007f\\]/.test(value)) throw invalid();
  // Match the original authority as well: URL.port removes explicitly supplied default ports.
  const match = /^https?:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.bandcamp\.com)\/(track|album)\/([a-z0-9_-]+)\/?(?:[?#].*)?$/i.exec(value);
  if (!match || /^(?:www|daily|api)\./i.test(match[1]!)) throw invalid();
  return { url: `https://${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}/${match[3]}`, host: match[1]!.toLowerCase(), kind: match[2]!.toLowerCase() as Target["kind"] };
}

function thumbnail(info: Metadata): string | undefined {
  const alternatives = Array.isArray(info.thumbnails) ? info.thumbnails.filter(object).map(item => item.url).toReversed() : [];
  for (const value of [info.thumbnail, ...alternatives]) {
    if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u0020\u007f\\]/.test(value)) continue;
    const match = /^(?:https?:)?\/\/(f\d+\.bcbits\.com)(\/img\/[a-z0-9_-]+\.(?:jpe?g|png|webp|gif))(?:[?#].*)?$/i.exec(value);
    if (match) return `https://${match[1]!.toLowerCase()}${match[2]}`;
  }
}

function artist(info: Metadata, album = false): string | undefined {
  const list = (value: unknown) => Array.isArray(value) ? label(value.map(item => label(item)).filter(Boolean).join(", ")) : undefined;
  return (album ? label(info.album_artist) ?? list(info.album_artists) : undefined) ?? label(info.artist) ?? list(info.artists) ?? label(info.uploader);
}

function mediaItem(info: Metadata, source: Target): ProviderItem {
  const title = label(info.track) ?? label(info.title);
  if (!title) throw invalidCatalog();
  const image = thumbnail(info);
  const subtitle = artist(info);
  const description = label(info.description, 1_000);
  return {
    id: providerItemId("bandcamp", source.url), provider: "bandcamp", kind: "media", title, url: source.url,
    ...(image ? { thumbnail: image } : {}), ...(subtitle ? { subtitle } : {}), ...(description ? { description } : {}),
    ...(typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration >= 0 && info.duration <= Number.MAX_SAFE_INTEGER ? { duration: info.duration } : {}),
  };
}

function checkTrack(info: Metadata, source: Target) {
  if (info.entries !== undefined || info._type !== undefined && info._type !== "video" || info.formats !== undefined && !Array.isArray(info.formats)) throw invalidCatalog();
  if (info.webpage_url !== undefined && target(info.webpage_url).url !== source.url) throw invalidCatalog();
  const formats = [info, ...(Array.isArray(info.formats) ? info.formats.filter(object) : [])];
  const playable = info.has_drm !== true && info._has_drm !== true && formats.some(format => {
    if (format.has_drm === true || format.vcodec !== "none" || typeof format.acodec !== "string" || format.acodec === "none" || format.protocol !== undefined && !["http", "https"].includes(String(format.protocol))) return false;
    if (typeof format.url !== "string" || format.url.length > 8_192 || /[\u0000-\u0020\u007f\\]/.test(format.url)) return false;
    try { const url = new URL(format.url); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.port; }
    catch { return false; }
  });
  if (!playable) throw new ProviderError("This Bandcamp track has no supported public audio stream. Account-only playback is not supported.");
}

export function createBandcampCatalog(run: typeof runYtDlp = runYtDlp, request: typeof fetch = globalThis.fetch) {
  async function search(query: string, signal?: AbortSignal): Promise<ProviderPage> {
    if (query.length > 200) throw new ProviderError("Enter a Bandcamp search of at most 200 characters.", 400);
    // Bandcamp's own search box uses this public JSON endpoint. The documented
    // partner API covers accounts and sales, not catalog search (/developer).
    const info = await providerJson("https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ search_text: query, search_filter: "", full_page: true, fan_id: null }),
    }, request);
    if (!object(info) || !object(info.auto) || info.auto.ac_error || !Array.isArray(info.auto.results)) throw new ProviderError("Bandcamp search is unavailable. Try again shortly.");
    const seen = new Set<string>();
    const items = info.auto.results.slice(0, 50).flatMap((entry): ProviderItem[] => {
      if (!object(entry) || !["a", "t"].includes(String(entry.type))) return [];
      let source: Target;
      try { source = target(entry.item_url_path); } catch { return []; }
      const title = label(entry.name);
      if (!title || seen.has(source.url) || source.kind !== (entry.type === "a" ? "album" : "track")) return [];
      seen.add(source.url);
      // Search's `img` leaves out the "a" a cover's address starts with, so it answers 404: build it from `art_id`,
      // at the size album pages give.
      const art = typeof entry.art_id === "number" && Number.isSafeInteger(entry.art_id) && entry.art_id > 0 ? `https://f4.bcbits.com/img/a${String(entry.art_id).padStart(10, "0")}_5.jpg` : entry.img;
      return [{ id: providerItemId("bandcamp", source.url), provider: "bandcamp", kind: source.kind === "album" ? "collection" : "media",
        title, url: source.url, subtitle: label(entry.band_name), thumbnail: thumbnail({ thumbnail: art }) }];
    });
    return { title: "Bandcamp", items };
  }

  async function extract(source: Target, signal?: AbortSignal): Promise<Metadata> {
    signal?.throwIfAborted();
    const args = source.kind === "album" ? ["--flat-playlist", "--playlist-items", "1:501"] : ["--no-playlist", "--playlist-items", "1", "--format", "bestaudio/best"];
    const output = await run(["--use-extractors", "bandcamp,bandcamp:album,end", "--dump-single-json", ...args, "--", source.url], { signal });
    signal?.throwIfAborted();
    let info: unknown;
    try { info = JSON.parse(output); } catch { throw invalidCatalog(); }
    if (!object(info)) throw invalidCatalog();
    return info;
  }

  async function album(url: string, signal?: AbortSignal): Promise<ProviderPage> {
    signal?.throwIfAborted();
    const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
    const source = target(url);
    if (source.kind !== "album") throw new ProviderError("Choose a Bandcamp album link to queue its tracks.", 400);
    const info = await extract(source, cancellation);
    if (info._type !== "playlist" || !Array.isArray(info.entries)) throw invalidCatalog();
    if (info.entries.length > 500 || typeof info.playlist_count === "number" && info.playlist_count > 500) throw new ProviderError("This album has more than 500 tracks. Queue individual tracks instead.", 400);
    if (info.playlist_count != null && info.playlist_count !== info.entries.length) throw invalidCatalog();
    if (!info.entries.length) throw new ProviderError("This Bandcamp album has no public tracks.");
    const title = label(info.title);
    if (!title) throw invalidCatalog();
    if (info.webpage_url !== undefined && target(info.webpage_url).url !== source.url) throw invalidCatalog();
    const seen = new Set<string>();
    const items = info.entries.map((entry): ProviderItem => {
      if (!object(entry)) throw invalidCatalog();
      let track: Target;
      try { track = target(entry.webpage_url ?? entry.url); } catch { throw invalidCatalog(); }
      if (track.kind !== "track" || track.host !== source.host || seen.has(track.url)) throw invalidCatalog();
      seen.add(track.url);
      return mediaItem(entry, track);
    });
    // Flat entries contain no artwork or audio formats. Inspect one track, then resolve each track afresh when played.
    const first = target(items[0]!.url);
    const detail = await extract(first, cancellation);
    checkTrack(detail, first);
    const image = thumbnail(info) ?? thumbnail(detail);
    const subtitle = artist(detail, true);
    return withProviderItem("bandcamp", source.url, "collection", { title, thumbnail: image, subtitle, description: label(info.description, 2000), items: items.map((item, index) => ({
      ...item, collection: { title, url: source.url, index }, ...(image ? { thumbnail: image } : {}), ...(subtitle ? { subtitle } : {}),
      ...(index === 0 && typeof detail.duration === "number" && Number.isFinite(detail.duration) && detail.duration >= 0 && detail.duration <= Number.MAX_SAFE_INTEGER ? { duration: detail.duration } : {}),
    })) });
  }

  async function browse(request: BrowseRequest, signal?: AbortSignal): Promise<ProviderPage> {
    signal?.throwIfAborted();
    if (request.cursor !== undefined) throw new ProviderError("Start a new Bandcamp search or open an album link.", 400);
    if (request.query !== undefined && (typeof request.query !== "string" || request.query.length > 2_048 || /[\u0000-\u001f\u007f]/.test(request.query))) throw new ProviderError("Enter a public Bandcamp track or album link.", 400);
    if (request.url !== undefined && typeof request.url !== "string") throw new ProviderError("Enter a public Bandcamp track or album link.", 400);
    const value = request.url || request.query?.trim();
    if (!value) return { title: "Bandcamp", items: [] };
    if (!request.url && !/^https?:\/\//i.test(value)) return search(value, signal);
    const source = target(value);
    if (source.kind === "album") return album(source.url, signal);
    const info = await extract(source, signal);
    checkTrack(info, source);
    const item = mediaItem(info, source);
    return { title: item.title, item, items: [item] };
  }

  return { browse, album };
}

const catalog = createBandcampCatalog();
export const browseBandcamp = catalog.browse;
export const loadBandcampAlbum = catalog.album;
