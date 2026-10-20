import { browserActions } from "@/original-page";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { collectionLocation } from "@/detail-navigation";
import { providerCollectionCursor } from "@/collection-pagination";
import type { Action } from "../../../shared/protocol";
import type { MediaCollection } from "../../../shared/media";
import type { ProviderId, ProviderItem, VideoQuality } from "../../../shared/providers";
import { providerShape } from "../../../shared/providers";
import { providerBrowseQuery, providerPageQuery, providerFavoritesQuery, type ProviderSearchPage } from "@/api/providers";
import { forLaterQuery } from "@/api/for-later";
import { apiFetch } from "@/api/client";
import { historyQuery } from "@/api/progress";
import { usePlayOn } from "@/components/PlayOn";
import { failed } from "@/toasts";
import type { MenuAction } from "@/components/RowMenu";
import { nextEpisode, progressFor, seriesResumeFor } from "./provider-progress";
import type { HistoryItem } from "../../../shared/viewing";

export type SearchKind = "Video" | "Music" | "Live" | "Radio" | "Channels";
export type SearchLength = "Under 10 min" | "10–60 min" | "Over 1 hr";
export type SearchFacet = { kind: SearchKind; duration?: number | null };
export type SearchHit = SearchFacet & {
  id: string; source: string; title: string; meta: string; description?: string; url?: string;
  position?: number; live?: boolean;
  /** What an openable hit is, shown instead of a length. */
  collection?: "Channel" | "List" | "Album" | "Series" | "Season" | "Programme";
  thumbnail?: string; video?: boolean;
  primary: { label: string; disabled?: boolean; run: () => void; href?: string };
  /** Every verb, the primary's included; MediaRow's menu holds the rest. */
  actions: MenuAction[];
};
export type SearchCollection = { url?: string; title: string; source: string; thumbnail?: string; description?: string; subtitle?: string; single?: boolean; playLabel?: string; position?: number; duration?: number | null; fromStart?: () => void; playAll?: () => void; playOn?: (deviceId: string) => void; playNext?: () => void; queueAll?: () => void; save?: () => void; saved?: boolean; saveDisabled?: boolean; disabled?: boolean };
export type SearchResultSummary = { count: number; loading: boolean; error: boolean; errorMessage?: string; retry?: () => void; warning?: string; more?: () => void; moreDisabled?: boolean; facets?: SearchFacet[]; hits?: SearchHit[]; collection?: SearchCollection; page?: ProviderSearchPage };
export const lengthOf = (seconds: number): SearchLength => seconds < 600 ? "Under 10 min" : seconds <= 3600 ? "10–60 min" : "Over 1 hr";
export function matchesFacet(item: SearchFacet, kind?: SearchKind, length?: SearchLength) {
  return (!kind || item.kind === kind) && (!length || item.duration != null && lengthOf(item.duration) === length);
}
export type SearchPlaybackProps = {
  onResults?: (source: string, summary: SearchResultSummary) => void;
  origin: string; token: string; connected: boolean; canPlay: boolean; active: boolean;
  onCommand?: (action: Action) => Promise<boolean>;
};
export const providerNames: Record<ProviderId, string> = { youtube: "YouTube", raiplay: "RaiPlay", twitch: "Twitch", bandcamp: "Bandcamp", soundcloud: "SoundCloud", streamingcommunity: "StreamingCommunity", movies123: "123MoviesFree", animesaturn: "AnimeSaturn", animeunity: "AnimeUnity" };
export const searchError = (reason: unknown) => reason instanceof Error ? reason.message : "Didn't respond.";
export function collectionLabel(item: ProviderItem): SearchHit["collection"] {
  if (item.kind === "media") return;
  if (item.kind === "channel") return "Channel";
  if (item.provider === "bandcamp") return "Album";
  if (item.provider === "raiplay") return "Programme";
  const path = new URL(item.url).pathname;
  if (item.provider === "movies123" && /^\/season\/[\w-]+-\d+\/?$/.test(path)) return "Season";
  if (item.provider === "streamingcommunity") return /\/season-\d+$/.test(path) ? "Season" : "Series";
  if (item.provider === "animesaturn" || item.provider === "animeunity") return "Series";
  return "List";
}
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

type Props = SearchPlaybackProps & {
  provider: ProviderId; query: string; retry?: number; url?: string; quality: VideoQuality; onEnqueued: () => void;
  onOpenCollection?: (item: ProviderItem) => void;
  paged?: boolean; cursor?: string; context?: MediaCollection;
  onPlayHistory?: (item: HistoryItem, options: { fromStart?: boolean; on?: string }) => Promise<boolean>;
};
export function SearchOnlineResults(props: Props) {
  return <OnlineResults key={JSON.stringify([props.origin, props.token, props.provider, props.query, props.url, props.cursor])} {...props} />;
}
function OnlineResults(props: Props) {
  const { provider } = props;
  const client = useQueryClient();
  const playOn = usePlayOn();
  const request = props.url ? { url: props.url } : { query: props.query };
  // Hidden sources still report search counts. Active controls presentation,
  // not whether a source participates in the cross-source search.
  const refetchInterval = provider === "twitch" && props.connected && props.active ? 20_000 : false;
  const browse = useInfiniteQuery({ ...providerBrowseQuery(props, provider, request), enabled: props.connected && !props.paged, refetchInterval, refetchIntervalInBackground: false, refetchOnMount: !!props.retry ? "always" : true });
  const single = useQuery({ ...providerPageQuery(props, provider, { ...request, cursor: props.cursor }), enabled: props.connected && !!props.paged, refetchInterval, refetchIntervalInBackground: false });
  const page = useMemo<ProviderSearchPage | null>(() => {
    if (props.paged) return single.data ?? null;
    if (!browse.data?.pages.length) return null;
    const pages = browse.data.pages, items: ProviderItem[] = [], ids = new Set<string>();
    for (const part of pages) for (const item of part.items) {
      const id = item.collection?.index == null ? item.id : `${item.id}:${item.collection.url}:${item.collection.index}`;
      if (!ids.has(id)) { ids.add(id); items.push(item); }
    }
    const warning = [...new Set(pages.flatMap(part => part.warning ? [part.warning] : []))].join(" ");
    return { ...pages[0]!, items, nextCursor: pages.at(-1)?.nextCursor, ...(warning ? { warning } : {}) };
  }, [browse.data, single.data, props.paged]);
  const loading = props.connected && (props.paged ? single.isFetching : browse.isFetching);
  const failure = props.paged ? single.error : browse.error;
  const error = failure ? searchError(failure) : "";
  const [visible, setVisible] = useState(() => Math.max(60, page?.items.length ?? 0));
  const kept = useQuery({ ...providerFavoritesQuery(props), enabled: props.connected, retry: false });
  const favorites = kept.error ? null : kept.data?.favorites ?? null;
  const later = useQuery({ ...forLaterQuery(props), enabled: props.connected, retry: false });
  const history = useQuery({ ...historyQuery(props, provider), enabled: props.connected && !!props.url && !!props.onPlayHistory });
  const savedWeb = (item: ProviderItem) => later.data?.items.find(entry => entry.url === item.url);
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  // Only presentation state is retained locally. Query owns pages, requests,
  // errors and retries, so changing a query or connection retires its reads.
  const music = provider === "bandcamp" || provider === "soundcloud";
  const facet = (item: ProviderItem): SearchFacet => ({ kind: music ? "Music" : item.kind !== "media" ? "Channels" : item.live ? "Live" : "Video", duration: item.duration });
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setBusy(false); return () => controller.abort(); }, [props.origin, props.token, props.connected]);
  async function more() {
    if (!page || loading || !props.connected) return;
    if (visible < page.items.length) { setVisible(value => value + 6); return; }
    if (!browse.hasNextPage) return;
    const signal = lifetime.current?.signal;
    const result = await browse.fetchNextPage({ cancelRefetch: false });
    if (!signal?.aborted && !result.isError) setVisible(value => value + 6);
  }
  async function action(failure: string, work: (signal: AbortSignal) => Promise<boolean | void>) {
    if (busy || !props.connected || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setBusy(true);
    try { await work(signal); }
    catch (reason) { if (!signal.aborted) failed(failure, reason); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  function play(item: ProviderItem, playNow: boolean, placement?: "next", deviceId?: string) {
    void action(`Couldn't ${playNow ? "play" : "queue"} ${item.title}.`, async signal => {
      const ok = await props.onCommand?.({ type: "enqueueProvider", provider: item.provider, url: item.url, shape: providerShape(item), title: item.title, thumbnail: item.thumbnail, ...(item.collection ? { collection: item.collection } : {}), ...(!music ? { quality: props.quality } : {}), playNow, ...(placement ? { placement } : {}), ...(deviceId ? { deviceId } : {}) });
      if (ok && !signal.aborted) props.onEnqueued();
      return ok ?? false;
    });
  }
  function save(item: ProviderItem, saved: boolean) {
    void action(`Couldn't ${saved ? "remove" : "save"} ${item.title}.`, async signal => {
      if (item.kind === "media") {
        const existing = savedWeb(item);
        let collection = item.collection;
        if (!existing && collection?.index !== undefined) {
          // AnimeUnity pages use displayed number ranges, which can combine several episodes.
          const episodePage = provider === "animeunity";
          const fresh = await client.fetchQuery({ ...providerPageQuery(props, provider, episodePage ? { url: item.url } : { url: collection.url, cursor: providerCollectionCursor(provider, collection) }), staleTime: 0 });
          signal.throwIfAborted();
          const current = fresh.items.find(candidate => candidate.url === item.url && candidate.collection?.url === collection?.url && (episodePage || candidate.collection?.index === collection?.index));
          if (!current) throw new Error("This collection changed. Refresh it before saving this item.");
          collection = current.collection;
        }
        await readSearch(props, existing ? `/api/for-later/${encodeURIComponent(existing.id)}` : "/api/for-later", signal, { method: existing ? "DELETE" : "POST", ...(existing ? {} : { body: JSON.stringify({ reference: { kind: "web", url: item.url, title: item.title, ...(collection ? { collection: { url: collection.url, ...(collection.index === undefined ? {} : { index: collection.index }) } } : {}), thumbnail: webThumbnail(item.thumbnail), duration: typeof item.duration === "number" && Number.isFinite(item.duration) && item.duration >= 0 && item.duration <= 86400 ? item.duration : undefined } }) }) });
        if (!signal.aborted) await client.invalidateQueries({ queryKey: ["for-later"] });
      } else {
        await readSearch(props, saved ? `/api/providers/favorites/${encodeURIComponent(item.id)}` : "/api/providers/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ item }) }) });
        if (!signal.aborted) await client.invalidateQueries({ queryKey: ["providers", "favorites"] });
      }
    });
  }
  useEffect(() => {
    const hits: SearchHit[] = (page?.items ?? []).slice(0, props.paged ? undefined : visible).map(item => {
      const saved = item.kind === "media" ? !!savedWeb(item) : !!favorites?.some(entry => entry.id === item.id);
      const saveUnavailable = item.kind === "media" ? !later.data : favorites === null;
      const saveAction = { label: saved ? "Saved" : "Save", pressed: saved, disabled: busy || saveUnavailable, run: () => save(item, saved) };
      return { id: `${provider}:${item.id}${item.collection?.index == null ? "" : `:${item.collection.index}`}`, url: item.url, source: providerNames[provider], title: item.title, meta: [item.subtitle, providerNames[provider]].filter(Boolean).join(" · "), description: item.description, ...facet(item), live: item.live, collection: collectionLabel(item), thumbnail: item.thumbnail,
        primary: { label: "Open", href: collectionLocation(item), run: () => props.onOpenCollection?.(item) },
        actions: [...(item.kind === "media" ? [
          { label: "Play", disabled: !props.canPlay || busy || !props.onCommand, run: () => play(item, true) },
          { label: "Play on", disabled: !props.canPlay || busy || !props.onCommand, playOn: (deviceId: string) => play(item, true, undefined, deviceId) },
          { label: "Play next", disabled: busy || !props.onCommand, run: () => play(item, false, "next") },
          { label: "Queue", disabled: busy || !props.onCommand, run: () => play(item, false) },
          saveAction,
        ] : [saveAction]), ...browserActions(item.url)],
      };
    });
    const known = props.url ? [
      ...(favorites ?? []),
      ...client.getQueriesData<InfiniteData<ProviderSearchPage>>({ queryKey: ["search", "providers", provider] }).flatMap(([, data]) => data?.pages.flatMap(page => page.items) ?? []),
    ].filter(item => item.provider === provider && item.url === props.url) : [];
    const canonical = page?.item ?? known[0];
    const selected = canonical && { ...canonical,
      collection: props.context ?? canonical.collection,
      thumbnail: canonical.thumbnail ?? known.find(item => item.thumbnail)?.thumbnail,
      description: canonical.description ?? known.find(item => item.description)?.description,
      subtitle: canonical.subtitle ?? known.find(item => item.subtitle)?.subtitle,
    };
    const episodeList = selected?.kind === "collection" && !!page?.items.length && page.items.every(item => item.kind === "media")
      && (provider === "streamingcommunity" && /\/titles\/\d+(?:-[\w-]+)?$/.test(new URL(selected.url).pathname)
        || provider === "movies123" && /^\/season\/[\w-]+-\d+\/?$/.test(new URL(selected.url).pathname)
        || provider === "animesaturn" || provider === "animeunity");
    const historyItems = history.data?.items ?? [];
    const start = selected?.kind === "media" ? selected : episodeList ? nextEpisode(page!.items, historyItems) : undefined;
    const animeResume = selected && ["animesaturn", "animeunity"].includes(provider) ? seriesResumeFor(selected, historyItems) : undefined;
    const progress = animeResume ?? (start ? progressFor(start, historyItems) : selected ? seriesResumeFor(selected, historyItems) : undefined);
    const resume = progress?.playable && !progress.watched && progress.position > 0 ? progress : undefined;
    const startItem = (fromStart = false, deviceId?: string) => {
      if (resume && props.onPlayHistory) void action(`Couldn't play ${resume.title}.`, () => playOn.play(on => props.onPlayHistory!(resume, { fromStart, on }), deviceId));
      else if (start) play(start, true, undefined, deviceId);
    };
    const selectedSaved = !!selected && (selected.kind === "media" ? !!savedWeb(selected) : !!favorites?.some(entry => entry.id === selected.id));
    const list = (playNow: boolean, deviceId?: string) => props.onCommand && props.url && page?.items.some(item => item.kind === "media") ? () => void action(`Couldn't ${playNow ? "play" : "queue"} ${page.title || selected?.title || providerNames[provider]}.`, () => props.onCommand?.({ type: "enqueueProvider", provider, url: props.url!, shape: selected?.kind === "media" ? "atom" : "playlist", ...(!playNow ? { title: page.title || selected?.title || providerNames[provider] } : {}), ...(selected?.collection ? { collection: selected.collection } : {}), playNow, quality: props.quality, ...(deviceId ? { deviceId } : {}) }) ?? Promise.resolve(false)) : undefined;
    props.onResults?.(providerNames[provider], { page: page ?? undefined, count: page?.items.length ?? 0, loading, error: !!error, errorMessage: error, retry: () => { if (props.paged) void single.refetch(); else if (browse.isFetchNextPageError) void more(); else void browse.refetch(); }, warning: page?.warning, more: !props.paged && (visible < (page?.items.length ?? 0) || browse.hasNextPage) ? () => void more() : undefined, moreDisabled: !props.connected || loading, facets: page?.items.map(facet), hits,
      ...(props.url ? { collection: { url: selected?.url ?? props.url, title: page?.title || selected?.title || providerNames[provider], thumbnail: page?.thumbnail ?? selected?.thumbnail, description: page?.description ?? selected?.description ?? progress?.description, subtitle: page?.subtitle ?? selected?.subtitle, source: providerNames[provider], disabled: busy || !props.connected || !!props.onPlayHistory && history.isLoading,
        single: selected?.kind === "media", playAll: start || resume ? () => startItem() : list(true), playOn: start || resume ? deviceId => startItem(false, deviceId) : list(true) && (deviceId => list(true, deviceId)?.()), queueAll: list(false),
        playNext: selected?.kind === "media" && props.onCommand ? () => play(selected, false, "next") : undefined,
        playLabel: resume ? "Resume" : start ? "Play" : undefined, position: resume?.position, duration: resume?.duration, fromStart: resume ? () => startItem(true) : undefined,
        save: selected ? () => save(selected, selectedSaved) : undefined, saved: selectedSaved, saveDisabled: selected?.kind === "media" ? !later.data : favorites === null,
      } } : {}),
    });
  }, [props.url, props.paged, JSON.stringify(props.context), page, visible, favorites, later.data, history.data, history.isLoading, busy, loading, error, browse.hasNextPage, props.onResults, props.canPlay, props.onCommand, props.quality, props.onOpenCollection, props.onPlayHistory]);
  return null;
}
