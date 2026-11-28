import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { artShape, type ArtShape } from "@/art-shape";
import { mediaSubtitle } from "@/components/MediaContext";
import { collectionSubtitle, metaLine } from "@/media-caption";
import { formatDay, formatRuntime } from "@/time-format";
import { foldCopies, searchRelevance } from "../../search";
import { spotifyLink } from "../../../shared/providers";
import { stationSources } from "../../../shared/radio";
import type { SearchHit, SearchResultSummary } from "./SearchOnlineResults";

// Sources in the order they lead when they answer together; the rest are searched too.
export const sourceOrder = [
  "Shared sources",
  "YouTube",
  "Bandcamp",
  "SoundCloud",
  "Radio archives",
  "Mixcloud",
  "Spotify",
  "Twitch",
  "RaiPlay",
  "avoid radio",
  "Radio playlists",
  "Radio directory",
  "StreamingCommunity",
  "123MoviesFree",
  "AnimeSaturn",
  "AnimeUnity",
];
export const catalogues = ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"];
/** The sources that answer within a second or two over plain HTTP, never taking a yt-dlp slot. */
export const quickSources = ["Radio archives", "Mixcloud", "Spotify", "Bandcamp", "Twitch"];

export const names = (sources: string[]) =>
  sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : sources[0];

/** A hit's own artwork shape (art-shape.ts). */
export const shapeOf = (hit: SearchHit): ArtShape =>
  artShape(
    hit.source,
    hit.kind === "Radio"
      ? "station"
      : hit.collection === "Channel"
        ? "channel"
        : hit.collection
          ? "collection"
          : hit.context
            ? "episode"
            : "media",
  );

// A radio archive's list is one of a station's shows (its residents, series and styles read as shows too); a Spotify
// list is an artist, an album or a playlist.
const collectionName = (hit: SearchHit) =>
  hit.collection !== "List"
    ? hit.collection
    : hit.source === "Radio archives"
      ? "show"
      : hit.source === "Spotify"
        ? (spotifyLink(hit.url ?? "")?.kind ?? hit.collection)
        : hit.collection;
const day = /^\d{4}-\d{2}-\d{2}$/;
// The byline, without what the collection's name already says (a Spotify artist's "Artist").
export const hitContext = (hit: SearchHit) =>
  metaLine(
    ...(collectionSubtitle(hit.meta, hit.collection, hit.source) ?? "")
      .split(" · ")
      .filter(
        (part) =>
          part !== hit.source &&
          part.toLowerCase() !== collectionName(hit)?.toLowerCase() &&
          mediaSubtitle({ subtitle: part, creator: hit.creator, collection: hit.context }),
      )
      .map((part) => (day.test(part) ? formatDay(part) : part)),
  );
/** One meta line by the caption rules: the byline the links don't already give, what an openable hit is, its length, then where else it is. */
export const hitMeta = (hit: SearchHit, showCollection = true) =>
  metaLine(
    hitContext(hit),
    showCollection && collectionName(hit),
    !hit.live && !hit.collection && hit.duration != null && formatRuntime(hit.duration),
    !!hit.also?.length && `also on ${names(hit.also)}`,
  );

/** A hit's addresses, for the level while it plays: its page, or its station (by its source or its stream). */
export const hitSources = (hit: SearchHit) => [
  hit.url,
  ...(hit.radio ? stationSources(hit.radio) : []),
];

/**
 * A hit as Search presses it: an episode, track, video or stream plays, an album, set or show plays all, and Open (its
 * page) moves to its menu; a film, series or channel keeps Open.
 */
export function pressPlays(hit: SearchHit): SearchHit {
  if (hit.primary.label !== "Open" || catalogues.includes(hit.source)) return hit;
  const play = hit.actions.find(
    (action) => (action.label === "Play" || action.label === "Play all") && action.run,
  );
  if (!play) return hit;
  return {
    ...hit,
    primary: { label: play.label, run: play.run!, disabled: play.disabled },
    actions: [
      { label: hit.primary.label, run: hit.primary.run, disabled: hit.primary.disabled },
      ...hit.actions.filter((action) => action !== play),
    ],
  };
}

/** `ranked` with what was shown for `key` kept in its place, and what's new after it, so answers never move what's shown. */
function useHeldOrder(key: string, ranked: string[]) {
  const shown = useRef({ key, order: [] as string[] });
  const before = shown.current.key === key ? shown.current.order : [];
  const order = [
    ...before.filter((source) => ranked.includes(source)),
    ...ranked.filter((source) => !before.includes(source)),
  ];
  useLayoutEffect(() => {
    shown.current = { key, order };
  });
  return order;
}

/**
 * One search's hits as Search shows them: each source in the order it answered (the strongest first among those
 * answering together; a source never moves once shown), each in its own order, each recording once (foldCopies), every
 * press playing what plays. `within` is what a source's own search shows: copies fold only among the sources in scope.
 */
export function useSourceHits(
  key: string,
  summaries: Record<string, SearchResultSummary>,
  query: string,
) {
  const { strength } = searchRelevance(query);
  const best = (source: string) =>
    Math.max(0, ...(summaries[source]?.hits ?? []).map((hit) => strength(hit.title)));
  const answered = sourceOrder
    .filter((source) => summaries[source]?.hits?.length)
    .sort((a, b) => best(b) - best(a));
  const order = useHeldOrder(key, answered);
  const within = (scope: string) =>
    foldCopies(
      order
        .filter((from) => scope === "All" || from === scope)
        .flatMap((from) => summaries[from]!.hits!),
    ).map(pressPlays);
  return { order, hits: within("All"), within };
}

// Radio archives asks every station, each within 3 s (archives/index.ts), so the quick sources have all answered by then;
// the top waits that long at most for a stronger match.
const topWait = 3000;
/**
 * The strongest title match (every word at least, `rank`), once the quick sources have answered (`waiting` false) or after
 * `topWait`. A stronger match that answers later takes its place until the person moves focus or selection (`frozen`);
 * from then on it holds for `key`, so it never changes under the focus.
 */
export function useTopHit(
  key: string,
  hits: SearchHit[],
  query: string,
  waiting: boolean,
  frozen: boolean,
  typing = false,
) {
  const { strength, credited } = searchRelevance(query, typing);
  const [late, setLate] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setLate(key), topWait);
    return () => clearTimeout(timer);
  }, [key]);
  // The searched artist's own item leads any title match by someone else, and a live stream leads only on its exact
  // title. Between equal titles, what plays leads a channel or a list, and the title as typed (accents too) a folded one.
  const typed = query.trim().toLocaleLowerCase();
  const rank = (hit: SearchHit) => {
    const words = credited(hit) ? 4 : strength(hit.title);
    if (words < 2 || (hit.live && words !== 3)) return 0;
    return words * 4 + (hit.collection ? 0 : 2) + (hit.title.toLocaleLowerCase() === typed ? 1 : 0);
  };
  const best = Math.max(0, ...hits.map(rank));
  const candidate =
    (waiting && late !== key) || !best ? undefined : hits.find((hit) => rank(hit) === best);
  const [held, setHeld] = useState<{ key: string; id: string } | null>(null);
  const shown = held?.key === key ? hits.find((hit) => hit.id === held.id) : undefined;
  const top = shown && (frozen || rank(shown) >= best) ? shown : candidate;
  useLayoutEffect(() => {
    if (top && (held?.key !== key || held.id !== top.id)) setHeld({ key, id: top.id });
  }, [top?.id, key]);
  return top;
}
