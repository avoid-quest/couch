export type ProviderId = "youtube" | "twitch" | "raiplay" | "bandcamp";
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
  duration?: number;
  live?: boolean;
};

export type ProviderPage = { items: ProviderItem[]; nextCursor?: string; title?: string };
export type BrowseRequest = { query?: string; url?: string; cursor?: string };

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
    const domains = { youtube: ["youtube.com", "youtu.be"], twitch: ["twitch.tv"], raiplay: ["raiplay.it"], bandcamp: ["bandcamp.com"] };
    return (Object.keys(domains) as ProviderId[]).find(provider => domains[provider].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)));
  } catch { return; }
}
