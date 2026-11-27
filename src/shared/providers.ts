import type { CollectionLink, MediaCollection, MediaShape } from "./media";
import { isStreamingCommunityHost } from "./streamingcommunity";
import { isAnimeSaturnHost, animeSaturnPageUrl } from "./animesaturn";
import { isAnimeUnityHost, animeUnityPageUrl } from "./animeunity";
import { isMovies123Host, movies123Origin, movies123PageUrl } from "./movies123";
import { archiveLink, isArchiveHost } from "./archives";
import { isMixcloudHost, mixcloudLink } from "./mixcloud";

export type ProviderId =
  | "youtube"
  | "twitch"
  | "raiplay"
  | "bandcamp"
  | "soundcloud"
  | "streamingcommunity"
  | "movies123"
  | "animesaturn"
  | "animeunity"
  | "mixcloud"
  | "archives"
  | "spotify";
export type VideoQuality = "auto" | "best" | "1080p" | "720p" | "480p";

export const providerPageSize = 24;
export const youtubeMaxOffset = 2_400;
// Include every occurrence on YouTube's final supported page.
export const maxCollectionIndex = youtubeMaxOffset + providerPageSize - 1;

export type ProviderItem = {
  id: string;
  provider: ProviderId;
  kind: "media" | "collection" | "channel";
  title: string;
  url: string;
  thumbnail?: string;
  description?: string;
  subtitle?: string;
  creator?: CollectionLink;
  /** Canonical containing list, with its zero-based occurrence when known. */
  collection?: MediaCollection;
  duration?: number;
  live?: boolean;
};

export type ProviderPage = {
  item?: ProviderItem;
  items: ProviderItem[];
  /** How many items the whole list holds, when the source says (a paged list shows only its first). */
  count?: number;
  nextCursor?: string;
  title?: string;
  thumbnail?: string;
  description?: string;
  subtitle?: string;
  parent?: CollectionLink;
};
export type BrowseRequest = { query?: string; url?: string; cursor?: string };

/** A section of a page (RaiPlay's "In Diretta" on its front page): that page's row, not a programme to save. */
export const pageSection = (item: Pick<ProviderItem, "provider" | "url">) =>
  item.provider === "raiplay" && /#block=/.test(item.url);

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
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(
        url.hostname,
      ) &&
      ["/playlist", "/watch"].includes(url.pathname.replace(/\/$/, "")) &&
      /^[A-Za-z0-9_-]{10,100}$/.test(url.searchParams.get("list") ?? "")
    );
  } catch {
    return false;
  }
}

export function providerForUrl(value: string): ProviderId | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    if (isStreamingCommunityHost(url.hostname)) return "streamingcommunity";
    if (isMovies123Host(url.hostname)) return "movies123";
    if (isAnimeSaturnHost(url.hostname)) return "animesaturn";
    if (isAnimeUnityHost(url.hostname)) return "animeunity";
    if (isMixcloudHost(url.hostname)) return "mixcloud";
    if (isArchiveHost(url.hostname)) return "archives";
    const domains: Partial<Record<ProviderId, string[]>> = {
      youtube: ["youtube.com", "youtu.be"],
      twitch: ["twitch.tv"],
      raiplay: ["raiplay.it"],
      bandcamp: ["bandcamp.com"],
      soundcloud: ["soundcloud.com"],
      spotify: ["open.spotify.com"],
    };
    return (Object.keys(domains) as ProviderId[]).find((provider) =>
      domains[provider]!.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      ),
    );
  } catch {
    return;
  }
}

/** Public playable page only: never a direct stream, signed link or arbitrary provider path. */
export function publicProviderMediaUrl(value: string): string | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value),
      provider = providerForUrl(value);
    if (!provider || url.port || url.hash) return;
    const path = url.pathname.replace(/\/$/, "");
    if (provider === "mixcloud" || provider === "archives") {
      const link = provider === "mixcloud" ? mixcloudLink(value) : archiveLink(value);
      return link?.shape === "atom" ? link.url : undefined;
    }
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
      return page && (page.pathname.startsWith("/movie/") || page.searchParams.has("episode"))
        ? `${movies123Origin}${page.pathname}${page.search}`
        : undefined;
    }
    if (
      provider === "streamingcommunity" &&
      /^\/(?:[a-z]{2}\/)?(?:titles\/\d+(?:-[\w-]+)?|watch\/\d+)$/.test(path) &&
      (!url.search || (/^\?e=\d+$/.test(url.search) && /\/watch\/\d+$/.test(path)))
    )
      return url.href;
    if (provider === "youtube") {
      if (
        ![
          "youtube.com",
          "www.youtube.com",
          "m.youtube.com",
          "music.youtube.com",
          "youtu.be",
          "www.youtu.be",
        ].includes(url.hostname)
      )
        return;
      const short = url.hostname.endsWith("youtu.be"),
        id = short
          ? path.slice(1)
          : path === "/watch"
            ? url.searchParams.get("v")
            : path.match(/^\/(?:shorts|live|embed)\/([^/]+)$/)?.[1];
      const publicQuery =
        !short && path === "/watch" ? /^\?v=[A-Za-z0-9_-]{11}$/.test(url.search) : !url.search;
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id) && publicQuery)
        return `https://www.youtube.com/watch?v=${id}`;
    }
    if (provider === "spotify") {
      const link = spotifyLink(value);
      return link?.kind === "track" ? link.url : undefined;
    }
    if (url.search) return;
    if (
      provider === "soundcloud" &&
      ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(url.hostname) &&
      /^\/[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(path) &&
      !/^\/(?:search|discover|you|stations|charts|library)\//i.test(path) &&
      !/\/(?:sets|tracks|albums|reposts|popular-tracks)$/i.test(path)
    )
      return `https://soundcloud.com${path}`;
    if (
      provider === "raiplay" &&
      ["raiplay.it", "www.raiplay.it"].includes(url.hostname) &&
      /^\/video\/\d{4}\/\d{2}\/[a-z0-9_%.-]+\.(?:html|json)$/i.test(path)
    )
      return `https://www.raiplay.it${path.replace(/\.json$/, ".html")}`;
    if (
      provider === "bandcamp" &&
      /^[a-z0-9-]+\.bandcamp\.com$/.test(url.hostname) &&
      /^\/track\/[a-z0-9-]+$/.test(path)
    )
      return `https://${url.hostname}${path}`;
    if (
      provider === "twitch" &&
      ["twitch.tv", "www.twitch.tv"].includes(url.hostname) &&
      /^\/videos\/\d+$/.test(path)
    )
      return `https://www.twitch.tv${path}`;
  } catch {
    /* Optional public metadata. */
  }
}

export const providerNames: Record<ProviderId, string> = {
  youtube: "YouTube",
  raiplay: "RaiPlay",
  twitch: "Twitch",
  bandcamp: "Bandcamp",
  soundcloud: "SoundCloud",
  streamingcommunity: "StreamingCommunity",
  movies123: "123MoviesFree",
  animesaturn: "AnimeSaturn",
  animeunity: "AnimeUnity",
  mixcloud: "Mixcloud",
  archives: "Radio archives",
  spotify: "Spotify",
};

const soundCloudHosts = ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"];
// First path segments that are SoundCloud's own pages, not a profile.
const soundCloudPages =
  /^(?:search|discover|you|stations|charts|library|upload|pages|settings|messages|notifications|feed|people|tags|jobs|imprint|pro|connect|mobile|logout|signin|terms-of-use|popular)$/i;

/** A public SoundCloud set (`/<user>/sets/<set>`) or profile (`/<user>`), canonical; never a private or reserved page. */
export function soundCloudListUrl(value: string): string | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !soundCloudHosts.includes(url.hostname) ||
      url.searchParams.has("secret_token")
    )
      return;
    const path = url.pathname.replace(/\/$/, "");
    const match = /^\/([a-z0-9_-]+)(\/sets\/[a-z0-9_-]+)?$/i.exec(path);
    if (!match || soundCloudPages.test(match[1]!)) return;
    return `https://soundcloud.com${path}`;
  } catch {
    return;
  }
}

// bandcamp.com's own pages, not a fan's.
const bandcampPages =
  /^(?:api|search|tag|tags|discover|login|signup|help|about|artists|fans|labels|terms_of_use|privacy|guide|gift_cards|settings|yum|feed|apps|developer|community|daily|EmbeddedPlayer|stream_redirect|download|cart|contact)$/i;

/** A Bandcamp fan's public collection (`bandcamp.com/<fan>`) or wishlist (`/<fan>/wishlist`), canonical. */
export function bandcampFanUrl(
  value: string,
): { url: string; fan: string; list: "collection" | "wishlist" } | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !["bandcamp.com", "www.bandcamp.com"].includes(url.hostname)
    )
      return;
    const match = /^\/([a-z0-9_]{1,64})(\/wishlist)?\/?$/i.exec(url.pathname);
    if (!match || bandcampPages.test(match[1]!)) return;
    const fan = match[1]!.toLowerCase();
    return {
      url: `https://bandcamp.com/${fan}${match[2] ? "/wishlist" : ""}`,
      fan,
      list: match[2] ? "wishlist" : "collection",
    };
  } catch {
    return;
  }
}

/** A Spotify track, album or playlist link (`open.spotify.com[/intl-xx]/<kind>/<id>`), canonical. */
export function spotifyLink(
  value: string,
): { url: string; kind: "track" | "album" | "playlist"; id: string } | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname !== "open.spotify.com"
    )
      return;
    const match =
      /^(?:\/intl-[a-z]{2}(?:-[a-z]{2})?)?\/(track|album|playlist)\/([A-Za-z0-9]{22})\/?$/i.exec(
        url.pathname,
      );
    if (!match) return;
    const kind = match[1]!.toLowerCase() as "track" | "album" | "playlist";
    return { url: `https://open.spotify.com/${kind}/${match[2]}`, kind, id: match[2]! };
  } catch {
    return;
  }
}

/**
 * What a pasted link is, from its URL alone (no fetch, so Enter is always safe): an `atom` plays by itself, a `playlist`
 * queues whole, and a `page` (a channel, a series, a category) is opened to choose from. Undefined: Couch's providers
 * don't open it, and it plays as a webpage.
 */
export type LinkTarget = { provider: ProviderId; shape: MediaShape | "page" };
type LinkClassifier = (url: string) => LinkTarget | undefined;

function builtInLink(value: string): LinkTarget | undefined {
  const provider = providerForUrl(value);
  if (!provider) return;
  const path = new URL(value).pathname.replace(/\/$/, "");
  // Twitch pages list only channels and categories; a VOD plays as a webpage.
  if (provider === "twitch")
    return path.startsWith("/videos/") ? undefined : { provider, shape: "page" };
  if (provider === "spotify") {
    const link = spotifyLink(value);
    return link && { provider, shape: link.kind === "track" ? "atom" : "playlist" };
  }
  if (provider === "youtube" && isYouTubePlaylistUrl(value))
    return { provider, shape: path === "/playlist" ? "playlist" : "atom" };
  // Share links carry tracking and start-time parameters (`?si=`, `&t=`) that don't change what plays.
  const page = new URL(value);
  page.hash = "";
  if (provider === "youtube") {
    const v = page.searchParams.get("v");
    page.search = path === "/watch" && v ? `?v=${encodeURIComponent(v)}` : "";
  } else if (["soundcloud", "bandcamp", "raiplay"].includes(provider)) page.search = "";
  if (publicProviderMediaUrl(page.href)) return { provider, shape: "atom" };
  if (provider === "soundcloud")
    return soundCloudListUrl(value) ? { provider, shape: "playlist" } : undefined;
  if (provider === "bandcamp")
    return /^[a-z0-9-]+\.bandcamp\.com$/i.test(new URL(value).hostname) &&
      /^\/album\/[a-z0-9_-]+$/i.test(path)
      ? { provider, shape: "playlist" }
      : bandcampFanUrl(value)
        ? { provider, shape: "playlist" }
        : undefined;
  return { provider, shape: "page" };
}

/** Each host's classifier, first match wins. */
const linkClassifiers: LinkClassifier[] = [
  (value) => {
    const link = archiveLink(value) ?? mixcloudLink(value);
    return link && { provider: link.provider, shape: link.shape };
  },
  builtInLink,
];

export function linkTarget(value: string): LinkTarget | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
  } catch {
    return;
  }
  for (const classify of linkClassifiers) {
    const target = classify(value);
    if (target) return target;
  }
}
