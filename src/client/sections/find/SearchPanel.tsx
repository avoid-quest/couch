import { searchSources, type SearchRouteState } from "../../search";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveForLater } from "@/components/SaveForLater";
import type { Action } from "../../../shared/protocol";
import type { ProviderId, VideoQuality } from "../../../shared/providers";
import { SearchOnlineResults, providerNames, type SearchResultSummary } from "./SearchOnlineResults";
import { SearchSource } from "./SearchSource";
import { SearchRadioResults } from "./SearchRadioResults";
import { useInvalidation } from "./useInvalidation";
import { QualityOptions } from "@/components/QualitySelect";
import { supportsWebVideoQuality, useEnqueueVideoQuality } from "../../video-quality";
import { createId } from "../../session/session";
import type { SourceSetupKind } from "@/components/SourceSetupDialog";

type Source = "Library" | "Jellyfin";
type Options = { playNow?: boolean; fromStart?: boolean };
export type Props = {
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  defaultQuality?: VideoQuality;
  onCommand?: (action: Action) => Promise<boolean>;
  onEnqueue: (source: Source, id: string, options?: Options) => Promise<boolean>;
  onBrowse: (section: string) => void;
  onManageSources?: (source?: SourceSetupKind) => void;
  onQueryChange?: (query: string) => void;
  draftQuery?: string;
  searchState?: SearchRouteState;
  onSearchChange?: (state: SearchRouteState) => void;
};
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Could not search this source.";

export function SearchPanel(props: Props) {
  const [localDraft, setDraft] = useState(props.searchState?.query ?? "");
  const draft = props.draftQuery ?? localDraft;
  const input = useRef<HTMLInputElement>(null);
  const [summaries, setSummaries] = useState<Record<string, SearchResultSummary>>({});
  const reportResults = useCallback((source: string, summary: SearchResultSummary) => setSummaries(current => ({ ...current, [source]: summary })), []);
  const [localSearch, setSearch] = useState({ query: "", attempt: 0 });
  const search = { ...localSearch, query: props.searchState?.query ?? localSearch.query };
  const [localFilter, setLocalFilter] = useState("All");
  const filter = props.searchState?.source ?? localFilter;
  const setFilter = (source: string) => { setLocalFilter(source); props.onSearchChange?.({ query: search.query, source }); };
  useEffect(() => { if (props.draftQuery === undefined && props.searchState) setDraft(props.searchState.query); }, [props.draftQuery, props.searchState?.query]);
  const changeDraft = (query: string) => { if (props.draftQuery === undefined) setDraft(query); props.onQueryChange?.(query); };
  const commit = (query: string, submit = false) => {
    const source = query !== search.query || /^https?:\/\//i.test(query) ? "All" : filter;
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
  useEffect(() => { setSummaries({}); }, [search.query, props.origin, props.token]);
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
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
  const providers = linkedProvider ? [linkedProvider] : url ? [] : ["youtube", "raiplay", "twitch"] as ProviderId[];
  const visible = (source: string) => !!url || filter === "All" || filter === source;
  const scopes = searchSources.flatMap(source => summaries[source]?.count ? [[source, summaries[source]] as const] : []);
  const completed = ["YouTube", "RaiPlay", "Twitch", "avoid radio", "Radio playlists", "Radio directory", "TV folders", "Jellyfin"].every(source => summaries[source] && !summaries[source].loading);
  const total = scopes.reduce((sum, [, summary]) => sum + summary.count, 0);
  async function playLink(playNow: boolean) {
    if (!props.onCommand || !url || linkPending || !linkRequest.current) return;
    const signal = linkRequest.current.signal;
    setLinkPending(true); setLinkNotice("");
    try { if (await props.onCommand({ type: "enqueueWeb", entryId: createId(), url, quality, playNow }) && !signal.aborted) { resetQuality(); setLinkNotice(playNow ? "Opening this link on the playback computer." : "Link added to the end of Up next. Playback is unchanged."); } }
    catch (reason) { if (!signal.aborted) setLinkNotice(message(reason)); }
    finally { if (!signal.aborted) setLinkPending(false); }
  }
  return <section ref={panel} className="min-w-0 space-y-3" aria-label="Search media">
    <form role="search" className="flex items-center gap-3.5 rounded-[14px] border bg-card px-4 py-1.5 shadow-[0_1px_0_rgb(0_0_0/0.2)] transition-colors focus-within:border-primary" onSubmit={event => { event.preventDefault(); commit(draft.trim(), true); }}>
      <Search aria-hidden="true" className="size-[22px] shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><Label className="sr-only" htmlFor="media-search">Search or paste a link</Label><Input ref={input} id="media-search" type="search" maxLength={4096} value={draft} onChange={event => changeDraft(event.target.value)} placeholder="Search or paste a link" /></div>
      {draft && <Button variant="ghost" type="button" aria-label="Clear search" onClick={() => { changeDraft(""); commit(""); input.current?.focus(); }}><X aria-hidden="true" /></Button>}
    </form>
    {!search.query && props.connected && <p className="text-[13px] text-muted-foreground">One search across YouTube, Twitch, RaiPlay, Bandcamp, radio and your library. Paste a link to play it directly.</p>}
    {!props.connected && <p role="status">Reconnect to search and play your media.</p>}
    {search.query && <>
      {!url && filter !== "All" && !summaries[filter]?.count && <Button variant="outline" onClick={() => setFilter("All")}>Show all sources</Button>}
      {!url && scopes.length > 0 && <nav data-search-scopes className="sticky top-[var(--shell-header)] z-[5] flex gap-1.5 overflow-x-auto bg-background py-2.5 [scrollbar-width:none]" aria-label="Filter search results"><Button variant={filter === "All" ? "secondary" : "ghost"} aria-label="All sources" aria-pressed={filter === "All"} onClick={() => setFilter("All")}>All sources <span className="text-muted-foreground">{total}</span></Button>{scopes.map(([source, summary]) => <Button key={source} aria-label={source} variant={filter === source ? "secondary" : "ghost"} aria-pressed={filter === source} onClick={() => setFilter(source)}>{source} <span className="text-muted-foreground">{summary.count}</span></Button>)}</nav>}
      {props.connected && !url && completed && total === 0 && !Object.values(summaries).some(summary => summary.error) && <p role="status">No results for "{search.query}". Try a station, title or artist.</p>}
      {providers.map(provider => <div key={`${provider}:${search.query}:${search.attempt}`} hidden={!visible(providerNames[provider])}><SearchOnlineResults {...props} onResults={reportResults} active={props.active && visible(providerNames[provider])} provider={provider} query={search.query} url={url} quality={quality} onQualityChange={setQuality} onEnqueued={resetQuality} /></div>)}
      {!url && <>
        {(["avoid radio", "Radio playlists", "Radio directory"] as const).map(source => <div key={`${source}:${search.query}:${search.attempt}`} hidden={!visible(source)}><SearchRadioResults {...props} onResults={reportResults} active={props.active && visible(source)} query={search.query} source={source} /></div>)}
        {(["Library", "Jellyfin"] as const).map(source => <div key={`${source}:${search.query}:${search.attempt}`} hidden={!visible(source === "Library" ? "TV folders" : source)}><SearchSource {...props} onResults={reportResults} onChooseSource={source => { focusSource.current = source; setFilter(source); }} active={props.active && visible(source === "Library" ? "TV folders" : source)} source={source} query={search.query} attempt={search.attempt} /></div>)}
        {filter === "Bandcamp" && <p className="text-sm text-muted-foreground">Paste a Bandcamp album or track link.</p>}
      </>}
      {url && !linkedProvider && <Card className="grid gap-3.5 rounded-[14px] border bg-card p-5"><h2>Media link</h2><p className="break-all text-sm text-muted-foreground">{url}</p><div className="flex flex-wrap gap-2"><Button disabled={!props.connected || !props.canPlay || !props.onCommand || linkPending} onClick={() => void playLink(true)}>Play now</Button><Button variant="secondary" disabled={!props.connected || !props.onCommand || linkPending} onClick={() => void playLink(false)}>Add to queue</Button>{supportsWebVideoQuality(url) && <QualityOptions id="search-link-quality" value={quality} disabled={!props.connected || linkPending} onChange={setQuality} />}</div>{linkNotice && <p role="status">{linkNotice}</p>}</Card>}
      {url && /^https?:\/\/[^/]*streamingcommunity/i.test(url) && props.onManageSources && <Button variant="outline" onClick={() => props.onManageSources?.("streaming-community")}>StreamingCommunity settings</Button>}
    </>}
  </section>;
}

function providerForLink(value: string): ProviderId | undefined {
  try {
    const { hostname } = new URL(value);
    return (Object.entries({ youtube: ["youtube.com", "youtu.be"], raiplay: ["raiplay.it"], twitch: ["twitch.tv"], bandcamp: ["bandcamp.com"] }) as [ProviderId, string[]][]).find(([, domains]) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))?.[0];
  } catch { return undefined; }

}
