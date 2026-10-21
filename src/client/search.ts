import type { SearchHit } from "./sections/find/SearchOnlineResults";

export function mergeSearchHits(sources: readonly string[], hits: Record<string, SearchHit[]>, query: string) {
  const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const exact = (hit: SearchHit) => !!query.trim() && normalize(hit.title) === normalize(query);
  return sources.flatMap((source, rank) => (hits[source] ?? []).map((hit, index) => ({ hit, order: index * sources.length + rank })))
    .sort((a, b) => Number(exact(b.hit)) - Number(exact(a.hit)) || a.order - b.order).map(({ hit }) => hit);
}

export const searchSources = ["All", "Shared sources", "YouTube", "Bandcamp", "SoundCloud", "RaiPlay", "StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity", "avoid radio", "Radio playlists", "Radio directory", "Twitch"];
/** What Search narrows by first; channels and lists show under videos. */
export const searchKinds = ["films", "live", "radio", "music", "videos"] as const;
export type SearchKind = typeof searchKinds[number];
export type SearchRouteState = { query: string; source: string; kind?: SearchKind };
export function readSearchState(search: string | Record<string, string | string[] | undefined>): SearchRouteState {
  const params = typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(Object.entries(search).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] ?? "" : value]] as [string, string][]));
  const kind = searchKinds.find(value => value === params.get("kind"));
  return { ...(kind ? { kind } : {}), query: (params.get("q") ?? "").slice(0, 4096), source: searchSources.find(source => source === params.get("source")) ?? "All" };
}
export function searchLocation(state: SearchRouteState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.kind && searchKinds.includes(state.kind)) params.set("kind", state.kind);
  if (state.source !== "All" && searchSources.includes(state.source)) params.set("source", state.source);
  return `/search${params.size ? `?${params}` : ""}`;
}
/** A pasted web address, which opens as a page or as media rather than searching. */
export const isLink = (value: string) => {
  try { return /^https?:\/\//i.test(value) && !!new URL(value).hostname; }
  catch { return false; }
};

const normalizeWords = (value: string) => value.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
export function searchRelevance(query: string) {
  const words = normalizeWords(query);
  const mentions = (text: string, word: string) => normalizeWords(text).some(part => part.startsWith(word));
  return {
    close: (hit: Pick<SearchHit, "title" | "meta">) => !words.length || words.some(word => mentions(`${hit.title} ${hit.meta}`, word)),
    strong: (hit: Pick<SearchHit, "title">) => words.length > 0 && words.every(word => mentions(hit.title, word)),
  };
}
