import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action } from "../../../shared/protocol";
import type { BrowseRequest, ProviderId, ProviderItem, VideoQuality } from "../../../shared/providers";
import { providerShape } from "../../../shared/providers";
import { providerBrowseQuery, providerFavoritesQuery, type ProviderSearchPage } from "@/api/providers";
import { forLaterQuery } from "@/api/for-later";
import { apiFetch } from "@/api/client";

export type SearchKind = "Video" | "Music" | "Live" | "Radio" | "Channels";
export type SearchLength = "Under 10 min" | "10 min to 1 hour" | "Over an hour";
export type SearchFacet = { kind: SearchKind; duration?: number | null };
export type SearchHit = SearchFacet & {
  id: string; source: string; title: string; meta: string; description?: string;
  position?: number; live?: boolean; collection?: boolean;
  thumbnail?: string; artworkId?: string | null; video?: boolean;
  primary: { label: string; disabled?: boolean; run: () => void };
  actions: Array<{ label: string; disabled?: boolean; pressed?: boolean; run?: () => void; node?: ReactNode }>;
};
export type SearchCollection = { title: string; source: string; openerId?: string; back: () => void; playAll?: () => void; queueAll?: () => void; save?: () => void; saved?: boolean; disabled?: boolean };
export type SearchResultSummary = { count: number; loading: boolean; error: boolean; errorMessage?: string; retry?: () => void; notice?: string; actionError?: string; warning?: string; more?: () => void; moreDisabled?: boolean; page?: { start: number; end: number; total: number; previous?: () => void; next?: () => void }; facets?: SearchFacet[]; hits?: SearchHit[]; collection?: SearchCollection };
export function matchesFacet(item: SearchFacet, kinds: SearchKind[] = [], lengths: SearchLength[] = []) {
  return (!kinds.length || kinds.includes(item.kind)) && (!lengths.length || item.duration != null && lengths.includes(item.duration < 600 ? "Under 10 min" : item.duration <= 3600 ? "10 min to 1 hour" : "Over an hour"));
}
export type SearchPlaybackProps = {
  onResults?: (source: string, summary: SearchResultSummary) => void;
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  onCommand?: (action: Action) => Promise<boolean>;
  kinds?: SearchKind[]; lengths?: SearchLength[];
};
export const providerNames: Record<ProviderId, string> = { youtube: "YouTube", raiplay: "RaiPlay", twitch: "Twitch", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };
export const searchError = (reason: unknown) => reason instanceof Error ? reason.message : "Could not complete this request.";
function webThumbnail(value?: string) {
  if (!value || value.length > 2048) return undefined;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : undefined; }
  catch { return undefined; }
}
export async function readSearch<T>(props: Pick<SearchPlaybackProps, "origin" | "token">, path: string, signal: AbortSignal, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers); headers.set("Content-Type", "application/json");
  const response = await apiFetch(props, path, { ...init, headers, signal }, 30_000);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

type Location = { request: BrowseRequest; title: string; opener?: string; item?: ProviderItem };
type Props = SearchPlaybackProps & {
  provider: ProviderId; query: string; retry?: number; url?: string; quality: VideoQuality; onQualityChange?: (quality: VideoQuality) => void; onEnqueued: () => void;
  onCollectionChange?: (open: boolean) => void;
};
export function SearchOnlineResults(props: Props) {
  return <OnlineResults key={JSON.stringify([props.origin, props.token, props.provider, props.query, props.url])} {...props} />;
}
function OnlineResults(props: Props) {
  const { provider } = props;
  const client = useQueryClient();
  const [trail, setTrail] = useState<Location[]>([{ request: props.url ? { url: props.url } : { query: props.query }, title: providerNames[provider] }]);
  const location = trail[trail.length - 1]!;
  // Hidden sources still report search counts. Active controls presentation,
  // not whether a source participates in the cross-source search.
  const browse = useInfiniteQuery({ ...providerBrowseQuery(props, provider, location.request), enabled: props.connected, refetchOnMount: !!props.retry ? "always" : true });
  const page = useMemo<ProviderSearchPage | null>(() => {
    if (!browse.data?.pages.length) return null;
    const pages = browse.data.pages, items: ProviderItem[] = [], ids = new Set<string>();
    for (const part of pages) for (const item of part.items) if (!ids.has(item.id)) { ids.add(item.id); items.push(item); }
    const warning = [...new Set(pages.flatMap(part => part.warning ? [part.warning] : []))].join(" ");
    return { ...pages[0]!, items, nextCursor: pages.at(-1)?.nextCursor, ...(warning ? { warning } : {}) };
  }, [browse.data]);
  const loading = props.connected && browse.isFetching;
  const error = browse.error ? searchError(browse.error) : "";
  const [visible, setVisible] = useState(60);
  const kept = useQuery({ ...providerFavoritesQuery(props), enabled: props.connected, retry: false });
  const favorites = kept.error ? null : kept.data?.favorites ?? null;
  const later = useQuery({ ...forLaterQuery(props), enabled: props.connected, retry: false });
  const savedWeb = (item: ProviderItem) => later.data?.items.find(entry => entry.url === item.url);
  const saveError = kept.error ? searchError(kept.error) : "";
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  // Only presentation state is retained locally. Query owns pages, requests,
  // errors and retries, so changing a query or connection retires its reads.
  const views = useRef(new Map<string, number>());
  const key = JSON.stringify(location.request);
  const currentView = useRef(key); currentView.current = key;
  useEffect(() => { props.onCollectionChange?.(trail.length > 1); }, [trail.length]);
  const facet = (item: ProviderItem): SearchFacet => ({ kind: item.kind !== "media" ? "Channels" : item.live ? "Live" : provider === "bandcamp" ? "Music" : "Video", duration: item.duration });
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setBusy(false); return () => controller.abort(); }, [props.origin, props.token, props.connected]);
  useEffect(() => { setVisible(views.current.get(key) ?? 60); setActionError(""); setNotice(""); }, [key]);
  async function more() {
    if (!page || loading || !props.connected) return;
    if (visible < page.items.length) { setVisible(value => value + 6); return; }
    if (!browse.hasNextPage) return;
    const signal = lifetime.current?.signal;
    const result = await browse.fetchNextPage({ cancelRefetch: false });
    if (!signal?.aborted && currentView.current === key && !result.isError) setVisible(value => value + 6);
  }
  function open(item: ProviderItem, opener = item.id) { views.current.set(key, visible); setTrail(current => [...current, { request: { url: item.url }, title: item.title, opener, item }]); }
  function back() { setTrail(current => current.slice(0, -1)); }
  async function action(work: (signal: AbortSignal) => Promise<boolean | void>, done: string) {
    if (busy || !props.connected || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setBusy(true); setActionError(""); setNotice("");
    try { const ok = await work(signal); if (!signal.aborted && ok !== false) setNotice(done); }
    catch (reason) { if (!signal.aborted) setActionError(searchError(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  function play(item: ProviderItem, playNow: boolean, placement?: "next") {
    void action(async signal => {
      const ok = await props.onCommand?.({ type: "enqueueProvider", provider: item.provider, url: item.url, shape: providerShape(item), title: item.title, thumbnail: item.thumbnail, ...(provider !== "bandcamp" ? { quality: props.quality } : {}), playNow, ...(placement ? { placement } : {}) });
      if (ok && !signal.aborted) props.onEnqueued();
      return ok ?? false;
    }, playNow ? `Starting ${item.title} on the playback computer.` : placement ? `${item.title} plays next.` : `${item.title} added to the end of Up next. Playback is unchanged.`);
  }
  function save(item: ProviderItem, saved: boolean) {
    void action(async signal => {
      if (item.kind === "media") {
        const existing = savedWeb(item);
        await readSearch(props, existing ? `/api/for-later/${encodeURIComponent(existing.id)}` : "/api/for-later", signal, { method: existing ? "DELETE" : "POST", ...(existing ? {} : { body: JSON.stringify({ reference: { kind: "web", url: item.url, title: item.title, thumbnail: webThumbnail(item.thumbnail), duration: typeof item.duration === "number" && Number.isFinite(item.duration) && item.duration >= 0 && item.duration <= 86400 ? item.duration : undefined } }) }) });
        if (!signal.aborted) await client.invalidateQueries({ queryKey: ["for-later"] });
      } else {
        await readSearch(props, saved ? `/api/providers/favorites/${encodeURIComponent(item.id)}` : "/api/providers/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ item }) }) });
        if (!signal.aborted) await client.invalidateQueries({ queryKey: ["providers", "favorites"] });
      }
    }, `${item.title} ${saved ? "removed." : "saved."}`);
  }
  useEffect(() => {
    const hits: SearchHit[] = (page?.items ?? []).slice(0, visible).map(item => {
      const saved = item.kind === "media" ? !!savedWeb(item) : !!favorites?.some(entry => entry.id === item.id);
      const saveUnavailable = item.kind === "media" ? !later.data : favorites === null;
      return { id: `${provider}:${item.id}`, source: providerNames[provider], title: item.title, meta: [item.subtitle, providerNames[provider]].filter(Boolean).join(", "), description: item.description, ...facet(item), live: item.live, collection: item.kind !== "media", thumbnail: item.thumbnail,
        primary: { label: item.kind === "media" ? "Play" : "Open", disabled: item.kind === "media" && (!props.canPlay || busy || !props.onCommand), run: () => item.kind === "media" ? play(item, true) : open(item) },
        actions: item.kind === "media" ? [
          { label: "Play next", disabled: busy || !props.onCommand, run: () => play(item, false, "next") },
          { label: "Queue", disabled: busy || !props.onCommand, run: () => play(item, false) },
          { label: saved ? "Saved" : "Save", pressed: saved, disabled: busy || saveUnavailable, run: () => save(item, saved) },
        ] : [{ label: saved ? "Saved" : "Save", pressed: saved, disabled: busy || saveUnavailable, run: () => save(item, saved) }],
      };
    });
    const selected = location.item;
    props.onResults?.(providerNames[provider], { count: page?.items.length ?? 0, loading, error: !!error, errorMessage: error, retry: () => { if (browse.isFetchNextPageError) void more(); else void browse.refetch(); }, notice, actionError: [actionError, saveError].filter(Boolean).join(" "), warning: page?.warning, more: visible < (page?.items.length ?? 0) || browse.hasNextPage ? () => void more() : undefined, moreDisabled: !props.connected || loading, facets: page?.items.map(facet), hits,
      ...(trail.length > 1 ? { collection: { title: page?.title || location.title, source: providerNames[provider], openerId: `${provider}:${location.opener}`, back, disabled: busy,
        playAll: location.request.url && page?.items.length ? () => void action(() => props.onCommand?.({ type: "enqueueProvider", provider, url: location.request.url!, shape: "playlist", playNow: true, quality: props.quality }) ?? Promise.resolve(false), `Starting ${location.title}.`) : undefined,
        queueAll: location.request.url && page?.items.length ? () => void action(() => props.onCommand?.({ type: "enqueueProvider", provider, url: location.request.url!, shape: "playlist", quality: props.quality }) ?? Promise.resolve(false), `${location.title} added to Up next.`) : undefined,
        save: selected ? () => save(selected, !!favorites?.some(entry => entry.id === selected.id)) : undefined,
        saved: !!selected && !!favorites?.some(entry => entry.id === selected.id),
      } } : {}),
    });
  }, [trail.length, page?.items, page?.title, page?.warning, location, visible, favorites, later.data, busy, loading, error, notice, actionError, saveError, browse.hasNextPage, props.onResults, props.canPlay, props.onCommand, props.quality]);
  return null;
}
