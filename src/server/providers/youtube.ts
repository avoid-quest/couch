import { mediaCreator } from "../media-creator";
import { isYouTubePlaylistUrl } from "../../shared/providers";
import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { runYtDlp } from "../yt-dlp";
import { ProviderError, providerItemId, withProviderItem } from "./http";

const pageSize = 24;
const maxOffset = 2_400;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const hosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);
type Target = { url: string; kind: ProviderItem["kind"] | "search" };
type Metadata = Record<string, unknown>;
const object = (value: unknown): value is Metadata => typeof value === "object" && value !== null && !Array.isArray(value);
const label = (value: unknown, limit = 200) => typeof value === "string" ? value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, limit) || undefined : undefined;

function searchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function target(value: string): Target {
  const invalid = () => new ProviderError("Enter a YouTube video, channel, or playlist URL.", 400);
  if (value.length > 2_048 || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) throw invalid();
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw invalid(); }
  if (!hosts.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw invalid();
  const path = parsed.pathname.replace(/\/$/, "");
  try { decodeURIComponent(path); } catch { throw invalid(); }
  const shortHost = parsed.hostname === "youtu.be" || parsed.hostname === "www.youtu.be";
  const list = parsed.searchParams.get("list");
  if (!shortHost && ["/watch", "/playlist"].includes(path) && list && /^[A-Za-z0-9_-]{10,100}$/.test(list)) {
    return { url: `https://www.youtube.com/playlist?list=${list}`, kind: "collection" };
  }
  const id = shortHost ? path.slice(1) : path === "/watch" ? parsed.searchParams.get("v") : path.match(/^\/(?:shorts|live|embed)\/([^/]+)$/)?.[1];
  if (id && videoId.test(id)) return { url: `https://www.youtube.com/watch?v=${id}`, kind: "media" };
  if (shortHost) throw invalid();
  const channel = path.match(/^\/(?:@[^/]{1,100}|channel\/UC[A-Za-z0-9_-]{22}|(?:c|user)\/[^/]{1,100})(\/(?:videos|shorts|streams|playlists))?$/);
  if (channel && !/%(?:2f|5c|00)/i.test(path)) return { url: `https://www.youtube.com${path}`, kind: channel[1] ? "collection" : "channel" };
  const query = parsed.searchParams.get("search_query");
  if (path === "/results" && query?.trim() && query.length <= 200 && !/[\u0000-\u001f\u007f]/.test(query)) return { url: searchUrl(query.trim()), kind: "search" };
  throw invalid();
}

function thumbnail(info: Metadata, source: Target): string | undefined {
  const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails.filter(object).map(item => item.url).toReversed() : [];
  for (const value of [info.thumbnail, ...thumbnails]) {
    if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u0020\u007f\\]/.test(value)) continue;
    try {
      const url = new URL(value.startsWith("//") ? `https:${value}` : value);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/.test(url.hostname)) return url.href;
    } catch { /* Ignore unusable artwork. */ }
  }
  return source.kind === "media" ? `https://i.ytimg.com/vi/${new URL(source.url).searchParams.get("v")}/hqdefault.jpg` : undefined;
}

function item(info: unknown): ProviderItem | null {
  if (!object(info) || ["private", "premium_only", "subscriber_only", "needs_auth"].includes(String(info.availability))) return null;
  const title = label(info.title) ?? label(info.channel);
  if (!title || ["[Private video]", "[Deleted video]"].includes(title)) return null;
  let source: Target;
  try {
    const url = label(info.webpage_url, 2_049) ?? label(info.url, 2_049) ?? (typeof info.id === "string" && videoId.test(info.id) ? `https://www.youtube.com/watch?v=${info.id}` : "");
    source = target(url);
  } catch { return null; }
  if (source.kind === "search") return null;
  const image = thumbnail(info, source);
  const description = label(info.description, 1_000);
  const subtitle = label(info.channel, 200) ?? label(info.uploader, 200);
  return {
    creator: mediaCreator(info),
    id: providerItemId("youtube", source.url), provider: "youtube", kind: source.kind, title, url: source.url,
    ...(image ? { thumbnail: image } : {}), ...(description ? { description } : {}), ...(subtitle ? { subtitle } : {}),
    ...(typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration >= 0 ? { duration: info.duration } : {}),
    ...(info.is_live === true || info.live_status === "is_live" ? { live: true } : {}),
  };
}

// A channel's page is its sections. Its name and avatar come from yt-dlp's listing, without its videos, so the page
// and a Save made there name the channel rather than its address (a UC… ID); the address stays the fallback.
async function channelPage(url: string, run: typeof runYtDlp, signal?: AbortSignal): Promise<ProviderPage> {
  let info: Metadata = {};
  try {
    const parsed: unknown = JSON.parse(await run(["--use-extractors", "youtube.*,end", "--flat-playlist", "--dump-single-json", "--playlist-items", "0", "--", url], { signal }));
    if (object(parsed)) info = parsed;
  } catch { signal?.throwIfAborted(); }
  return {
    title: label(info.channel) ?? label(info.uploader) ?? label(decodeURIComponent(new URL(url).pathname.split("/").at(-1)!)),
    thumbnail: thumbnail(info, { url, kind: "channel" }),
    items: [["videos", "Videos"], ["playlists", "Playlists"], ["shorts", "Shorts"], ["streams", "Live streams"]].map(([tab, title]) => ({
      id: providerItemId("youtube", `${url}/${tab}`), provider: "youtube", kind: "collection", title: title!, url: `${url}/${tab}`,
    })),
  };
}

export function createYouTubeBrowser(run: typeof runYtDlp = runYtDlp) {
  return async function browseYouTube(request: BrowseRequest, signal?: AbortSignal): Promise<ProviderPage> {
    signal?.throwIfAborted();
    if (request.query !== undefined && (typeof request.query !== "string" || request.query.length > 200 || /[\u0000-\u001f\u007f]/.test(request.query))) throw new ProviderError("Enter a YouTube search of at most 200 characters.", 400);
    if (request.url !== undefined && typeof request.url !== "string") throw new ProviderError("Enter a YouTube video, channel, or playlist URL.", 400);
    if (request.cursor !== undefined && (typeof request.cursor !== "string" || !/^(?:0|[1-9]\d{0,3})$/.test(request.cursor))) throw new ProviderError("Invalid YouTube page. Start a new search.", 400);
    const offset = Number(request.cursor ?? "0");
    if (offset > maxOffset || offset % pageSize !== 0) throw new ProviderError("Invalid YouTube page. Start a new search.", 400);
    const query = request.query?.trim() ?? "";
    if (!request.url && !query) {
      if (offset) throw new ProviderError("Invalid YouTube page. Start a new search.", 400);
      return { title: "YouTube", items: [] };
    }
    const source = target(request.url || (/^https?:\/\//i.test(query) ? query : query.startsWith("@") ? `https://www.youtube.com/${encodeURIComponent(query).replace(/^%40/, "@")}` : searchUrl(query)));
    if (source.kind === "channel") {
      if (offset) throw new ProviderError("Invalid YouTube page. Open a channel section first.", 400);
      return withProviderItem("youtube", source.url, "channel", await channelPage(source.url, run, signal));
    }
    if (source.kind === "media" && offset) throw new ProviderError("Invalid YouTube page. Start a new search.", 400);
    const output = await run(["--use-extractors", "youtube.*,end", "--flat-playlist", "--dump-single-json", "--playlist-items", `${offset + 1}:${offset + pageSize + 1}`, "--", source.url], { signal });
    signal?.throwIfAborted();
    let info: unknown;
    try { info = JSON.parse(output); } catch { throw new Error("YouTube returned invalid catalog information. Update yt-dlp and try again."); }
    if (!object(info) || (info.entries !== undefined && !Array.isArray(info.entries))) throw new Error("YouTube returned invalid catalog information.");
    const entries = Array.isArray(info.entries) ? info.entries : [info];
    const page: ProviderPage = {
      title: label(info.title) ?? "YouTube",
      ...(/\/(?:videos|shorts|streams|playlists)$/.test(new URL(source.url).pathname) ? { parent: { title: label(info.channel) ?? label(info.uploader) ?? "Channel", url: source.url.replace(/\/(?:videos|shorts|streams|playlists)$/, "") } } : {}),
      ...(source.kind === "collection" ? { thumbnail: thumbnail(info, source), description: label(info.description, 2000), subtitle: label(info.channel) ?? label(info.uploader) } : {}),
      items: entries.slice(0, pageSize).map((raw, index) => {
        const entry = item(raw);
        return entry?.kind === "media" && isYouTubePlaylistUrl(source.url) ? { ...entry, collection: { title: label(info.title) ?? "YouTube playlist", url: source.url, index: offset + index } } : entry;
      }).filter((entry): entry is ProviderItem => entry !== null),
      ...(entries.length > pageSize && offset < maxOffset ? { nextCursor: String(offset + pageSize) } : {}),
    };
    return source.kind === "search" ? page : withProviderItem("youtube", source.url, source.kind, page);
  };
}

export const browseYouTube = createYouTubeBrowser();

export function createYouTubePlaylistLoader(run: typeof runYtDlp = runYtDlp) {
  return async (url: string, signal?: AbortSignal): Promise<ProviderPage> => {
    signal?.throwIfAborted();
    const source = target(url);
    if (source.kind === "channel") source.url = `${source.url.replace(/\/$/, "")}/videos`;
    const channelSection = source.kind === "collection" && /\/(?:videos|shorts|streams)$/.test(source.url);
    if (!isYouTubePlaylistUrl(source.url) && !channelSection) throw new ProviderError("Choose a YouTube playlist or channel list link.", 400);
    const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
    const output = await run(["--use-extractors", "youtube.*,end", "--flat-playlist", "--dump-single-json", "--playlist-items", "1:501", "--", source.url], { signal: cancellation });
    cancellation.throwIfAborted();
    let info: unknown;
    try { info = JSON.parse(output); } catch { throw new ProviderError("YouTube returned invalid playlist information."); }
    if (!object(info) || info._type !== "playlist" || !Array.isArray(info.entries)) throw new ProviderError("YouTube returned invalid playlist information.");
    if (info.entries.length > 500 || typeof info.playlist_count === "number" && info.playlist_count > 500) throw new ProviderError("This playlist has more than 500 videos. Add individual videos instead.", 400);
    if (isYouTubePlaylistUrl(source.url) && info.playlist_count != null && info.playlist_count !== info.entries.length) throw new ProviderError("YouTube returned an incomplete playlist. Try again or add individual videos.");
    if (info.webpage_url !== undefined) {
      if (typeof info.webpage_url !== "string") throw new ProviderError("YouTube returned a different playlist.");
      const returned = target(info.webpage_url).url;
      const sameChannel = channelSection && returned.replace(/\/(?:videos|shorts|streams)$/, "") === source.url.replace(/\/(?:videos|shorts|streams)$/, "");
      if (returned !== source.url && !sameChannel) throw new ProviderError("YouTube returned a different playlist.");
    }
    const items = info.entries.map(item);
    if (!items.length) throw new ProviderError("This playlist is empty.");
    if (items.some(entry => !entry || entry.kind !== "media")) throw new ProviderError("Some videos in this playlist are unavailable. Add the available videos individually.");
    return { title: label(info.title) ?? (channelSection ? "YouTube channel" : "YouTube playlist"), items: items as ProviderItem[] };
  };
}

export const loadYouTubePlaylist = createYouTubePlaylistLoader();
