import { HistoryPanel, type HistoryPlayback } from "./HistoryPanel";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListMusic, Play, Plus, Star } from "lucide-react";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage, VideoQuality } from "../shared/providers";
import { isYouTubePlaylistUrl } from "../shared/providers";
import { QualityOptions } from "./QualitySelect";
import { useEnqueueVideoQuality } from "./video-quality";

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
  onEnqueuePlaylist: (url: string, playNow: boolean, quality?: VideoQuality) => Promise<boolean>;
  onEnqueueAlbum: (provider: "bandcamp", url: string, playNow: boolean) => Promise<boolean>;
  onSavePlaylist?: (provider: "youtube" | "raiplay" | "bandcamp", url: string) => Promise<boolean>;
};
type Location = { request: BrowseRequest; title: string; openerId?: string };
const providers: Record<ProviderId, { name: string; placeholder: string }> = {
  youtube: { name: "YouTube", placeholder: "Search YouTube, @channel, or paste a link" },
  twitch: { name: "Twitch", placeholder: "Search channels, categories, or paste a link" },
  raiplay: { name: "RaiPlay", placeholder: "Search programs or paste a RaiPlay link" },
  bandcamp: { name: "Bandcamp", placeholder: "https://artist.bandcamp.com/album/…" },
};
const message = (error: unknown) => error instanceof Error ? error.message : "Could not complete the request.";

export function MediaArtwork({ thumbnail, title, className = "" }: { thumbnail?: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  let src = "";
  try {
    const url = new URL(thumbnail ?? "");
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
  } catch { /* Missing artwork uses the title initials. */ }
  return src && !failed
    ? <img className={`media-artwork bg-muted ${className}`} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={`media-artwork artwork-placeholder bg-muted text-muted-foreground ${className}`} aria-hidden="true">{title.slice(0, 2).toUpperCase()}</span>;
}

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
  return <section className="provider-panel catalog-panel space-y-5" aria-label="Online media">
    {props.showHeading !== false && <h2 className="text-2xl font-semibold tracking-tight">Online media</h2>}
    <Tabs value={provider} onValueChange={value => { setInitialItem(undefined); setProvider(value as ProviderId); }}>
      <TabsList className="provider-selector group-data-horizontal/tabs:h-auto w-full" aria-label="Online providers">{(Object.keys(providers) as ProviderId[]).map(id => <TabsTrigger key={id} value={id} className="min-h-11 flex-1">{providers[id].name}</TabsTrigger>)}</TabsList>
      <TabsContent value={provider} className="mt-4"><ProviderBrowser key={`${props.origin}:${props.token}:${provider}`} {...props} initialItem={initialItem} onEnqueue={enqueue} provider={provider} quality={quality} onQualityChange={setQuality} onEnqueuePlaylist={async (url, playNow) => { const ok = await props.onEnqueuePlaylist(url, playNow, quality); if (ok) resetQuality(); return ok; }} /></TabsContent>
    </Tabs>
  </section>;
}

function ProviderBrowser({ active = true, onPlayHistory, initialItem, provider, origin, token, connected, canPlay, version, onEnqueue, onEnqueueAlbum, onEnqueuePlaylist, onSavePlaylist, quality, onQualityChange }: Props & { provider: ProviderId; quality: VideoQuality; onQualityChange: (quality: VideoQuality) => void }) {
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
        setNotice(`${item.title} ${saved ? "removed from" : "saved to"} favorites.`);
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
      if (ok && !controller.signal.aborted) setNotice(playNow ? `${item.title} sent to the TV.` : `${item.title} added to the shared queue.`);
    } catch (reason) {
      if (!controller.signal.aborted) setActionError(message(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function enqueueCollection(url: string, playNow: boolean, playlist = false) {
    if (busy || !connected || !lifetime.current) return;
    const controller = lifetime.current;
    setBusy(url);
    setActionError(null);
    setNotice("");
    try {
      const ok = await (playlist ? onEnqueuePlaylist(url, playNow) : onEnqueueAlbum("bandcamp", url, playNow));
      if (ok && !controller.signal.aborted) setNotice(playNow ? "Playing on the TV." : "Added to Up next.");
    } catch (reason) {
      if (!controller.signal.aborted) setActionError(message(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function saveAsPlaylist(url: string) {
    if (busy || !connected || !lifetime.current || !onSavePlaylist || provider === "twitch") return;
    const controller = lifetime.current;
    setBusy(url);
    setActionError(null);
    setNotice("");
    try {
      const ok = await onSavePlaylist(provider, url);
      if (ok && !controller.signal.aborted) setNotice("Saved as a playlist. Find it under Saved playlists.");
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
  const albumUrl = provider === "bandcamp" && view === "browse" && /^https?:\/\/[^/]+\.bandcamp\.com\/album\/[^/?#]+\/?(?:[?#].*)?$/i.test(location.request.url ?? "") ? location.request.url : undefined;
  const album = albumUrl && page && !pending && !browseError && items.length > 0 && items.every(item => item.kind === "media");
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
      <div className="provider-toolbar mb-3 flex items-center justify-between gap-3 border-b pb-4">
        <TabsList className="provider-views group-data-horizontal/tabs:h-auto" aria-label="Provider view">
          <TabsTrigger value="browse" className="min-h-11">Browse</TabsTrigger>
          <TabsTrigger value="saved" className="min-h-11">Saved <Badge variant="secondary">{savedItems.length}</Badge></TabsTrigger>
        </TabsList>
        {view === "browse" && !atRecent && <Button variant="ghost" className="min-h-11" disabled={!connected} onClick={() => { restoreFocus.current = "input"; setInput(""); setTrail([{ request: {}, title: info.name }]); }}>Back to recent</Button>}
      </div>
      <TabsContent value={view} className="space-y-4">
        {actionError && <p className="provider-error rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{actionError}</p>}
        {notice && <p className="provider-notice rounded-lg border bg-muted p-4 text-sm" role="status">{notice}</p>}
        {favoriteError && <div className="provider-error rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">Saved items unavailable. {favoriteError} <Button variant="ghost" className="min-h-11" disabled={!connected} onClick={() => setFavoriteRevision(value => value + 1)}>Try again</Button></div>}
        {view === "browse" && atRecent && <HistoryPanel origin={origin} token={token} connected={connected} canPlay={canPlay} onPlay={onPlayHistory} provider={provider} active={active} />}
        {view === "browse" && !atRecent && <div className="provider-location flex items-center gap-3">
          {trail.length > 1 && <Button data-back variant="outline" className="min-h-11 shrink-0" disabled={!connected} onClick={back}>Back</Button>}
          <h3 className="text-lg font-medium wrap-anywhere">{page?.title || location.title}</h3>
        </div>}
        {view === "browse" && browseError && <div className="provider-error rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{browseError} <Button variant="ghost" className="min-h-11" disabled={!connected} onClick={() => page?.nextCursor ? void more() : setTrail(current => [...current.slice(0, -1), { ...location }])}>Try again</Button></div>}
        {pending && <p className="provider-empty text-muted-foreground py-6 text-sm" role="status">{view === "saved" ? "Loading saved items…" : `Loading ${info.name}…`}</p>}
        {!(view === "browse" && atRecent) && !pending && !items.length && !(view === "browse" ? browseError : favoriteError) && <p className="provider-empty text-muted-foreground py-6 text-sm leading-relaxed">{!connected ? "Browsing will return when the TV reconnects." : provider === "bandcamp" ? view === "saved" ? "Save albums and tracks to find them from every remote." : "No public tracks found. Try another album or track link." : view === "saved" ? "Save videos, channels, and collections here to find them from every remote." : "Nothing found. Try another search or paste a channel, playlist, or program link."}</p>}
        {playlistUrl && page && !pending && !browseError && !!items.length && <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!canPlay || !connected || busy !== null} onClick={() => void enqueueCollection(playlistUrl, true, true)}><Play aria-hidden="true" />Play playlist</Button>
          <Button variant="secondary" disabled={!connected || busy !== null} onClick={() => void enqueueCollection(playlistUrl, false, true)}><Plus aria-hidden="true" />Up next</Button>
          {onSavePlaylist && <Button variant="secondary" disabled={!connected || busy !== null} onClick={() => void saveAsPlaylist(playlistUrl)}><ListMusic aria-hidden="true" />Save as playlist</Button>}
          <QualityOptions id={`${qualityId}-playlist`} label={`Video quality for ${page.title || "playlist"}`} value={quality} onChange={onQualityChange} disabled={!connected || busy !== null} />
        </div>}
        {raiListUrl && page && !pending && !browseError && onSavePlaylist && <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!connected || busy !== null} onClick={() => void saveAsPlaylist(raiListUrl)}><ListMusic aria-hidden="true" />Save as playlist</Button>
        </div>}
        {album && <div className="provider-album">
          <MediaArtwork key={items[0]!.thumbnail || albumUrl} thumbnail={items[0]!.thumbnail} title={page.title || "Album"} className="provider-album-artwork" />
          <div className="provider-album-copy">
            {items[0]!.subtitle && <p className="text-sm font-medium wrap-anywhere">{items[0]!.subtitle}</p>}
            <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "track" : "tracks"}</p>
            <div className="provider-album-actions">
              <Button disabled={!canPlay || busy !== null} onClick={() => void enqueueCollection(albumUrl, true)}><Play aria-hidden="true" />Play album</Button>
              <Button variant="outline" disabled={!connected || busy !== null} onClick={() => void enqueueCollection(albumUrl, false)}><Plus aria-hidden="true" />Add album to queue</Button>
              {onSavePlaylist && <Button variant="outline" disabled={!connected || busy !== null} onClick={() => void saveAsPlaylist(albumUrl)}><ListMusic aria-hidden="true" />Save as playlist</Button>}
            </div>
          </div>
        </div>}
        {album && <ol className="provider-track-list" aria-label="Album tracks">{items.map((item, index) => {
          const saved = favorites.some(entry => entry.id === item.id);
          return <li className="provider-item provider-track" key={item.id}>
            <span className="provider-track-position text-muted-foreground" aria-hidden="true">{index + 1}</span>
            <div className="provider-track-copy"><h4 className="text-sm font-medium wrap-anywhere">{item.title}</h4>{item.duration !== undefined && <p className="text-xs text-muted-foreground">{duration(item.duration)}</p>}</div>
            <div className="provider-item-actions provider-media-actions">
              <Button aria-label="Play on TV" disabled={!canPlay || busy !== null} onClick={() => void enqueue(item, true)}><Play aria-hidden="true" />Play</Button>
              <Button variant="secondary" aria-label="Add to queue" disabled={!connected || busy !== null} onClick={() => void enqueue(item, false)}><Plus aria-hidden="true" />Queue</Button>
              <Button variant={saved ? "secondary" : "ghost"} size="icon" className="provider-save" disabled={!connected || busy !== null || favoritesLoading || !!favoriteError} aria-label={`${saved ? "Remove" : "Save"} ${item.title} ${saved ? "from" : "to"} favorites`} aria-pressed={saved} onClick={() => void favorite(item, saved)}><Star aria-hidden="true" className={saved ? "fill-current" : ""} /></Button>
            </div>
          </li>;
        })}</ol>}
        {!!items.length && !album && <ul className={`provider-grid${provider === "bandcamp" ? " provider-music-grid" : ""}`}>{items.map(item => {
          const saved = favorites.some(entry => entry.id === item.id);
          const channelSummary = provider === "twitch" && view === "browse" && item.url === location.request.url;
          const details = <>
            {!channelSummary && <div className="provider-artwork-wrap relative">
              <MediaArtwork key={item.thumbnail || item.id} thumbnail={item.thumbnail} title={item.title} />
              {item.live ? <Badge variant="destructive" className="provider-badge live absolute right-2 bottom-2">LIVE</Badge> : item.duration ? <Badge variant="secondary" className="provider-badge absolute right-2 bottom-2">{duration(item.duration)}</Badge> : item.kind !== "media" ? <Badge variant="secondary" className="provider-badge absolute right-2 bottom-2">{item.kind === "channel" ? "Channel" : "Collection"}</Badge> : null}
            </div>}
            <div className="provider-item-copy space-y-1 p-3 pb-0">
              <h4 className="line-clamp-2 text-base font-medium leading-snug wrap-anywhere" title={item.title}>{item.title}</h4>
              {item.subtitle && <p className="text-muted-foreground line-clamp-1 text-sm wrap-anywhere">{item.subtitle}</p>}
              {!item.subtitle && item.description && <p className="provider-description text-muted-foreground line-clamp-2 text-sm wrap-anywhere">{item.description}</p>}
            </div>
          </>;
          return <li className={`provider-item min-w-0${channelSummary ? " provider-channel-summary" : ""}`} key={item.id}>
            <Card className="catalog-card h-full gap-0 overflow-hidden py-0">
              {item.kind === "media" ? <div className="provider-item-main">{details}</div> : <Button variant="ghost" className="provider-item-main provider-open block h-auto w-full rounded-none p-0 text-left whitespace-normal" data-provider-id={item.id} disabled={!connected} onClick={() => open(item)} aria-label={`Open ${item.title}`}>{details}</Button>}
              <div className={`provider-item-actions mt-auto p-3 ${item.kind === "media" ? "provider-media-actions" : "provider-browse-actions"}`}>
                {item.kind === "media" ? <>
                  <Button aria-label="Play on TV" disabled={!canPlay || busy !== null} onClick={() => void enqueue(item, true)}><Play aria-hidden="true" />Play</Button>
                  <Button variant="secondary" aria-label="Add to queue" disabled={!connected || busy !== null} onClick={() => void enqueue(item, false)}><Plus aria-hidden="true" />Queue</Button>
                  {item.provider !== "bandcamp" && <QualityOptions id={`${qualityId}-${item.id}`} label={`Video quality for ${item.title}`} value={quality} onChange={onQualityChange} disabled={!connected || busy !== null} />}
                  {item.provider === "twitch" && item.live && !channelSummary && <Button className="provider-broadcasts-link" data-provider-id={item.id} variant="outline" disabled={!connected || busy !== null} onClick={() => open(item)}>Past broadcasts</Button>}
                </> : !channelSummary && <Button variant="secondary" disabled={!connected} onClick={() => open(item)}>{item.provider === "twitch" && item.kind === "channel" ? "Past broadcasts" : "Browse"}</Button>}
                <Button variant={saved ? "secondary" : "ghost"} size="icon" className="provider-save shrink-0" disabled={!connected || busy !== null || favoritesLoading || !!favoriteError} aria-label={`${saved ? "Remove" : "Save"} ${item.title} ${saved ? "from" : "to"} favorites`} aria-pressed={saved} onClick={() => void favorite(item, saved)}><Star aria-hidden="true" className={saved ? "fill-current" : ""} /></Button>
              </div>
            </Card>
          </li>;
        })}</ul>}
        {view === "browse" && page?.nextCursor && <Button variant="outline" className="provider-more min-h-11 w-full" disabled={!connected || loadingMore} onClick={() => void more()}>{loadingMore ? "Loading more…" : "Load more"}</Button>}
      </TabsContent>
    </Tabs>
  </div>;
}
