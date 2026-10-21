import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { playbackStatus } from "@/playback-status";
import { useOptionalSessionGate } from "@/session/session-context";
import { MediaContext, mediaSubtitle } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { isLink, mergeSearchHits, searchSources, searchEndBounds, searchDeadline, searchSecondsLeft, searchRelevance, type SearchRouteState } from "../../search";
import { memo, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { FilterSelect } from "@/components/ContentFilters";
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

type GroupId = "films" | "radio" | "live" | "music" | "videos" | "channels";
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
const count = (group: Group, n: number) => `${n} ${group.noun[n === 1 ? 0 : 1]}`;
const catalogues = ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"];
// RaiPlay's programmes are series too; they come as 16:9 frames rather than posters.
const groupOf = (hit: SearchHit): GroupId => catalogues.includes(hit.source) && hit.collection !== "Channel" && hit.collection !== "List" || hit.source === "RaiPlay" && !!hit.collection ? "films"
  : hit.kind === "Radio" ? "radio" : hit.kind === "Live" ? "live" : hit.kind === "Music" ? "music" : hit.collection ? "channels" : "videos";
const shapeOf = (hit: SearchHit): TileShape => { const shape = groups.find(group => group.id === groupOf(hit))!.shape; return shape === "rows" || hit.source === "RaiPlay" ? "video" : shape; };

/**
 * The results of the header's search (`searchState`, the route's): the closest match on top, then every source's hits
 * by kind, each kind in the shape it reads best in (posters, squares, frames, or rows under the time ruler), with the
 * sources and "Ends by" as one row of choices above them; or a pasted link.
 */
export function SearchPanel(props: Props) {
  const { searchState } = props;
  const query = searchState.query;
  const [remoteSummaries, setSummaries] = useState<Record<string, SearchResultSummary>>({});
  const liveHits = useLiveSourceHits(query);
  const latest = useMemo<Record<string, SearchResultSummary>>(() => ({ ...remoteSummaries, "Shared sources": { count: liveHits.length, hits: liveHits, facets: liveHits, loading: false, error: false } }), [remoteSummaries, liveHits]);
  // Query cache hits are published before paint; never debounce them into a blank revisit.
  const summaries = latest;
  const resultsKey = JSON.stringify([query, props.origin, props.token]);
  const [seenResults, setSeenResults] = useState(resultsKey);
  if (resultsKey !== seenResults) { setSeenResults(resultsKey); setSummaries({}); }
  const reportResults = useCallback((source: string, summary: SearchResultSummary) => setSummaries(current => ({ ...current, [source]: summary })), []);
  const filter = searchState.source;
  const until = searchState.until;
  const setFilter = (source: string) => props.onSearchChange({ ...searchState, source });
  const setUntil = (value: string) => props.onSearchChange({ ...searchState, until: value === "any" ? undefined : value });
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
  const panel = useRef<HTMLElement>(null);
  const url = isLink(query) ? query : undefined;
  const providers = url ? [] : ["youtube", "bandcamp", "soundcloud", "raiplay", "twitch", "streamingcommunity", "movies123", "animesaturn", "animeunity"] as ProviderId[];
  const inScope = (source: string) => filter === "All" || filter === source;
  const asking = sourceOrder.filter(source => inScope(source) && (!summaries[source] || summaries[source].loading));
  // Ends by: three clock times ahead, on the half hour, the first at least twenty minutes out. Live and radio always fit.
  const now = useDurationClock();
  const [selectedDeadline, setSelectedDeadline] = useState(() => until ? { until, deadline: searchDeadline(until, now) } : null);
  const deadline = selectedDeadline?.until === until ? selectedDeadline : until ? { until, deadline: searchDeadline(until, now) } : null;
  if (deadline !== selectedDeadline) setSelectedDeadline(deadline);
  const bounds = searchEndBounds(now);
  if (deadline && !bounds.some(bound => bound.value === until)) bounds.unshift({ value: deadline.until, deadline: deadline.deadline });
  const fits = deadline ? searchSecondsLeft(deadline.deadline, now) : null;
  const fitsBy = (hit: SearchHit, seconds: number | null) => seconds == null || !!hit.live || hit.kind === "Radio" || !hit.collection && hit.duration != null && hit.duration - (hit.position ?? 0) <= seconds;
  // What the search asked for, and what merely came back: a hit is close when it mentions a word of the query, and
  // strong when its title holds every word.
  const { close, strong } = searchRelevance(query);
  const merged = useMemo(() => mergeSearchHits(sourceOrder, Object.fromEntries(Object.entries(summaries).map(([source, summary]) => [source, summary.hits ?? []])), query), [summaries, query]);
  const scoped = merged.filter(hit => inScope(hit.source) && fitsBy(hit, fits));
  const relevant = scoped.filter(close);
  const loose = scoped.filter(hit => !close(hit));
  // The closest match leads: the first strong hit of the first kind that has one, as Home's hero leads its shelves. The first match
  // holds still for the query, so nothing moves under the focus while browsing.
  const candidate = groups.map(group => relevant.find(hit => groupOf(hit) === group.id && strong(hit))).find(Boolean);
  const [held, setHeld] = useState<{ key: string; id: string } | null>(null);
  useLayoutEffect(() => {
    if (candidate) {
      setHeld(current => current?.key === resultsKey ? current : { key: resultsKey, id: candidate.id });
    }
  }, [candidate, resultsKey]);
  const top = (held?.key === resultsKey && relevant.find(hit => hit.id === held.id)) || candidate;
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
  const shown: Entry[] = Object.entries(summaries).filter(([source]) => inScope(source));
  const clearFilters = () => props.onSearchChange({ query, source: "All" });
  const sourceCount = (source: string) => merged.filter(hit => (source === "All" || hit.source === source) && close(hit) && fitsBy(hit, fits)).length;
  const [looseOpen, setLooseOpen] = useState(false);
  const filtered = filter !== "All" || !!until;
  return <section ref={panel} className="min-w-0 space-y-8" aria-label="Search results" onFocusCapture={event => { focusedHit.current = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset.hitId ?? null; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !panel.current?.contains(event.relatedTarget)) focusedHit.current = null; }}>
    {!url && <>
      <div className="grid gap-3">
        <div role="group" aria-label="Search filters" className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-end gap-3 sm:flex sm:flex-wrap">
          <FilterSelect label="Source" value={filter} onChange={setFilter} className="sm:w-56" options={searchSources.map(source => ({ value: source, label: source === "All" ? "All sources" : source,
            detail: source === "All" ? sourceCount(source) : !summaries[source] || summaries[source].loading ? "Loading…" : summaries[source].error ? "Unavailable" : sourceCount(source),
          }))} />
          <FilterSelect label="Ends by" value={until ?? "any"} onChange={setUntil} className="sm:w-40" options={[{ value: "any", label: "Any time" }, ...bounds.map(bound => ({ value: bound.value, label: bound.value }))]} />
        </div>
        <div className="flex min-h-11 items-start justify-between gap-3">
        <p role="status" className="flex min-h-10 items-start gap-2 text-sm text-muted-foreground">
          {asking.length > 0 && <Spinner aria-hidden="true" className="mt-1 size-3.5 shrink-0" />}
          <span className="min-w-0 break-words">
            <span className="block text-foreground">{!relevant.length && asking.length ? `Searching for “${query}”…` : `${relevant.length} ${relevant.length === 1 ? "result" : "results"} for “${query}”`}</span>
            {asking.length > 0 && <span className="block">{asking.length === 1 ? `Still asking ${asking[0]}.` : `Still asking ${asking.length} sources.`}</span>}
          </span>
        </p>
        <Button variant="ghost" disabled={!filtered} onClick={clearFilters} className="-mr-2.5 shrink-0">Clear filters</Button>
        </div>
      </div>
      <SourceProblems summaries={shown} />
      {!scoped.length && asking.length > 0 && <MediaRowsSkeleton label="Loading search results…" />}
      {top && <TopResult key={top.id} hit={top} now={now} />}
      {grouped.map((group, index) => group.shape === "rows"
        ? <section key={group.id} aria-label={group.title} className="grid min-w-0 gap-3">
          <header className="flex min-h-8 items-baseline gap-3"><h2 className="text-base font-medium">{group.title}</h2><p className="text-sm text-muted-foreground tabular-nums">{count(group, group.hits.length)}</p></header>
          <HitList pageFirst={!top && index === 0} hits={group.hits} label={group.title} />
        </section>
        : <Shelf key={group.id} title={group.title} time={count(group, group.hits.length)}>
          {group.hits.slice(0, expandedGroups.includes(group.id) ? undefined : 12).map((hit, position) => <li key={hit.id} className="shrink-0"><HitTile hit={hit} now={now} shape={shapeOf(hit)} pageFirst={!top && index === 0 && position === 0} /></li>)}
          {!expandedGroups.includes(group.id) && group.hits.length > 12 && <li className="shrink-0 self-center"><Button variant="ghost" onClick={() => setExpanded({ key: resultsKey, groups: [...expandedGroups, group.id] })}>{group.hits.length - 12} more</Button></li>}
        </Shelf>)}
      <MoreResults summaries={shown} />
      {props.connected && !asking.length && !relevant.length && filtered && !shown.some(([, summary]) => summary.error) && <Empty><EmptyHeader><EmptyTitle>Nothing matches these filters</EmptyTitle></EmptyHeader><EmptyContent><Button variant="outline" onClick={clearFilters}>Clear filters</Button></EmptyContent></Empty>}
      {props.connected && !asking.length && !relevant.length && !filtered && !shown.some(([, summary]) => summary.error) && <Empty role="status"><EmptyHeader><EmptyTitle><h2>Nothing found for “{query}”</h2></EmptyTitle><EmptyDescription>Try fewer words or paste a link.</EmptyDescription></EmptyHeader>{props.onManageSources && <EmptyContent><Button variant="outline" onClick={() => props.onManageSources?.()}>Add a source</Button></EmptyContent>}</Empty>}
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
function HitTile({ hit, now, shape, pageFirst }: { hit: SearchHit; now: number; shape: TileShape; pageFirst: boolean }) {
  const play = hit.live && hit.actions.find(action => action.label === "Play" && !action.disabled && action.run);
  const primary = play ? { label: play.label, run: play.run!, disabled: play.disabled } : hit.primary;
  return <MediaTile context={<HitSource hit={hit} />} data-hit-id={hit.id} data-page-first={pageFirst || undefined} shape={shape} title={hit.title} meta={hitContext(hit)} thumbnail={hit.thumbnail} aria-label={`${primary.label} ${hit.title}`} disabled={primary.disabled}
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
