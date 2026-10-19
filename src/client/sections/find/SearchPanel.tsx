import { isLink, mergeSearchHits, searchSources, searchEndBounds, searchDeadline, searchSecondsLeft, searchRelevance, type SearchRouteState } from "../../search";
import { memo, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@tanstack/react-pacer/debouncer";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ChoiceGroup } from "@/components/ChoiceGroup";
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
import { DurationBar, DurationRuler, useDurationClock } from "@/components/DurationBar";
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
  { id: "music", title: "Music", shape: "square", noun: ["track", "tracks"] },
  { id: "videos", title: "Videos", shape: "rows", noun: ["video", "videos"] },
  { id: "channels", title: "Channels and lists", shape: "rows", noun: ["channel", "channels"] },
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
  // Sources answer in bursts; the page takes each burst as one change, so rows and tiles don't shuffle in step with every source.
  const [summaries] = useDebouncedValue(latest, { wait: 250, leading: true, trailing: true });
  const resultsKey = JSON.stringify([query, props.origin, props.token]);
  const [seenResults, setSeenResults] = useState(resultsKey);
  if (resultsKey !== seenResults) { setSeenResults(resultsKey); setSummaries({}); }
  const reportResults = useCallback((source: string, summary: SearchResultSummary) => setSummaries(current => ({ ...current, [source]: summary })), []);
  const filter = searchState.source;
  const until = searchState.until;
  const setFilter = (source: string) => props.onSearchChange({ ...searchState, source });
  const setUntil = (value: string) => {
    setSelectedDeadline(value === "any" ? null : { until: value, deadline: searchDeadline(value, now) });
    props.onSearchChange({ ...searchState, until: value === "any" ? undefined : value });
  };
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
  const panel = useRef<HTMLElement>(null);
  const url = isLink(query) ? query : undefined;
  const providers = url ? [] : ["youtube", "bandcamp", "soundcloud", "raiplay", "twitch", "streamingcommunity", "movies123", "animesaturn", "animeunity"] as ProviderId[];
  const inScope = (source: string) => filter === "All" || filter === source;
  const asking = sourceOrder.filter(source => !summaries[source] || summaries[source].loading);
  const total = Object.values(summaries).reduce((sum, summary) => sum + summary.count, 0);
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
  // The closest match leads: the first strong hit of the first kind that has one, as Home's hero leads its shelves. Once
  // every source has answered it holds still for the query, so nothing moves under the focus while browsing.
  const candidate = groups.map(group => relevant.find(hit => groupOf(hit) === group.id && strong(hit))).find(Boolean);
  const [held, setHeld] = useState<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (candidate && !asking.length && summaries === latest) {
      setHeld(current => current?.key === resultsKey ? current : { key: resultsKey, id: candidate.id });
    }
  }, [candidate, asking.length, summaries, latest, resultsKey]);
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
  const fromSources = searchSources.filter(source => source !== "All" && (source === filter || summaries[source]?.loading || sourceCount(source) > 0));
  const [looseOpen, setLooseOpen] = useState(false);
  const filtered = filter !== "All" || !!until;
  return <section ref={panel} className="min-w-0 space-y-8" aria-label="Search results" onFocusCapture={event => { focusedHit.current = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset.hitId ?? null; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !panel.current?.contains(event.relatedTarget)) focusedHit.current = null; }}>
    {!url && <>
      {(total > 0 || asking.length > 0) && <div className="grid gap-2">
        <p role="status" className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground tabular-nums">{asking.length > 0 && <Spinner aria-hidden="true" className="size-3.5" />}{relevant.length} results{asking.length > 0 && `, still asking ${asking.join(", ")}`}</p>
        {/* Each row is named once at its left, as a settings row is, so the choices stay short: "From: YouTube", "Ends by: 17:30". */}
        {(relevant.length > 0 || filtered) && <div className="grid gap-x-4 gap-y-1 md:grid-cols-[5rem_minmax(0,1fr)] md:items-center">
          <p className="text-sm text-muted-foreground">From</p>
          <ChoiceGroup label="From" value={filter} onValueChange={setFilter} className="-ml-2.5 touch:flex-nowrap touch:overflow-x-auto touch:[scrollbar-width:none] touch:*:shrink-0" options={[{ value: "All", label: "All sources", count: sourceCount("All") }, ...fromSources.map(source => ({ value: source, label: source, count: summaries[source]?.loading ? "…" : sourceCount(source) }))]} />
          <p className="text-sm text-muted-foreground">Ends by</p>
          <ChoiceGroup label="Ends by" value={until ?? "any"} onValueChange={setUntil} className="-ml-2.5 touch:flex-nowrap touch:overflow-x-auto touch:[scrollbar-width:none] touch:*:shrink-0" options={[{ value: "any", label: "Any time" }, ...bounds.map(bound => ({ value: bound.value, label: bound.value, count: merged.filter(hit => inScope(hit.source) && close(hit) && fitsBy(hit, bound.value === until ? fits : searchSecondsLeft(bound.deadline, now))).length }))]} />
        </div>}
      </div>}
      {top && <TopResult key={top.id} hit={top} now={now} />}
      {grouped.map((group, index) => group.shape === "rows"
        ? <section key={group.id} aria-label={group.title} className="grid min-w-0 gap-3">
          <header className="flex min-h-8 items-baseline gap-3"><h2 className="text-base font-medium">{group.title}</h2><p className="text-sm text-muted-foreground tabular-nums">{count(group, group.hits.length)}</p></header>
          <HitList pageFirst={!top && index === 0} hits={group.hits} label={group.title} />
        </section>
        : <Shelf key={group.id} title={group.title} time={count(group, group.hits.length)}>
          {group.hits.slice(0, expandedGroups.includes(group.id) ? undefined : 12).map((hit, position) => <li key={hit.id} className="shrink-0"><HitTile hit={hit} shape={shapeOf(hit)} pageFirst={!top && index === 0 && position === 0} /></li>)}
          {!expandedGroups.includes(group.id) && group.hits.length > 12 && <li className="shrink-0 self-center"><Button variant="ghost" onClick={() => setExpanded({ key: resultsKey, groups: [...expandedGroups, group.id] })}>{group.hits.length - 12} more</Button></li>}
        </Shelf>)}
      <MoreResults summaries={shown} />
      <SourceProblems summaries={shown} />
      {total > 0 && !asking.length && !relevant.length && filtered && <Empty><EmptyHeader><EmptyTitle>Nothing matches these filters</EmptyTitle></EmptyHeader><EmptyContent><Button variant="outline" onClick={clearFilters}>Clear filters</Button></EmptyContent></Empty>}
      {props.connected && !asking.length && !relevant.length && !filtered && !shown.some(([, summary]) => summary.error) && <Empty role="status"><EmptyHeader><EmptyTitle><h2>Nothing found for “{query}”</h2></EmptyTitle><EmptyDescription>Try fewer words or paste a link.</EmptyDescription></EmptyHeader>{props.onManageSources && <EmptyContent><Button variant="outline" onClick={() => props.onManageSources?.()}>Add a source</Button></EmptyContent>}</Empty>}
      {/* What came back without a word of the query waits behind one line, so a stray hit never leads. */}
      {loose.length > 0 && <Collapsible open={looseOpen} onOpenChange={setLooseOpen} className="grid gap-3">
        <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-2.5 justify-self-start text-muted-foreground">{looseOpen ? "Hide" : "Show"} {loose.length} results that don't mention “{query}”</Button></CollapsibleTrigger>
        <CollapsibleContent><HitList hits={loose} label="Other results" timeline={false} /></CollapsibleContent>
      </Collapsible>}
    </>}
    {providers.map(provider => <SearchOnlineResults key={`${provider}:${query}`} {...props} onResults={reportResults} active={props.active && inScope(providerNames[provider])} provider={provider} query={query} quality={quality} onEnqueued={resetQuality} />)}
    {!url && radioSources.map(source => <SearchRadioResults key={`${source}:${query}`} {...props} onResults={reportResults} active={props.active && inScope(source)} query={query} source={source} />)}
    {url && <PastedLink key={url} url={url} {...props} quality={quality} onQualityChange={setQuality} onDone={resetQuality} />}
  </section>;
}

/** The closest match, laid out like Home's hero at a smaller size: artwork, title, meta, when it ends, then its verbs. */
function TopResult({ hit, now }: { hit: SearchHit; now: number }) {
  const { on } = usePlayOn();
  const label = hit.primary.label === "Play" || hit.primary.label === "Resume" ? on(hit.primary.label) : hit.primary.label;
  const play = hit.primary.label !== "Play" ? hit.actions.find(action => action.label === "Play") : undefined;
  const queue = hit.actions.find(action => action.label === "Queue");
  const rest = useItemMenu(hit.actions.filter(action => action !== play && action !== queue && action.label !== hit.primary.label));
  const time = hit.live ? "Live" : hit.collection ? hit.collection : hit.duration != null ? `${formatDuration(hit.duration)}, ends ${formatEndTime(hit.duration - (hit.position ?? 0), now)}` : undefined;
  return <section data-search-top data-hit-id={hit.id} aria-label={hit.title} className="grid gap-x-8 gap-y-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-end">
    <div aria-hidden="true" className="h-40 min-w-0 md:h-48 [&_img]:aspect-auto [&_img]:bg-transparent"><MediaArtwork thumbnail={hit.thumbnail} title={hit.title} collection={!!hit.collection && hit.collection !== "Album"} className={cn("h-full w-auto max-w-full object-contain", tileAspect[shapeOf(hit)])} /></div>
    <div className="grid min-w-0 gap-1">
      <h2 className="line-clamp-2 text-2xl font-semibold tracking-tight">{hit.title}</h2>
      <p className="truncate text-sm text-muted-foreground">{hit.meta}</p>
      {time && <p className="text-xl font-light tabular-nums">{time}</p>}
      <div data-nav-row className="mt-3 flex flex-wrap items-center gap-1">
        <Button data-page-first data-play size="lg" asChild={!!hit.primary.href && !hit.primary.disabled} disabled={hit.primary.disabled} onClick={event => {
          if (hit.primary.href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
          if (hit.primary.href) event.preventDefault();
          hit.primary.run();
        }}>{hit.primary.href && !hit.primary.disabled ? <a href={detailHref(hit.primary.href)}>{label}</a> : label}</Button>
        {play && <Button variant="ghost" size="lg" disabled={play.disabled} onClick={play.run}>{on("Play")}</Button>}
        {queue && <Button variant="ghost" size="lg" disabled={queue.disabled} onClick={queue.run}>Queue</Button>}
        <ItemMenu menu={rest} size="icon-lg" title={hit.title} className="opacity-100" />
      </div>
    </div>
  </section>;
}

/** A hit as a tile: its press does its main verb (Play for a station or a live stream, else Open), the rest in its menu. */
function HitTile({ hit, shape, pageFirst }: { hit: SearchHit; shape: TileShape; pageFirst: boolean }) {
  const play = hit.live && hit.actions.find(action => action.label === "Play" && !action.disabled && action.run);
  const primary = play ? { label: play.label, run: play.run!, disabled: play.disabled } : hit.primary;
  return <MediaTile data-hit-id={hit.id} data-page-first={pageFirst || undefined} shape={shape} title={hit.title} meta={hit.meta} thumbnail={hit.thumbnail} aria-label={`${primary.label} ${hit.title}`} disabled={primary.disabled}
    href={!play ? hit.primary.href : undefined} onClick={() => primary.run()} menu={[...play && hit.primary.label !== "Play" ? [hit.primary] : [], ...hit.actions.filter(action => action.label !== primary.label)]} />;
}

/** Search hits as media rows under one time ruler. */
export const HitList = memo(function HitList({ hits, label, timeline = true, currentId, pageFirst = false }: { hits: SearchHit[]; label: string; timeline?: boolean; currentId?: string; pageFirst?: boolean }) {
  if (!hits.length) return null;
  return <div className="[--duration-width:6rem] sm:[--duration-width:14rem] lg:[--duration-width:18rem]">
    {/* Mirrors MediaRow's thumbnail column, gap and button padding so bars start at "Now". */}
    {timeline && hits.some(hit => !hit.collection && !hit.live && hit.duration != null) && <div className="hidden grid-cols-[7rem_minmax(0,1fr)] gap-x-4 sm:grid"><DurationRuler className="col-start-2 ml-2" /></div>}
    <MediaList aria-label={label}>{hits.map((hit, index) => {
      // A live hit's press plays it while Play is enabled; otherwise it keeps its Open destination.
      const play = hit.live && hit.actions.find(action => action.label === "Play" && !action.disabled && action.run);
      return <MediaRow key={hit.id} compact={!timeline} pageFirst={pageFirst && index === 0} data-hit-id={hit.id} title={hit.title} meta={timeline ? hit.meta : [hit.meta.split(" · ").filter(part => part !== hit.source).join(" · "), !hit.live && hit.duration != null ? formatDuration(hit.duration) : undefined].filter(Boolean).join(" · ")} description={timeline ? hit.description : undefined} artFit={hit.kind === "Music" || ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"].includes(hit.source) ? "contain" : "cover"}
      art={<MediaArtwork thumbnail={hit.thumbnail} title={hit.title} collection={!!hit.collection} />}
      primary={play ? { label: play.label, onClick: play.run!, disabled: play.disabled } : { label: hit.primary.label, onClick: hit.primary.run, disabled: hit.primary.disabled, href: hit.primary.href }}
      // A press that plays keeps the hit's own destination (a station's page) in the menu as Open.
      menu={play || hit.primary.label === "Play" ? [...play && hit.primary.label !== "Play" ? [{ label: hit.primary.label, disabled: hit.primary.disabled, run: hit.primary.run }] : [], ...hit.actions.filter(action => action.label !== "Play")] : hit.actions}
      // A press that opens a page holding every verb needs no "…": a collection's, whose menu is Save. Stations, live hits and videos with Play next keep theirs.
      menuOnPage={!play && !!hit.primary.href && hit.kind !== "Radio" && !hit.actions.some(action => action.label === "Play next")}>
      {hit.id === currentId && <span className="text-sm font-medium">Playing</span>}
      {timeline && (hit.collection ? <span className="text-sm">{hit.collection}</span> : <DurationBar duration={hit.duration} position={hit.position} live={hit.live} />)}
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
  const notes = summaries.filter(([, summary]) => summary.warning);
  const names = failed.map(([source]) => source);
  return <>
    {failed.length > 0 && <Alert variant="destructive">
      <AlertTitle>Couldn't load {names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}.</AlertTitle>
      <AlertDescription><ul>{failed.map(([source, summary]) => <li key={source} className="break-words">{failed.length > 1 && `${source}: `}{summary.errorMessage || "Didn't respond."}</li>)}</ul></AlertDescription>
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
