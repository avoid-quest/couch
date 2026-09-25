import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthArtwork } from "@/components/AuthArtwork";
import type { JellyfinItems, JellyfinStatus } from "../../../shared/jellyfin";
import type { LibrarySearch, LibrarySource } from "../../../shared/library";
import { apiFetch } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { progressTime } from "@/components/HistoryPanel";
import { SaveForLater } from "@/components/SaveForLater";
import { MetadataEditor } from "@/components/MetadataEditor";
import type { Props } from "./SearchPanel";
import { type SearchResultSummary, type SearchFacet, type SearchHit } from "./SearchOnlineResults";

type Source = "Library" | "Jellyfin";
type Options = { playNow?: boolean; fromStart?: boolean; placement?: "next" };
type Result = { artworkId?: string | null; video?: boolean; id: string; title: string; detail: string; plot?: string | null; available: boolean; position: number; duration: number | null; watched: boolean };
type Page = { items: Result[]; total: number; warning?: string };
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Could not search this source.";

export function SearchSource({ source, query, ...props }: Props & { source: Source; query: string; onResults: (source: string, summary: SearchResultSummary) => void }) {
  const [offset, setOffset] = useState(0);
  const pageSize = source === "Library" ? 30 : 50;
  const result = useQuery({
    queryKey: [source === "Library" ? "library" : "jellyfin", "search", query, offset],
    enabled: props.connected, retry: false,
    queryFn: async ({ signal }): Promise<Page> => {
      const read = <T,>(path: string) => apiFetch(props, path, { signal }, 20_000).then(response => response.json() as Promise<T>);
      if (source === "Jellyfin") {
        const status = await read<JellyfinStatus>("/api/jellyfin");
        if (!status.connected) return { items: [], total: 0, warning: "Jellyfin is not connected. An administrator can connect it in source settings." };
        const result = await read<JellyfinItems>(`/api/jellyfin/items?${new URLSearchParams({ q: query, startIndex: String(offset) })}`);
        return { total: result.total, items: result.items.map(item => ({ id: item.id, title: item.title, video: item.kind !== "Audio", detail: [item.kind, item.detail].filter(Boolean).join(" · "), available: true, position: item.resumePosition, duration: item.duration, watched: item.played })) };
      }
      const [result, folders] = await Promise.all([
        read<LibrarySearch>(`/api/library/items?${new URLSearchParams({ q: query, offset: String(offset), limit: String(pageSize) })}`), read<{ sources: LibrarySource[] }>("/api/library/sources"),
      ]);
      const unavailable = folders.sources.filter(folder => folder.status === "unavailable" || folder.status === "error");
      return { total: result.total, warning: unavailable.length ? `${unavailable.map(folder => folder.name).join(", ")}: folder unavailable or scan failed. Saved results remain visible; an administrator can check source settings.` : folders.sources.some(folder => folder.status === "scanning") ? "A folder is still scanning. Results update as media is indexed." : !folders.sources.length ? "No TV folders configured. An administrator can add them in source settings." : undefined,
        items: result.items.map(item => ({ id: item.id, title: item.title, artworkId: item.artworkId, video: item.kind === "video", detail: [item.video?.show?.title, item.artist, item.album, item.video?.year, item.kind].filter(Boolean).join(" · "), plot: item.video?.plot, available: item.available, position: item.progress?.position ?? 0, duration: item.duration, watched: item.progress?.watched ?? false })) };
    },
  });
  const page = result.data ?? null;
  const loading = props.connected && result.isFetching;
  const error = result.error ? message(result.error) : null;
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = page?.items.find(item => item.id === detailId) ?? null;
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const operation = new AbortController(); lifetime.current = operation; setPending(false); return () => operation.abort(); }, [props.origin, props.token, props.connected]);
  useEffect(() => { setDetailId(null); }, [offset, query, source]);
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
    setPending(true); setActionError(null); setNotice("");
    try { if (await props.onEnqueue(source, item.id, options) && !signal?.aborted) setNotice(options?.playNow ? `Starting ${item.title} on the playback computer.` : options?.placement === "next" ? `${item.title} plays next.` : `Added ${item.title} to the end of Up next. Playback is unchanged.`); }
    catch (reason) { if (!signal?.aborted) setActionError(message(reason)); }
    finally { if (!signal?.aborted) setPending(false); }
  }
  const actions = (item: Result) => <div className="flex flex-wrap gap-2">
    <Button aria-label={`${item.position ? "Resume" : "Play"}: ${item.title}`} disabled={!props.connected || !props.canPlay || !item.available || loading || pending} onClick={() => void enqueue(item, { playNow: true })}>{item.position ? "Resume" : "Play"}</Button>
    {!!item.position && <Button variant="outline" aria-label={`Play ${item.title} from start`} disabled={!props.connected || !props.canPlay || !item.available || loading || pending} onClick={() => void enqueue(item, { playNow: true, fromStart: true })}>From start</Button>}
    <SaveForLater origin={props.origin} token={props.token} connected={props.connected} reference={{ kind: source === "Library" ? "library" : "jellyfin", id: item.id }} title={item.title} />
    <Button variant="secondary" aria-label={`Play next: ${item.title}`} disabled={!props.connected || !item.available || loading || pending} onClick={() => void enqueue(item, { placement: "next" })}>Play next</Button>
    <Button variant="secondary" aria-label={`Up next: ${item.title}`} disabled={!props.connected || !item.available || loading || pending} onClick={() => void enqueue(item)}>Queue</Button>
  </div>;
  useEffect(() => {
    const label = source === "Library" ? "TV folders" : source;
    const hits: SearchHit[] | undefined = page?.items.map(item => ({ id: `${source}:${item.id}`, source: label, title: item.title, meta: [item.detail, label].filter(Boolean).join(", "), description: item.plot ?? undefined, ...facet(item), position: item.position, artworkId: item.artworkId, video: item.video,
      primary: { label: item.position ? "Resume" : "Play", disabled: !props.canPlay || !item.available || loading || pending, run: () => void enqueue(item, { playNow: true }) },
      actions: [
        ...(item.position ? [{ label: "From start", disabled: !props.canPlay || !item.available || loading || pending, run: () => void enqueue(item, { playNow: true, fromStart: true }) }] : []),
        { label: "Play next", disabled: !item.available || loading || pending, run: () => void enqueue(item, { placement: "next" }) },
        { label: "Queue", disabled: !item.available || loading || pending, run: () => void enqueue(item) },
        { label: "Details", run: () => { trigger.current = document.activeElement as HTMLButtonElement; setDetailId(item.id); } },
        { label: "Save", node: <SaveForLater origin={props.origin} token={props.token} connected={props.connected} reference={{ kind: source === "Library" ? "library" : "jellyfin", id: item.id }} title={item.title} /> },
      ],
    }));
    props.onResults(label, { count: page?.total ?? 0, loading, error: !!error, errorMessage: error ?? undefined, retry: () => void result.refetch(), warning: page?.warning, notice, actionError: actionError ?? undefined, page: page && page.total > pageSize ? { start: offset + 1, end: Math.min(offset + pageSize, page.total), total: page.total, previous: offset && !loading ? () => setOffset(value => Math.max(0, value - pageSize)) : undefined, next: offset + pageSize < page.total && !loading ? () => setOffset(value => value + pageSize) : undefined } : undefined, facets: page?.items.map(facet), hits });
  }, [source, page?.items, page?.total, page?.warning, offset, loading, error, notice, actionError, pending, props.onResults, props.canPlay, props.connected, props.origin, props.token]);
  return <Dialog open={props.active && detail !== null} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (props.active && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}>
    {detail && <><AuthArtwork origin={props.origin} token={props.token} id={detail.artworkId} video={detail.video} className="h-auto aspect-[1.9] w-full" /><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{source} · {detail.detail}</DialogDescription></DialogHeader>{detail.plot && <p className="break-words text-sm">{detail.plot}</p>}{detail.duration !== null && <p className="text-sm">Duration {progressTime(detail.duration)}</p>}{detail.position > 0 && <p className="text-sm">Continue from {progressTime(detail.position)}</p>}{!detail.available && <p role="status">File unavailable. Check the folder in source settings.</p>}{actions(detail)}{source === "Library" && detail.video && props.canManageMetadata && <MetadataEditor key={detail.id} origin={props.origin} token={props.token} id={detail.id} connected={props.connected} onSaved={() => void result.refetch()} />}{notice && <p role="status">{notice}</p>}{actionError && <p role="alert">{actionError}</p>}</>}
  </DialogContent></Dialog>;
}
