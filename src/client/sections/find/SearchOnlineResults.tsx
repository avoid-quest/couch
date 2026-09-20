import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action } from "../../../shared/protocol";
import type { BrowseRequest, ProviderId, ProviderItem, VideoQuality } from "../../../shared/providers";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { QualityOptions } from "@/components/QualitySelect";
import { isYouTubePlaylistUrl, providerShape } from "../../../shared/providers";
import { streamingCommunityPreviewQuery } from "@/api/streamingcommunity";
import { providerBrowseQuery, providerFavoritesQuery, type ProviderSearchPage } from "@/api/providers";
import { apiFetch } from "@/api/client";

export type SearchResultSummary = { count: number; loading: boolean; error: boolean };
export type SearchPlaybackProps = {
  onResults?: (source: string, summary: SearchResultSummary) => void;
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  onCommand?: (action: Action) => Promise<boolean>;
};
export const providerNames: Record<ProviderId, string> = { youtube: "YouTube", raiplay: "RaiPlay", twitch: "Twitch", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };
export const searchError = (reason: unknown) => reason instanceof Error ? reason.message : "Could not complete this request.";
export async function readSearch<T>(props: Pick<SearchPlaybackProps, "origin" | "token">, path: string, signal: AbortSignal, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers); headers.set("Content-Type", "application/json");
  const response = await apiFetch(props, path, { ...init, headers, signal }, 30_000);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

type Location = { request: BrowseRequest; title: string; opener?: string };
type Props = SearchPlaybackProps & {
  provider: ProviderId; query: string; url?: string; quality: VideoQuality; onQualityChange?: (quality: VideoQuality) => void; onEnqueued: () => void;
};
export function SearchOnlineResults(props: Props) {
  return <OnlineResults key={JSON.stringify([props.origin, props.token, props.provider, props.query, props.url])} {...props} />;
}
function OnlineResults(props: Props) {
  const { provider } = props;
  const client = useQueryClient();
  const qualityId = useId();
  const [trail, setTrail] = useState<Location[]>([{ request: props.url ? { url: props.url } : { query: props.query }, title: providerNames[provider] }]);
  const location = trail[trail.length - 1]!;
  const [detail, setDetail] = useState<ProviderItem | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreDetailFocus = useRef(false);
  // Hidden sources still report search counts. Active controls presentation,
  // not whether a source participates in the cross-source search.
  const browse = useInfiniteQuery({ ...providerBrowseQuery(props, provider, location.request), enabled: props.connected, refetchOnMount: "always" });
  const page = useMemo<ProviderSearchPage | null>(() => {
    if (!browse.data?.pages.length) return null;
    const pages = browse.data.pages, items: ProviderItem[] = [], ids = new Set<string>();
    for (const part of pages) for (const item of part.items) if (!ids.has(item.id)) { ids.add(item.id); items.push(item); }
    const warning = [...new Set(pages.flatMap(part => part.warning ? [part.warning] : []))].join(" ");
    return { ...pages[0]!, items, nextCursor: pages.at(-1)?.nextCursor, ...(warning ? { warning } : {}) };
  }, [browse.data]);
  const loading = props.connected && browse.isFetching;
  const error = browse.error ? searchError(browse.error) : "";
  const [visible, setVisible] = useState(6);
  const kept = useQuery({ ...providerFavoritesQuery(props), enabled: props.connected, retry: false });
  const favorites = kept.error ? null : kept.data?.favorites ?? null;
  const saveError = kept.error ? searchError(kept.error) : "";
  const previewId = provider === "streamingcommunity" && detail ? /\/titles\/(\d+)-/.exec(detail.url)?.[1] ?? null : null;
  const preview = useQuery({ ...streamingCommunityPreviewQuery(props, previewId ? Number(previewId) : null), enabled: props.connected && previewId !== null });
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const restore = useRef<string | undefined>(undefined);
  // Only presentation state is retained locally. Query owns pages, requests,
  // errors and retries, so changing a query or connection retires its reads.
  const views = useRef(new Map<string, { visible: number; top: number }>());
  const key = JSON.stringify(location.request);
  const currentView = useRef(key); currentView.current = key;
  useEffect(() => { if (trail.length === 1) props.onResults?.(providerNames[provider], { count: page?.items.length ?? 0, loading, error: !!error }); }, [trail.length, page?.items.length, loading, error, props.onResults, provider]);
  useEffect(() => {
    if (!props.active) {
      if (detail) { restoreDetailFocus.current = true; setDetail(null); }
      return;
    }
    if (!restoreDetailFocus.current) return;
    const frame = requestAnimationFrame(() => {
      if (detailTrigger.current?.isConnected && !detailTrigger.current.closest("[hidden]")
        && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) detailTrigger.current.focus({ preventScroll: true });
      restoreDetailFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [props.active, detail]);

  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setBusy(false); return () => controller.abort(); }, [props.origin, props.token, props.connected]);
  useEffect(() => { setVisible(views.current.get(key)?.visible ?? 6); setActionError(""); setNotice(""); }, [key]);
  useEffect(() => {
    if (!props.active || loading || !page || !restore.current) return;
    const id = restore.current;
    const frame = requestAnimationFrame(() => { if (document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) return;
      const container = section.current?.closest(".tv-browser") ?? document.scrollingElement;
      if (container) container.scrollTop = views.current.get(key)?.top ?? container.scrollTop;
      section.current?.querySelector<HTMLButtonElement>(id === "back" ? "[data-back]" : `[data-search-item="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); restore.current = undefined; });
    return () => cancelAnimationFrame(frame);
  }, [props.active, loading, page, key]);

  async function more() {
    if (!page || loading || !props.connected) return;
    if (visible < page.items.length) { setVisible(value => value + 6); return; }
    if (!browse.hasNextPage) return;
    const signal = lifetime.current?.signal;
    const result = await browse.fetchNextPage({ cancelRefetch: false });
    if (!signal?.aborted && currentView.current === key && !result.isError) setVisible(value => value + 6);
  }
  function open(item: ProviderItem, opener = item.id) { const container = section.current?.closest(".tv-browser") ?? document.scrollingElement;
    views.current.set(key, { visible, top: container?.scrollTop ?? 0 }); restore.current = "back"; setTrail(current => [...current, { request: { url: item.url }, title: item.title, opener }]); }
  function back() { restore.current = location.opener; setTrail(current => current.slice(0, -1)); }
  async function action(work: (signal: AbortSignal) => Promise<boolean | void>, done: string) {
    if (busy || !props.connected || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setBusy(true); setActionError(""); setNotice("");
    try { const ok = await work(signal); if (!signal.aborted && ok !== false) setNotice(done); }
    catch (reason) { if (!signal.aborted) setActionError(searchError(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  function play(item: ProviderItem, playNow: boolean) {
    void action(async signal => {
      const ok = await props.onCommand?.({ type: "enqueueProvider", provider: item.provider, url: item.url, shape: providerShape(item), title: item.title, thumbnail: item.thumbnail, ...(provider !== "bandcamp" ? { quality: props.quality } : {}), playNow });
      if (ok && !signal.aborted) props.onEnqueued();
      return ok ?? false;
    }, playNow ? `Starting ${item.title} on the playback computer.` : `${item.title} added to the end of Up next. Playback is unchanged.`);
  }
  function save(item: ProviderItem, saved: boolean) {
    void action(async signal => {
      await readSearch(props, saved ? `/api/providers/favorites/${encodeURIComponent(item.id)}` : "/api/providers/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ item }) }) });
      if (!signal.aborted) await client.invalidateQueries({ queryKey: ["providers", "favorites"] });
    }, `${item.title} ${saved ? "removed." : "kept."}`);
  }
  const playlistUrl = provider === "youtube" && isYouTubePlaylistUrl(location.request.url ?? location.request.query ?? "") ? location.request.url ?? location.request.query : undefined;
  const album = provider === "bandcamp" && /\/album\//.test(location.request.url ?? "") && !!page?.items.length && page.items.every(item => item.kind === "media");
  const itemActions = (item: ProviderItem, inDetail = false) => {
    const saved = !!favorites?.some(entry => entry.id === item.id);
    return <div className="flex flex-wrap items-center gap-1">
      <Button data-search-item={item.kind === "media" ? item.id : undefined} aria-label={`Play: ${item.title}`} disabled={!props.connected || !props.canPlay || busy || !props.onCommand} onClick={() => play(item, true)}>Play</Button>
      <Button variant="secondary" aria-label={`Up next: ${item.title}`} disabled={!props.connected || busy || !props.onCommand} onClick={() => play(item, false)}>Up next</Button>
      {item.kind !== "media" && <Button data-search-item={item.id} aria-label={`Open ${item.title}`} disabled={!props.connected} onClick={() => { setDetail(null); open(item); }}>Open</Button>}
      <Button variant="ghost" aria-label={saved ? `Remove ${item.title}` : `Keep ${item.title}`} aria-pressed={saved} disabled={!props.connected || busy || favorites === null} onClick={() => save(item, saved)}>{saved ? "Kept" : "Keep"}</Button>
      {provider === "twitch" && item.live && item.url !== location.request.url && <Button data-search-item={`${item.id}-broadcasts`} variant="outline" aria-label={`Past broadcasts from ${item.title}`} disabled={!props.connected} onClick={() => { setDetail(null); open(item, `${item.id}-broadcasts`); }}>Past broadcasts</Button>}
      {item.kind === "media" && provider !== "bandcamp" && props.onQualityChange && <QualityOptions id={`${qualityId}-${item.id}${inDetail ? "-detail" : ""}`} label={`Video quality for ${item.title}`} value={props.quality} onChange={props.onQualityChange} disabled={!props.connected || busy} />}
    </div>;
  };
  return <section ref={section} aria-label={`${providerNames[provider]} search results`} aria-busy={loading} className="grid gap-3.5 border-t py-6 first:border-t-0 first:pt-3" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && trail.length > 1 && props.active) { event.preventDefault(); back(); } }}>
    <div className="flex items-baseline justify-between gap-3"><h2 className="text-[13px] font-semibold tracking-[.01em] text-muted-foreground">{providerNames[provider]}</h2>{trail.length > 1 && <Button variant="outline" data-back onClick={back}>Back to results</Button>}</div>
    {trail.length > 1 && <h3>{page?.title || location.title}</h3>}
    {loading && <p role="status">Searching {providerNames[provider]}…</p>}
    {error && <p role="alert">{error} <Button variant="outline" disabled={!props.connected || loading} onClick={() => { if (browse.isFetchNextPageError) void more(); else void browse.refetch(); }}>Retry {providerNames[provider]}</Button></p>}
    {!loading && page && !page.items.length && <p className="text-muted-foreground">No matches in {providerNames[provider]}.</p>}
    {page?.warning && <p role="status">{page.warning}</p>}
    {saveError && <p role="status">Kept status unavailable. {saveError} <Button variant="outline" disabled={!props.connected} onClick={() => void kept.refetch()}>Retry kept status</Button></p>}
    {actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
    {playlistUrl && page?.items.length && !loading && !error && <div className="flex flex-wrap gap-2"><Button disabled={!props.canPlay || !props.connected || busy || !props.onCommand} onClick={() => void action(async signal => { const ok = await props.onCommand!({ type: "enqueueProvider", provider, url: playlistUrl, shape: "playlist", playNow: true, quality: props.quality }); if (ok && !signal.aborted) props.onEnqueued(); return ok; }, `Starting ${page.title || "list"} on the playback computer.`)}>Play</Button><Button variant="secondary" disabled={!props.connected || busy || !props.onCommand} onClick={() => void action(async signal => { const ok = await props.onCommand!({ type: "enqueueProvider", provider, url: playlistUrl, shape: "playlist", quality: props.quality }); if (ok && !signal.aborted) props.onEnqueued(); return ok; }, `${page.title || "List"} added to Up next.`)}>Up next</Button>{props.onQualityChange && <QualityOptions id={`${qualityId}-playlist`} label="Video quality" value={props.quality} onChange={props.onQualityChange} disabled={!props.connected || busy} />}</div>}
    {album && <div className="flex flex-wrap gap-2"><Button disabled={!props.canPlay || !props.connected || busy || !props.onCommand} onClick={() => void action(() => props.onCommand!({ type: "enqueueProvider", provider, url: location.request.url!, shape: "playlist", playNow: true }), "Starting album on the playback computer.")}>Play</Button><Button variant="secondary" disabled={!props.connected || busy || !props.onCommand} onClick={() => void action(() => props.onCommand!({ type: "enqueueProvider", provider, url: location.request.url!, shape: "playlist" }), "Album added to Up next.")}>Up next</Button></div>}
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-x-4 gap-y-5">{page?.items.slice(0, visible).map(item => <li key={item.id} className="flex min-w-0 flex-col"><MediaArtwork thumbnail={item.thumbnail} title={item.title} /><div className="grid gap-1 px-0.5 pb-0 pt-2.5"><Button variant="ghost" className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 p-0 text-left leading-normal whitespace-normal" aria-label={`Details for ${item.title}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetail(item); }}><strong className="text-[15px] font-semibold leading-tight break-words">{item.title}</strong><small className="text-xs text-muted-foreground">{[item.subtitle, item.live ? "Live" : item.kind === "media" ? provider === "bandcamp" ? "Track" : "Video" : item.kind === "channel" ? "Channel" : "Collection"].filter(Boolean).join(" · ")}</small></Button></div>{itemActions(item)}</li>)}</ul>
    <Dialog open={props.active && !!detail} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (props.active && detailTrigger.current?.isConnected && !detailTrigger.current.closest("[hidden]") && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) detailTrigger.current.focus({ preventScroll: true }); }}>
      {detail && <><MediaArtwork thumbnail={preview.data?.thumbnail ?? detail.thumbnail} title={detail.title} className="h-auto aspect-[1.9] w-full" /><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{providerNames[provider]}{detail.live ? " · Live" : ""}</DialogDescription></DialogHeader>{detail.subtitle && <p>{detail.subtitle}</p>}{provider === "streamingcommunity" && preview.data && <p className="text-xs text-muted-foreground">{[preview.data.year, preview.data.quality, preview.data.genres.join(", "), preview.data.seasonsCount && `${preview.data.seasonsCount} seasons`].filter(Boolean).join(" · ")}</p>}{provider === "streamingcommunity" && preview.data?.plot && <p className="text-sm">{preview.data.plot}</p>}{itemActions(detail, true)}{actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}</>}
    </DialogContent></Dialog>
    {page && (visible < page.items.length || browse.hasNextPage) && <Button variant="outline" disabled={!props.connected || loading} onClick={() => void more()}>Show more {providerNames[provider]}</Button>}
  </section>;
}
