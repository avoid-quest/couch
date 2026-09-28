import { searchSources, searchKinds, searchLengths, type SearchRouteState } from "../../search";
import { memo, useMemo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { SearchBar } from "@/components/SearchBar";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PageHeader } from "@/components/PageHeader";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import type { Action } from "../../../shared/protocol";
import type { ProviderId, ProviderItem, VideoQuality } from "../../../shared/providers";
import { SearchOnlineResults, matchesFacet, providerNames, searchError, type SearchCollection, type SearchFacet, type SearchHit, type SearchKind, type SearchLength, type SearchResultSummary } from "./SearchOnlineResults";
import { SearchRadioResults } from "./SearchRadioResults";
import { supportsWebVideoQuality, useEnqueueVideoQuality, videoQualityOptions } from "../../video-quality";
import { createId } from "../../session/session";
import type { SourceSetupKind } from "@/components/SourceSetupDialog";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar, DurationRuler } from "@/components/DurationBar";

export type Props = {
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  defaultQuality?: VideoQuality;
  onCommand?: (action: Action) => Promise<boolean>;
  onManageSources?: (source?: SourceSetupKind) => void;
  onOpenCollection?: (item: ProviderItem) => void;
  onQueryChange?: (query: string) => void;
  draftQuery?: string;
  searchState?: SearchRouteState;
  onSearchChange?: (state: SearchRouteState) => void;
};
type Entry = [source: string, summary: SearchResultSummary];

// Sources in the order their results interleave; the rest are searched too.
const sourceOrder = ["YouTube", "Twitch", "RaiPlay", "avoid radio", "Radio playlists", "Radio directory", "StreamingCommunity", "Bandcamp"];
const searchable = sourceOrder.filter(source => source !== "Bandcamp");
const radioSources = ["avoid radio", "Radio playlists", "Radio directory"] as const;
const isLink = (value: string) => {
  try { return /^https?:\/\//i.test(value) && !!new URL(value).hostname; }
  catch { return false; }
};

export function SearchPanel(props: Props) {
  const [localDraft, setDraft] = useState(props.searchState?.query ?? "");
  const routeQuery = props.searchState?.query;
  const [seenRoute, setSeenRoute] = useState(routeQuery);
  if (routeQuery !== seenRoute) { setSeenRoute(routeQuery); if (props.draftQuery === undefined && routeQuery !== undefined) setDraft(routeQuery); }
  const draft = props.draftQuery ?? localDraft;
  const input = useRef<HTMLInputElement>(null);
  const [composing, setComposing] = useState(false);
  const typeToSearch = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || (event.key.length !== 1 || event.key === " ") || document.querySelector('[role="dialog"][data-state="open"]')) return;
    if (!(event.target instanceof HTMLElement) || event.target.closest("button, a, input, select, textarea, summary, [role=button], [role=link], [role=option], [contenteditable=true]")) return;
    input.current?.focus();
    if (input.current) { props.onQueryChange?.(`${draft}${event.key}`); if (!props.onQueryChange) setDraft(`${draft}${event.key}`); event.preventDefault(); }
  });
  useEffect(() => {
    if (!props.active) return;
    const onKeyDown = (event: KeyboardEvent) => typeToSearch(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.active]);
  const [localSearch, setSearch] = useState({ query: "", attempt: 0 });
  const search = { ...localSearch, query: props.searchState?.query ?? localSearch.query };
  const [summaries, setSummaries] = useState<Record<string, SearchResultSummary>>({});
  const resultsKey = JSON.stringify([search.query, props.origin, props.token]);
  const [seenResults, setSeenResults] = useState(resultsKey);
  if (resultsKey !== seenResults) { setSeenResults(resultsKey); setSummaries({}); }
  const reportResults = useCallback((source: string, summary: SearchResultSummary) => setSummaries(current => ({ ...current, [source]: summary })), []);
  const [localFilter, setLocalFilter] = useState("All");
  const [localKind, setLocalKind] = useState<SearchKind | "All">("All");
  const [localLength, setLocalLength] = useState<SearchLength | "All">("All");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filter = props.searchState?.source ?? localFilter;
  const kind = props.searchState ? props.searchState.kind ?? "All" : localKind;
  const length = props.searchState ? props.searchState.length ?? "All" : localLength;
  const filtersState = { ...(kind === "All" ? {} : { kind }), ...(length === "All" ? {} : { length }) };
  const setFilter = (source: string) => { setLocalFilter(source); props.onSearchChange?.({ query: search.query, source, ...filtersState }); };
  const setKind = (value: SearchKind | "All") => { setLocalKind(value); props.onSearchChange?.({ query: search.query, source: filter, ...filtersState, kind: value === "All" ? undefined : value }); };
  const setLength = (value: SearchLength | "All") => { setLocalLength(value); props.onSearchChange?.({ query: search.query, source: filter, ...filtersState, length: value === "All" ? undefined : value }); };
  const changeDraft = (query: string) => { if (props.draftQuery === undefined) setDraft(query); props.onQueryChange?.(query); };
  const commit = (query: string, submit = false) => {
    const source = isLink(query) ? "All" : filter;
    setLocalFilter(source);
    setSearch(value => ({ query, attempt: value.attempt + Number(submit && query === search.query) }));
    props.onSearchChange?.({ query, source, ...filtersState });
  };
  const commitDraft = useEffectEvent(() => commit(draft.trim()));
  useEffect(() => {
    if (composing || !props.active || !props.connected || draft.trim() === search.query) return;
    const timer = setTimeout(() => commitDraft(), 300);
    return () => clearTimeout(timer);
  }, [draft, search.query, props.active, props.connected, composing]);
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
  const panel = useRef<HTMLElement>(null);
  const url = isLink(search.query) ? search.query : undefined;
  const providers = url ? [] : ["youtube", "raiplay", "twitch", "streamingcommunity"] as ProviderId[];
  const inScope = (source: string) => filter === "All" || filter === source;
  const asking = searchable.filter(source => !summaries[source] || summaries[source].loading);
  const total = Object.values(summaries).reduce((sum, summary) => sum + summary.count, 0);
  const facetKind = kind === "All" ? undefined : kind, facetLength = length === "All" ? undefined : length;
  const mergedHits = useMemo(() => sourceOrder.flatMap((source, rank) => (summaries[source]?.hits ?? []).map((hit, index) => ({ hit, order: index * sourceOrder.length + rank })))
    .filter(({ hit }) => (inScope(hit.source) && matchesFacet(hit, facetKind, facetLength)))
    .sort((a, b) => a.order - b.order).map(({ hit }) => hit), [summaries, filter, facetKind, facetLength]);
  const focusedHit = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!props.active || !focusedHit.current || document.activeElement !== document.body) return;
    const row = panel.current?.querySelector<HTMLElement>(`[data-hit-id="${CSS.escape(focusedHit.current)}"] [data-play]`)
      ?? panel.current?.querySelector<HTMLElement>("[data-play]") ?? input.current;
    row?.focus({ preventScroll: true });
  }, [mergedHits, props.active]);
  const shown: Entry[] = Object.entries(summaries).filter(([source]) => inScope(source));
  const clearFilters = () => { setLocalFilter("All"); setLocalKind("All"); setLocalLength("All"); props.onSearchChange?.({ query: search.query, source: "All" }); };
  const facets = (source = filter) => Object.entries(summaries).filter(([name]) => source === "All" || name === source).flatMap(([, summary]) => summary.facets ?? []);
  const count = (items: SearchFacet[], kind?: SearchKind, length?: SearchLength) => items.filter(item => matchesFacet(item, kind, length)).length;
  const fromSources = searchSources.filter(source => source !== "All" && (source === filter || summaries[source]?.loading || count(facets(source), facetKind, facetLength) > 0));
  const filters = <>
    <FilterGroup label="From" value={filter} onChange={setFilter} options={[{ value: "All", label: "All", count: count(facets("All"), facetKind, facetLength) },
      ...fromSources.map(source => ({ value: source, label: source, count: summaries[source]?.loading ? "…" : count(facets(source), facetKind, facetLength) }))]} />
    <FilterGroup label="What" value={kind} onChange={setKind} options={[{ value: "All" as const, label: "All", count: count(facets(), undefined, facetLength) },
      ...searchKinds.map(value => { const matches = count(facets(), value, facetLength); return { value, label: value, count: matches, disabled: !matches && kind !== value }; })]} />
    <FilterGroup label="Length" value={length} onChange={setLength} options={[{ value: "All" as const, label: "All", count: count(facets(), facetKind) },
      ...searchLengths.map(value => { const matches = count(facets(), facetKind, value); return { value, label: value, count: matches, disabled: !matches && length !== value }; })]} />
  </>;
  const activeFilters = [filter, kind, length].filter(value => value !== "All").join(", ");
  const results = (label: string) => <>
    <HitList hits={mergedHits} label={label} origin={props.origin} token={props.token} />
    <MoreResults summaries={shown} />
    <SourceProblems summaries={shown} />
  </>;
  return <section ref={panel} className="min-w-0 space-y-6" aria-label="Search media" onFocusCapture={event => { focusedHit.current = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset.hitId ?? null; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !panel.current?.contains(event.relatedTarget)) focusedHit.current = null; }} onKeyDown={event => { if (event.target !== input.current) return; if (event.key === "ArrowDown") { const row = panel.current?.querySelector<HTMLElement>("[data-play]"); if (row) { event.preventDefault(); row.focus(); } } else if (event.key === "ArrowUp") { const nav = document.querySelector<HTMLElement>(".app-header a"); if (nav) { event.preventDefault(); nav.focus(); } } }}>
    <SearchBar id="media-search" pageFirst inputRef={input} className="min-w-0" value={draft} onValueChange={changeDraft} onCompositionChange={setComposing} onSubmit={() => { commit(draft.trim(), true); requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-play]")?.focus()); }} onClear={draft ? () => { changeDraft(""); commit(""); input.current?.focus(); } : undefined} />
    {search.query && !url && asking.length > 0 && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner aria-hidden="true" className="size-3.5" />Still asking {asking.join(", ")}…</p>}
    {search.query && !url && <div className={total ? "grid min-w-0 gap-6 xl:grid-cols-[12rem_minmax(0,1fr)] xl:gap-12" : "min-w-0"}>
      {total > 0 && <>
        <div className="xl:hidden"><Button variant="ghost" className="-ml-2.5" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>Filters{activeFilters && <span className="text-muted-foreground">{activeFilters}</span>}</Button></div>
        <aside className={filtersOpen ? "grid gap-6 sm:grid-cols-3 xl:block xl:space-y-6" : "hidden xl:block xl:space-y-6"} aria-label="Filter search results">{filters}</aside>
      </>}
      <div className="min-w-0 space-y-6">
        {results("Search results")}
        {total > 0 && !asking.length && !mergedHits.length && <Empty><EmptyHeader><EmptyTitle>Nothing matches these filters</EmptyTitle></EmptyHeader><EmptyContent><Button variant="outline" onClick={clearFilters}>Clear filters</Button></EmptyContent></Empty>}
        {props.connected && !asking.length && total === 0 && !shown.some(([, summary]) => summary.error) && <Empty role="status"><EmptyHeader><EmptyTitle><h2>Nothing found for “{search.query}”</h2></EmptyTitle><EmptyDescription>{filter === "Bandcamp" ? "Paste a Bandcamp album or track link." : "Try fewer words or paste a link."}</EmptyDescription></EmptyHeader>{props.onManageSources && <EmptyContent><Button variant="outline" onClick={() => props.onManageSources?.()}>Add a source</Button></EmptyContent>}</Empty>}
      </div>
    </div>}
    {search.query && providers.map(provider => <SearchOnlineResults key={`${provider}:${search.query}:${search.attempt}`} {...props} retry={search.attempt} onResults={reportResults} active={props.active && inScope(providerNames[provider])} provider={provider} query={search.query} quality={quality} onEnqueued={resetQuality} />)}
    {search.query && !url && <>
      {radioSources.map(source => <SearchRadioResults key={`${source}:${search.query}:${search.attempt}`} {...props} retry={search.attempt} onResults={reportResults} active={props.active && inScope(source)} query={search.query} source={source} />)}
    </>}
    {url && <PastedLink key={`${url}:${search.attempt}`} url={url} {...props} quality={quality} onQualityChange={setQuality} onDone={resetQuality} />}
  </section>;
}

function FilterGroup<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: { value: T; label: string; count: number | string; disabled?: boolean }[] }) {
  return <div className="min-w-0 space-y-1">
    <h2 className="text-sm text-muted-foreground">{label}</h2>
    <ChoiceGroup label={`${label} filter`} orientation="vertical" value={value} onValueChange={onChange} options={options} className="-ml-2.5 w-[calc(100%+0.625rem)]" />
  </div>;
}

/** Search hits as media rows under one time ruler. */
export const HitList = memo(function HitList({ hits, label, origin, token }: { hits: SearchHit[]; label: string; origin: string; token: string }) {
  if (!hits.length) return null;
  return <div className="[--duration-width:6rem] sm:[--duration-width:14rem] lg:[--duration-width:18rem]">
    {/* Mirrors MediaRow's thumbnail column, gap and button padding so bars start at "Now". */}
    {hits.some(hit => !hit.collection && !hit.live && hit.duration != null) && <div className="hidden grid-cols-[7rem_minmax(0,1fr)] gap-x-4 sm:grid"><DurationRuler className="col-start-2 ml-2" /></div>}
    <MediaList aria-label={label}>{hits.map(hit => <MediaRow key={hit.id} data-hit-id={hit.id} title={hit.title} meta={hit.meta} description={hit.description} artFit={hit.kind === "Music" || hit.source === "StreamingCommunity" ? "contain" : "cover"}
      art={<MediaArtwork thumbnail={hit.thumbnail} title={hit.title} />}
      primary={{ label: hit.primary.label, onClick: hit.primary.run, disabled: hit.primary.disabled }}
      actions={hit.actions.map(action => action.node ? <span key={action.label} className="contents">{action.node}</span> : <Button key={action.label} variant="ghost" aria-label={`${action.label} ${hit.title}`} aria-pressed={action.pressed} disabled={action.disabled} onClick={action.run}>{action.label}</Button>)}>
      {hit.collection ? <span className="text-sm">{hit.collection}</span> : <DurationBar duration={hit.duration} position={hit.position} live={hit.live} />}
    </MediaRow>)}</MediaList>
  </div>;
});

/** An opened channel, list or show: back, title, and whole-list verbs. */
export function CollectionHeader({ collection, back, onBack, canPlay }: { collection: SearchCollection; back: string; onBack: () => void; canPlay: boolean }) {
  return <div className="space-y-4">
    <PageHeader back={{ label: back, onClick: onBack }} title={collection.title} className="mb-0 [&_h1]:whitespace-normal [&_h1]:break-words" actions={<>
    <Button disabled={!canPlay || collection.disabled || !collection.playAll} onClick={collection.playAll}>Play all</Button>
    <Button variant="ghost" disabled={collection.disabled || !collection.queueAll} onClick={collection.queueAll}>Queue all</Button>
    {collection.save && <Button variant="ghost" aria-pressed={collection.saved} disabled={collection.disabled || collection.saveDisabled} onClick={collection.save}>{collection.saved ? "Saved" : "Save"}</Button>}
    </>} />
    {(collection.thumbnail || collection.description || collection.subtitle) && <div data-collection-preview className="flex items-start gap-4 sm:gap-6">
      {collection.thumbnail && <MediaArtwork thumbnail={collection.thumbnail} title={collection.title} className="h-36 w-24 shrink-0 object-contain bg-transparent sm:h-48 sm:w-36" />}
      <div className="min-w-0 space-y-2">
        {collection.subtitle && <p className="text-sm text-muted-foreground">{collection.subtitle}</p>}
        {collection.description && <p className="max-w-prose text-sm leading-relaxed break-words">{collection.description}</p>}
      </div>
    </div>}
  </div>;
}

export function MoreResults({ summaries }: { summaries: Entry[] }) {
  const more = summaries.filter(([, summary]) => summary.more);
  return more.length ? <div className="flex flex-wrap gap-2">{more.map(([source, summary]) => <Button key={source} variant="outline" disabled={summary.moreDisabled} onClick={summary.more}>More from {source}</Button>)}</div> : null;
}

/** Sources that failed, as one Alert with one Try again; then source notes. */
export function SourceProblems({ summaries }: { summaries: Entry[] }) {
  const failed = summaries.filter(([, summary]) => summary.error);
  const notes = summaries.filter(([, summary]) => summary.warning);
  const names = failed.map(([source]) => source);
  return <>
    {failed.length > 0 && <Alert variant="destructive">
      <AlertTitle>Couldn't reach {names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}.</AlertTitle>
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
  async function send(playNow: boolean) {
    if (!props.onCommand || pending || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setPending(true);
    try { if (await props.onCommand(mode === "Direct media" ? { type: "enqueue", entry: { id: createId(), title: (hostname + pathname).slice(0, 200), source: url }, playNow } : { type: "enqueueWeb", entryId: createId(), url, quality, playNow }) && !signal.aborted) onDone(); }
    catch (reason) { if (!signal.aborted) toast.error(searchError(reason)); }
    finally { if (!signal.aborted) setPending(false); }
  }
  const disabled = !props.connected || pending;
  return <section className="max-w-3xl space-y-4" aria-label="Pasted link">
    <SettingsSection>
      <SettingsRow label="Open as"><ChoiceGroup label="Open link as" value={mode} onValueChange={setMode} disabled={disabled} options={[{ value: "Webpage", label: "Webpage" }, { value: "Direct media", label: "Direct media" }]} /></SettingsRow>
      {mode === "Webpage" && supportsWebVideoQuality(url) && <SettingsRow label="Quality"><ChoiceGroup label="Video quality" value={quality} onValueChange={onQualityChange} disabled={disabled} options={videoQualityOptions} /></SettingsRow>}
    </SettingsSection>
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled || !props.canPlay || !props.onCommand} onClick={() => void send(true)}>Play</Button>
      <Button variant="ghost" disabled={disabled || !props.onCommand} onClick={() => void send(false)}>Queue</Button>
      {/^https?:\/\/[^/]*streamingcommunity/i.test(url) && props.onManageSources && <Button variant="ghost" onClick={() => props.onManageSources?.("streaming-community")}>StreamingCommunity settings</Button>}
    </div>
  </section>;
}
