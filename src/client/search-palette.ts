import { canReturn, searchRelevance, type SearchKind, type SearchRouteState } from "./search";

/** What a search is narrowed to before it runs: the results page's kind and source, or none. */
export type SearchScope = Pick<SearchRouteState, "kind" | "source">;
export type Scope = { label: string; words: string[] } & ({ kind: SearchKind; source?: never } | { source: string; kind?: never });

export const kindLabels: Record<SearchKind, string> = { films: "Films & series", live: "Live", radio: "Radio", music: "Music", videos: "Videos" };
// The kinds in the results' order, then the sources; each answers to its name and the short forms people type.
export const scopes: Scope[] = [
  { kind: "films", label: kindLabels.films, words: ["film", "movies", "movie", "series", "shows"] },
  { kind: "radio", label: kindLabels.radio, words: ["stations", "station", "fm"] },
  { kind: "live", label: kindLabels.live, words: ["streams", "stream"] },
  { kind: "music", label: kindLabels.music, words: ["songs", "albums", "album"] },
  { kind: "videos", label: kindLabels.videos, words: ["video"] },
  { source: "YouTube", label: "YouTube", words: ["yt"] },
  { source: "Bandcamp", label: "Bandcamp", words: ["bc"] },
  { source: "SoundCloud", label: "SoundCloud", words: ["sc"] },
  { source: "Twitch", label: "Twitch", words: [] },
  { source: "RaiPlay", label: "RaiPlay", words: ["rai"] },
  { source: "StreamingCommunity", label: "StreamingCommunity", words: [] },
  { source: "123MoviesFree", label: "123MoviesFree", words: ["123"] },
  { source: "AnimeSaturn", label: "AnimeSaturn", words: ["anime"] },
  { source: "AnimeUnity", label: "AnimeUnity", words: [] },
  { source: "avoid radio", label: "avoid radio", words: ["avoid"] },
  { source: "Radio playlists", label: "Radio playlists", words: ["playlists"] },
  { source: "Radio directory", label: "Radio directory", words: ["directory"] },
  { source: "Shared sources", label: "Shared sources", words: ["shared"] },
];
/** The sources an empty field offers; the radio's own lists and shared sources answer when typed. */
export const offeredSources = scopes.filter(scope => scope.source && !["avoid radio", "Radio playlists", "Radio directory", "Shared sources"].includes(scope.source));

const squash = (value: string) => value.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** The scopes the typed text names, best first: an exact name or short form, then those it starts. Two letters at least. */
export function matchScopes(text: string): Scope[] {
  const typed = squash(text);
  if (typed.length < 2) return [];
  const names = (scope: Scope) => [scope.label, ...scope.words].map(squash);
  return [...scopes.filter(scope => names(scope).includes(typed)), ...scopes.filter(scope => !names(scope).includes(typed) && names(scope).some(name => name.startsWith(typed)))];
}
/** What Tab completes the field's text to: the best scope, when the text is all one scope's name. */
export const completeScope = (text: string): Scope | undefined => matchScopes(text)[0];

export const isChosen = (current: SearchScope, scope: Scope) => scope.kind ? current.kind === scope.kind : current.source === scope.source;
/**
 * Choosing a scope narrows the field: a kind keeps the source when it can return that kind, a source keeps the kind it
 * can return, so no combination comes out impossible. Choosing a chosen scope removes it.
 */
export function chooseScope(current: SearchScope, scope: Scope): SearchScope {
  if (isChosen(current, scope)) return scope.kind ? { kind: undefined, source: current.source } : { kind: current.kind, source: "All" };
  if (scope.kind) return { kind: scope.kind, source: canReturn(current.source, scope.kind) ? current.source : "All" };
  return { kind: canReturn(scope.source, current.kind) ? current.kind : undefined, source: scope.source };
}
/** Backspace in an empty field: the source goes first, then the kind. */
export const dropScope = (current: SearchScope): SearchScope => current.source !== "All" ? { kind: current.kind, source: "All" } : { kind: undefined, source: "All" };
/** The field's tokens, kind first. */
export const scopeLabels = (current: SearchScope) => [...current.kind ? [kindLabels[current.kind]] : [], ...current.source !== "All" ? [current.source] : []];
export const hasScope = (current: SearchScope) => !!current.kind || current.source !== "All";

/** A held title; `context` (its series, album or artist) matches too. */
type Titled = { title: string; source?: string; context?: string };
type Station = { name: string };
/**
 * The field's suggestions while typing, from what the client already holds: scopes, recent searches, saved and played
 * titles, and stations. Never a source's search. A scope narrows them: stations only for radio, titles never for it,
 * and a source only its own titles.
 */
export function suggest<T extends Titled, P extends Titled, S extends Station>(text: string, current: SearchScope, held: { recents: string[]; saved: T[]; played: P[]; stations: S[] }, limit = 4) {
  const { strong } = searchRelevance(text);
  const typed = text.trim().toLocaleLowerCase();
  const radio = !current.kind || current.kind === "radio";
  const titled = <I extends Titled>(items: I[]) => current.kind === "radio" ? [] : items.filter(item => strong({ title: `${item.title} ${item.context ?? ""}` }) && (current.source === "All" || !item.source || item.source === current.source)).slice(0, limit);
  const seen = new Set<string>();
  const once = <I extends Titled>(item: I) => { const key = item.title.toLocaleLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; };
  return {
    scopes: matchScopes(text).slice(0, 3),
    recents: held.recents.filter(query => query.toLocaleLowerCase() !== typed && strong({ title: query })).slice(0, limit),
    saved: titled(held.saved).filter(once),
    played: titled(held.played).filter(once),
    stations: radio && (current.source === "All" || ["avoid radio", "Radio playlists", "Radio directory"].includes(current.source)) ? held.stations.filter(station => strong({ title: station.name })).filter((station, index, all) => all.findIndex(other => other.name === station.name) === index).slice(0, limit) : [],
  };
}
