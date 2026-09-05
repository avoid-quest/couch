export type ProviderId = "youtube" | "twitch" | "raiplay";
export type VideoQuality = "best" | "1080p" | "720p" | "480p";

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
