import type { SearchHit, SearchKind, SearchLength } from "./sections/find/SearchOnlineResults";

export function mergeSearchHits(sources: readonly string[], hits: Record<string, SearchHit[]>, query: string) {
  const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const exact = (hit: SearchHit) => !!query.trim() && normalize(hit.title) === normalize(query);
  return sources.flatMap((source, rank) => (hits[source] ?? []).map((hit, index) => ({ hit, order: index * sources.length + rank })))
    .sort((a, b) => Number(exact(b.hit)) - Number(exact(a.hit)) || a.order - b.order).map(({ hit }) => hit);
}

export const searchSources = ["All", "Shared sources", "YouTube", "Bandcamp", "SoundCloud", "RaiPlay", "StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity", "avoid radio", "Radio playlists", "Radio directory", "Twitch"];
export const searchKinds: SearchKind[] = ["Video", "Music", "Live", "Radio", "Channels"];
export const searchLengths: SearchLength[] = ["Under 10 min", "10–60 min", "Over 1 hr"];
export type SearchRouteState = { query: string; source: string; kind?: SearchKind; length?: SearchLength };
export function readSearchState(search: string | Record<string, string | string[] | undefined>): SearchRouteState {
  const params = typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(Object.entries(search).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] ?? "" : value]] as [string, string][]));
  const kind = searchKinds.find(value => value === params.get("kind")), length = searchLengths.find(value => value === params.get("length"));
  return { ...(kind ? { kind } : {}), ...(length ? { length } : {}), query: (params.get("q") ?? "").slice(0, 4096), source: searchSources.find(source => source === params.get("source")) ?? "All" };
}
export function searchLocation(state: SearchRouteState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.source !== "All" && searchSources.includes(state.source)) params.set("source", state.source);
  if (state.kind && searchKinds.includes(state.kind)) params.set("kind", state.kind);
  if (state.length && searchLengths.includes(state.length)) params.set("length", state.length);
  return `/search${params.size ? `?${params}` : ""}`;
}
/** A pasted web address, which opens as a page or as media rather than searching. */
export const isLink = (value: string) => {
  try { return /^https?:\/\//i.test(value) && !!new URL(value).hostname; }
  catch { return false; }
};
