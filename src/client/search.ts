import { searchWords } from "../shared/search-text";
import type { SearchHit } from "./sections/find/SearchOnlineResults";

/**
 * Every source's hits as one ranked list: the strongest title match first (`searchRelevance`'s strength), then the
 * sources taking turns in `sources`' order, then each source's own order.
 */
export function mergeSearchHits(
  sources: readonly string[],
  hits: Record<string, SearchHit[]>,
  query: string,
) {
  const { strength } = searchRelevance(query);
  return sources
    .flatMap((source, rank) =>
      (hits[source] ?? []).map((hit, index) => ({
        hit,
        strength: strength(hit.title),
        order: index * sources.length + rank,
      })),
    )
    .sort((a, b) => b.strength - a.strength || a.order - b.order)
    .map(({ hit }) => hit);
}
/**
 * The ranked hits with the ones already shown up to and including `held` (the focused hit) kept where they were, so
 * what arrives later only lands below it and nothing moves under the focus.
 */
export function keepShown<T extends { id: string }>(
  shown: readonly string[],
  ranked: readonly T[],
  held: string | null,
): T[] {
  const through = held ? shown.indexOf(held) + 1 : 0;
  const byId = new Map(ranked.map((hit) => [hit.id, hit]));
  const kept = shown.slice(0, through).flatMap((id) => byId.get(id) ?? []);
  const keptIds = new Set(kept.map((hit) => hit.id));
  return [...kept, ...ranked.filter((hit) => !keptIds.has(hit.id))];
}

const searchSources = [
  "All",
  "Shared sources",
  "YouTube",
  "Bandcamp",
  "SoundCloud",
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
