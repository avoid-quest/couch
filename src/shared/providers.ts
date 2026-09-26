import type { MediaShape } from "./media";
import { isStreamingCommunityHost } from "./streamingcommunity";

export type ProviderId = "youtube" | "twitch" | "raiplay" | "bandcamp" | "streamingcommunity";
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
  collection?: { title: string; url: string; index?: number };
  duration?: number;
  live?: boolean;
};

export type ProviderPage = { item?: ProviderItem; items: ProviderItem[]; nextCursor?: string; title?: string; thumbnail?: string; description?: string; subtitle?: string };
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
    const domains: Partial<Record<ProviderId, string[]>> = { youtube: ["youtube.com", "youtu.be"], twitch: ["twitch.tv"], raiplay: ["raiplay.it"], bandcamp: ["bandcamp.com"] };
    return (Object.keys(domains) as ProviderId[]).find(provider => domains[provider]!.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)));
  } catch { return; }
}
