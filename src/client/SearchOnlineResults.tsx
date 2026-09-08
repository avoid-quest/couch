import { useEffect, useId, useRef, useState } from "react";
import type { Action } from "../shared/protocol";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage, VideoQuality } from "../shared/providers";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "./ProviderPanel";
import { QualityOptions } from "./QualitySelect";
import { isYouTubePlaylistUrl } from "../shared/providers";
import { createId } from "./session";

export type SearchPlaybackProps = {
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
  provider: ProviderId; query: string; url?: string; version: number; quality: VideoQuality; onQualityChange?: (quality: VideoQuality) => void; onEnqueued: () => void;
};
export function SearchOnlineResults(props: Props) {
  return <OnlineResults key={`${props.origin}:${props.token}:${props.provider}`} {...props} />;
}
function OnlineResults(props: Props) {
  const { provider } = props;
  const qualityId = useId();
  const [trail, setTrail] = useState<Location[]>([{ request: props.url ? { url: props.url } : { query: props.query }, title: providerNames[provider] }]);
  const location = trail[trail.length - 1]!;
  const [page, setPage] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
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

  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setBusy(false); return () => { controller.abort(); request.current?.abort(); }; }, [props.origin, props.token, props.connected]);
  useEffect(() => {
    const controller = new AbortController();
    if (!props.connected) { setFavorites(null); return; }
    setSaveError("");
    void readSearch<{ favorites: ProviderItem[] }>(props, "/api/providers/favorites", controller.signal).then(body => { if (!controller.signal.aborted) setFavorites(body.favorites); }).catch(reason => { if (!controller.signal.aborted) { setFavorites(null); setSaveError(searchError(reason)); } });
    return () => controller.abort();
  }, [props.origin, props.token, props.connected, props.version, retry]);

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
  function open(item: ProviderItem) { const container = section.current?.closest(".tv-browser") ?? document.scrollingElement;
    views.current.set(key, { visible, top: container?.scrollTop ?? 0 }); restore.current = "back"; setTrail(current => [...current, { request: { url: item.url }, title: item.title, opener: item.id }]); }
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
    }, playNow ? `Starting ${item.title} on the TV.` : `${item.title} added to Up next.`);
  }
  function save(item: ProviderItem, saved: boolean) {
    void action(async signal => {
      await readSearch(props, saved ? `/api/providers/favorites/${encodeURIComponent(item.id)}` : "/api/providers/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ item }) }) });
      if (!signal.aborted) setFavorites(current => saved ? current?.filter(entry => entry.id !== item.id) ?? [] : [...current?.filter(entry => entry.id !== item.id) ?? [], item]);
    }, `${item.title} ${saved ? "removed from" : "added to"} Saved.`);
  }
  const playlistUrl = provider === "youtube" && isYouTubePlaylistUrl(location.request.url ?? location.request.query ?? "") ? location.request.url ?? location.request.query : undefined;
  const album = provider === "bandcamp" && /\/album\//.test(location.request.url ?? "") && !!page?.items.length && page.items.every(item => item.kind === "media");
  return <section ref={section} aria-label={`${providerNames[provider]} search results`} aria-busy={loading} className="search-source" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && trail.length > 1 && props.active) { event.preventDefault(); back(); } }}>
    <div className="search-source-heading"><h2>{providerNames[provider]}</h2>{trail.length > 1 && <Button variant="outline" data-back onClick={back}>Back to results</Button>}</div>
    {trail.length > 1 && <h3>{page?.title || location.title}</h3>}
    {loading && <p role="status">Searching {providerNames[provider]}…</p>}
    {error && <p role="alert">{error} <Button variant="outline" disabled={!props.connected || loading} onClick={() => { if (page?.nextCursor) void more(); else { cache.current.delete(key); setRetry(value => value + 1); } }}>Retry {providerNames[provider]}</Button></p>}
    {!loading && page && !page.items.length && <p className="text-muted-foreground">No matches in {providerNames[provider]}.</p>}
    {page?.warning && <p role="status">{page.warning}</p>}
    {saveError && <p role="status">Saved status unavailable. {saveError} <Button variant="outline" disabled={!props.connected} onClick={() => setRetry(value => value + 1)}>Retry saved status</Button></p>}
    {actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
    {playlistUrl && page?.items.length && !loading && !error && <div className="flex flex-wrap gap-2"><Button disabled={!props.canPlay || !props.connected || busy || !props.onCommand} onClick={() => void action(async () => { const ok = await props.onCommand!({ type: "enqueueProviderPlaylist", provider: "youtube", url: playlistUrl, playNow: true, quality: props.quality }); if (ok) props.onEnqueued(); return ok; }, "Playing playlist on the TV.")}>Play playlist</Button><Button variant="secondary" disabled={!props.connected || busy || !props.onCommand} onClick={() => void action(async () => { const ok = await props.onCommand!({ type: "enqueueProviderPlaylist", provider: "youtube", url: playlistUrl, quality: props.quality }); if (ok) props.onEnqueued(); return ok; }, "Playlist added to Up next.")}>Up next: playlist</Button>{props.onQualityChange && <QualityOptions id={`${qualityId}-playlist`} label="Playlist video quality" value={props.quality} onChange={props.onQualityChange} disabled={!props.connected || busy} />}</div>}
    {album && <div className="flex flex-wrap gap-2"><Button disabled={!props.canPlay || !props.connected || busy || !props.onCommand} onClick={() => void action(() => props.onCommand!({ type: "enqueueProviderAlbum", provider: "bandcamp", url: location.request.url!, playNow: true }), "Starting album on the TV.")}>Play album</Button><Button variant="secondary" disabled={!props.connected || busy || !props.onCommand} onClick={() => void action(() => props.onCommand!({ type: "enqueueProviderAlbum", provider: "bandcamp", url: location.request.url! }), "Album added to Up next.")}>Up next: album</Button></div>}
    <ul className="search-online-grid">{page?.items.slice(0, visible).map(item => {
      const saved = !!favorites?.some(entry => entry.id === item.id);
      return <li key={item.id} className="search-online-card"><MediaArtwork thumbnail={item.thumbnail} title={item.title} /><div className="search-online-copy"><h3>{item.title}</h3><p>{[item.subtitle, item.live ? "Live" : item.kind === "media" ? provider === "bandcamp" ? "Track" : "Video" : item.kind === "channel" ? "Channel" : "Collection"].filter(Boolean).join(" · ")}</p></div><div className="search-item-actions">
        {item.kind === "media" ? <><Button data-search-item={item.id} aria-label={`Play ${item.title}`} disabled={!props.connected || !props.canPlay || busy || !props.onCommand} onClick={() => play(item, true)}>Play</Button><Button variant="secondary" aria-label={`Add ${item.title} to Up next`} disabled={!props.connected || busy || !props.onCommand} onClick={() => play(item, false)}>Up next</Button></> : <Button data-search-item={item.id} aria-label={`Open ${item.title}`} disabled={!props.connected} onClick={() => open(item)}>Open</Button>}
        {item.kind === "media" && provider !== "bandcamp" && props.onQualityChange && <QualityOptions id={`${qualityId}-${item.id}`} label={`Video quality for ${item.title}`} value={props.quality} onChange={props.onQualityChange} disabled={!props.connected || busy} />}
        <Button variant="ghost" aria-label={saved ? `Remove ${item.title} from saved` : `Save ${item.title}`} aria-pressed={saved} disabled={!props.connected || busy || favorites === null} onClick={() => save(item, saved)}>{saved ? "Saved" : "Save"}</Button>
      </div></li>;
    })}</ul>
    {page && (visible < page.items.length || page.nextCursor) && <Button variant="outline" disabled={!props.connected || loading} onClick={() => void more()}>Show more {providerNames[provider]}</Button>}
  </section>;
}
