import { searchWords } from "../shared/search-text";
import type { SearchHit } from "./sections/find/SearchOnlineResults";

// A page's address as copies name it: host without www, path decoded, no query or trailing slash.
function pageKey(url?: string) {
  if (!url) return;
  try {
    const page = new URL(url);
    const path = decodeURIComponent(page.pathname).replace(/\/$/, "");
    return `${page.hostname.replace(/^www\./, "")}${path}`.toLowerCase();
  } catch {
    return;
  }
}
type Copyable = Pick<SearchHit, "source" | "title" | "url" | "duration" | "copies" | "also">;
const names = (from: Copyable, page?: string) =>
  !!page && !!from.copies?.some((copy) => pageKey(copy) === page);
// Another source's hit is the same recording when either names the other's page as a copy, or when the titles match and
// the lengths are within a minute (uploads trim a little silence).
function sameRecording(kept: Copyable, hit: Copyable) {
  if (kept.source === hit.source) return false;
  if (names(kept, pageKey(hit.url)) || names(hit, pageKey(kept.url))) return true;
  return (
    kept.duration != null &&
    hit.duration != null &&
    Math.abs(kept.duration - hit.duration) <= 60 &&
    searchWords(kept.title).join(" ") === searchWords(hit.title).join(" ")
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
    const at = kept.findIndex((other) => sameRecording(other, hit));
    if (at < 0) {
      kept.push(hit);
      continue;
    }
    const other = kept[at]!;
    const [first, copy] = names(hit, pageKey(other.url)) ? [hit, other] : [other, hit];
    kept[at] = {
      ...first,
      also: [...new Set([...(first.also ?? []), ...(copy.also ?? []), copy.source])].filter(
        (source) => source !== first.source,
      ),
      copies: [...(first.copies ?? []), ...(copy.copies ?? []), ...(copy.url ? [copy.url] : [])],
    };
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
/** A pasted web address, which opens as a page or as media rather than searching. */
export const isLink = (value: string) => {
  try {
    return /^https?:\/\//i.test(value) && !!new URL(value).hostname;
  } catch {
    return false;
  }
};

export function searchRelevance(query: string) {
  const words = searchWords(query);
  const mentions = (text: string, word: string) =>
    searchWords(text).some((part) => part.startsWith(word));
  /** How well a title answers the query: 3 when it is the query, 2 when every word starts one of its words, 1 when some word does. */
  const strength = (title: string) => {
    if (!words.length) return 0;
    const parts = searchWords(title);
    if (parts.join(" ") === words.join(" ")) return 3;
    const found = words.filter((word) => parts.some((part) => part.startsWith(word))).length;
    return found === words.length ? 2 : found ? 1 : 0;
  };
  return {
    close: (hit: Pick<SearchHit, "title" | "meta" | "radio">) =>
      !words.length ||
      words.some((word) =>
        mentions(
          [
            hit.title,
            hit.meta,
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
  };
}
