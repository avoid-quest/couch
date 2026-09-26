import type { SearchKind, SearchLength } from "./sections/find/SearchOnlineResults";

export const searchSources = ["All", "YouTube", "RaiPlay", "StreamingCommunity", "avoid radio", "Radio playlists", "Radio directory", "Folders", "Jellyfin", "Twitch", "Bandcamp"];
// Old links name sources by their earlier labels.
const legacySources: Record<string, string> = { Radio: "Radio playlists", "TV folders": "Folders" };
export const searchKinds: SearchKind[] = ["Video", "Music", "Live", "Radio", "Channels"];
export const searchLengths: SearchLength[] = ["Under 10 min", "10–60 min", "Over 1 hr"];
export type SearchRouteState = { query: string; source: string; kind?: SearchKind; length?: SearchLength };
export function readSearchState(search: string | Record<string, string | string[] | undefined>): SearchRouteState {
  const params = typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(Object.entries(search).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] ?? "" : value]] as [string, string][]));
  const kind = searchKinds.find(value => value === params.get("kind")), length = searchLengths.find(value => value === params.get("length"));
  return { ...(kind ? { kind } : {}), ...(length ? { length } : {}), query: (params.get("q") ?? "").slice(0, 4096), source: searchSources.find(source => source === (legacySources[params.get("source") ?? ""] ?? params.get("source"))) ?? "All" };
}
export function searchLocation(state: SearchRouteState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.source !== "All" && searchSources.includes(state.source)) params.set("source", state.source);
  if (state.kind && searchKinds.includes(state.kind)) params.set("kind", state.kind);
  if (state.length && searchLengths.includes(state.length)) params.set("length", state.length);
  return `/find${params.size ? `?${params}` : ""}`;
}
