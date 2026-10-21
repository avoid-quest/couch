import { MediaRowsSkeleton, MediaTilesSkeleton } from "@/components/LoadingMedia";
import { ChevronRight } from "lucide-react";
import { playbackStatus } from "@/playback-status";
import { useOptionalSessionGate } from "@/session/session-context";
import { MediaContext, mediaSubtitle } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { isLink, mergeSearchHits, searchLocation, searchRelevance, type SearchKind, type SearchRouteState } from "../../search";
import { memo, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { FilterBar, FilterChoice, FilterSelect } from "@/components/ContentFilters";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import type { Action } from "../../../shared/protocol";
import { providerForUrl, type ProviderId, type ProviderItem, type VideoQuality } from "../../../shared/providers";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import { SearchOnlineResults, providerNames, type SearchHit, type SearchResultSummary } from "./SearchOnlineResults";
import { Shelf } from "@/components/Shelf";
import { MediaTile, tileAspect, type TileShape } from "@/components/MediaTile";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { cn } from "@/lib/utils";
import { SearchRadioResults } from "./SearchRadioResults";
import { supportsWebVideoQuality, useEnqueueVideoQuality, videoQualityOptions } from "../../video-quality";
import { createId } from "../../session/session";
import type { SourceKind } from "@/components/sourceTypes";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar, useDurationClock } from "@/components/DurationBar";
import { formatDuration, formatEndTime } from "@/time-format";
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

type GroupId = SearchKind | "channels";
type Group = { id: GroupId; title: string; shape: TileShape | "rows"; noun: [one: string, many: string] };
// What's on the board first, then what you'd listen to, then the long tail of videos and channels. Each heading counts
// what it holds by name, as Home's shelves say "3 unfinished" or "2 saved".
const groups: Group[] = [
  { id: "films", title: "Films and series", shape: "poster", noun: ["title", "titles"] },
  { id: "radio", title: "Radio", shape: "square", noun: ["station", "stations"] },
  { id: "live", title: "Live now", shape: "video", noun: ["stream", "streams"] },
  { id: "music", title: "Music", shape: "square", noun: ["result", "results"] },
  { id: "videos", title: "Videos", shape: "rows", noun: ["video", "videos"] },
  { id: "channels", title: "Channels and lists", shape: "rows", noun: ["result", "results"] },
];
// The row of kinds above the results. Every source is searched on every query, so the row never changes while they answer.
const kinds: { value: SearchKind | "all"; label: string; none: string }[] = [
  { value: "all", label: "All", none: "results" }, { value: "films", label: "Films & series", none: "films or series" }, { value: "live", label: "Live", none: "live streams" },
  { value: "radio", label: "Radio", none: "stations" }, { value: "music", label: "Music", none: "music" }, { value: "videos", label: "Videos", none: "videos" },
];
const kindOf = (group: GroupId): SearchKind => group === "channels" ? "videos" : group;
const count = (group: Group, n: number) => `${n} ${group.noun[n === 1 ? 0 : 1]}`;
const catalogues = ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"];
// RaiPlay's programmes are series too; they come as 16:9 frames rather than posters.
const groupOf = (hit: SearchHit): GroupId => catalogues.includes(hit.source) && hit.collection !== "Channel" && hit.collection !== "List" || hit.source === "RaiPlay" && !!hit.collection ? "films"
  : hit.kind === "Radio" ? "radio" : hit.kind === "Live" ? "live" : hit.kind === "Music" ? "music" : hit.collection ? "channels" : "videos";
const shapeOf = (hit: SearchHit): TileShape => { const shape = groups.find(group => group.id === groupOf(hit))!.shape; return shape === "rows" || hit.source === "RaiPlay" ? "video" : shape; };
// One kind's tiles wrap as ProviderPage's posters do, each as wide as its column.
const gridColumns = { poster: "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]", square: "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]", video: "grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]" } as const;
const fluidTile = { poster: "[--tile-art:150cqi]", square: "[--tile-art:100cqi]", video: "[--tile-art:56.25cqi]" } as const;

/**
 * The results of the header's search (`searchState`, the route's): a row of kinds and a source above them, then the
 * closest match, then every source's hits by kind, each kind in the shape it reads best in (posters, squares, frames,
 * or rows under the time ruler); one kind fills the page as a grid or a list. Or a pasted link.
 */
export function SearchPanel(props: Props) {
  const { searchState } = props;
  const query = searchState.query;
  const [remoteSummaries, setSummaries] = useState<Record<string, SearchResultSummary>>({});
  const liveHits = useLiveSourceHits(query);
  const latest = useMemo<Record<string, SearchResultSummary>>(() => ({ ...remoteSummaries, "Shared sources": { count: liveHits.length, hits: liveHits, loading: false, error: false } }), [remoteSummaries, liveHits]);
  // Query cache hits are published before paint; never debounce them into a blank revisit.
  const summaries = latest;
  const resultsKey = JSON.stringify([query, props.origin, props.token]);
  const [seenResults, setSeenResults] = useState(resultsKey);
  if (resultsKey !== seenResults) { setSeenResults(resultsKey); setSummaries({}); }
  const reportResults = useCallback((source: string, summary: SearchResultSummary) => setSummaries(current => ({ ...current, [source]: summary })), []);
  const filter = searchState.source;
  const kind = searchState.kind;
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
  const panel = useRef<HTMLElement>(null);
  const url = isLink(query) ? query : undefined;
  const providers = url ? [] : ["youtube", "bandcamp", "soundcloud", "raiplay", "twitch", "streamingcommunity", "movies123", "animesaturn", "animeunity"] as ProviderId[];
  const inScope = (source: string) => filter === "All" || filter === source;
  const inKind = (hit: SearchHit, of = kind) => !of || kindOf(groupOf(hit)) === of;
  const asking = sourceOrder.filter(source => inScope(source) && (!summaries[source] || summaries[source].loading));
  const now = useDurationClock();
  // What the search asked for, and what merely came back: a hit is close when it mentions a word of the query, and
  // strong when its title holds every word.
  const { close, strong } = searchRelevance(query);
  const merged = useMemo(() => mergeSearchHits(sourceOrder, Object.fromEntries(Object.entries(summaries).map(([source, summary]) => [source, summary.hits ?? []])), query), [summaries, query]);
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
  // A heading or All results that changed the kind left with its control; the focus goes to the chosen kind.
  const shownKind = useRef(kind);
  useLayoutEffect(() => {
    if (shownKind.current === kind) return;
    shownKind.current = kind;
    if (document.activeElement === document.body) panel.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
  }, [kind]);
  const shown: Entry[] = Object.entries(summaries).filter(([source]) => inScope(source));
  const kindHits = merged.filter(hit => inKind(hit) && close(hit));
  const sourceHits = (source: string) => kindHits.filter(hit => hit.source === source).length;
  // A source with no hits of a newly chosen kind would empty it, so the choice falls back to every source.
  const chooseKind = (value: SearchKind | "all") => {
    const next = value === "all" ? undefined : value;
    props.onSearchChange({ ...searchState, kind: next, source: filter === "All" || merged.some(hit => hit.source === filter && close(hit) && inKind(hit, next)) ? filter : "All" });
  };
  const allResults = () => props.onSearchChange({ query, source: "All" });
  const [looseOpen, setLooseOpen] = useState(false);
  const one = kind && groups.find(group => group.id === kind)!;
  const heading = (group: Group) => kind ? undefined : searchLocation({ ...searchState, kind: kindOf(group.id) });
  return <section ref={panel} className="min-w-0 space-y-8" aria-label="Search results" onFocusCapture={event => { focusedHit.current = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset.hitId ?? null; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !panel.current?.contains(event.relatedTarget)) focusedHit.current = null; }}>
    {!url && <>
      <FilterBar label="Search filters" data-nav-row>
        <FilterChoice label="Kind" value={kind ?? "all"} onChange={chooseKind} options={kinds} className="max-sm:w-full" />
        <FilterSelect label="Source" value={filter} onChange={source => props.onSearchChange({ ...searchState, source })} className="sm:ml-auto" options={[
          { value: "All", label: "All sources", detail: kindHits.length },
          ...sourceOrder.filter(source => source === filter || sourceHits(source)).map(source => ({ value: source, label: source, detail: sourceHits(source) })),
        ]} />
      </FilterBar>
      <p role="status" className="sr-only">
        {!relevant.length && asking.length ? `Searching for “${query}”…` : `${relevant.length} ${relevant.length === 1 ? "result" : "results"} for “${query}”.`}
        {asking.length > 0 && ` ${asking.length === 1 ? `Still asking ${asking[0]}.` : `Still asking ${asking.length} sources.`}`}
      </p>
      <SourceProblems summaries={shown} />
      {!scoped.length && asking.length > 0 && (one && one.shape !== "rows" ? <ul aria-label="Loading search results…" className={cn("grid list-none gap-x-4 gap-y-6 p-0", gridColumns[one.shape])}><MediaTilesSkeleton shape={one.shape} fluid /></ul> : <MediaRowsSkeleton label="Loading search results…" />)}
      {top && <TopResult key={top.id} hit={top} now={now} />}
      {grouped.map((group, index) => group.shape === "rows"
        ? <section key={group.id} aria-label={group.title} className="grid min-w-0 gap-3">
          {/* One kind's own list needs no heading: the row names it. Channels and lists stay headed under Videos. */}
          {kind !== group.id && <header className="flex min-h-8 items-baseline gap-3"><h2 className="text-base font-medium">{heading(group) ? <KindLink href={heading(group)!} title={group.title} /> : group.title}</h2><p className="text-sm text-muted-foreground tabular-nums">{count(group, group.hits.length)}</p></header>}
          <HitList pageFirst={!top && index === 0} hits={group.hits} label={group.title} />
        </section>
        : kind ? <ul key={group.id} aria-label={group.title} className={cn("grid list-none gap-x-4 gap-y-6 p-0", gridColumns[group.shape])}>
          {group.hits.map((hit, position) => <li key={hit.id} className="@container min-w-0"><HitTile hit={hit} now={now} shape={shapeOf(hit)} pageFirst={!top && position === 0} className={cn("w-full [&_[data-media-tile]]:w-full [&_[data-tile-art]]:w-full", fluidTile[shapeOf(hit)])} /></li>)}
        </ul>
        : <Shelf key={group.id} title={group.title} time={count(group, group.hits.length)} href={heading(group)}>
          {group.hits.slice(0, expandedGroups.includes(group.id) ? undefined : 12).map((hit, position) => <li key={hit.id} className="shrink-0"><HitTile hit={hit} now={now} shape={shapeOf(hit)} pageFirst={!top && index === 0 && position === 0} /></li>)}
          {!expandedGroups.includes(group.id) && group.hits.length > 12 && <li className="shrink-0 self-center"><Button variant="ghost" onClick={() => setExpanded({ key: resultsKey, groups: [...expandedGroups, group.id] })}>{group.hits.length - 12} more</Button></li>}
        </Shelf>)}
      <MoreResults summaries={shown} />
      {props.connected && !asking.length && !relevant.length && !shown.some(([, summary]) => summary.error) && (kind || filter !== "All"
        ? <Empty role="status"><EmptyHeader><EmptyTitle><h2>No {kinds.find(option => option.value === (kind ?? "all"))!.none}{filter !== "All" && ` on ${filter}`} for “{query}”</h2></EmptyTitle></EmptyHeader><EmptyContent><Button variant="outline" onClick={allResults}>All results</Button></EmptyContent></Empty>
        : <Empty role="status"><EmptyHeader><EmptyTitle><h2>Nothing found for “{query}”</h2></EmptyTitle><EmptyDescription>Try fewer words or paste a link.</EmptyDescription></EmptyHeader>{props.onManageSources && <EmptyContent><Button variant="outline" onClick={() => props.onManageSources?.()}>Add a source</Button></EmptyContent>}</Empty>)}
      {/* What came back without a word of the query waits behind one line, so a stray hit never leads. */}
      {loose.length > 0 && <Collapsible open={looseOpen} onOpenChange={setLooseOpen} className="grid gap-3">
        <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-2.5 h-auto min-h-8 max-w-full justify-self-start text-left whitespace-normal text-muted-foreground">{looseOpen ? "Hide" : "Show"} {loose.length} {loose.length === 1 ? "result that doesn't" : "results that don't"} mention “{query}”</Button></CollapsibleTrigger>
        <CollapsibleContent><HitList hits={loose} label="Other results" compact /></CollapsibleContent>
      </Collapsible>}
    </>}
    {providers.map(provider => <SearchOnlineResults key={`${provider}:${query}`} {...props} onResults={reportResults} active={props.active && inScope(providerNames[provider])} provider={provider} query={query} quality={quality} onEnqueued={resetQuality} />)}
    {!url && radioSources.map(source => <SearchRadioResults key={`${source}:${query}`} {...props} onResults={reportResults} active={props.active && inScope(source)} query={query} source={source} />)}
    {url && <PastedLink key={url} url={url} {...props} quality={quality} onQualityChange={setQuality} onDone={resetQuality} />}
  </section>;
}

/** A group's heading under All opens its kind, as a shelf's heading opens what it samples. */
function KindLink({ href, title }: { href: string; title: string }) {
  const details = useDetailNavigation();
  return <Button asChild variant="ghost" className="-ml-2.5 h-auto min-h-8 gap-1 text-left text-base font-medium whitespace-normal">
    <a id={`shelf-${title.toLowerCase().replace(/\W+/g, "-")}`} href={href} onClick={event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      details.open(href);
    }}>{title}<ChevronRight aria-hidden="true" className="text-muted-foreground" /></a>
  </Button>;
}

const hitContext = (hit: SearchHit) => hit.meta.split(" · ").filter(part => part !== hit.source && mediaSubtitle({ subtitle: part, creator: hit.creator, collection: hit.context })).join(" · ");

/** Sources stay readable even when a long artist or programme name fills the context line. */
function HitSource({ hit, showSource = true }: { hit: SearchHit; showSource?: boolean }) {
  return <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground"><MediaContext radio={hit.radio && { ...hit.radio, title: hit.radio.title === hit.title ? "Station details" : hit.radio.title }} source={showSource ? hit.source : undefined} collection={hit.context} creator={hit.creator} />{hit.collection && <span>{hit.collection}</span>}</div>;
}

/** The closest match, laid out like Home's hero at a smaller size: artwork, title, meta, when it ends, then its verbs. */
function TopResult({ hit, now }: { hit: SearchHit; now: number }) {
  const { on } = usePlayOn();
  const label = hit.primary.label === "Play" || hit.primary.label === "Resume" ? on(hit.primary.label) : hit.primary.label;
  const play = hit.primary.label !== "Play" ? hit.actions.find(action => action.label === "Play") : undefined;
  const queue = hit.actions.find(action => action.label === "Queue");
  const save = hit.actions.find(action => action.label === "Save" || action.label === "Saved");
  const rest = useItemMenu(hit.actions.filter(action => action !== play && action !== queue && action !== save && action.label !== hit.primary.label));
  const time = hit.live ? "Live" : !hit.collection && hit.duration != null ? `${formatDuration(hit.duration)}, ends ${formatEndTime(hit.duration - (hit.position ?? 0), now)}` : undefined;
  return <section data-search-top data-hit-id={hit.id} aria-label={hit.title} className="grid gap-x-8 gap-y-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-end">
    <div aria-hidden="true" className="h-40 min-w-0 md:h-48 [&_img]:aspect-auto [&_img]:bg-transparent"><MediaArtwork thumbnail={hit.thumbnail} title={hit.title} collection={!!hit.collection && hit.collection !== "Album"} className={cn("h-full w-auto max-w-full object-contain", tileAspect[shapeOf(hit)])} /></div>
    <div className="grid min-w-0 gap-1">
      <h2 className="break-words text-2xl font-semibold tracking-tight">{hit.primary.href ? <ContentLink href={hit.primary.href} className="no-underline hover:underline">{hit.title}</ContentLink> : hit.title}</h2>
      {hitContext(hit) && <p className="text-sm text-muted-foreground break-words">{hitContext(hit)}</p>}
      <HitSource hit={hit} />
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time}</p>}
      <div data-nav-row className="mt-3 flex flex-wrap items-center gap-2 max-md:[&>:first-child]:w-full">
        <Button data-page-first data-play size="lg" asChild={!!hit.primary.href && !hit.primary.disabled} disabled={hit.primary.disabled} onClick={event => {
          if (hit.primary.href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
          if (hit.primary.href) event.preventDefault();
          hit.primary.run();
        }}>{hit.primary.href && !hit.primary.disabled ? <a href={detailHref(hit.primary.href)}>{label}</a> : label}</Button>
        {play && <Button variant="ghost" size="lg" disabled={play.disabled} onClick={play.run}>{on("Play")}</Button>}
        {queue && <Button variant="ghost" size="lg" disabled={queue.disabled} onClick={queue.run}>Queue</Button>}
        {save && <Button variant="ghost" size="lg" aria-pressed={save.pressed} disabled={save.disabled} onClick={save.run}>{save.label}</Button>}
        <ItemMenu menu={rest} size="icon-lg" title={hit.title} className="opacity-100" />
      </div>
      {hit.description && <p className="mt-4 line-clamp-3 max-w-prose break-words text-sm leading-relaxed text-muted-foreground">{hit.description}</p>}
    </div>
  </section>;
}

/** A hit as a tile: its press does its main verb (Play for a station or a live stream, else Open), the rest in its menu. */
function HitTile({ hit, now, shape, pageFirst, className }: { hit: SearchHit; now: number; shape: TileShape; pageFirst: boolean; className?: string }) {
  const play = hit.live && hit.actions.find(action => action.label === "Play" && !action.disabled && action.run);
  const primary = play ? { label: play.label, run: play.run!, disabled: play.disabled } : hit.primary;
  return <MediaTile context={<HitSource hit={hit} />} className={className} data-hit-id={hit.id} data-page-first={pageFirst || undefined} shape={shape} title={hit.title} meta={hitContext(hit)} thumbnail={hit.thumbnail} aria-label={`${primary.label} ${hit.title}`} disabled={primary.disabled}
    href={!play ? hit.primary.href : undefined} onClick={() => primary.run()} menu={[...play && hit.primary.label !== "Play" ? [hit.primary] : [], ...hit.actions.filter(action => action.label !== primary.label)]}>
    {!hit.live && !hit.collection && hit.duration != null && <span className="text-sm font-light tabular-nums">{formatDuration(hit.duration)}, ends {formatEndTime(hit.duration - (hit.position ?? 0), now)}</span>}
  </MediaTile>;
}

/** Search hits as divided rows; collection and station pages use the compact layout. */
export const HitList = memo(function HitList({ hits, label, compact = false, currentId, pageFirst = false, showSource = true }: { hits: SearchHit[]; label: string; compact?: boolean; currentId?: string; pageFirst?: boolean; showSource?: boolean }) {
  const session = useOptionalSessionGate();
  if (!hits.length) return null;
  return <div className="min-w-0">
    <MediaList aria-label={label}>{hits.map((hit, index) => {
      // A live hit's press plays it while Play is enabled; otherwise it keeps its Open destination.
      const play = hit.live && hit.actions.find(action => action.label === "Play" && !action.disabled && action.run);
      return <MediaRow context={<HitSource hit={hit} showSource={showSource} />} key={hit.id} compact={compact} pageFirst={pageFirst && index === 0} data-hit-id={hit.id} title={hit.title} meta={!compact ? hitContext(hit) : [hitContext(hit), !hit.live && hit.duration != null ? formatDuration(hit.duration) : undefined].filter(Boolean).join(" · ")} description={!compact ? hit.description : undefined} artFit={hit.kind === "Music" || ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"].includes(hit.source) ? "contain" : "cover"}
      art={<MediaArtwork thumbnail={hit.thumbnail} title={hit.title} collection={!!hit.collection} />}
      primary={play ? { label: play.label, onClick: play.run!, disabled: play.disabled } : { label: hit.primary.label, onClick: hit.primary.run, disabled: hit.primary.disabled, href: hit.primary.href }}
      // A press that plays keeps the hit's own destination (a station's page) in the menu as Open.
      menu={play || hit.primary.label === "Play" ? [...play && hit.primary.label !== "Play" ? [{ label: hit.primary.label, disabled: hit.primary.disabled, run: hit.primary.run }] : [], ...hit.actions.filter(action => action.label !== "Play")] : hit.actions}>
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

/** Sources that failed, as one Alert with one Try again; then source notes. */
export function SourceProblems({ summaries }: { summaries: Entry[] }) {
  const failed = summaries.filter(([, summary]) => summary.error);
  const notes = summaries.filter(([, summary]) => summary.warning && summary.warning !== summary.errorMessage);
  const names = failed.map(([source]) => source);
  const messages = [...new Set(failed.map(([, summary]) => summary.errorMessage || "Didn't respond."))];
  return <>
    {failed.length > 0 && <Alert variant="destructive">
      <AlertTitle>Couldn't load {names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}.</AlertTitle>
      <AlertDescription>{messages.length === 1 ? messages[0] : <ul>{failed.map(([source, summary]) => <li key={source} className="break-words">{failed.length > 1 && `${source}: `}{summary.errorMessage || "Didn't respond."}</li>)}</ul>}</AlertDescription>
      <AlertAction><Button variant="ghost" size="sm" onClick={() => failed.forEach(([, summary]) => summary.retry?.())}>Try again</Button></AlertAction>
    </Alert>}
    {notes.length > 0 && <Alert><AlertDescription><ul>{notes.map(([source, summary]) => <li key={source}>{source}: {summary.warning}</li>)}</ul></AlertDescription></Alert>}
  </>;
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
