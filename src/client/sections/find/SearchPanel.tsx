import { searchSources, type SearchRouteState } from "../../search";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaveForLater } from "@/components/SaveForLater";
import { SearchBar } from "@/components/SearchBar";
import type { Action } from "../../../shared/protocol";
import type { ProviderId, VideoQuality } from "../../../shared/providers";
import { SearchOnlineResults, providerNames, type SearchHit, type SearchResultSummary } from "./SearchOnlineResults";
import { SearchSource } from "./SearchSource";
import { SearchRadioResults } from "./SearchRadioResults";
import { QualityOptions } from "@/components/QualitySelect";
import { supportsWebVideoQuality, useEnqueueVideoQuality } from "../../video-quality";
import { createId } from "../../session/session";
import { useOptionalShell } from "@/sections/shell/shell-context";
import type { SourceSetupKind } from "@/components/SourceSetupDialog";
import { Check } from "lucide-react";
import { matchesFacet, type SearchKind, type SearchLength } from "./SearchOnlineResults";
import { MediaArtwork } from "@/components/MediaArtwork";
import { AuthArtwork } from "@/components/AuthArtwork";
import { DurationBar, DurationRuler } from "@/components/DurationBar";
import { OpenFileButton } from "@/sections/now/OpenFileButton";

type Source = "Library" | "Jellyfin";
type Options = { playNow?: boolean; fromStart?: boolean; placement?: "next" };
export type Props = {
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean; canManageMetadata?: boolean;
  defaultQuality?: VideoQuality;
  onCommand?: (action: Action) => Promise<boolean>;
  onEnqueue: (source: Source, id: string, options?: Options) => Promise<boolean>;
  onBrowse: (section: string) => void;
  onManageSources?: (source?: SourceSetupKind) => void;
  onQueryChange?: (query: string) => void;
  kinds?: SearchKind[]; lengths?: SearchLength[];
  draftQuery?: string;
  searchState?: SearchRouteState;
  onSearchChange?: (state: SearchRouteState) => void;
};
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Could not search this source.";

export function SearchPanel(props: Props) {
  const shell = useOptionalShell();
  const standardLayout = shell?.standardLayout;
  const [localDraft, setDraft] = useState(props.searchState?.query ?? "");
  const draft = props.draftQuery ?? localDraft;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!standardLayout || !props.active) return;
    const typeToSearch = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1 || document.querySelector('[role="dialog"][data-state="open"]')) return;
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable='true']")) return;
      input.current?.focus();
      if (input.current) { props.onQueryChange?.(`${draft}${event.key}`); if (!props.onQueryChange) setDraft(`${draft}${event.key}`); event.preventDefault(); }
    };
    window.addEventListener("keydown", typeToSearch);
    return () => window.removeEventListener("keydown", typeToSearch);
  }, [standardLayout, props.active, props.onQueryChange, draft]);
  const [summaries, setSummaries] = useState<Record<string, SearchResultSummary>>({});
  const [openedProvider, setOpenedProvider] = useState<ProviderId | null>(null);
  const reportResults = useCallback((source: string, summary: SearchResultSummary) => setSummaries(current => ({ ...current, [source]: summary })), []);
  const [localSearch, setSearch] = useState({ query: "", attempt: 0 });
  const search = { ...localSearch, query: props.searchState?.query ?? localSearch.query };
  const [localFilter, setLocalFilter] = useState("All");
  const [kinds, setKinds] = useState<SearchKind[]>([]);
  const [lengths, setLengths] = useState<SearchLength[]>([]);
  const filter = props.searchState?.source ?? localFilter;
  const setFilter = (source: string) => { setLocalFilter(source); props.onSearchChange?.({ query: search.query, source }); };
  useEffect(() => { if (props.draftQuery === undefined && props.searchState) setDraft(props.searchState.query); }, [props.draftQuery, props.searchState?.query]);
  const changeDraft = (query: string) => { if (props.draftQuery === undefined) setDraft(query); props.onQueryChange?.(query); };
  const commit = (query: string, submit = false) => {
    const source = /^https?:\/\//i.test(query) ? "All" : filter;
    setLinkNotice(""); setLocalFilter(source);
    setSearch(value => ({ query, attempt: value.attempt + Number(submit && query === search.query) }));
    props.onSearchChange?.({ query, source });
  };
  const commitDraft = useEffectEvent(() => commit(draft.trim()));
  useEffect(() => {
    if (!props.active || !props.connected || draft.trim() === search.query) return;
    const timer = setTimeout(() => commitDraft(), 300);
    return () => clearTimeout(timer);
  }, [draft, search.query, props.active, props.connected]);
  useEffect(() => { setSummaries({}); setOpenedProvider(null); }, [search.query, props.origin, props.token]);
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
  const [linkMode, setLinkMode] = useState<"Webpage" | "Direct media">("Webpage");
  const [linkPending, setLinkPending] = useState(false);
  const [linkNotice, setLinkNotice] = useState("");
  const linkRequest = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); linkRequest.current = controller; setLinkPending(false); return () => controller.abort(); }, [props.origin, props.token, props.connected, search.attempt, search.query]);
  const panel = useRef<HTMLElement>(null);
  const focusSource = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!props.active) { focusSource.current = null; return; }
    if (!focusSource.current || focusSource.current !== filter) return;
    focusSource.current = null;
    panel.current?.querySelector<HTMLButtonElement>('[data-search-scopes] [aria-pressed="true"]')?.focus({ preventScroll: true });
  });
  const scroll = useRef({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!props.active) return;
    const container = panel.current?.closest(".tv-browser") ?? document.scrollingElement;
    if (container) { container.scrollTop = scroll.current.top; container.scrollLeft = scroll.current.left; }
    return () => { if (container) scroll.current = { top: container.scrollTop, left: container.scrollLeft }; };
  }, [props.active]);
  const url = /^https?:\/\//i.test(search.query) ? search.query : undefined;
  const linkedProvider = url ? providerForLink(url) : undefined;
  const providers = standardLayout && url ? [] : linkedProvider ? [linkedProvider] : url ? [] : ["youtube", "raiplay", "twitch", "streamingcommunity"] as ProviderId[];
  const visible = (source: string) => !!url || filter === "All" || filter === source;
  const searchable = ["YouTube", "RaiPlay", "StreamingCommunity", "Twitch", "avoid radio", "Radio playlists", "Radio directory", "TV folders", "Jellyfin"];
  const isEmptySource = (source: string) => { const summary = summaries[source]; return !!summary && !summary.loading && !summary.error && summary.count === 0; };
  const showSource = (source: string) => (!openedProvider || providerNames[openedProvider] === source) && visible(source) && !isEmptySource(source);
  const emptySources = searchable.filter(isEmptySource);
  const scopes = searchSources.flatMap(source => summaries[source]?.count ? [[source, summaries[source]] as const] : []);
  const completed = ["YouTube", "RaiPlay", "Twitch", "StreamingCommunity", "avoid radio", "Radio playlists", "Radio directory", "TV folders", "Jellyfin"].every(source => summaries[source] && !summaries[source].loading);
  const total = scopes.reduce((sum, [, summary]) => sum + summary.count, 0);
  const sourceOrder = ["YouTube", "Twitch", "RaiPlay", "avoid radio", "Radio playlists", "Radio directory", "TV folders", "Jellyfin", "StreamingCommunity", "Bandcamp"];
  const collection = openedProvider ? summaries[providerNames[openedProvider]]?.collection : undefined;
  const wasInCollection = useRef(false);
  const restoreHit = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!props.active) return;
    if (collection && !wasInCollection.current) {
      wasInCollection.current = true;
      requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-back]")?.focus({ preventScroll: true }));
    } else if (!collection && wasInCollection.current) {
      wasInCollection.current = false;
      requestAnimationFrame(() => {
        const selector = restoreHit.current ? `[data-hit-id="${CSS.escape(restoreHit.current)}"] [data-play]` : "[data-play]";
        panel.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
        restoreHit.current = null;
      });
    }
  }, [collection, props.active]);
  const backFromCollection = () => { restoreHit.current = collection?.openerId ?? null; collection?.back(); };
  const mergedHits = sourceOrder.flatMap((source, rank) => (summaries[source]?.hits ?? []).map((hit, index) => ({ hit, order: index * sourceOrder.length + rank })))
    .filter(({ hit }) => (collection ? hit.source === collection.source : (filter === "All" || filter === hit.source) && matchesFacet(hit, kinds, lengths)))
    .sort((a, b) => a.order - b.order).map(({ hit }) => hit);
  const failures = Object.entries(summaries).filter(([source, summary]) => summary.error && (!collection || collection.source === source));
  const allKinds: SearchKind[] = ["Video", "Music", "Live", "Radio", "Channels"];
  const allLengths: SearchLength[] = ["Under 10 min", "10 min to 1 hour", "Over an hour"];
  const filteredSources = searchSources.filter(source => source !== "All" && (summaries[source]?.facets?.some(item => matchesFacet(item, kinds, lengths)) || summaries[source]?.loading));
  const facetCount = (key: "kind" | "length", option?: SearchKind | SearchLength) => Object.entries(summaries)
    .filter(([source]) => filter === "All" || source === filter)
    .flatMap(([, summary]) => summary.facets ?? [])
    .filter(item => matchesFacet(item, key === "kind" ? option ? [option as SearchKind] : [] : kinds, key === "length" ? option ? [option as SearchLength] : [] : lengths)).length;
  const toggle = <T extends string,>(selected: T[], value: T) => selected.includes(value) ? selected.filter(entry => entry !== value) : [...selected, value];
  const facetGroup = <T extends string,>(label: string, values: T[], selected: T[], onChange: (next: T[]) => void, count: (value: T) => number) => <section className="find-facet-group" aria-label={`${label} filter`}><h2>{label}</h2><Button variant="ghost" className="find-facet" aria-pressed={!selected.length} onClick={() => onChange([])}><Check aria-hidden="true" className={!selected.length ? "" : "invisible"} />All</Button>{values.map(value => { const matches = count(value); return <Button key={value} variant="ghost" className="find-facet" aria-pressed={selected.includes(value)} disabled={!matches && !selected.includes(value)} onClick={() => onChange(toggle(selected, value))}><Check aria-hidden="true" className={selected.includes(value) ? "" : "invisible"} />{value}<span>{matches}</span></Button>; })}</section>;
  const filters = <aside className="find-filters" aria-label="Filter search results"><section className="find-facet-group" aria-label="From filter"><h2>From</h2><Button variant="ghost" className="find-facet" aria-pressed={filter === "All"} onClick={() => setFilter("All")}><Check aria-hidden="true" className={filter === "All" ? "" : "invisible"} />All<span>{Object.values(summaries).flatMap(summary => summary.facets ?? []).filter(item => matchesFacet(item, kinds, lengths)).length}</span></Button>{filteredSources.map(source => <Button key={source} variant="ghost" className="find-facet" aria-pressed={filter === source} onClick={() => setFilter(filter === source ? "All" : source)}><Check aria-hidden="true" className={filter === source ? "" : "invisible"} />{source}<span>{summaries[source]?.loading ? "…" : summaries[source]?.facets?.filter(item => matchesFacet(item, kinds, lengths)).length ?? 0}</span></Button>)}</section>{facetGroup("What", allKinds, kinds, setKinds, value => facetCount("kind", value))}{facetGroup("Length", allLengths, lengths, setLengths, value => facetCount("length", value))}</aside>;
  const resultRow = (hit: SearchHit) => <li key={hit.id} data-hit-id={hit.id} className="find-result-row">
    {hit.artworkId ? <AuthArtwork origin={props.origin} token={props.token} id={hit.artworkId} video={hit.video} /> : <MediaArtwork thumbnail={hit.thumbnail} title={hit.title} />}
    <Button variant="ghost" data-play className="result-main" aria-label={`${hit.primary.label} ${hit.title}`} disabled={hit.primary.disabled} onClick={hit.primary.run}><span className="result-head"><strong>{hit.title}</strong><small>{hit.meta}</small></span><DurationBar duration={hit.duration} position={hit.position} live={hit.live} collection={hit.collection} />{hit.description && <span className="result-description">{hit.description}</span>}</Button>
    <div className="find-result-actions">{hit.actions.map((action, index) => action.node ? <span key={`${hit.id}:${index}`}>{action.node}</span> : <Button key={`${hit.id}:${index}`} variant="ghost" aria-label={`${action.label}: ${hit.title}`} aria-pressed={action.pressed} disabled={action.disabled} onClick={action.run}>{action.label}</Button>)}</div>
  </li>;
  async function playLink(playNow: boolean) {
    if (!props.onCommand || !url || linkPending || !linkRequest.current) return;
    const signal = linkRequest.current.signal;
    setLinkPending(true); setLinkNotice("");
    try { if (await props.onCommand(linkMode === "Direct media" ? { type: "enqueue", entry: { id: createId(), title: new URL(url).hostname + new URL(url).pathname, source: url }, playNow } : { type: "enqueueWeb", entryId: createId(), url, quality, playNow }) && !signal.aborted) { resetQuality(); setLinkNotice(playNow ? "Opening this link on the playback computer." : "Link added to the end of Up next. Playback is unchanged."); } }
    catch (reason) { if (!signal.aborted) setLinkNotice(message(reason)); }
    finally { if (!signal.aborted) setLinkPending(false); }
  }
  return <section ref={panel} className="min-w-0 space-y-3" aria-label="Search media" onKeyDown={event => { if (standardLayout && collection && event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); backFromCollection(); return; } if (event.target !== input.current || !standardLayout) return; if (event.key === "ArrowDown") { const row = panel.current?.querySelector<HTMLElement>("[data-play]"); if (row) { event.preventDefault(); row.focus(); } } else if (event.key === "ArrowUp") { const nav = document.querySelector<HTMLElement>(".app-header a"); if (nav) { event.preventDefault(); nav.focus(); } } }}>
    <div className="find-search-row"><SearchBar id="media-search" inputRef={input} className="min-w-0 flex-1" value={draft} placeholder="Search, or paste a link" onValueChange={changeDraft} onSubmit={() => { commit(draft.trim(), true); if (standardLayout) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-play]")?.focus()); }} onClear={draft ? () => { changeDraft(""); commit(""); input.current?.focus(); } : undefined} />
      {standardLayout && shell?.nativeHost && shell.localHost && !shell.tvPresentation && props.onCommand && <OpenFileButton connected={props.connected} run={props.onCommand} playNow />}
    </div>
    {!search.query && props.connected && !standardLayout && <p className="text-[13px] text-muted-foreground">One search across YouTube, Twitch, RaiPlay, Bandcamp, StreamingCommunity, radio and your library. Paste a link to play it directly.</p>}
    {!props.connected && <p role="status">Reconnect to search and play your media.</p>}
    {search.query && !url && !completed && (standardLayout ? <p className="find-searching" role="status">Still asking {searchable.filter(source => !summaries[source] || summaries[source].loading).join(", ")}…</p> : <div className="h-0.5 overflow-hidden rounded bg-muted" role="progressbar" aria-label="Searching sources"><div className="h-full w-1/3 animate-pulse rounded bg-primary/60" /></div>)}
    {!standardLayout && !url && props.connected && (search.query ? scopes.length > 0 : true) && <nav data-search-scopes className="sticky top-[var(--shell-header)] z-[5] flex gap-1.5 overflow-x-auto bg-background py-2.5 [scrollbar-width:none]" aria-label="Filter search results"><Button variant={filter === "All" ? "secondary" : "ghost"} aria-label="All sources" aria-pressed={filter === "All"} onClick={() => setFilter("All")}>All sources{search.query ? <span className="text-muted-foreground"> {total}</span> : null}</Button>{(search.query ? scopes.map(([source]) => source) : searchSources.filter(source => source !== "All")).map(source => <Button key={source} aria-label={source} variant={filter === source ? "secondary" : "ghost"} aria-pressed={filter === source} onClick={() => setFilter(source)}>{source}{summaries[source] ? <span className="text-muted-foreground"> {summaries[source]!.count}</span> : null}</Button>)}</nav>}
    {search.query && <>
      <div className={standardLayout && !url ? `find-results-layout${openedProvider ? " find-results-layout-collection" : ""}` : undefined}>
      {standardLayout && !url && !openedProvider && filters}
      <div className={standardLayout && !url ? openedProvider ? "find-collection-results" : "find-results" : undefined}>
      {standardLayout && !url && !openedProvider && <DurationRuler />}
      {standardLayout && !url && collection && <div className="find-collection-heading"><Button variant="ghost" data-back onClick={backFromCollection}>‹ Results</Button><h2>{collection.title}</h2><Button variant="ghost" disabled={!props.canPlay || collection.disabled || !collection.playAll} onClick={collection.playAll}>Play all</Button><Button variant="ghost" disabled={collection.disabled || !collection.queueAll} onClick={collection.queueAll}>Queue all</Button>{collection.save && <Button variant="ghost" aria-pressed={collection.saved} disabled={collection.disabled} onClick={collection.save}>{collection.saved ? "Saved" : "Save"}</Button>}</div>}
      {standardLayout && !url && <ul className="find-merged-results" aria-label={collection ? `${collection.title} items` : "Search results"}>{mergedHits.map(resultRow)}</ul>}
      {standardLayout && !url && failures.length > 0 && <div className="find-source-errors">{failures.map(([source, summary]) => <p key={source} role="status">{source}: {summary.errorMessage || "This source did not answer."} {summary.retry && <Button variant="ghost" onClick={summary.retry}>Try again</Button>}</p>)}</div>}
      {!url && filter !== "All" && !summaries[filter]?.count && <Button variant="outline" onClick={() => setFilter("All")}>Show all sources</Button>}
      {props.connected && !url && completed && total === 0 && !Object.values(summaries).some(summary => summary.error) && (standardLayout ? <div className="find-empty" role="status"><h2>Nothing found for “{search.query}”</h2><p>Searched YouTube, Twitch, RaiPlay, radio and TV folders. Try fewer words, or paste a link to the page with the video.</p>{props.onManageSources && <Button variant="outline" onClick={() => props.onManageSources?.()}>Add a source</Button>}</div> : <p role="status">No results for "{search.query}". Try a station, title or artist.</p>)}
      <div className={standardLayout && !url ? "find-source-queries" : undefined}>
      {providers.map(provider => <div key={`${provider}:${search.query}:${search.attempt}`} hidden={!showSource(providerNames[provider])}><SearchOnlineResults {...props} kinds={standardLayout && !openedProvider ? kinds : undefined} lengths={standardLayout && !openedProvider ? lengths : undefined} retry={search.attempt} onResults={reportResults} onCollectionChange={open => setOpenedProvider(open ? provider : null)} active={props.active && showSource(providerNames[provider])} provider={provider} query={search.query} url={url} quality={quality} onQualityChange={setQuality} onEnqueued={resetQuality} /></div>)}
      {!url && <>
        {(["avoid radio", "Radio playlists", "Radio directory"] as const).map(source => <div key={`${source}:${search.query}:${search.attempt}`} hidden={!showSource(source)}><SearchRadioResults {...props} kinds={standardLayout ? kinds : undefined} lengths={standardLayout ? lengths : undefined} onResults={reportResults} active={props.active && showSource(source)} query={search.query} source={source} /></div>)}
        {(["Library", "Jellyfin"] as const).map(source => <div key={`${source}:${search.query}:${search.attempt}`} hidden={!showSource(source === "Library" ? "TV folders" : source)}><SearchSource {...props} kinds={standardLayout ? kinds : undefined} lengths={standardLayout ? lengths : undefined} onResults={reportResults} onChooseSource={source => { focusSource.current = source; setFilter(source); }} active={props.active && showSource(source === "Library" ? "TV folders" : source)} source={source} query={search.query} attempt={search.attempt} /></div>)}
        {filter === "Bandcamp" && <p className="text-sm text-muted-foreground">Paste a Bandcamp album or track link.</p>}
      </>}
      {!standardLayout && !url && emptySources.length > 0 && <p className="text-muted-foreground">No matches in {emptySources.join(", ")}.</p>}
      </div>
      {url && (standardLayout || !linkedProvider) && (standardLayout ? <div className="find-link-card"><h2>{url}</h2><div className="find-link-choice"><span>Open as</span>{(["Webpage", "Direct media"] as const).map(mode => <Button key={mode} variant="ghost" aria-pressed={linkMode === mode} onClick={() => setLinkMode(mode)}>{linkMode === mode && <Check aria-hidden="true" />}{mode}</Button>)}</div>{linkMode === "Webpage" && supportsWebVideoQuality(url) && <div className="find-link-choice"><span>Quality</span>{([ ["1080p", "auto"], ["Best", "best"], ["720p", "720p"], ["480p", "480p"] ] as const).map(([label, value]) => <Button key={value} variant="ghost" aria-pressed={quality === value || (value === "auto" && quality === "1080p")} disabled={!props.connected || linkPending} onClick={() => setQuality(value)}>{(quality === value || (value === "auto" && quality === "1080p")) && <Check aria-hidden="true" />}{label}</Button>)}</div>}<div className="find-link-actions"><Button disabled={!props.connected || !props.canPlay || !props.onCommand || linkPending} onClick={() => void playLink(true)}>Play</Button><Button variant="ghost" disabled={!props.connected || !props.onCommand || linkPending} onClick={() => void playLink(false)}>Queue</Button></div>{linkNotice && <p role="status">{linkNotice}</p>}</div> : <Card className="grid gap-3.5 rounded-[14px] border bg-card p-5"><h2>Media link</h2><p className="break-all text-sm text-muted-foreground">{url}</p><div className="flex flex-wrap gap-2"><Button disabled={!props.connected || !props.canPlay || !props.onCommand || linkPending} onClick={() => void playLink(true)}>Play</Button><Button variant="secondary" disabled={!props.connected || !props.onCommand || linkPending} onClick={() => void playLink(false)}>Up next</Button>{supportsWebVideoQuality(url) && <QualityOptions id="search-link-quality" value={quality} disabled={!props.connected || linkPending} onChange={setQuality} />}</div>{linkNotice && <p role="status">{linkNotice}</p>}</Card>)}
      {url && /^https?:\/\/[^/]*streamingcommunity/i.test(url) && props.onManageSources && <Button variant="outline" onClick={() => props.onManageSources?.("streaming-community")}>StreamingCommunity settings</Button>}
      </div></div>
    </>}
  </section>;
}

function providerForLink(value: string): ProviderId | undefined {
  try {
    const { hostname } = new URL(value);
    return (Object.entries({ youtube: ["youtube.com", "youtu.be"], raiplay: ["raiplay.it"], twitch: ["twitch.tv"], bandcamp: ["bandcamp.com"] }) as [ProviderId, string[]][]).find(([, domains]) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))?.[0];
  } catch { return undefined; }

}
