import { searchSources, type SearchRouteState } from "./routes";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AuthArtwork } from "./AuthArtwork";
import "./search-panel.css";
import type { JellyfinItems, JellyfinStatus } from "../shared/jellyfin";
import type { LibrarySearch, LibrarySource } from "../shared/library";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveForLater } from "./SaveForLater";
import { progressTime } from "./HistoryPanel";
import type { Action } from "../shared/protocol";
import type { ProviderId, VideoQuality } from "../shared/providers";
import { SearchOnlineResults, providerNames } from "./SearchOnlineResults";
import { SearchRadioResults } from "./SearchRadioResults";
import { QualityOptions } from "./QualitySelect";
import { useEnqueueVideoQuality } from "./video-quality";
import { createId } from "./session";

type Source = "Library" | "Jellyfin";
type Options = { playNow?: boolean; fromStart?: boolean };
type Result = { artworkId?: string | null; video?: boolean; id: string; title: string; detail: string; plot?: string | null; available: boolean; position: number; duration: number | null; watched: boolean };
type Page = { items: Result[]; total: number; warning?: string };
type Props = {
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  libraryVersion: number; jellyfinVersion: number;
  providerVersion?: number; radioVersion?: number; defaultQuality?: VideoQuality;
  onCommand?: (action: Action) => Promise<boolean>;
  onEnqueue: (source: Source, id: string, options?: Options) => Promise<boolean>;
  onBrowse: (section: string) => void;
  searchState?: SearchRouteState;
  onSearchChange?: (state: SearchRouteState) => void;
};
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Could not search this source.";

export function SearchPanel(props: Props) {
  const [draft, setDraft] = useState(props.searchState?.query ?? "");
  const [localSearch, setSearch] = useState({ query: "", attempt: 0 });
  const search = { ...localSearch, query: props.searchState?.query ?? localSearch.query };
  const [localFilter, setLocalFilter] = useState("All");
  const filter = props.searchState?.source ?? localFilter;
  const setFilter = (source: string) => { setLocalFilter(source); props.onSearchChange?.({ query: search.query, source }); };
  useEffect(() => { if (props.searchState) setDraft(props.searchState.query); }, [props.searchState?.query]);
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality ?? "auto");
  const [linkPending, setLinkPending] = useState(false);
  const [linkNotice, setLinkNotice] = useState("");
  const linkRequest = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); linkRequest.current = controller; setLinkPending(false); return () => controller.abort(); }, [props.origin, props.token, props.connected, search.attempt]);
  const panel = useRef<HTMLElement>(null);
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
  const visible = (source: string) => filter === "All" || filter === source;
  const scopes = searchSources;
  async function playLink(playNow: boolean) {
    if (!props.onCommand || !url || linkPending || !linkRequest.current) return;
    const signal = linkRequest.current.signal;
    setLinkPending(true); setLinkNotice("");
    try { if (await props.onCommand({ type: "enqueueWeb", entryId: createId(), url, quality, playNow }) && !signal.aborted) { resetQuality(); setLinkNotice(playNow ? "Opening this link on the TV." : "Link added to Up next."); } }
    catch (reason) { if (!signal.aborted) setLinkNotice(message(reason)); }
    finally { if (!signal.aborted) setLinkPending(false); }
  }
  return <section ref={panel} className="search-panel catalog-panel min-w-0 space-y-5" aria-label="Search media">
    <h1>Search</h1>
    <form role="search" className="search-box" onSubmit={event => { event.preventDefault(); setLinkNotice(""); const query = draft.trim(), source = /^https?:\/\//i.test(query) ? "All" : filter; setLocalFilter(source); setSearch(value => ({ query, attempt: value.attempt + 1 })); props.onSearchChange?.({ query, source }); }}>
      <Search aria-hidden="true" /><div className="min-w-0 flex-1"><Label className="sr-only" htmlFor="media-search">Search your sources</Label><Input id="media-search" type="search" maxLength={4096} value={draft} disabled={!props.connected} onChange={event => setDraft(event.target.value)} placeholder="Title, artist, station or link" /></div>
      <Button variant="ghost" type="submit" disabled={!props.connected}>Search</Button>
    </form>
    <nav className="search-scopes" aria-label="Search sources">{scopes.map(scope => <Button key={scope} variant={filter === scope ? "secondary" : "ghost"} aria-pressed={filter === scope} onClick={() => setFilter(scope)}>{scope}</Button>)}</nav>
    {!props.connected && <p role="status">Reconnect to search and play your media.</p>}
    {!search.query ? <div className="search-shortcuts">{[["Library", "Library"], ["Jellyfin", "Jellyfin"], ["Online", "Online"], ["Radio", "Radio"], ["Guide", "Live TV"]].map(([section, label]) => <Button key={section} variant="outline" onClick={() => props.onBrowse(section!)}>{label}</Button>)}</div> : <>
      {providers.map(provider => <div key={`${provider}:${search.query}:${search.attempt}`} hidden={!visible(providerNames[provider])}><SearchOnlineResults {...props} active={props.active && visible(providerNames[provider])} provider={provider} query={search.query} url={url} version={props.providerVersion ?? 0} quality={quality} onQualityChange={setQuality} onEnqueued={resetQuality} /></div>)}
      {!url && <>
        <div hidden={!visible("Radio")}><SearchRadioResults key={`radio:${search.query}:${search.attempt}`} {...props} active={props.active && visible("Radio")} query={search.query} version={props.radioVersion ?? 0} /><SearchRadioResults key={`directory:${search.query}:${search.attempt}`} {...props} active={props.active && visible("Radio")} query={search.query} version={props.radioVersion ?? 0} directory /></div>
        {(["Library", "Jellyfin"] as const).map(source => <div key={`${source}:${search.query}:${search.attempt}`} hidden={!visible(source === "Library" ? "TV folders" : source)}><SearchSource {...props} active={props.active && visible(source === "Library" ? "TV folders" : source)} source={source} query={search.query} attempt={search.attempt} /></div>)}
        {filter === "Bandcamp" && <p className="search-capability">Paste a Bandcamp album or track link.</p>}
      </>}
      {url && !linkedProvider && <Card className="search-start"><h2>Media link</h2><p className="break-all text-sm text-muted-foreground">{url}</p><div className="flex flex-wrap gap-2"><Button disabled={!props.connected || !props.canPlay || !props.onCommand || linkPending} onClick={() => void playLink(true)}>Play link</Button><Button variant="secondary" disabled={!props.connected || !props.onCommand || linkPending} onClick={() => void playLink(false)}>Up next</Button><QualityOptions id="search-link-quality" value={quality} disabled={!props.connected || linkPending} onChange={setQuality} /></div>{linkNotice && <p role="status">{linkNotice}</p>}</Card>}
      {url && linkedProvider && !visible(providerNames[linkedProvider]) && <p>Choose {providerNames[linkedProvider]} or All to open this link.</p>}
    </>}
  </section>;
}

function providerForLink(value: string): ProviderId | undefined {
  try {
    const { hostname } = new URL(value);
    return (Object.entries({ youtube: ["youtube.com", "youtu.be"], raiplay: ["raiplay.it"], twitch: ["twitch.tv"], bandcamp: ["bandcamp.com"] }) as [ProviderId, string[]][]).find(([, domains]) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))?.[0];
  } catch { return undefined; }

}

function SearchSource({ source, query, attempt, ...props }: Props & { source: Source; query: string; attempt: number }) {
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const requested = useRef("");
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!props.active) {
      if (detail) { restoreFocus.current = true; setDetail(null); }
      return;
    }
    if (!restoreFocus.current) return;
    const frame = requestAnimationFrame(() => {
      if (trigger.current?.isConnected && !trigger.current.closest("[hidden]")
        && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) trigger.current.focus({ preventScroll: true });
      restoreFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [props.active]);
  const pageSize = source === "Library" ? 30 : 50;

  useEffect(() => {
    if (!props.connected) { setLoading(false); return; }
    const controller = new AbortController();
    const key = JSON.stringify([props.origin, props.token, query, attempt, offset]);
    if (requested.current !== key) { setPage(null); setDetail(null); requested.current = key; }
    setLoading(true); setError(null);
    const read = async <T,>(path: string): Promise<T> => {
      const response = await fetch(`${props.origin}${path}`, { headers: { Authorization: `Bearer ${props.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not search this source.");
      return body;
    };
    const load = async (): Promise<Page> => {
      if (source === "Jellyfin") {
        const status = await read<JellyfinStatus>("/api/jellyfin");
        if (!status.connected) return { items: [], total: 0, warning: "Jellyfin is not connected. An administrator can connect it in Settings > Sources." };
        const result = await read<JellyfinItems>(`/api/jellyfin/items?${new URLSearchParams({ q: query, startIndex: String(offset) })}`);
        return { total: result.total, items: result.items.map(item => ({ id: item.id, title: item.title, video: item.kind !== "Audio", detail: [item.kind, item.detail].filter(Boolean).join(" · "), available: true, position: item.resumePosition, duration: item.duration, watched: item.played })) };
      }
      const [result, folders] = await Promise.all([
        read<LibrarySearch>(`/api/library/items?${new URLSearchParams({ q: query, offset: String(offset), limit: String(pageSize) })}`), read<{ sources: LibrarySource[] }>("/api/library/sources"),
      ]);
      const unavailable = folders.sources.filter(folder => folder.status === "unavailable" || folder.status === "error");
      return { total: result.total, warning: unavailable.length ? `${unavailable.map(folder => folder.name).join(", ")}: folder unavailable or scan failed. Saved results remain visible; an administrator can check Settings > Sources.` : folders.sources.some(folder => folder.status === "scanning") ? "A folder is still scanning. Results update as media is indexed." : !folders.sources.length ? "No TV folders configured. An administrator can add them in Settings > Sources." : undefined,
        items: result.items.map(item => ({ id: item.id, title: item.title, artworkId: item.artworkId, video: item.kind === "video", detail: [item.video?.show?.title, item.artist, item.album, item.video?.year, item.kind].filter(Boolean).join(" · "), plot: item.video?.plot, available: item.available, position: item.progress?.position ?? 0, duration: item.duration, watched: item.progress?.watched ?? false })) };
    };
    void load().then(result => { if (!controller.signal.aborted) { setPage(result); setDetail(current => current ? result.items.find(item => item.id === current.id) ?? null : null); } }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.origin, props.token, props.connected, source === "Library" ? props.libraryVersion : props.jellyfinVersion, query, attempt, offset, retry, source]);

  async function enqueue(item: Result, options?: Options) {
    setPending(true); setActionError(null); setNotice("");
    try { if (await props.onEnqueue(source, item.id, options)) setNotice(options?.playNow ? `Starting ${item.title} on the TV.` : `Added ${item.title} to the queue.`); }
    catch (reason) { setActionError(message(reason)); }
    finally { setPending(false); }
  }
  const actions = (item: Result) => <div className="flex flex-wrap gap-2">
    <Button aria-label={`${item.position ? "Resume" : "Play"} ${item.title}`} disabled={!props.connected || !props.canPlay || !item.available || loading || pending} onClick={() => void enqueue(item, { playNow: true })}>{item.position ? "Resume" : "Play"}</Button>
    {!!item.position && <Button variant="outline" aria-label={`Play ${item.title} from start`} disabled={!props.connected || !props.canPlay || !item.available || loading || pending} onClick={() => void enqueue(item, { playNow: true, fromStart: true })}>From start</Button>}
    <SaveForLater origin={props.origin} token={props.token} connected={props.connected} reference={{ kind: source === "Library" ? "library" : "jellyfin", id: item.id }} title={item.title} />
    <Button variant="secondary" aria-label={`Add ${item.title} to queue`} disabled={!props.connected || !item.available || loading || pending} onClick={() => void enqueue(item)}>Queue</Button>
  </div>;
  return <section className="space-y-3" aria-label={`${source} search results`} aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xl font-semibold">{source === "Library" ? "TV folders" : source}</h3><Button variant="outline" onClick={() => props.onBrowse(source === "Library" ? "Files" : source)}>Browse {source === "Library" ? "TV folders" : source}</Button></div>
    <p className="text-sm text-muted-foreground" role="status">{loading ? `Searching ${source}…` : page ? `${page.total} result${page.total === 1 ? "" : "s"}` : ""}</p>
    {error && <Alert variant="destructive"><AlertDescription><p>{error}</p><Button variant="outline" disabled={!props.connected || loading} onClick={() => setRetry(value => value + 1)}>Retry {source}</Button></AlertDescription></Alert>}
    {page?.warning && <div className="space-y-2"><p className="text-sm text-muted-foreground" role="status">{page.warning}</p><Button variant="outline" disabled={!props.connected || loading} onClick={() => setRetry(value => value + 1)}>Refresh {source}</Button></div>}
    {!loading && page?.total === 0 && !page.warning && <p className="text-sm text-muted-foreground">No matches in {source}. Try another title or artist.</p>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    <ul className="search-results">{page?.items.map(item => <li key={item.id} className="search-result-row">
      <AuthArtwork origin={props.origin} token={props.token} id={item.artworkId} video={item.video} className="search-result-art" />
      <Button variant="ghost" className="search-result-title" aria-label={`Details for ${item.title}`} onClick={event => { trigger.current = event.currentTarget; setDetail(item); }}><strong>{item.title}</strong><small>{item.detail}{item.watched && " · Watched"}{!item.available && " · File unavailable"}{item.position > 0 && ` · Continue from ${progressTime(item.position)}`}</small></Button>
      <Button variant="outline" aria-label={`Add ${item.title} to queue`} disabled={!props.connected || !item.available || loading || pending} onClick={() => void enqueue(item)}><Plus aria-hidden="true" /><span className="search-optional">Up next</span></Button>
    </li>)}</ul>
    {page && page.total > pageSize && <nav aria-label={`${source} search pages`} className="flex items-center justify-between gap-2"><Button variant="outline" disabled={!props.connected || loading || !offset} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>Previous</Button><span className="text-sm">{offset + 1}–{Math.min(offset + pageSize, page.total)} of {page.total}</span><Button variant="outline" disabled={!props.connected || loading || offset + pageSize >= page.total} onClick={() => setOffset(value => value + pageSize)}>Next</Button></nav>}
    <Dialog open={props.active && detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (props.active && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}>
      {detail && <><AuthArtwork origin={props.origin} token={props.token} id={detail.artworkId} video={detail.video} className="search-detail-art" /><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{source} · {detail.detail}</DialogDescription></DialogHeader>{detail.plot && <p className="break-words text-sm">{detail.plot}</p>}{detail.duration !== null && <p className="text-sm">Duration {progressTime(detail.duration)}</p>}{detail.position > 0 && <p className="text-sm">Continue from {progressTime(detail.position)}</p>}{!detail.available && <p role="status">File unavailable. Check the folder in Settings &gt; Sources.</p>}{actions(detail)}{notice && <p role="status">{notice}</p>}{actionError && <p role="alert">{actionError}</p>}</>}
    </DialogContent></Dialog>
  </section>;
}
