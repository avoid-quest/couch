import { HistoryPanel, type HistoryPlayback } from "./HistoryPanel";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, Plus, Star } from "lucide-react";
import { MediaArtwork } from "./MediaArtwork";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage, VideoQuality } from "../../shared/providers";
import { isYouTubePlaylistUrl } from "../../shared/providers";
import { QualityOptions } from "./QualitySelect";
import { useEnqueueVideoQuality } from "@/video-quality";

type Props = {
  showHeading?: boolean;
  active?: boolean;
  onPlayHistory: HistoryPlayback;
  initialItem?: ProviderItem;
  initialProvider?: ProviderId;
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  version: number;
  defaultQuality: VideoQuality;
  onEnqueue: (item: ProviderItem, playNow: boolean, quality?: VideoQuality) => Promise<boolean>;
};
type Location = { request: BrowseRequest; title: string; openerId?: string };
const providers: Record<ProviderId, { name: string; placeholder: string }> = {
  youtube: { name: "YouTube", placeholder: "Search YouTube, @channel, or paste a link" },
  twitch: { name: "Twitch", placeholder: "Search channels, categories, or paste a link" },
  raiplay: { name: "RaiPlay", placeholder: "Search programs or paste a RaiPlay link" },
  streamingcommunity: { name: "StreamingCommunity", placeholder: "Search StreamingCommunity or paste a title link" },
  bandcamp: { name: "Bandcamp", placeholder: "https://artist.bandcamp.com/album/…" },
};
const message = (error: unknown) => error instanceof Error ? error.message : "Could not complete the request.";

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor(value % 3_600 / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(value % 60).padStart(2, "0")}`;
}

export function ProviderPanel(props: Props) {
  const [provider, setProvider] = useState<ProviderId>(props.initialItem?.provider ?? props.initialProvider ?? "youtube");
  const [initialItem, setInitialItem] = useState(props.initialItem);
  useEffect(() => {
    setProvider(props.initialItem?.provider ?? props.initialProvider ?? "youtube");
    setInitialItem(props.initialItem);
  }, [props.initialItem, props.initialProvider]);
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(props.defaultQuality);
  const enqueue = async (item: ProviderItem, playNow: boolean) => {
    const ok = await props.onEnqueue(item, playNow, item.provider === "bandcamp" ? undefined : quality);
    if (ok) resetQuality();
    return ok;
  };
  return <section className="@container/catalog min-w-0 space-y-5 p-5 max-[480px]:p-4 [&_[role=alert]]:wrap-anywhere [&_[role=status]]:wrap-anywhere" aria-label="Online media">
    {props.showHeading !== false && <h2 className="text-2xl font-semibold tracking-tight">Online media</h2>}
    <Tabs value={provider} onValueChange={value => { setInitialItem(undefined); setProvider(value as ProviderId); }}>
      <TabsList className="provider-selector grid w-full grid-cols-4 group-data-horizontal/tabs:h-auto" aria-label="Online providers">{(Object.keys(providers) as ProviderId[]).map(id => <TabsTrigger key={id} value={id} className="min-h-11 min-w-0 flex-1 @max-[420px]/catalog:px-0.5 @max-[420px]/catalog:text-xs">{providers[id].name}</TabsTrigger>)}</TabsList>
      <TabsContent value={provider} className="mt-4"><ProviderBrowser key={`${props.origin}:${props.token}:${provider}`} {...props} initialItem={initialItem} onEnqueue={enqueue} provider={provider} quality={quality} onQualityChange={setQuality} /></TabsContent>
    </Tabs>
  </section>;
}

function ProviderBrowser({ active = true, onPlayHistory, initialItem, provider, origin, token, connected, canPlay, version, onEnqueue, quality, onQualityChange }: Props & { provider: ProviderId; quality: VideoQuality; onQualityChange: (quality: VideoQuality) => void }) {
  const info = providers[provider];
  const qualityId = useId();
  const [input, setInput] = useState("");
  const [trail, setTrail] = useState<Location[]>([{ request: {}, title: info.name }, ...(initialItem?.provider === provider ? [{ request: { url: initialItem.url }, title: initialItem.title }] : [])]);
  const [page, setPage] = useState<ProviderPage | null>(null);
  const [view, setView] = useState<"browse" | "saved">("browse");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<ProviderItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [favoriteRevision, setFavoriteRevision] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const browserRef = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef<"input" | { itemId: string } | null>(null);
  const location = trail[trail.length - 1]!;
  const atRecent = !location.request.query && !location.request.url;

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}/api/providers/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "Could not load online media.");
    }
    return response;
  }, [origin, token]);

  const browse = useCallback(async (target: BrowseRequest, signal: AbortSignal) => {
    const params = new URLSearchParams();
    if (target.query) params.set("q", target.query);
    if (target.url) params.set("url", target.url);
    if (target.cursor) params.set("cursor", target.cursor);
    const response = await request(`${provider}/items?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    return response.json() as Promise<ProviderPage>;
  }, [provider, request]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setBusy(null);
    return () => { controller.abort(); activeRequest.current?.abort(); actionRequest.current?.abort(); };
  }, [connected]);

  useEffect(() => {
    activeRequest.current?.abort();
    setLoadingMore(false);
    if (!connected) { setLoading(false); return; }
    if (atRecent) { setLoading(false); setPage(null); setBrowseError(null); return; }
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setPage(null);
    setBrowseError(null);
    void browse(location.request, controller.signal).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setBrowseError(message(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { controller.abort(); };
  }, [browse, connected, location, atRecent]);

  useEffect(() => {
    if (loading || (!page && !atRecent) || !restoreFocus.current) return;
    if (!browserRef.current?.closest("[hidden]") && !document.querySelector('[role="dialog"], [role="listbox"], [data-slot="popover-content"]')) {
      const selector = restoreFocus.current === "input" ? "#provider-search" : `[data-provider-id="${CSS.escape(restoreFocus.current.itemId)}"]`;
      browserRef.current?.querySelector<HTMLElement>(selector)?.focus();
    }
    restoreFocus.current = null;
  }, [page, loading, atRecent]);

  useEffect(() => {
    if (!connected) { setFavoritesLoading(false); return; }
    const controller = new AbortController();
    setFavoritesLoading(true);
    setFavoriteError(null);
    void request("favorites", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(response => response.json() as Promise<{ favorites: ProviderItem[] }>)
      .then(body => { if (!controller.signal.aborted) setFavorites(body.favorites); })
      .catch(reason => { if (!controller.signal.aborted) setFavoriteError(message(reason)); })
      .finally(() => { if (!controller.signal.aborted) setFavoritesLoading(false); });
    return () => { controller.abort(); };
  }, [request, connected, version, favoriteRevision]);

  function search(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    setNotice("");
    setActionError(null);
    setView("browse");
    if (provider === "bandcamp") {
      setTrail([{ request: {}, title: info.name }, ...(value ? [{ request: { url: value }, title: "Bandcamp" }] : [])]);
    } else setTrail([{ request: /^https?:\/\//i.test(value) ? { url: value } : { query: value }, title: value ? `Results for ${value}` : info.name }]);
  }

  function open(item: ProviderItem) {
    setView("browse");
    setNotice("");
    setActionError(null);
    const next = { request: { url: item.url }, title: item.title, openerId: item.id };
    setTrail(current => current[current.length - 1]?.request.url === item.url ? [...current.slice(0, -1), next] : [...current, next]);
  }

  function back() {
    restoreFocus.current = location.openerId ? { itemId: location.openerId } : "input";
    setActionError(null);
    setNotice("");
    setTrail(current => current.length > 1 ? current.slice(0, -1) : current);
  }

  async function more() {
    if (!page?.nextCursor || loadingMore || !connected) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoadingMore(true);
    setBrowseError(null);
    try {
      const result = await browse({ ...location.request, cursor: page.nextCursor }, controller.signal);
      if (!controller.signal.aborted) setPage(previous => previous ? { ...result, title: previous.title || result.title, items: [...previous.items, ...result.items.filter(item => !previous.items.some(existing => existing.id === item.id))] } : result);
    } catch (reason) {
      if (!controller.signal.aborted) setBrowseError(message(reason));
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  async function favorite(item: ProviderItem, saved: boolean) {
    if (actionRequest.current || !connected) return;
    const controller = new AbortController();
    actionRequest.current = controller;
    setBusy(item.id);
    setActionError(null);
    setNotice("");
    try {
      await request(saved ? `favorites/${encodeURIComponent(item.id)}` : "favorites", { method: saved ? "DELETE" : "POST", body: saved ? undefined : JSON.stringify({ item }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) });
      if (!controller.signal.aborted) {
        setFavorites(current => saved ? current.filter(entry => entry.id !== item.id) : [...current.filter(entry => entry.id !== item.id), item]);
        setFavoriteRevision(revision => revision + 1);
        setNotice(`${item.title} ${saved ? "removed." : "kept."}`);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setActionError(message(reason));
    } finally {
      if (actionRequest.current === controller) { actionRequest.current = null; if (!controller.signal.aborted) setBusy(null); }
    }
  }

  async function enqueue(item: ProviderItem, playNow: boolean) {
    if (busy || !connected || !lifetime.current) return;
    const controller = lifetime.current;
    setBusy(item.id);
    setActionError(null);
    setNotice("");
    try {
      const ok = await onEnqueue(item, playNow);
      if (ok && !controller.signal.aborted) setNotice(playNow ? `${item.title} sent to the TV.` : `${item.title} added to Up next.`);
    } catch (reason) {
      if (!controller.signal.aborted) setActionError(message(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }


  const savedItems = favorites.filter(item => item.provider === provider);
  const items = view === "saved" ? savedItems : page?.items ?? [];
  const pending = view === "saved" ? favoritesLoading : loading;
  const playlistUrl = provider === "youtube" && view === "browse" && isYouTubePlaylistUrl(location.request.url ?? location.request.query ?? "") ? location.request.url ?? location.request.query : undefined;
  const raiListUrl = provider === "raiplay" && view === "browse" && /^https:\/\/www\.raiplay\.it\/(?:programmi|collezioni)\/[a-z0-9_%.-]+(?:\/ContentSet-[a-f0-9-]+\.json)?$/i.test(location.request.url ?? "") ? location.request.url : undefined;
  const scListUrl = provider === "streamingcommunity" && view === "browse" && /^https:\/\/[a-z0-9.]*stream[a-z0-9]*unity[a-z0-9]*\.[a-z]{2,63}\/(?:[a-z]{2}\/)?titles\/\d+(?:-[\w-]*)?(?:\/season-\d+)?$/i.test(location.request.url ?? "") ? location.request.url : undefined;
  const albumUrl = provider === "bandcamp" && view === "browse" && /^https?:\/\/[^/]+\.bandcamp\.com\/album\/[^/?#]+\/?(?:[?#].*)?$/i.test(location.request.url ?? "") ? location.request.url : undefined;
  const album = albumUrl && page && !pending && !browseError && items.length > 0 && items.every(item => item.kind === "media");
  const listUrl = playlistUrl || raiListUrl || scListUrl || albumUrl;
  const listRef = listUrl && page ? { id: listUrl, provider, kind: "collection" as const, title: page.title || location.title, url: listUrl } : null;
  return <div ref={browserRef} className="space-y-4" onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented || view !== "browse" || trail.length < 2 || !connected) return;
    if (browserRef.current?.closest("[hidden]")) return;
    if (document.querySelector('[role="dialog"], [role="listbox"], [data-slot="popover-content"]')) return;
    event.preventDefault();
    back();
  }}>
    <form className="provider-search catalog-search flex items-end gap-2" role="search" onSubmit={search}>
      <div className="grid min-w-0 flex-1 gap-2"><Label htmlFor="provider-search">{provider === "bandcamp" ? "Album or track link" : "Search or open a link"}</Label><Input id="provider-search" className="min-h-11" type={provider === "bandcamp" ? "url" : "search"} maxLength={4096} placeholder={info.placeholder} value={input} onChange={event => setInput(event.target.value)} disabled={!connected} autoCapitalize="none" autoCorrect="off" /></div>
      <Button type="submit" className="min-h-11" disabled={!connected}>{provider === "bandcamp" ? "Open" : "Search"}</Button>
    </form>
    <Tabs value={view} onValueChange={value => setView(value as "browse" | "saved")}>
      <div className="provider-toolbar mb-3 flex min-w-0 items-center justify-between gap-3 border-b pb-4">
        <TabsList className="provider-views group-data-horizontal/tabs:h-auto" aria-label="Provider view">
          <TabsTrigger value="browse" className="min-h-11">Browse</TabsTrigger>
          <TabsTrigger value="saved" className="min-h-11">Kept <Badge variant="secondary">{savedItems.length}</Badge></TabsTrigger>
        </TabsList>
        {view === "browse" && !atRecent && <Button variant="ghost" className="min-h-11" disabled={!connected} onClick={() => { restoreFocus.current = "input"; setInput(""); setTrail([{ request: {}, title: info.name }]); }}>Back to recent</Button>}
      </div>
      <TabsContent value={view} className="space-y-4">
        {actionError && <p className="border-l-2 border-destructive py-2 pl-3 text-sm text-destructive" role="alert">{actionError}</p>}
        {notice && <p className="border-l-2 border-primary py-2 pl-3 text-sm" role="status">{notice}</p>}
        {favoriteError && <div className="border-l-2 border-destructive py-2 pl-3 text-sm text-destructive" role="alert">Kept items unavailable. {favoriteError} <Button variant="ghost" className="min-h-11" disabled={!connected} onClick={() => setFavoriteRevision(value => value + 1)}>Try again</Button></div>}
        {view === "browse" && atRecent && <HistoryPanel origin={origin} token={token} connected={connected} canPlay={canPlay} onPlay={onPlayHistory} provider={provider} active={active} />}
        {view === "browse" && !atRecent && <div className="provider-location flex min-w-0 items-center gap-3">
          {trail.length > 1 && <Button data-back variant="outline" className="min-h-11 shrink-0" disabled={!connected} onClick={back}>Back</Button>}
          <h3 className="min-w-0 text-base font-medium wrap-anywhere">{page?.title || location.title}</h3>
        </div>}
        {view === "browse" && browseError && <div className="border-l-2 border-destructive py-2 pl-3 text-sm text-destructive" role="alert">{browseError} <Button variant="ghost" className="min-h-11" disabled={!connected} onClick={() => page?.nextCursor ? void more() : setTrail(current => [...current.slice(0, -1), { ...location }])}>Try again</Button></div>}
        {pending && <p className="provider-empty text-muted-foreground py-6 text-sm" role="status">{view === "saved" ? "Loading kept items…" : `Loading ${info.name}…`}</p>}
        {!(view === "browse" && atRecent) && !pending && !items.length && !(view === "browse" ? browseError : favoriteError) && <p className="provider-empty text-muted-foreground py-6 text-sm leading-relaxed">{!connected ? "Browsing will return when the TV reconnects." : provider === "bandcamp" ? view === "saved" ? "Keep albums and tracks to find them from every remote." : "No public tracks found. Try another album or track link." : view === "saved" ? "Keep videos, channels, and collections here to find them from every remote." : "Nothing found. Try another search or paste a channel, list, or program link."}</p>}
        {listRef && !pending && !browseError && <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!canPlay || busy !== null} onClick={() => void enqueue(listRef, true)}><Play aria-hidden="true" />Play</Button>
          <Button variant="secondary" disabled={!connected || busy !== null} onClick={() => void enqueue(listRef, false)}><Plus aria-hidden="true" />Up next</Button>
          {provider !== "bandcamp" && <QualityOptions id={`${qualityId}-playlist`} label={`Video quality for ${page?.title || "list"}`} value={quality} onChange={onQualityChange} disabled={!connected || busy !== null} />}
        </div>}
        {album && <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-4 @max-[420px]/catalog:grid-cols-[64px_minmax(0,1fr)] @max-[420px]/catalog:gap-3">
          <MediaArtwork key={items[0]!.thumbnail || albumUrl} thumbnail={items[0]!.thumbnail} title={page.title || "Album"} className="aspect-square rounded-md" />
          <div className="min-w-0">
            {items[0]!.subtitle && <p className="text-sm font-medium wrap-anywhere">{items[0]!.subtitle}</p>}
            <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "track" : "tracks"}</p>
          </div>
        </div>}
        {album && <ol className="m-0 border-y" aria-label="Album tracks">{items.map((item, index) => {
          const saved = favorites.some(entry => entry.id === item.id);
          return <li className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-t py-3 first:border-t-0 @max-[420px]/catalog:grid-cols-[24px_minmax(0,1fr)] @max-[420px]/catalog:gap-2" key={item.id}>
            <span className="text-center text-xs tabular-nums text-muted-foreground" aria-hidden="true">{index + 1}</span>
            <div className="min-w-0"><h4 className="text-sm font-medium wrap-anywhere">{item.title}</h4>{item.duration !== undefined && <p className="text-xs text-muted-foreground">{duration(item.duration)}</p>}</div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-center gap-2 [&>button]:min-w-0 [&>button]:px-2 [&>button]:text-sm @max-[420px]/catalog:col-start-2">
              <Button aria-label="Play on TV" disabled={!canPlay || busy !== null} onClick={() => void enqueue(item, true)}><Play aria-hidden="true" />Play</Button>
              <Button variant="secondary" aria-label="Up next" disabled={!connected || busy !== null} onClick={() => void enqueue(item, false)}><Plus aria-hidden="true" />Up next</Button>
              <Button variant={saved ? "secondary" : "ghost"} size="icon" className="provider-save" disabled={!connected || busy !== null || favoritesLoading || !!favoriteError} aria-label={saved ? `Remove ${item.title}` : `Keep ${item.title}`} aria-pressed={saved} onClick={() => void favorite(item, saved)}><Star aria-hidden="true" className={saved ? "fill-current" : ""} /></Button>
            </div>
          </li>;
        })}</ol>}
        {!!items.length && !album && <ul className="divide-y">{items.map(item => {
          const saved = favorites.some(entry => entry.id === item.id);
          const channelSummary = provider === "twitch" && view === "browse" && item.url === location.request.url;
          const details = <div className="flex min-w-0 items-start gap-3">
            {!channelSummary && <div className="relative w-32 shrink-0 overflow-hidden">
              <MediaArtwork key={item.thumbnail || item.id} thumbnail={item.thumbnail} title={item.title} className={provider === "bandcamp" ? "aspect-square" : ""} />
              {item.live ? <Badge variant="destructive" className="provider-badge live absolute right-2 bottom-2">LIVE</Badge> : item.duration ? <Badge variant="secondary" className="provider-badge absolute right-2 bottom-2">{duration(item.duration)}</Badge> : item.kind !== "media" ? <Badge variant="secondary" className="provider-badge absolute right-2 bottom-2">{item.kind === "channel" ? "Channel" : "Collection"}</Badge> : null}
            </div>}
            <div className="min-w-0 flex-1 space-y-1">
              <h4 className="line-clamp-2 text-base font-medium leading-snug wrap-anywhere" title={item.title}>{item.title}</h4>
              {item.subtitle && <p className="text-muted-foreground line-clamp-1 text-sm wrap-anywhere">{item.subtitle}</p>}
              {!item.subtitle && item.description && <p className="provider-description text-muted-foreground line-clamp-2 text-sm wrap-anywhere">{item.description}</p>}
            </div>
          </div>;
          return <li className="grid min-w-0 gap-3 py-3" key={item.id}>
              {item.kind === "media" ? <div className="min-w-0">{details}</div> : <Button variant="ghost" className="block h-auto w-full min-w-0 rounded-none p-0 text-left whitespace-normal focus-visible:outline-offset-[-4px]" data-provider-id={item.id} disabled={!connected} onClick={() => open(item)} aria-label={`Open ${item.title}`}>{details}</Button>}
              <div className="flex flex-wrap items-center gap-2 [&>button]:text-sm">
                <Button aria-label="Play on TV" disabled={!canPlay || busy !== null} onClick={() => void enqueue(item, true)}><Play aria-hidden="true" />Play</Button>
                <Button variant="secondary" aria-label="Up next" disabled={!connected || busy !== null} onClick={() => void enqueue(item, false)}><Plus aria-hidden="true" />Up next</Button>
                {!channelSummary && <Button variant="secondary" disabled={!connected} onClick={() => open(item)}>{item.provider === "twitch" && item.kind === "channel" ? "Past broadcasts" : "Browse"}</Button>}
                {item.provider !== "bandcamp" && <QualityOptions id={`${qualityId}-${item.id}`} label={`Video quality for ${item.title}`} value={quality} onChange={onQualityChange} disabled={!connected || busy !== null} />}
                {item.provider === "twitch" && item.live && !channelSummary && <Button data-provider-id={item.id} variant="outline" disabled={!connected || busy !== null} onClick={() => open(item)}>Past broadcasts</Button>}
                <Button variant={saved ? "secondary" : "ghost"} size="icon" className="provider-save shrink-0" disabled={!connected || busy !== null || favoritesLoading || !!favoriteError} aria-label={saved ? `Remove ${item.title}` : `Keep ${item.title}`} aria-pressed={saved} onClick={() => void favorite(item, saved)}><Star aria-hidden="true" className={saved ? "fill-current" : ""} /></Button>
              </div>
          </li>;
        })}</ul>}
        {view === "browse" && page?.nextCursor && <Button variant="outline" className="provider-more min-h-11 w-full" disabled={!connected || loadingMore} onClick={() => void more()}>{loadingMore ? "Loading more…" : "Load more"}</Button>}
      </TabsContent>
    </Tabs>
  </div>;
}
