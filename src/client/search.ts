import { linkTarget, providerForUrl } from "../shared/providers";
import { searchWords } from "../shared/search-text";
import type { SearchHit } from "./sections/find/SearchOnlineResults";

// A page's address as copies name it: host without www, path decoded, no query or trailing slash, except a YouTube watch
// page's `?v=`, the only part naming its video.
function pageKey(url?: string) {
  if (!url) return;
  try {
    const page = new URL(url);
    const host = page.hostname.replace(/^www\./, "");
    const path = decodeURIComponent(page.pathname).replace(/\/$/, "");
    const video = /(?:^|\.)youtube\.com$/.test(host) ? page.searchParams.get("v") : null;
    return `${host}${path}${video ? `?v=${video}` : ""}`.toLowerCase();
  } catch {
    return;
  }
}
type Copyable = Pick<
  SearchHit,
  "source" | "title" | "url" | "duration" | "copies" | "also" | "creator" | "meta"
>;
const names = (from: Copyable, page?: string) =>
  !!page && !!from.copies?.some((copy) => pageKey(copy) === page);
// Who a hit is by: its creator, else its byline's first name; a byline of only the source's name names nobody.
function artist(hit: Copyable) {
  const byline = hit.meta?.split(/ · |, /)[0];
  return searchWords(hit.creator?.title ?? (byline === hit.source ? "" : (byline ?? "")));
}
// One artist names the other when either is unknown or one's words are all in the other's ("Pitbull - Topic").
function sameArtist(a: Copyable, b: Copyable) {
  const [one, other] = [artist(a), artist(b)];
  return (
    !one.length ||
    !other.length ||
    one.every((word) => other.includes(word)) ||
    other.every((word) => one.includes(word))
  );
}
// Another source's hit is the same recording when either names the other's page as a copy, or when the titles and
// artists match and the lengths are within a minute (uploads trim a little silence).
function sameRecording(kept: Copyable, hit: Copyable) {
  if (kept.source === hit.source) return false;
  if (names(kept, pageKey(hit.url)) || names(hit, pageKey(kept.url))) return true;
  return (
    kept.duration != null &&
    hit.duration != null &&
    Math.abs(kept.duration - hit.duration) <= 60 &&
    searchWords(kept.title).join(" ") === searchWords(hit.title).join(" ") &&
    sameArtist(kept, hit)
  );
}
/**
 * The same recording from several sources shows once, with the other sources in `also`: a radio episode and its Mixcloud
 * and SoundCloud uploads are one hit, the episode "also on Mixcloud and SoundCloud". The one that names the others as
 * its copies (the station's own) stands for them, else the one that came first.
 */
export function foldCopies<T extends Copyable>(hits: readonly T[]): T[] {
  const kept: T[] = [];
  for (const hit of hits) {
    const matched = kept.filter((other) => sameRecording(other, hit));
    if (!matched.length) {
      kept.push(hit);
      continue;
    }
    const first = matched.some((other) => names(hit, pageKey(other.url))) ? hit : matched[0]!;
    const folded = [...matched, hit].filter((each) => each !== first);
    kept[kept.indexOf(matched[0]!)] = {
      ...first,
      also: [
        ...new Set([
          ...(first.also ?? []),
          ...folded.flatMap((copy) => [...(copy.also ?? []), copy.source]),
        ]),
      ].filter((source) => source !== first.source),
      copies: [
        ...(first.copies ?? []),
        ...folded.flatMap((copy) => [...(copy.copies ?? []), ...(copy.url ? [copy.url] : [])]),
      ],
    };
    for (const other of matched.slice(1)) kept.splice(kept.indexOf(other), 1);
  }
  return kept;
}

const searchSources = [
  "All",
  "Shared sources",
  "YouTube",
  "Bandcamp",
  "SoundCloud",
  "Mixcloud",
  "Spotify",
  "Radio archives",
  "RaiPlay",
  "StreamingCommunity",
  "123MoviesFree",
  "AnimeSaturn",
  "AnimeUnity",
  "avoid radio",
  "Radio playlists",
  "Radio directory",
  "Twitch",
];
/** What Search narrows by first; channels and lists show under videos. */
const searchKinds = ["films", "live", "radio", "music", "videos", "audio"] as const;
export type SearchKind = (typeof searchKinds)[number];
export type SearchRouteState = { query: string; source: string; kind?: SearchKind };
/**
 * The kinds each source can return, so a kind waits on, and reports problems from, only the sources that could answer
 * it. Catalogues' series and RaiPlay's programmes are films and series; channels and lists are videos.
 */
const sourceKinds: Record<string, readonly SearchKind[]> = {
  "Shared sources": ["live"],
  YouTube: ["videos", "live", "audio"],
  Bandcamp: ["music", "audio"],
  SoundCloud: ["music", "audio"],
  Mixcloud: ["music", "audio"],
  Spotify: ["music", "audio"],
  "Radio archives": ["music", "audio"],
  Twitch: ["live", "videos"],
  RaiPlay: ["films", "videos", "live"],
  StreamingCommunity: ["films"],
  "123MoviesFree": ["films", "videos"],
  AnimeSaturn: ["films"],
  AnimeUnity: ["films"],
  "avoid radio": ["radio"],
  "Radio playlists": ["radio"],
  "Radio directory": ["radio"],
};
export const canReturn = (source: string, kind?: SearchKind) =>
  !kind || source === "All" || (sourceKinds[source] ?? searchKinds).includes(kind);
export function readSearchState(
  search: string | Record<string, string | string[] | undefined>,
): SearchRouteState {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search)
      : new URLSearchParams(
          Object.entries(search).flatMap(([key, value]) =>
            value === undefined
              ? []
              : ([[key, Array.isArray(value) ? (value[0] ?? "") : value]] as [string, string][]),
          ),
        );
  const kind = searchKinds.find((value) => value === params.get("kind"));
  return {
    ...(kind ? { kind } : {}),
    query: (params.get("q") ?? "").slice(0, 4096),
    source: searchSources.find((source) => source === params.get("source")) ?? "All",
  };
}
export function searchLocation(state: SearchRouteState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.kind && searchKinds.includes(state.kind)) params.set("kind", state.kind);
  if (state.source !== "All" && searchSources.includes(state.source))
    params.set("source", state.source);
  return `/search${params.size ? `?${params}` : ""}`;
}
/**
 * A pasted web address, which opens as a page or as media rather than searching: as typed with its scheme, or as https
 * when it starts with a host one of Couch's sources knows (`soundcloud.com/…`), as people copy it. Words are never a link.
 */
export function linkOf(value: string) {
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).hostname ? value : undefined;
    } catch {
      return;
    }
  }
  if (/\s/.test(value)) return;
  const url = `https://${value}`;
  return providerForUrl(url) || linkTarget(url) ? url : undefined;
}
export const isLink = (value: string) => !!linkOf(value);

/**
 * How hits answer a query. A word matches a whole word of the hit, folded; while `typing`, the last word may be the start
 * of one until a space finishes it, so "dj al" already finds DJ Alé and "dj ale " or a submitted "dj ale" doesn't find
 * DJ Alex.
 */
export function searchRelevance(query: string, typing = false) {
  const words = searchWords(query);
  const open = typing && !/\s$/.test(query);
  const matches = (part: string, word: string) =>
    part === word || (open && word === words.at(-1) && part.startsWith(word));
  const mentions = (text: string, word: string) =>
    searchWords(text).some((part) => matches(part, word));
  /** How well a title answers the query: 3 when it is the query, 2 when it has every word, 1 when it has some. */
  const strength = (title: string) => {
    if (!words.length) return 0;
    const parts = searchWords(title);
    if (parts.join(" ") === words.join(" ")) return 3;
    const found = words.filter((word) => parts.some((part) => matches(part, word))).length;
    return found === words.length ? 2 : found ? 1 : 0;
  };
  return {
    /** Whether every word of the query is in the hit's title, artist, album, show or station details. */
    close: (hit: Pick<SearchHit, "title" | "meta" | "radio" | "creator" | "context">) =>
      !words.length ||
      words.every((word) =>
        mentions(
          [
            hit.title,
            hit.meta,
            hit.creator?.title,
            hit.context?.title,
            hit.radio?.host,
            hit.radio?.group,
            ...(hit.radio?.tags ?? []),
            ...(hit.radio?.categories ?? []),
          ].join(" "),
          word,
        ),
      ),
    strong: (hit: Pick<SearchHit, "title">) => strength(hit.title) >= 2,
    strength,
    /**
     * Whether the query is the hit's artist and its whole title, in either order ("miles davis kind of blue", "the band
     * the weight"). The artist is its creator, else its byline's first name (a Spotify album's "Miles Davis").
     */
    credited: (hit: Pick<SearchHit, "title" | "creator" | "meta">) => {
      const artist = searchWords(hit.creator?.title ?? hit.meta?.split(/ · |, /)[0] ?? "");
      const title = searchWords(hit.title);
      const reads = (parts: string[]) =>
        parts.length === words.length && parts.every((part, index) => matches(part, words[index]!));
      // Or the artist's words anywhere ("davis miles kind of blue"), the rest the whole title in order.
      const rest = words.filter((word) => !artist.includes(word));
      const around =
        artist.every((part) => words.includes(part)) &&
        rest.length === title.length &&
        rest.every((word, index) => matches(title[index]!, word));
      return (
        !!artist.length &&
        !!title.length &&
        (reads([...artist, ...title]) || reads([...title, ...artist]) || around)
      );
    },
  };
}
