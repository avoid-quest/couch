import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuthArtwork } from "@/components/AuthArtwork";
import type { JellyfinItems } from "../../../shared/jellyfin";
import type { LibrarySearch } from "../../../shared/library";
import { apiFetch } from "@/api/client";
import { librarySourcesQuery } from "@/api/library";
import { jellyfinQuery } from "@/api/jellyfin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaveForLater } from "@/components/SaveForLater";
import { MetadataEditor } from "@/components/MetadataEditor";
import { playNotice } from "@/copy";
import { formatDuration } from "@/time-format";
import type { Props } from "./SearchPanel";
import { searchError, type SearchResultSummary, type SearchFacet, type SearchHit } from "./SearchOnlineResults";

type Source = "Library" | "Jellyfin";
type Options = { playNow?: boolean; fromStart?: boolean; placement?: "next" };
type Result = { artworkId?: string | null; video?: boolean; id: string; title: string; detail: string; plot?: string | null; available: boolean; position: number; duration: number | null; watched: boolean };
type Page = { items: Result[]; total: number; warning?: string };

export function SearchSource({ source, query, ...props }: Props & { source: Source; query: string; retry?: number; onResults: (source: string, summary: SearchResultSummary) => void }) {
  const label = source === "Library" ? "Folders" : source;
  const pageSize = source === "Library" ? 30 : 50;
  const folders = useQuery({ ...librarySourcesQuery(props), enabled: props.connected && source === "Library" });
  const jellyfin = useQuery({ ...jellyfinQuery(props), enabled: props.connected && source === "Jellyfin", retry: false });
  const result = useInfiniteQuery({
    queryKey: [source === "Library" ? "library" : "jellyfin", "search", query],
    enabled: props.connected && (source === "Library" || jellyfin.data?.connected === true), retry: false,
    staleTime: 30_000,
    refetchOnMount: props.retry ? "always" : true,
    initialPageParam: 0,
    getNextPageParam: (last: Page, _pages: Page[], offset: number) => offset + pageSize < last.total ? offset + pageSize : undefined,
    queryFn: async ({ pageParam: offset, signal }): Promise<Page> => {
      const read = <T,>(path: string) => apiFetch(props, path, { signal }, 20_000).then(response => response.json() as Promise<T>);
      if (source === "Jellyfin") {
        const result = await read<JellyfinItems>(`/api/jellyfin/items?${new URLSearchParams({ q: query, startIndex: String(offset) })}`);
        return { total: result.total, items: result.items.map(item => ({ id: item.id, title: item.title, video: item.kind !== "Audio", detail: [item.kind, item.detail].filter(Boolean).join(" · "), available: true, position: item.resumePosition, duration: item.duration, watched: item.played })) };
      }
      const result = await read<LibrarySearch>(`/api/library/items?${new URLSearchParams({ q: query, offset: String(offset), limit: String(pageSize) })}`);
      return { total: result.total,
        items: result.items.map(item => ({ id: item.id, title: item.title, artworkId: item.artworkId, video: item.kind === "video", detail: [item.video?.show?.title, item.artist, item.album, item.video?.year, item.kind].filter(Boolean).join(" · "), plot: item.video?.plot, available: item.available, position: item.progress?.position ?? 0, duration: item.duration, watched: item.progress?.watched ?? false })) };
    },
  });
  const pages = result.data?.pages;
  const items = pages?.flatMap(page => page.items) ?? [];
  const metadata = source === "Library" ? folders : jellyfin;
  const loading = props.connected && (result.isFetching || metadata.isFetching);
  const failure = result.error ?? metadata.error;
  const error = failure ? searchError(failure) : null;
  const unavailable = folders.data?.sources.filter(folder => folder.status === "unavailable" || folder.status === "error") ?? [];
  const warning = source !== "Library" ? undefined : unavailable.length ? `Can't reach ${unavailable.map(folder => folder.name).join(", ")}. Showing earlier results.` : folders.data?.sources.some(folder => folder.status === "scanning") ? "Still scanning. More results soon." : undefined;
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = items.find(item => item.id === detailId) ?? null;
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const operation = new AbortController(); lifetime.current = operation; setPending(false); return () => operation.abort(); }, [props.origin, props.token, props.connected]);
  useEffect(() => { setDetailId(null); }, [query, source]);
  useEffect(() => {
    if (!props.active) {
      if (detail) { restoreFocus.current = true; setDetailId(null); }
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
  const facet = (item: Result): SearchFacet => ({ kind: item.video ? "Video" : "Music", duration: item.duration });

  async function enqueue(item: Result, options?: Options) {
    const signal = lifetime.current?.signal;
    setPending(true);
    try { if (await props.onEnqueue(source, item.id, options) && !signal?.aborted && !options?.playNow) toast(playNotice(item.title, options?.placement ?? "queue")); }
    catch (reason) { if (!signal?.aborted) toast.error(searchError(reason)); }
    finally { if (!signal?.aborted) setPending(false); }
  }
  const blocked = (item: Result) => !props.connected || !item.available || loading || pending;
  const save = (item: Result) => <SaveForLater origin={props.origin} token={props.token} connected={props.connected} reference={{ kind: source === "Library" ? "library" : "jellyfin", id: item.id }} title={item.title} />;
  useEffect(() => {
    const hits: SearchHit[] = items.map(item => ({ id: `${source}:${item.id}`, source: label, title: item.title, meta: [item.detail, label].filter(Boolean).join(" · "), description: item.plot ?? undefined, ...facet(item), position: item.position, artworkId: item.artworkId, video: item.video,
      primary: { label: item.position ? "Resume" : "Play", disabled: !props.canPlay || blocked(item), run: () => void enqueue(item, { playNow: true }) },
      actions: [
        ...(item.position ? [{ label: "From start", disabled: !props.canPlay || blocked(item), run: () => void enqueue(item, { playNow: true, fromStart: true }) }] : []),
        { label: "Play next", disabled: blocked(item), run: () => void enqueue(item, { placement: "next" }) },
        { label: "Queue", disabled: blocked(item), run: () => void enqueue(item) },
        { label: "Details", run: () => { trigger.current = document.activeElement as HTMLButtonElement; setDetailId(item.id); } },
        { label: "Save", node: save(item) },
      ],
    }));
    props.onResults(label, { count: pages?.[0]?.total ?? 0, loading, error: !!error, errorMessage: error ?? undefined, retry: () => { void metadata.refetch(); if (source === "Library" || jellyfin.data?.connected) void result.refetch(); }, warning,
      more: result.hasNextPage ? () => void result.fetchNextPage() : undefined, moreDisabled: loading, facets: items.map(facet), hits });
  }, [source, pages, loading, error, warning, pending, result.hasNextPage, props.onResults, props.canPlay, props.connected, props.origin, props.token]);
  return <Dialog open={props.active && detail !== null} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (props.active && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}>
    {detail && <>
      <AuthArtwork origin={props.origin} token={props.token} id={detail.artworkId} video={detail.video} className="aspect-video h-auto w-full rounded-none" />
      <DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{[label, detail.detail, detail.duration !== null && formatDuration(detail.duration)].filter(Boolean).join(" · ")}</DialogDescription></DialogHeader>
      {detail.plot && <p className="text-sm break-words">{detail.plot}</p>}
      {detail.position > 0 && <p className="text-sm text-muted-foreground">Resume at {formatDuration(detail.position)}</p>}
      {!detail.available && <p className="text-sm text-muted-foreground">Missing. Check the folder in Settings → Sources.</p>}
      <div className="flex flex-wrap gap-2">
        <Button aria-label={`${detail.position ? "Resume" : "Play"} ${detail.title}`} disabled={!props.canPlay || blocked(detail)} onClick={() => void enqueue(detail, { playNow: true })}>{detail.position ? "Resume" : "Play"}</Button>
        {!!detail.position && <Button variant="ghost" aria-label={`From start ${detail.title}`} disabled={!props.canPlay || blocked(detail)} onClick={() => void enqueue(detail, { playNow: true, fromStart: true })}>From start</Button>}
        <Button variant="ghost" aria-label={`Play next ${detail.title}`} disabled={blocked(detail)} onClick={() => void enqueue(detail, { placement: "next" })}>Play next</Button>
        <Button variant="ghost" aria-label={`Queue ${detail.title}`} disabled={blocked(detail)} onClick={() => void enqueue(detail)}>Queue</Button>
        {save(detail)}
      </div>
      {source === "Library" && detail.video && props.canManageMetadata && <MetadataEditor key={detail.id} origin={props.origin} token={props.token} id={detail.id} connected={props.connected} onSaved={() => void result.refetch()} />}
    </>}
  </DialogContent></Dialog>;
}
