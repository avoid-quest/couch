import type { CollectionLink, MediaCollection, MediaShape } from "./media";
import { isStreamingCommunityHost } from "./streamingcommunity";
import { isAnimeSaturnHost, animeSaturnPageUrl } from "./animesaturn";
import { isAnimeUnityHost, animeUnityPageUrl } from "./animeunity";
import { isMovies123Host, movies123Origin, movies123PageUrl } from "./movies123";

export type ProviderId = "youtube" | "twitch" | "raiplay" | "bandcamp" | "soundcloud" | "streamingcommunity" | "movies123" | "animesaturn" | "animeunity";
export type VideoQuality = "auto" | "best" | "1080p" | "720p" | "480p";

export type ProviderItem = {
  id: string;
  provider: ProviderId;
  kind: "media" | "collection" | "channel";
  title: string;
  url: string;
  thumbnail?: string;
  description?: string;
  subtitle?: string;
  /** Canonical containing list, with its zero-based occurrence when known. */
  collection?: MediaCollection;
  duration?: number;
  live?: boolean;
};

export type ProviderPage = { item?: ProviderItem; items: ProviderItem[]; nextCursor?: string; title?: string; thumbnail?: string; description?: string; subtitle?: string; parent?: CollectionLink };
export type BrowseRequest = { query?: string; url?: string; cursor?: string };

export const providerShape = (item: Pick<ProviderItem, "kind">): MediaShape =>
  item.kind === "media" ? "atom" : "playlist";
// Lightweight title refresh from StreamingCommunity's preview endpoint. The
// caller keeps the item's own name and link; the site's preview omits both.
export type StreamingCommunityPreview = {
  id: number;
  kind: "movie" | "series";
  year?: string;
  quality?: string;
  runtime?: number;
  seasonsCount?: number;
  plot?: string;
  genres: string[];
  thumbnail?: string;
};

export function isYouTubePlaylistUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.port
      && ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(url.hostname)
      && ["/playlist", "/watch"].includes(url.pathname.replace(/\/$/, "")) && /^[A-Za-z0-9_-]{10,100}$/.test(url.searchParams.get("list") ?? "");
  } catch { return false; }
}

export function providerForUrl(value: string): ProviderId | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    if (isStreamingCommunityHost(url.hostname)) return "streamingcommunity";
    if (isMovies123Host(url.hostname)) return "movies123";
    if (isAnimeSaturnHost(url.hostname)) return "animesaturn";
    if (isAnimeUnityHost(url.hostname)) return "animeunity";
    const domains: Partial<Record<ProviderId, string[]>> = { youtube: ["youtube.com", "youtu.be"], twitch: ["twitch.tv"], raiplay: ["raiplay.it"], bandcamp: ["bandcamp.com"], soundcloud: ["soundcloud.com"] };
    return (Object.keys(domains) as ProviderId[]).find(provider => domains[provider]!.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)));
  } catch { return; }
}

/** Public playable page only: never a direct stream, signed link or arbitrary provider path. */
export function publicProviderMediaUrl(value: string): string | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value), provider = providerForUrl(value);
    if (!provider || url.port || url.hash) return;
    const path = url.pathname.replace(/\/$/, "");
    if (provider === "animesaturn") {
      const page = animeSaturnPageUrl(value);
      return page && !page.pathname.startsWith("/anime/") ? page.href : undefined;
    }
    if (provider === "animeunity") {
      const page = animeUnityPageUrl(value);
      return page && /^\/anime\/[^/]+\/\d+$/.test(page.pathname) ? page.href : undefined;
    }
    if (provider === "movies123") {
      const page = movies123PageUrl(value);
      return page && (page.pathname.startsWith("/movie/") || page.searchParams.has("episode")) ? `${movies123Origin}${page.pathname}${page.search}` : undefined;
    }
    if (provider === "streamingcommunity" && /^\/(?:[a-z]{2}\/)?(?:titles\/\d+(?:-[\w-]+)?|watch\/\d+)$/.test(path)
      && (!url.search || /^\?e=\d+$/.test(url.search) && /\/watch\/\d+$/.test(path))) return url.href;
    if (provider === "youtube") {
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"].includes(url.hostname)) return;
      const short = url.hostname.endsWith("youtu.be"), id = short ? path.slice(1) : path === "/watch" ? url.searchParams.get("v") : path.match(/^\/(?:shorts|live|embed)\/([^/]+)$/)?.[1];
      const publicQuery = !short && path === "/watch" ? /^\?v=[A-Za-z0-9_-]{11}$/.test(url.search) : !url.search;
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id) && publicQuery) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (url.search) return;
    if (provider === "soundcloud" && ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(url.hostname) && /^\/[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(path)
      && !/^\/(?:search|discover|you|stations|charts|library)\//i.test(path) && !/\/(?:sets|tracks|albums|reposts|popular-tracks)$/i.test(path)) return `https://soundcloud.com${path}`;
    if (provider === "raiplay" && ["raiplay.it", "www.raiplay.it"].includes(url.hostname) && /^\/video\/\d{4}\/\d{2}\/[a-z0-9_%.-]+\.(?:html|json)$/i.test(path)) return `https://www.raiplay.it${path.replace(/\.json$/, ".html")}`;
    if (provider === "bandcamp" && /^[a-z0-9-]+\.bandcamp\.com$/.test(url.hostname) && /^\/track\/[a-z0-9-]+$/.test(path)) return `https://${url.hostname}${path}`;
    if (provider === "twitch" && ["twitch.tv", "www.twitch.tv"].includes(url.hostname) && /^\/videos\/\d+$/.test(path)) return `https://www.twitch.tv${path}`;
  } catch { /* Optional public metadata. */ }
}
