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
export type SearchRouteState = { query: string; source: string; kind?: SearchKind; length?: SearchLength; /** Ends by this clock time ("HH:MM"). */ until?: string };
export function readSearchState(search: string | Record<string, string | string[] | undefined>): SearchRouteState {
  const params = typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(Object.entries(search).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] ?? "" : value]] as [string, string][]));
  const kind = searchKinds.find(value => value === params.get("kind")), length = searchLengths.find(value => value === params.get("length"));
  const until = params.get("until");
  return { ...(kind ? { kind } : {}), ...(length ? { length } : {}), ...(until && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(until) ? { until } : {}), query: (params.get("q") ?? "").slice(0, 4096), source: searchSources.find(source => source === params.get("source")) ?? "All" };
}
export function searchLocation(state: SearchRouteState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.source !== "All" && searchSources.includes(state.source)) params.set("source", state.source);
  if (state.kind && searchKinds.includes(state.kind)) params.set("kind", state.kind);
  if (state.length && searchLengths.includes(state.length)) params.set("length", state.length);
  if (state.until) params.set("until", state.until);
  return `/search${params.size ? `?${params}` : ""}`;
}
/** A pasted web address, which opens as a page or as media rather than searching. */
export const isLink = (value: string) => {
  try { return /^https?:\/\//i.test(value) && !!new URL(value).hostname; }
  catch { return false; }
};

/** Local clock deadlines; keep the selected timestamp fixed while the page stays open. */
export function searchEndBounds(now: number) {
  const date = new Date(now);
  const first = Math.ceil((date.getHours() * 60 + date.getMinutes() + 20) / 30) * 30;
  return [first, first + 60, first + 180].map(minutes => ({
    value: `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    deadline: new Date(now).setHours(0, minutes, 0, 0),
  }));
}
export function searchDeadline(until: string, now: number) {
  // A generated choice can cross midnight. Other past clock values are expired.
  return searchEndBounds(now).find(bound => bound.value === until)?.deadline
    ?? new Date(now).setHours(Number(until.slice(0, 2)), Number(until.slice(3)), 0, 0);
}
export const searchSecondsLeft = (deadline: number, now: number) => Math.max(0, (deadline - now) / 1000);
const normalizeWords = (value: string) => value.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
export function searchRelevance(query: string) {
  const words = normalizeWords(query);
  const mentions = (text: string, word: string) => normalizeWords(text).some(part => part.startsWith(word));
  return {
    close: (hit: Pick<SearchHit, "title" | "meta">) => !words.length || words.some(word => mentions(`${hit.title} ${hit.meta}`, word)),
    strong: (hit: Pick<SearchHit, "title">) => words.length > 0 && words.every(word => mentions(hit.title, word)),
  };
}
