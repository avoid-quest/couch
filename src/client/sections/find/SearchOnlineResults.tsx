import { useEffect, useId, useRef, useState } from "react";
import { useInvalidation } from "./useInvalidation";
import type { Action } from "../../../shared/protocol";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage, VideoQuality } from "../../../shared/providers";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { QualityOptions } from "@/components/QualitySelect";
import { isYouTubePlaylistUrl } from "../../../shared/providers";
import { createId } from "../../session/session";

export type SearchResultSummary = { count: number; loading: boolean; error: boolean };
export type SearchPlaybackProps = {
  onResults?: (source: string, summary: SearchResultSummary) => void;
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  onCommand?: (action: Action) => Promise<boolean>;
};
export const providerNames: Record<ProviderId, string> = { youtube: "YouTube", raiplay: "RaiPlay", twitch: "Twitch", bandcamp: "Bandcamp" };
export const searchError = (reason: unknown) => reason instanceof Error ? reason.message : "Could not complete this request.";
export async function readSearch<T>(props: Pick<SearchPlaybackProps, "origin" | "token">, path: string, signal: AbortSignal, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${props.origin}${path}`, { ...init, headers: { Authorization: `Bearer ${props.token}`, "Content-Type": "application/json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
  if (response.status === 204 && response.ok) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not complete this request.");
  return body as T;
}

type SearchPage = ProviderPage & { warning?: string };
type Location = { request: BrowseRequest; title: string; opener?: string };
type Props = SearchPlaybackProps & {
  provider: ProviderId; query: string; url?: string; quality: VideoQuality; onQualityChange?: (quality: VideoQuality) => void; onEnqueued: () => void;
};
export function SearchOnlineResults(props: Props) {
  return <OnlineResults key={`${props.origin}:${props.token}:${props.provider}`} {...props} />;
}
function OnlineResults(props: Props) {
  const { provider } = props;
  const qualityId = useId();
  const [trail, setTrail] = useState<Location[]>([{ request: props.url ? { url: props.url } : { query: props.query }, title: providerNames[provider] }]);
  const location = trail[trail.length - 1]!;
  const [detail, setDetail] = useState<ProviderItem | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreDetailFocus = useRef(false);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const revision = useInvalidation("providers");
  const [visible, setVisible] = useState(6);
  const [favorites, setFavorites] = useState<ProviderItem[] | null>(null);
  const [saveError, setSaveError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  const request = useRef<AbortController | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const restore = useRef<string | undefined>(undefined);
  const views = useRef(new Map<string, { visible: number; top: number }>());
  const cache = useRef(new Map<string, SearchPage>());
  const key = JSON.stringify([props.origin, props.token, location.request]);
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

  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setBusy(false); return () => { controller.abort(); request.current?.abort(); }; }, [props.origin, props.token, props.connected]);
  useEffect(() => {
    const controller = new AbortController();
    if (!props.connected) { setFavorites(null); return; }
    setSaveError("");
    void readSearch<{ favorites: ProviderItem[] }>(props, "/api/providers/favorites", controller.signal).then(body => { if (!controller.signal.aborted) setFavorites(body.favorites); }).catch(reason => { if (!controller.signal.aborted) { setFavorites(null); setSaveError(searchError(reason)); } });
    return () => controller.abort();
  }, [props.origin, props.token, props.connected, revision, retry]);

  async function browse(target: BrowseRequest, signal: AbortSignal): Promise<SearchPage> {
    const read = (request: BrowseRequest) => readSearch<ProviderPage>(props, `/api/providers/${provider}/items?${new URLSearchParams(Object.entries({ q: request.query, url: request.url, cursor: request.cursor }).filter((entry): entry is [string, string] => !!entry[1]))}`, signal);
    if (provider !== "raiplay" || !target.query || target.cursor) return read(target);
    const [catalogue, live] = await Promise.allSettled([read(target), read({ url: "https://www.raiplay.it/dirette" })]);
    signal.throwIfAborted();
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s/g, "");
    const channels = live.status === "fulfilled" ? live.value.items.filter(item => normalize(item.title).includes(normalize(target.query!))) : [];
    if (catalogue.status === "rejected" && !channels.length) throw catalogue.reason;
    const result = catalogue.status === "fulfilled" ? catalogue.value : { items: [] };
    return { ...result, items: [...channels, ...result.items.filter(item => !channels.some(channel => channel.id === item.id))], ...(catalogue.status === "rejected" || live.status === "rejected" ? { warning: "Some RaiPlay results could not be loaded. Try this search again to refresh them." } : {}) };
  }
  useEffect(() => {
    request.current?.abort();
    setVisible(views.current.get(key)?.visible ?? 6); setActionError(""); setNotice("");
    if (!props.connected) { setLoading(false); return; }
    const controller = new AbortController(); request.current = controller;
    const stored = cache.current.get(key);
    setPage(stored ?? null); setError(""); setLoading(!stored);
    if (!stored) void browse(location.request, controller.signal).then(result => { if (!controller.signal.aborted) { cache.current.set(key, result); setPage(result); } }).catch(reason => { if (!controller.signal.aborted) setError(searchError(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.origin, props.token, props.connected, key, retry]);
  useEffect(() => {
    if (!props.active || loading || !page || !restore.current) return;
    const id = restore.current;
    const frame = requestAnimationFrame(() => { if (document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) return;
      const container = section.current?.closest(".tv-browser") ?? document.scrollingElement;
      if (container) container.scrollTop = views.current.get(key)?.top ?? container.scrollTop;
      section.current?.querySelector<HTMLButtonElement>(id === "back" ? "[data-back]" : `[data-search-item="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); restore.current = undefined; });
    return () => cancelAnimationFrame(frame);
  }, [props.active, loading, page]);

  async function more() {
    if (!page || loading) return;
    if (visible < page.items.length) { setVisible(value => value + 6); return; }
    if (!page.nextCursor) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const result = await browse({ ...location.request, cursor: page.nextCursor }, controller.signal);
      if (!controller.signal.aborted) { const next = { ...result, title: page.title, items: [...page.items, ...result.items.filter(item => !page.items.some(old => old.id === item.id))] }; cache.current.set(key, next); setPage(next); setVisible(value => value + 6); }
    } catch (reason) { if (!controller.signal.aborted) setError(searchError(reason)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
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
      const ok = await props.onCommand?.({ type: "enqueueWeb", entryId: createId(), url: item.url, title: item.title, thumbnail: item.thumbnail, ...(provider !== "bandcamp" ? { quality: props.quality } : {}), playNow });
      if (ok && !signal.aborted) props.onEnqueued();
      return ok ?? false;
    }, playNow ? `Starting ${item.title} on the playback computer.` : `${item.title} added to the end of Up next. Playback is unchanged.`);
  }
  function save(item: ProviderItem, saved: boolean) {
    void action(async signal => {
      await readSearch(props, saved ? `/api/providers/favorites/${encodeURIComponent(item.id)}` : "/api/providers/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ item }) }) });
      if (!signal.aborted) setFavorites(current => saved ? current?.filter(entry => entry.id !== item.id) ?? [] : [...current?.filter(entry => entry.id !== item.id) ?? [], item]);
    }, `${item.title} ${saved ? "removed from" : "added to"} Saved.`);
  }
  const playlistUrl = provider === "youtube" && isYouTubePlaylistUrl(location.request.url ?? location.request.query ?? "") ? location.request.url ?? location.request.query : undefined;
  const album = provider === "bandcamp" && /\/album\//.test(location.request.url ?? "") && !!page?.items.length && page.items.every(item => item.kind === "media");
  const itemActions = (item: ProviderItem, inDetail = false) => {
    const saved = !!favorites?.some(entry => entry.id === item.id);
    return <div className="flex flex-wrap items-center gap-1">
      {item.kind === "media" ? <><Button data-search-item={item.id} aria-label={`Play now: ${item.title}`} disabled={!props.connected || !props.canPlay || busy || !props.onCommand} onClick={() => play(item, true)}>Play now</Button><Button variant="secondary" aria-label={`Add to queue: ${item.title}`} disabled={!props.connected || busy || !props.onCommand} onClick={() => play(item, false)}>Add to queue</Button></> : <Button data-search-item={item.id} aria-label={`Open ${item.title}`} disabled={!props.connected} onClick={() => { setDetail(null); open(item); }}>Open</Button>}
      {provider === "twitch" && item.live && item.url !== location.request.url && <Button data-search-item={`${item.id}-broadcasts`} variant="outline" aria-label={`Past broadcasts from ${item.title}`} disabled={!props.connected} onClick={() => { setDetail(null); open(item, `${item.id}-broadcasts`); }}>Past broadcasts</Button>}
      {item.kind === "media" && provider !== "bandcamp" && props.onQualityChange && <QualityOptions id={`${qualityId}-${item.id}${inDetail ? "-detail" : ""}`} label={`Video quality for ${item.title}`} value={props.quality} onChange={props.onQualityChange} disabled={!props.connected || busy} />}
      <Button variant="ghost" aria-label={saved ? `Remove ${item.title} from saved` : `Save ${item.title}`} aria-pressed={saved} disabled={!props.connected || busy || favorites === null} onClick={() => save(item, saved)}>{saved ? "Saved" : "Save"}</Button>
    </div>;
  };
  return <section ref={section} aria-label={`${providerNames[provider]} search results`} aria-busy={loading} className="grid gap-3.5 border-t py-6 first:border-t-0 first:pt-3" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && trail.length > 1 && props.active) { event.preventDefault(); back(); } }}>
    <div className="flex items-baseline justify-between gap-3"><h2 className="text-[13px] font-semibold tracking-[.01em] text-muted-foreground">{providerNames[provider]}</h2>{trail.length > 1 && <Button variant="outline" data-back onClick={back}>Back to results</Button>}</div>
    {trail.length > 1 && <h3>{page?.title || location.title}</h3>}
    {loading && <p role="status">Searching {providerNames[provider]}…</p>}
    {error && <p role="alert">{error} <Button variant="outline" disabled={!props.connected || loading} onClick={() => { if (page?.nextCursor) void more(); else { cache.current.delete(key); setRetry(value => value + 1); } }}>Retry {providerNames[provider]}</Button></p>}
    {!loading && page && !page.items.length && <p className="text-muted-foreground">No matches in {providerNames[provider]}.</p>}
    {page?.warning && <p role="status">{page.warning}</p>}
    {saveError && <p role="status">Saved status unavailable. {saveError} <Button variant="outline" disabled={!props.connected} onClick={() => setRetry(value => value + 1)}>Retry saved status</Button></p>}
    {actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
    {playlistUrl && page?.items.length && !loading && !error && <div className="flex flex-wrap gap-2"><Button disabled={!props.canPlay || !props.connected || busy || !props.onCommand} onClick={() => void action(async () => { const ok = await props.onCommand!({ type: "enqueueProviderPlaylist", provider: "youtube", url: playlistUrl, playNow: true, quality: props.quality }); if (ok) props.onEnqueued(); return ok; }, "Playing playlist on the playback computer.")}>Play playlist</Button><Button variant="secondary" disabled={!props.connected || busy || !props.onCommand} onClick={() => void action(async () => { const ok = await props.onCommand!({ type: "enqueueProviderPlaylist", provider: "youtube", url: playlistUrl, quality: props.quality }); if (ok) props.onEnqueued(); return ok; }, "Playlist added to Up next.")}>Add playlist to queue</Button>{props.onQualityChange && <QualityOptions id={`${qualityId}-playlist`} label="Playlist video quality" value={props.quality} onChange={props.onQualityChange} disabled={!props.connected || busy} />}</div>}
    {album && <div className="flex flex-wrap gap-2"><Button disabled={!props.canPlay || !props.connected || busy || !props.onCommand} onClick={() => void action(() => props.onCommand!({ type: "enqueueProviderAlbum", provider: "bandcamp", url: location.request.url!, playNow: true }), "Starting album on the playback computer.")}>Play album</Button><Button variant="secondary" disabled={!props.connected || busy || !props.onCommand} onClick={() => void action(() => props.onCommand!({ type: "enqueueProviderAlbum", provider: "bandcamp", url: location.request.url! }), "Album added to Up next.")}>Add album to queue</Button></div>}
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-x-4 gap-y-5">{page?.items.slice(0, visible).map(item => <li key={item.id} className="flex min-w-0 flex-col"><MediaArtwork thumbnail={item.thumbnail} title={item.title} /><div className="grid gap-1 px-0.5 pb-0 pt-2.5"><Button variant="ghost" className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 p-0 text-left leading-normal whitespace-normal" aria-label={`Details for ${item.title}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetail(item); }}><strong className="text-[15px] font-semibold leading-tight break-words">{item.title}</strong><small className="text-xs text-muted-foreground">{[item.subtitle, item.live ? "Live" : item.kind === "media" ? provider === "bandcamp" ? "Track" : "Video" : item.kind === "channel" ? "Channel" : "Collection"].filter(Boolean).join(" · ")}</small></Button></div>{itemActions(item)}</li>)}</ul>
    <Dialog open={props.active && !!detail} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (props.active && detailTrigger.current?.isConnected && !detailTrigger.current.closest("[hidden]") && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) detailTrigger.current.focus({ preventScroll: true }); }}>
      {detail && <><MediaArtwork thumbnail={detail.thumbnail} title={detail.title} className="h-auto aspect-[1.9] w-full" /><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{providerNames[provider]}{detail.live ? " · Live" : ""}</DialogDescription></DialogHeader>{detail.subtitle && <p>{detail.subtitle}</p>}{itemActions(detail, true)}{actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}</>}
    </DialogContent></Dialog>
    {page && (visible < page.items.length || page.nextCursor) && <Button variant="outline" disabled={!props.connected || loading} onClick={() => void more()}>Show more {providerNames[provider]}</Button>}
  </section>;
}
