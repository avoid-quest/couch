import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { playbackStatus } from "@/playback-status";
import { useOptionalSessionGate } from "@/session/session-context";
import { MediaContext, mediaSubtitle } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { canReturn, isLink, mergeSearchHits, searchLocation, searchRelevance, type SearchKind, type SearchRouteState } from "../../search";
import { kindLabels, scopeLabels } from "../../search-palette";
import { memo, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import type { Action } from "../../../shared/protocol";
import { providerForUrl, type ProviderId, type ProviderItem, type VideoQuality } from "../../../shared/providers";
import { stationSources } from "../../../shared/radio";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import { SearchOnlineResults, providerNames, type SearchHit, type SearchResultSummary } from "./SearchOnlineResults";
import { Shelf } from "@/components/Shelf";
import { MediaTile } from "@/components/MediaTile";
import { artAspect, artShape, majorityShape, type ArtShape } from "@/art-shape";
import { episodeRow, metaLine, withoutUrls } from "@/media-caption";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { cn } from "@/lib/utils";
import { SearchRadioResults } from "./SearchRadioResults";
import { SearchKinds, SearchSources } from "./SearchFilters";
import { supportsWebVideoQuality, useEnqueueVideoQuality, videoQualityOptions } from "../../video-quality";
import { createId } from "../../session/session";
import type { SourceKind } from "@/components/sourceTypes";
import { MediaArtwork } from "@/components/MediaArtwork";
import { RadioSlot } from "@/components/RadioSchedule";
import { ArtLevel, useLevel } from "@/components/Level";
import { DurationBar } from "@/components/DurationBar";
import { formatDuration } from "@/time-format";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveToggle, verbRow } from "@/components/DetailHeader";
import { useLiveSourceHits } from "./useLiveSourceHits";

export type Props = {
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  defaultQuality?: VideoQuality;
  onCommand?: (action: Action) => Promise<boolean>;
  onManageSources?: (source?: SourceKind) => void;
  onOpenCollection?: (item: ProviderItem) => void;
  searchState: SearchRouteState;
  onSearchChange: (state: SearchRouteState) => void;
};
type Entry = [source: string, summary: SearchResultSummary];

// Sources in the order their results interleave; the rest are searched too.
const sourceOrder = ["Shared sources", "YouTube", "Bandcamp", "SoundCloud", "Twitch", "RaiPlay", "avoid radio", "Radio playlists", "Radio directory", "StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"];
const radioSources = ["avoid radio", "Radio playlists", "Radio directory"] as const;

type GroupId = Exclude<SearchKind, "audio"> | "channels";
type Group = { id: GroupId; title: string; shape: ArtShape };
// What's on the board first, then what you'd listen to, then the long tail of videos and channels, every kind a shelf.
// The kinds above already count, so the headings don't.
const groups: Group[] = [
  { id: "films", title: "Films and series", shape: "poster" },
  { id: "radio", title: "Radio", shape: "square" },
  { id: "live", title: "Live now", shape: "video" },
  { id: "music", title: "Music", shape: "square" },
  { id: "videos", title: "Videos", shape: "video" },
  { id: "channels", title: "Channels and lists", shape: "round" },
];
// The kinds above the results, in the shelves' order; only those the query found are offered.
const kinds = groups.flatMap(group => group.id === "channels" ? [] : [{ value: group.id as SearchKind, label: kindLabels[group.id as SearchKind] }]);
const kindOf = (group: GroupId): SearchKind => group === "channels" ? "videos" : group;
const catalogues = ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"];
// RaiPlay's programmes are series too; they come as 16:9 frames rather than posters.
const groupOf = (hit: SearchHit): GroupId => catalogues.includes(hit.source) && hit.collection !== "Channel" && hit.collection !== "List" || hit.source === "RaiPlay" && !!hit.collection ? "films"
  : hit.kind === "Radio" ? "radio" : hit.kind === "Live" ? "live" : hit.kind === "Music" ? "music" : hit.collection ? "channels" : "videos";
/** A hit's own artwork shape (art-shape.ts). */
const shapeOf = (hit: SearchHit): ArtShape => artShape(hit.source, hit.kind === "Radio" ? "station" : hit.collection === "Channel" ? "channel" : hit.collection ? "collection" : hit.context ? "episode" : "media");
// One kind's tiles wrap as ProviderPage's posters do, each as wide as its column.
const gridColumns = { poster: "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]", square: "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]", round: "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]", video: "grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]" } as const satisfies Record<ArtShape, string>;
const fluidTile = { poster: "[--tile-art:150cqi]", square: "[--tile-art:100cqi]", round: "[--tile-art:100cqi]", video: "[--tile-art:56.25cqi]" } as const satisfies Record<ArtShape, string>;

/**
 * The results of the header's search (`searchState`, the route's): the kinds it found, then that kind's sources, then the
 * closest match, then every source's hits by kind as shelves in their artwork's shape; one kind fills the page as a grid.
 * Sources that didn't answer close the page in one quiet line. Or a pasted link.
 */
export function SearchPanel(props: Props) {
  const { searchState } = props;
  const query = searchState.query;
  const kind = searchState.kind;
  const [remoteSummaries, setSummaries] = useState<Record<string, SearchResultSummary>>({});
  const liveHits = useLiveSourceHits(query);
  const latest = useMemo<Record<string, SearchResultSummary>>(() => ({ ...remoteSummaries, "Shared sources": { count: liveHits.length, hits: liveHits, loading: false, error: false } }), [remoteSummaries, liveHits]);
  // Query cache hits are published before paint; never debounce them into a blank revisit.
  const summaries = latest;
  const resultsKey = JSON.stringify([query, props.origin, props.token]);
  const [seenResults, setSeenResults] = useState(resultsKey);
  if (resultsKey !== seenResults) { setSeenResults(resultsKey); setSummaries({}); }
  const reportResults = useCallback((source: string, summary: SearchResultSummary) => setSummaries(current => ({ ...current, [source]: summary })), []);
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
  const panel = useRef<HTMLElement>(null);
  const url = isLink(query) ? query : undefined;
  const providers = url ? [] : (["youtube", "bandcamp", "soundcloud", "raiplay", "twitch", "streamingcommunity", "movies123", "animesaturn", "animeunity"] as ProviderId[])
    .filter(provider => kind !== "audio" || canReturn(providerNames[provider], kind));
  const pending = (source: string) => !summaries[source] || summaries[source].loading;
  // What the search asked for, and what merely came back: a hit is close when it mentions a word of the query, and
  // strong when its title holds every word.
  const { close, strong } = searchRelevance(query);
  const merged = useMemo(() => mergeSearchHits(sourceOrder, Object.fromEntries(Object.entries(summaries).map(([source, summary]) => [source, summary.hits ?? []])), query), [summaries, query]);
  // The kind and source are the header field's scope, chosen before or after the results. The filters come from what
  // was found, so no choice made here can come up empty: a kind is offered once it has a hit, and inside a kind, a
  // source once it has a hit of it. A scope chosen in the field shows too, and says so when it holds nothing.
  const found = merged.filter(hit => close(hit) && (kind !== "audio" || canReturn(hit.source, kind)));
  const kindOfHit = (hit: SearchHit) => kindOf(groupOf(hit));
  const inKind = (hit: SearchHit, of = kind) => !of || (of === "audio" ? canReturn(hit.source, of) : kindOfHit(hit) === of);
  const choices = kind === "audio" ? [{ value: kind, label: kindLabels.audio }, ...kinds] : kinds;
  const foundKinds = choices.flatMap(option => { const n = found.filter(hit => inKind(hit, option.value)).length; return n || option.value === kind && found.length ? [{ ...option, count: n }] : []; });
  const filter = searchState.source;
  const foundSources = sourceOrder.map(source => ({ value: source, count: found.filter(hit => hit.source === source && inKind(hit)).length })).filter(source => source.count || source.value === filter && found.length);
  // Only the sources that can return the kind are waited on, or report a problem.
  const inScope = (source: string) => (filter === "All" || filter === source) && canReturn(source, kind);
  const asking = sourceOrder.filter(source => inScope(source) && pending(source));
  const scoped = merged.filter(hit => inScope(hit.source) && inKind(hit));
  const relevant = scoped.filter(close);
  const loose = scoped.filter(hit => !close(hit));
  // The closest match leads: the first strong hit of the first kind that has one, as Home's hero leads its shelves. The first match
  // holds still for the query and kind, so nothing moves under the focus while browsing.
  const candidate = groups.map(group => relevant.find(hit => groupOf(hit) === group.id && strong(hit))).find(Boolean);
  const holdKey = `${resultsKey}:${kind ?? "all"}`;
  const [held, setHeld] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    if (candidate) setHeld(current => current[holdKey] ? current : { ...current, [holdKey]: candidate.id });
  }, [candidate, holdKey]);
  const top = (held[holdKey] && relevant.find(hit => hit.id === held[holdKey])) || candidate;
  const [expanded, setExpanded] = useState<{ key: string; groups: GroupId[] }>({ key: resultsKey, groups: [] });
  const expandedGroups = expanded.key === resultsKey ? expanded.groups : [];
  const grouped = groups.map(group => ({ ...group, hits: relevant.filter(hit => hit !== top && groupOf(hit) === group.id) })).filter(group => group.hits.length);
  const focusedHit = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!props.active || !focusedHit.current || document.activeElement !== document.body) return;
    const row = panel.current?.querySelector<HTMLElement>(`[data-hit-id="${CSS.escape(focusedHit.current)}"] [data-play], [data-hit-id="${CSS.escape(focusedHit.current)}"][data-media-tile]`)
      ?? panel.current?.querySelector<HTMLElement>("[data-play], [data-media-tile]");
    row?.focus({ preventScroll: true });
  }, [relevant, props.active]);
  // A heading that changed the kind, or a source that took its line away, left with its control; the focus goes to the chosen kind.
  const shownFilters = useRef(`${kind}:${filter}`);
  useLayoutEffect(() => {
    if (shownFilters.current === `${kind}:${filter}`) return;
    shownFilters.current = `${kind}:${filter}`;
    if (document.activeElement === document.body) panel.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
  }, [kind, filter]);
  const shown: Entry[] = Object.entries(summaries).filter(([source]) => inScope(source));
  // A kind keeps the chosen source when the source has hits of it; otherwise every source.
  const withKind = (next?: SearchKind): SearchRouteState => ({ ...searchState, kind: next, source: canReturn(filter, next) && found.some(hit => hit.source === filter && inKind(hit, next)) ? filter : "All" });
  const everything = () => props.onSearchChange({ query, source: "All" });
  const [looseOpen, setLooseOpen] = useState(false);
  const one = kind && groups.find(group => group.id === kind)!;
  const heading = (group: Group) => kind ? undefined : searchLocation(withKind(kindOf(group.id)));
  return <section ref={panel} className="min-w-0 space-y-8" aria-label="Search results" onFocusCapture={event => { focusedHit.current = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset.hitId ?? null; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !panel.current?.contains(event.relatedTarget)) focusedHit.current = null; }}>
    {!url && <>
      {/* The lines hold their height while sources answer, so nothing below moves as options arrive. A chosen kind
          always keeps its source line, empty while it has one source. */}
      {(foundKinds.length > 0 || asking.length > 0) && <div role="group" aria-label="Search filters" className="flex flex-col gap-1">
        <div className="min-h-8 touch:min-h-11">{foundKinds.length > 0 && <SearchKinds query={resultsKey} value={kind ?? "all"} onChange={next => props.onSearchChange(withKind(next === "all" ? undefined : next))} options={[{ value: "all", label: "All", count: found.length }, ...foundKinds]} />}</div>
        {(kind || filter !== "All") && <div className="min-h-8 touch:min-h-11">{(foundSources.length > 1 || filter !== "All") && <SearchSources query={`${resultsKey}:${kind}`} value={filter} onChange={source => props.onSearchChange({ ...searchState, kind, source })} options={foundSources} />}</div>}
      </div>}
      <p role="status" className="sr-only">
        {!relevant.length && asking.length ? `Searching for “${query}”…` : `${relevant.length} ${relevant.length === 1 ? "result" : "results"} for “${query}”.`}
        {asking.length > 0 && ` ${asking.length === 1 ? `Still asking ${asking[0]}.` : `Still asking ${asking.length} sources.`}`}
      </p>
      {!scoped.length && asking.length > 0 && (one ? <ul aria-label="Loading search results…" className={cn("grid list-none gap-x-4 gap-y-6 p-0", gridColumns[one.shape])}><MediaTilesSkeleton shape={one.shape} fluid /></ul> : <SearchSkeleton />)}
      {top && <TopResult key={top.id} hit={top} />}
      {grouped.map((group, index) => {
        const shape = majorityShape(group.hits.slice(0, 12).map(shapeOf));
        // A word every hit of a kind shares (RaiPlay's "Programme") says nothing, so it goes.
        const showCollection = !(group.hits.length > 1 && group.hits.every(hit => hit.collection && hit.collection === group.hits[0]!.collection));
        // One kind fills the page as a grid, without its heading or the twelve-tile cap; Channels and lists stay a shelf under Videos.
        if (kind === group.id) return <ul key={group.id} aria-label={group.title} className={cn("grid list-none gap-x-4 gap-y-6 p-0", gridColumns[shape])}>
          {group.hits.map((hit, position) => <li key={hit.id} className="@container min-w-0"><HitTile hit={hit} shape={shape} showCollection={showCollection} pageFirst={!top && position === 0} className={cn("w-full [&_[data-media-tile]]:w-full [&_[data-tile-art]]:w-full", fluidTile[shape])} /></li>)}
        </ul>;
        return <Shelf key={group.id} title={group.title} href={heading(group)}>
          {group.hits.slice(0, expandedGroups.includes(group.id) ? undefined : 12).map((hit, position) => <li key={hit.id} className="shrink-0"><HitTile hit={hit} shape={shape} showCollection={showCollection} pageFirst={!top && index === 0 && position === 0} /></li>)}
          {!expandedGroups.includes(group.id) && group.hits.length > 12 && <li className="shrink-0 self-center"><Button variant="ghost" onClick={() => setExpanded({ key: resultsKey, groups: [...expandedGroups, group.id] })}>{group.hits.length - 12} more</Button></li>}
        </Shelf>;
      })}
      <MoreResults summaries={shown} />
      {/* A scope from the field that holds nothing says so, with the way back to everything the query found. */}
      {props.connected && !asking.length && !scoped.length && found.length > 0 && <Empty role="status"><EmptyHeader><EmptyTitle><h2>Nothing in {scopeLabels({ kind, source: filter }).join(" on ")} for “{query}”</h2></EmptyTitle></EmptyHeader><EmptyContent><Button data-page-first variant="outline" onClick={everything}>Show all {found.length} {found.length === 1 ? "result" : "results"}</Button></EmptyContent></Empty>}
      {props.connected && !asking.length && !found.length && !shown.some(([, summary]) => summary.error) && <Empty role="status"><EmptyHeader><EmptyTitle><h2>Nothing found for “{query}”</h2></EmptyTitle><EmptyDescription>Try fewer words or paste a link.</EmptyDescription></EmptyHeader>{props.onManageSources && <EmptyContent><Button variant="outline" onClick={() => props.onManageSources?.()}>Add a source</Button></EmptyContent>}</Empty>}
      {/* What came back without a word of the query waits behind one line, so a stray hit never leads. */}
      {loose.length > 0 && <Collapsible open={looseOpen} onOpenChange={setLooseOpen} className="grid gap-3">
        <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-2.5 h-auto min-h-8 max-w-full justify-self-start text-left whitespace-normal text-muted-foreground">{looseOpen ? "Hide" : "Show"} {loose.length} {loose.length === 1 ? "result that doesn't" : "results that don't"} mention “{query}”</Button></CollapsibleTrigger>
        <CollapsibleContent><HitList hits={loose} label="Other results" compact /></CollapsibleContent>
      </Collapsible>}
      {/* Sources that didn't answer close the page in one quiet line, so the results lead. */}
      <SourcesUnanswered summaries={shown} />
    </>}
    {providers.map(provider => <SearchOnlineResults key={`${provider}:${query}`} {...props} onResults={reportResults} active={props.active && inScope(providerNames[provider])} provider={provider} query={query} quality={quality} onEnqueued={resetQuality} />)}
    {!url && kind !== "audio" && radioSources.map(source => <SearchRadioResults key={`${source}:${query}`} {...props} onResults={reportResults} active={props.active && inScope(source)} query={query} source={source} />)}
    {url && <PastedLink key={url} url={url} {...props} quality={quality} onQualityChange={setQuality} onDone={resetQuality} />}
  </section>;
}

const hitContext = (hit: SearchHit) => metaLine(...hit.meta.split(" · ").filter(part => part !== hit.source && mediaSubtitle({ subtitle: part, creator: hit.creator, collection: hit.context })));
/** One meta line by the caption rules: the byline the links don't already give, what an openable hit is, then its length. */
const hitMeta = (hit: SearchHit, showCollection = true) => metaLine(hitContext(hit), showCollection && hit.collection, !hit.live && !hit.collection && hit.duration != null && formatDuration(hit.duration));

/** Sources stay readable even when a long artist or programme name fills the context line. */
/** Where a hit leads: its source's home, its creator, series or season, its station. */
const hitRelated = (hit: SearchHit, showSource = true, onPage?: { context: boolean; creator: boolean }) =>
  ({ radio: hit.radio?.title !== hit.title ? hit.radio : undefined, source: showSource ? hit.source : undefined, collection: onPage?.context ? undefined : hit.context, creator: onPage?.creator ? undefined : hit.creator });
function HitSource({ hit }: { hit: SearchHit }) {
  return <MediaContext {...hitRelated(hit)} />;
}

/**
 * The closest match, laid out like Home's hero at a smaller size: artwork, title, one meta line and its links, then its
 * verbs. On a phone the artwork sits beside the title, so the first screen holds the shelves too.
 */
function TopResult({ hit }: { hit: SearchHit }) {
  const { on } = usePlayOn();
  const label = hit.primary.label === "Play" || hit.primary.label === "Resume" ? on(hit.primary.label) : hit.primary.label;
  const play = hit.primary.label !== "Play" ? hit.actions.find(action => action.label === "Play") : undefined;
  const queue = hit.actions.find(action => action.label === "Queue");
  const save = hit.actions.find(action => action.label === "Save" || action.label === "Saved");
  const rest = useItemMenu(hit.actions.filter(action => action !== play && action !== queue && action !== save && action.label !== hit.primary.label));
  const meta = hitMeta(hit);
  const description = withoutUrls(hit.description);
  const level = useLevel(hitSources(hit));
  return <section data-search-top data-hit-id={hit.id} aria-label={hit.title} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 md:grid-rows-[1fr_auto] md:gap-x-8 md:gap-y-3">
    {/* Its shape's frame at a set height, as Details draws it. */}
    <div aria-hidden="true" className={cn("relative h-20 max-w-[36vw] overflow-hidden md:row-span-2 md:h-56 md:max-w-[40vw]", artAspect[shapeOf(hit)])}><MediaArtwork thumbnail={hit.thumbnail} title={hit.title} collection={!!hit.collection && hit.collection !== "Album"} className="aspect-auto size-full object-cover" /><ArtLevel level={level} className="max-md:size-6 max-md:text-xs" /></div>
    <div className="grid min-w-0 gap-1 md:self-end">
      <h2 className="break-words text-xl leading-tight font-semibold tracking-tight md:text-4xl md:leading-[1.02] md:tracking-[-.03em]">{hit.primary.href ? <ContentLink href={hit.primary.href} className="no-underline hover:underline">{hit.title}</ContentLink> : hit.title}</h2>
      {meta && <p className="text-sm text-muted-foreground break-words tabular-nums">{meta}</p>}
      <HitSource hit={hit} />
    </div>
    <div className="col-span-2 grid min-w-0 gap-4 md:col-span-1 md:col-start-2">
      <div data-nav-row className={verbRow}>
        <Button data-page-first data-play size="lg" asChild={!!hit.primary.href && !hit.primary.disabled} disabled={hit.primary.disabled} onClick={event => {
          if (hit.primary.href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
          if (hit.primary.href) event.preventDefault();
          hit.primary.run();
        }}>{hit.primary.href && !hit.primary.disabled ? <a href={detailHref(hit.primary.href)}>{label}</a> : label}</Button>
        {play && <Button variant="ghost" size="lg" disabled={play.disabled} onClick={play.run}>{on("Play")}</Button>}
        {queue && <Button variant="ghost" size="lg" disabled={queue.disabled} onClick={queue.run}>Queue</Button>}
        {save && <SaveToggle saved={!!save.pressed} disabled={save.disabled} onClick={save.run} />}
        <ItemMenu menu={rest} size="icon-lg" title={hit.title} className="opacity-100" />
      </div>
      {description && <p className="line-clamp-3 max-w-prose break-words text-sm leading-relaxed text-muted-foreground max-md:hidden">{description}</p>}
    </div>
  </section>;
}

/** Search's cold load in the geometry it becomes: the closest match, then a shelf. */
function SearchSkeleton() {
  return <div role="status" aria-label="Loading search results…" data-loading="search" className="space-y-8">
    <div aria-hidden="true" className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 md:grid-rows-[1fr_auto] md:gap-x-8 md:gap-y-3">
      <Skeleton className="size-20 rounded-none md:row-span-2 md:size-56" />
      <div className="grid gap-2 md:self-end"><Skeleton className="h-7 w-3/5 max-w-96 md:h-8" /><Skeleton className="h-4 w-2/5 max-w-64" /></div>
      <div className="col-span-2 flex flex-wrap gap-2 md:col-span-1 md:col-start-2"><Skeleton className="h-11 w-28 max-md:w-full" /><Skeleton className="h-11 w-20" /><Skeleton className="size-10" /></div>
    </div>
    <div aria-hidden="true" className="grid gap-3">
      <div className="flex min-h-11 items-center"><Skeleton className="h-6 w-40" /></div>
      <ol className="-m-1 flex gap-4 overflow-hidden p-1 pb-3"><MediaTilesSkeleton shape="square" /></ol>
    </div>
  </div>;
}

/** A hit's addresses, for the level while it plays: its page, or its station (by its source or its stream). */
const hitSources = (hit: SearchHit) => [hit.url, ...hit.radio ? stationSources(hit.radio) : []];

/** A hit as a tile: its press does its main verb (Play for a station or a live stream, else Open), the rest in its menu. */
function HitTile({ hit, shape, showCollection = true, pageFirst, className }: { hit: SearchHit; shape: ArtShape; showCollection?: boolean; pageFirst: boolean; className?: string }) {
  const play = hit.live && hit.actions.find(action => action.label === "Play" && !action.disabled && action.run);
  const primary = play ? { label: play.label, run: play.run!, disabled: play.disabled } : hit.primary;
  return <MediaTile related={hitRelated(hit)} className={className} data-hit-id={hit.id} data-page-first={pageFirst || undefined} shape={shape} own={shapeOf(hit)} title={hit.title} meta={metaLine(hitMeta(hit, showCollection), hit.source)} thumbnail={hit.thumbnail} source={hitSources(hit)} aria-label={`${primary.label} ${hit.title}`} disabled={primary.disabled}
    href={!play ? hit.primary.href : undefined} onClick={() => primary.run()} menu={[...play && hit.primary.label !== "Play" ? [hit.primary] : [], ...hit.actions.filter(action => action.label !== primary.label)]} />;
}

/**
 * Search hits as divided rows; collection and station pages use the compact layout. An album's tracks (`numberOf`, a
 * track's place in the whole album, filtered or not) are a tracklist: number, title and time, with nothing the page
 * already says. `pageLinks` are what the page itself shows (its address, its creator, its trail): a row doesn't
 * repeat them.
 */
export const HitList = memo(function HitList({ hits, label, compact = false, currentId, pageFirst = false, showSource = true, numberOf, pageLinks = [] }: { hits: SearchHit[]; label: string; compact?: boolean; currentId?: string; pageFirst?: boolean; showSource?: boolean; numberOf?: (hit: SearchHit) => number; pageLinks?: readonly (string | undefined)[] }) {
  const session = useOptionalSessionGate();
  if (!hits.length) return null;
  // The list takes its majority shape; a word every row shares ("Programme") says nothing, so it goes.
  const shape = majorityShape(hits.map(shapeOf), compact ? "square" : "video");
  const sameKind = hits.length > 1 && hits.every(hit => hit.collection && hit.collection === hits[0]!.collection);
  const onPage = (url?: string) => !!url && pageLinks.includes(url);
  return <div className="min-w-0">
    <MediaList aria-label={label}>{hits.map((hit, index) => {
      // A live hit's press plays it while Play is enabled; otherwise it keeps its Open destination.
      const play = hit.live && hit.actions.find(action => action.label === "Play" && !action.disabled && action.run);
      const track = !!numberOf;
      // An episode in its series' own list goes by its name, "S1 E1" leading its meta, even as the list's one row.
      const episode = !showSource ? episodeRow(hit.title) : { title: hit.title };
      return <MediaRow related={track ? undefined : hitRelated(hit, showSource, { context: onPage(hit.context?.url), creator: onPage(hit.creator?.url) })} key={hit.id} compact={compact} pageFirst={pageFirst && index === 0} data-hit-id={hit.id} source={hitSources(hit)} title={episode.title}
      number={numberOf?.(hit)}
      meta={track ? !hit.live && hit.duration != null ? formatDuration(hit.duration) : undefined : compact ? metaLine(episode.lead, hitMeta(hit, !sameKind), showSource && hit.source) : metaLine(hitContext(hit), !sameKind && hit.collection, showSource && hit.source)}
      description={!compact ? withoutUrls(hit.description) || undefined : undefined} shape={shape} own={shapeOf(hit)}
      art={track ? undefined : <MediaArtwork thumbnail={hit.thumbnail} title={hit.title} collection={!!hit.collection} />}
      primary={play ? { label: play.label, onClick: play.run!, disabled: play.disabled } : { label: hit.primary.label, onClick: hit.primary.run, disabled: hit.primary.disabled, href: hit.primary.href }}
      // A press that plays keeps the hit's own destination (a station's page) in the menu as Open.
      menu={play || hit.primary.label === "Play" ? [...play && hit.primary.label !== "Play" ? [{ label: hit.primary.label, disabled: hit.primary.disabled, run: hit.primary.run }] : [], ...hit.actions.filter(action => action.label !== "Play")] : hit.actions}>
      {hit.radio?.next && <RadioSlot show={hit.radio.next} className="w-full text-meta break-words text-muted-foreground" />}
      {hit.id === currentId && <span className="text-sm font-medium">{session ? playbackStatus(session.state, session.connected).label : "Current item"}</span>}
      {!compact && !hit.collection && <DurationBar duration={hit.duration} position={hit.position} live={hit.live} />}
    </MediaRow>;
    })}</MediaList>
  </div>;
});

export function MoreResults({ summaries }: { summaries: Entry[] }) {
  const more = summaries.filter(([, summary]) => summary.more);
  return more.length ? <div className="flex flex-wrap gap-2">{more.map(([source, summary]) => <Button key={source} variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal" disabled={summary.moreDisabled} onClick={summary.more}>More from {source}</Button>)}</div> : null;
}

const names = (sources: string[]) => sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : sources[0];

/** A page whose one source failed: one Alert with its reason and Try again; then source notes. */
export function SourceProblems({ summaries }: { summaries: Entry[] }) {
  const failed = summaries.filter(([, summary]) => summary.error);
  const notes = summaries.filter(([, summary]) => summary.warning && summary.warning !== summary.errorMessage);
  const messages = [...new Set(failed.map(([, summary]) => summary.errorMessage || "Didn't respond."))];
  return <>
    {failed.length > 0 && <Alert variant="destructive">
      <AlertTitle>Couldn't load {names(failed.map(([source]) => source))}.</AlertTitle>
      <AlertDescription>{messages.length === 1 ? messages[0] : <ul>{failed.map(([source, summary]) => <li key={source} className="break-words">{failed.length > 1 && `${source}: `}{summary.errorMessage || "Didn't respond."}</li>)}</ul>}</AlertDescription>
      <AlertAction><Button variant="ghost" size="sm" onClick={() => failed.forEach(([, summary]) => summary.retry?.())}>Try again</Button></AlertAction>
    </Alert>}
    {notes.length > 0 && <Alert><AlertDescription><ul>{notes.map(([source, summary]) => <li key={source}>{source}: {summary.warning}</li>)}</ul></AlertDescription></Alert>}
  </>;
}

/**
 * Sources that didn't answer, where others did or the page is something else (Search, a Details page's neighbours): one
 * muted line at the end with one Try again, then a muted line per source note. Their reasons wait on the source's own page.
 */
export function SourcesUnanswered({ summaries }: { summaries: Entry[] }) {
  const failed = summaries.filter(([, summary]) => summary.error);
  const notes = summaries.filter(([, summary]) => summary.warning && summary.warning !== summary.errorMessage);
  if (!failed.length && !notes.length) return null;
  return <div data-source-problems className="grid gap-1 text-sm text-muted-foreground">
    {failed.length > 0 && <p>{names(failed.map(([source]) => source))} didn't answer. <Button variant="link" className="h-auto p-0 align-baseline text-foreground touch:min-h-0" onClick={() => failed.forEach(([, summary]) => summary.retry?.())}>Try again</Button></p>}
    {notes.map(([source, summary]) => <p key={source} className="break-words">{source}: {summary.warning}</p>)}
  </div>;
}

function PastedLink({ url, quality, onQualityChange, onDone, ...props }: Props & { url: string; quality: VideoQuality; onQualityChange: (quality: VideoQuality) => void; onDone: () => void }) {
  const [mode, setMode] = useState<"Webpage" | "Direct media">("Webpage");
  const [pending, setPending] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setPending(false); return () => controller.abort(); }, [props.origin, props.token, props.connected]);
  const { hostname, pathname } = new URL(url);
  const { on } = usePlayOn();
  async function send(playNow: boolean, deviceId?: string) {
    if (!props.onCommand || pending || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setPending(true);
    // The command reports its own failure on the page.
    try { if (await props.onCommand(mode === "Direct media" ? { type: "enqueue", entry: { id: createId(), title: (hostname + pathname).slice(0, 200), source: url }, playNow, deviceId } : { type: "enqueueWeb", entryId: createId(), url, quality, playNow, deviceId }) && !signal.aborted) onDone(); }
    finally { if (!signal.aborted) setPending(false); }
  }
  const navigation = useDetailNavigation();
  const provider = providerForUrl(url);
  const disabled = !props.connected || pending;
  return <section className="max-w-3xl space-y-4" aria-label="Pasted link">
    <SettingsSection>
      <SettingsRow label="Open as"><ChoiceGroup label="Open link as" value={mode} onValueChange={setMode} disabled={disabled} options={[{ value: "Webpage", label: "Webpage" }, { value: "Direct media", label: "Direct media" }]} /></SettingsRow>
      {mode === "Webpage" && supportsWebVideoQuality(url) && <SettingsRow label="Quality"><ChoiceGroup label="Video quality" value={quality} onValueChange={onQualityChange} disabled={disabled} options={videoQualityOptions} /></SettingsRow>}
    </SettingsSection>
    <div className="flex flex-wrap gap-2">
      {/* Keep playback available for provider links outside the catalog, such as Twitch VODs. */}
      {provider && <Button variant="outline" onClick={() => navigation.open(collectionLocation({ provider, url }))}>Open page</Button>}
      <Button disabled={disabled || !props.canPlay || !props.onCommand} onClick={() => void send(true)}>{on("Play")}</Button>
      <PlayOnMenu title={hostname + pathname} disabled={disabled || !props.canPlay || !props.onCommand} onPlay={deviceId => void send(true, deviceId)} />
      <Button variant="ghost" disabled={disabled || !props.onCommand} onClick={() => void send(false)}>Queue</Button>
      {/^https?:\/\/[^/]*streamingcommunity/i.test(url) && props.onManageSources && <Button variant="ghost" onClick={() => props.onManageSources?.("streaming-community")}>StreamingCommunity settings</Button>}
    </div>
  </section>;
}
