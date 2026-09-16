import { useEffect, useRef, useState } from "react";
import { Play, Plus } from "lucide-react";
import { AuthArtwork } from "../../AuthArtwork";
import type { JellyfinItems, JellyfinStatus } from "../../../shared/jellyfin";
import type { LibrarySearch, LibrarySource } from "../../../shared/library";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { progressTime } from "../../HistoryPanel";
import { SaveForLater } from "../../SaveForLater";
import type { Props } from "./SearchPanel";
import type { SearchResultSummary } from "./SearchOnlineResults";
import { useInvalidation } from "./useInvalidation";

type Source = "Library" | "Jellyfin";
type Options = { playNow?: boolean; fromStart?: boolean };
type Result = { artworkId?: string | null; video?: boolean; id: string; title: string; detail: string; plot?: string | null; available: boolean; position: number; duration: number | null; watched: boolean };
type Page = { items: Result[]; total: number; warning?: string };
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Could not search this source.";

export function SearchSource({ source, query, attempt, ...props }: Props & { source: Source; query: string; attempt: number; onResults: (source: string, summary: SearchResultSummary) => void; onChooseSource: (source: string) => void }) {
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const revision = useInvalidation(source === "Library" ? "library" : "jellyfin");
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
  useEffect(() => { props.onResults(source === "Library" ? "TV folders" : source, { count: page?.total ?? 0, loading, error: !!error }); }, [page?.total, loading, error, props.onResults, source]);

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
    };
    void load().then(result => { if (!controller.signal.aborted) { setPage(result); setDetail(current => current ? result.items.find(item => item.id === current.id) ?? null : null); } }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.origin, props.token, props.connected, query, attempt, offset, retry, revision, source]);

  async function enqueue(item: Result, options?: Options) {
    setPending(true); setActionError(null); setNotice("");
    try { if (await props.onEnqueue(source, item.id, options)) setNotice(options?.playNow ? `Starting ${item.title} on the playback computer.` : `Added ${item.title} to the end of Up next. Playback is unchanged.`); }
    catch (reason) { setActionError(message(reason)); }
    finally { setPending(false); }
  }
  const actions = (item: Result) => <div className="flex flex-wrap gap-2">
    <Button aria-label={`${item.position ? "Resume now" : "Play now"}: ${item.title}`} disabled={!props.connected || !props.canPlay || !item.available || loading || pending} onClick={() => void enqueue(item, { playNow: true })}>{item.position ? "Resume now" : "Play now"}</Button>
    {!!item.position && <Button variant="outline" aria-label={`Play ${item.title} from start`} disabled={!props.connected || !props.canPlay || !item.available || loading || pending} onClick={() => void enqueue(item, { playNow: true, fromStart: true })}>From start</Button>}
    <SaveForLater origin={props.origin} token={props.token} connected={props.connected} reference={{ kind: source === "Library" ? "library" : "jellyfin", id: item.id }} title={item.title} />
    <Button variant="secondary" aria-label={`Add to queue: ${item.title}`} disabled={!props.connected || !item.available || loading || pending} onClick={() => void enqueue(item)}>Add to queue</Button>
  </div>;
  return <section className="space-y-3" aria-label={`${source} search results`} aria-busy={loading}>
    <div className="flex items-baseline justify-between gap-3"><h2 className="text-[13px] font-semibold tracking-[.01em] text-muted-foreground">{source === "Library" ? "TV folders" : source}</h2>{page && !loading && <span className="text-[13px] text-muted-foreground">{page.total} result{page.total === 1 ? "" : "s"}</span>}</div>
    {loading && <p className="text-sm text-muted-foreground" role="status"><Spinner className="size-3.5" />Searching {source}…</p>}
    {error && <Alert variant="destructive"><AlertDescription><p>{error}</p><Button variant="outline" disabled={!props.connected || loading} onClick={() => setRetry(value => value + 1)}>Retry {source}</Button></AlertDescription></Alert>}
    {page?.warning && <div className="space-y-2"><p className="text-sm text-muted-foreground" role="status">{page.warning}</p><Button variant="outline" onClick={() => props.onChooseSource("YouTube")}>Search YouTube</Button><Button variant="outline" disabled={!props.connected || loading} onClick={() => setRetry(value => value + 1)}>Refresh {source}</Button></div>}
    {(error || page?.warning) && <div>{props.onManageSources ? <Button variant="outline" onClick={() => props.onManageSources?.(source === "Library" ? "folders" : "jellyfin")}>Source settings</Button> : <p className="text-sm text-muted-foreground">Ask an administrator to manage this source.</p>}</div>}
    {!loading && page?.total === 0 && !page.warning && <p className="text-sm text-muted-foreground">No matches in {source}. Try another title or artist.</p>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    <ul className="m-0 list-none space-y-0.5 p-0">{page?.items.map(item => <li key={item.id} className="-mx-2 flex items-center gap-3.5 rounded-[10px] px-2 py-2.5 hover:bg-muted/55">
      <AuthArtwork origin={props.origin} token={props.token} id={item.artworkId} video={item.video} className="h-[54px] w-[46px] rounded-md" />
      <Button variant="ghost" className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 p-0 text-left leading-normal whitespace-normal" aria-label={`Details for ${item.title}`} onClick={event => { trigger.current = event.currentTarget; setDetail(item); }}><strong className="text-[15px] font-semibold break-words">{item.title}</strong><small className="text-xs text-muted-foreground break-words">{item.detail}{item.watched && " · Watched"}{!item.available && " · File unavailable"}{item.position > 0 && ` · Continue from ${progressTime(item.position)}`}</small></Button>
      <div className="flex flex-wrap items-center gap-1"><Button aria-label={`${item.position ? "Resume now" : "Play now"}: ${item.title}`} disabled={!props.connected || !props.canPlay || !item.available || loading || pending} onClick={() => void enqueue(item, { playNow: true })}><Play aria-hidden="true" />{item.position ? "Resume now" : "Play now"}</Button><Button variant="outline" aria-label={`Add to queue: ${item.title}`} disabled={!props.connected || !item.available || loading || pending} onClick={() => void enqueue(item)}><Plus aria-hidden="true" /><span>Add to queue</span></Button></div>
    </li>)}</ul>
    {page && page.total > pageSize && <nav aria-label={`${source} search pages`} className="flex items-center justify-between gap-2"><Button variant="outline" disabled={!props.connected || loading || !offset} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>Previous</Button><span className="text-sm">{offset + 1}–{Math.min(offset + pageSize, page.total)} of {page.total}</span><Button variant="outline" disabled={!props.connected || loading || offset + pageSize >= page.total} onClick={() => setOffset(value => value + pageSize)}>Next</Button></nav>}
    <Dialog open={props.active && detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (props.active && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}>
      {detail && <><AuthArtwork origin={props.origin} token={props.token} id={detail.artworkId} video={detail.video} className="h-auto aspect-[1.9] w-full" /><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{source} · {detail.detail}</DialogDescription></DialogHeader>{detail.plot && <p className="break-words text-sm">{detail.plot}</p>}{detail.duration !== null && <p className="text-sm">Duration {progressTime(detail.duration)}</p>}{detail.position > 0 && <p className="text-sm">Continue from {progressTime(detail.position)}</p>}{!detail.available && <p role="status">File unavailable. Check the folder in source settings.</p>}{actions(detail)}{notice && <p role="status">{notice}</p>}{actionError && <p role="alert">{actionError}</p>}</>}
    </DialogContent></Dialog>
  </section>;
}
