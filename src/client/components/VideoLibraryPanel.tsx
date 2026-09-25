import { MetadataEditor } from "./MetadataEditor";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Play, Plus, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LibraryItem, LibrarySearch, VideoSeason, VideoShow, VideoShows } from "../../shared/library";
import { AuthArtwork } from "./AuthArtwork";
import { ProgressActions, progressTime } from "./HistoryPanel";

const pageSize = 24;
type Browse = { kind: "movies" | "shows"; q: string; offset: number }
  | { kind: "seasons"; show: VideoShow; q: string; offset: number }
  | { kind: "episodes"; show: VideoShow; season: number | null; q: string; offset: number };
const seasonTitle = (season: number | null) => season === null ? "Unnumbered" : season === 0 ? "Specials" : `Season ${season}`;
const episodeLabel = (item: LibraryItem) => item.video?.episode === null ? "Unnumbered episode" : `Episode ${item.video?.episode}`;

export function VideoLibraryPanel({ origin, token, connected, canPlay, canManage, version, view, active, onEnqueue }: {
  origin: string; token: string; connected: boolean; canPlay: boolean; canManage: boolean; version: number; view: "movies" | "shows"; active: boolean;
  onEnqueue: (id: string, options?: { playNow?: boolean; fromStart?: boolean }) => Promise<boolean>;
}) {
  const [browse, setBrowse] = useState<Browse>({ kind: view, q: "", offset: 0 });
  const [trail, setTrail] = useState<Array<{ browse: Browse; draft: string; focus: string; scrollTop: number; scrollLeft: number }>>([]);
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<LibrarySearch | null>(null);
  const [shows, setShows] = useState<VideoShows | null>(null);
  const [seasons, setSeasons] = useState<VideoSeason[]>([]);
  const [detail, setDetail] = useState<LibraryItem | null>(null);
  const [dataPath, setDataPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const restoreFocus = useRef<string | null>(null);
  const restoreScroll = useRef<{ scrollTop: number; scrollLeft: number } | null>(null);
  const scrollContainer = () => panel.current?.closest(".tv-browser") ?? document.scrollingElement;
  const detailTrigger = useRef<HTMLElement | null>(null);
  const queryId = useId();
  const showId = "show" in browse ? browse.show.id : null;
  const params = new URLSearchParams({ q: browse.q, offset: String(browse.offset), limit: String(pageSize) });
  if (browse.kind === "movies") params.set("videoType", "movie");
  if (browse.kind === "episodes") { params.set("showId", browse.show.id); params.set("season", browse.season === null ? "unknown" : String(browse.season)); }
  const path = browse.kind === "seasons" ? `/api/library/video/shows/${browse.show.id}/seasons`
    : browse.kind === "shows" ? `/api/library/video/shows?${params}` : `/api/library/items?${params}`;
  const busy = dataPath !== path;

  useEffect(() => {
    if (!active || !connected) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    const read = async (path: string) => {
      const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load your video library.");
      return result;
    };
    void Promise.all([read(path), showId ? read(`/api/library/items?showId=${showId}&limit=1`) : null]).then(([result, selected]) => {
      if (controller.signal.aborted) return;
      if (showId) {
        const show: VideoShow | undefined = selected?.items[0]?.video?.show;
        if (!show || show.id !== showId) throw new Error("This show is no longer in the library.");
        setBrowse(previous => "show" in previous && previous.show.id === show.id ? { ...previous, show } : previous);
        setTrail(previous => previous.map(entry => "show" in entry.browse && entry.browse.show.id === show.id ? { ...entry, browse: { ...entry.browse, show } } : entry));
      }
      if (browse.kind === "shows") setShows(result);
      else if (browse.kind === "seasons") setSeasons(result.items);
      else {
        setItems(result);
        setDetail(previous => previous ? result.items.find((item: LibraryItem) => item.id === previous.id) ?? previous : null);
      }
      setDataPath(path);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your video library."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, active, connected, path, browse.kind, showId, version, refresh]);

  useEffect(() => {
    if (busy || loading || !active || !restoreFocus.current || panel.current?.closest("[hidden]")) return;
    if (document.querySelector('[role="dialog"], [role="listbox"], [data-slot="popover-content"]')) return;
    panel.current?.querySelector<HTMLButtonElement>(restoreFocus.current)?.focus({ preventScroll: restoreScroll.current !== null });
    const container = scrollContainer();
    if (container && restoreScroll.current) {
      container.scrollTop = restoreScroll.current.scrollTop;
      container.scrollLeft = restoreScroll.current.scrollLeft;
    }
    restoreScroll.current = null;
    restoreFocus.current = null;
  }, [busy, loading, active, dataPath]);

  const open = (next: Browse, focus: string) => {
    const container = scrollContainer();
    setTrail(value => [...value, { browse, draft, focus, scrollTop: container?.scrollTop ?? 0, scrollLeft: container?.scrollLeft ?? 0 }]);
    setBrowse(next); setDraft(""); setNotice(null); setError(null); restoreFocus.current = "[data-back]";
  };
  const back = () => {
    const previous = trail.at(-1);
    if (!previous) return;
    setBrowse(previous.browse); setDraft(previous.draft); setTrail(value => value.slice(0, -1)); setNotice(null); setError(null); restoreFocus.current = previous.focus; restoreScroll.current = previous;
  };
  const search = (event: FormEvent) => { event.preventDefault(); setBrowse(value => ({ ...value, q: draft.trim(), offset: 0 })); setRefresh(value => value + 1); };
  const enqueue = async (item: LibraryItem, options?: { playNow?: boolean; fromStart?: boolean }) => {
    setPending(true); setError(null); setNotice(null);
    try { if (await onEnqueue(item.id, options)) setNotice(options?.playNow ? `Starting ${item.title} on the TV.` : `Added ${item.title} to Up next.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add this video."); }
    finally { setPending(false); }
  };
  const openDetail = (item: LibraryItem, trigger: HTMLElement) => { detailTrigger.current = trigger; setDetail(item); };
  const actions = (item: LibraryItem) => <div className="mt-auto flex flex-wrap gap-2 [&>button]:flex-auto @max-[360px]/catalog:[&>button]:basis-full">
    <Button aria-label={`${item.progress?.position ? "Resume" : "Play"} ${item.title}`} disabled={!connected || !canPlay || !item.available || busy || loading || pending} onClick={() => void enqueue(item, { playNow: true })}><Play aria-hidden="true" />{item.progress?.position ? "Resume" : "Play"}</Button>
    {!!item.progress?.position && <Button variant="outline" aria-label={`Play ${item.title} from start`} disabled={!connected || !canPlay || !item.available || busy || loading || pending} onClick={() => void enqueue(item, { playNow: true, fromStart: true })}><RotateCcw aria-hidden="true" />From start</Button>}
    <Button variant="secondary" aria-label={`Up next: ${item.title}`} disabled={!connected || !item.available || busy || loading || pending} onClick={() => void enqueue(item)}><Plus aria-hidden="true" />Up next</Button>
  </div>;
  const progress = (item: LibraryItem) => <ProgressActions origin={origin} token={token} connected={connected} mediaId={`library:${item.id}`} title={item.title} progress={item.progress} onUpdated={() => setRefresh(value => value + 1)} />;
  const summary = (item: LibraryItem) => <>
    <p className="text-sm text-muted-foreground">{[browse.kind === "episodes" ? episodeLabel(item) : item.video?.year, item.duration !== null ? progressTime(item.duration) : null].filter(value => value !== null && value !== undefined).join(" · ")}{!item.available && " · File unavailable"}</p>
    {item.progress?.watched && <Badge variant="secondary"><Check aria-hidden="true" />Watched</Badge>}
    {!!item.progress?.position && <p className="text-xs text-primary">Continue from {progressTime(item.progress.position)}</p>}
  </>;
  const show = "show" in browse ? browse.show : null;
  const total = browse.kind === "seasons" ? seasons.length : browse.kind === "shows" ? shows?.total ?? 0 : items?.total ?? 0;
  const searchLabel = `Search ${browse.kind === "episodes" ? "episodes" : view}`;

  return <section ref={panel} className="@container/catalog min-w-0 space-y-4" aria-label={view === "movies" ? "Movie library" : "Show library"} aria-busy={active && loading}>
    <div className="flex flex-wrap items-center gap-3">
      {!!trail.length && <Button data-back variant="ghost" onClick={back}><ArrowLeft aria-hidden="true" />Back</Button>}
      <div className="min-w-0 flex-1"><h3 className="break-words text-xl font-semibold">{show?.title ?? (view === "movies" ? "Movies" : "Shows")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{browse.kind === "episodes" ? `${seasonTitle(browse.season)} · In episode order` : browse.kind === "seasons" ? "Choose a season" : "From your library folders"}</p></div>
    </div>
    {browse.kind === "seasons" && show && <div className="grid gap-3 border-b pb-4 empty:hidden">
      {show.fanartId && <AuthArtwork origin={origin} token={token} id={show.fanartId} video className="aspect-video h-auto max-h-60 w-full [&>img]:object-cover" />}
      {(show.originalTitle || show.premiered || show.year) && <p className="break-words text-sm text-muted-foreground">{[show.originalTitle, show.premiered ?? show.year].filter(Boolean).join(" · ")}</p>}
      {!!show.genres.length && <p className="text-sm text-muted-foreground">{show.genres.join(" · ")}</p>}
      {show.plot && <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{show.plot}</p>}
    </div>}
    {browse.kind !== "seasons" && <form role="search" className="flex items-end gap-2" onSubmit={search}>
      <div className="min-w-0 flex-1"><Label htmlFor={queryId} className="sr-only">{searchLabel}</Label><Input id={queryId} type="search" aria-label={searchLabel} placeholder={searchLabel} value={draft} maxLength={200} disabled={!connected} onChange={event => setDraft(event.target.value)} /></div>
      <Button type="submit" variant="secondary" size="icon" aria-label="Search" disabled={!connected || loading}><Search aria-hidden="true" /></Button>
    </form>}
    {error && <div role="alert" className="grid gap-3 border-l-2 border-destructive py-2 pl-3 text-destructive"><p>{error}</p><Button variant="outline" className="justify-self-start" disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}>Try again</Button></div>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {!connected && <p className="text-sm text-muted-foreground" role="status">Reconnect to this TV to browse and play videos.</p>}
    {busy && connected && !error && <p role="status" className="text-sm text-muted-foreground">Loading library…</p>}
    {!busy && <p className="text-sm text-muted-foreground" aria-live="polite">{total} {browse.kind}</p>}
    {!busy && total === 0 && <p className="border-t pt-5 text-sm text-muted-foreground">{browse.q ? "No matching videos. Try another title." : "Add a video folder on the TV, or scan an existing folder again."}</p>}
    {!busy && browse.kind === "shows" && <ul className="grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,10rem),1fr))] @max-[360px]/catalog:grid-cols-2 @max-[360px]/catalog:gap-2">{shows?.items.map(item => <li key={item.id} className="min-w-0"><Button variant="ghost" className="h-auto w-full min-w-0 flex-col items-stretch justify-start gap-2 whitespace-normal p-1 text-left" data-video-show={item.id} aria-label={`Browse ${item.title} seasons`} onClick={() => open({ kind: "seasons", show: item, q: "", offset: 0 }, `[data-video-show="${item.id}"]`)} disabled={!connected}>
      <AuthArtwork origin={origin} token={token} id={item.artworkId} video className="aspect-[2/3] h-auto w-full [&>svg]:size-[30%] [&>svg]:max-h-14 [&>svg]:max-w-14 [&>svg]:opacity-55" /><strong className="wrap-anywhere text-base leading-[1.4] @max-[360px]/catalog:text-sm">{item.title}</strong><span className="text-sm font-normal text-muted-foreground">{item.seasonCount} seasons · {item.episodeCount} episodes</span>
    </Button></li>)}</ul>}
    {!busy && browse.kind === "seasons" && <ul className="grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,10rem),1fr))] @max-[360px]/catalog:grid-cols-2 @max-[360px]/catalog:gap-2">{seasons.map(item => <li key={item.season ?? "unknown"} className="min-w-0"><Button variant="ghost" className="h-auto w-full min-w-0 flex-col items-stretch justify-start gap-2 whitespace-normal p-1 text-left" data-video-season={item.season ?? "unknown"} aria-label={`Browse ${seasonTitle(item.season)}`} onClick={() => open({ kind: "episodes", show: browse.show, season: item.season, q: "", offset: 0 }, `[data-video-season="${item.season ?? "unknown"}"]`)} disabled={!connected}>
      <AuthArtwork origin={origin} token={token} id={item.artworkId} video className="aspect-[2/3] h-auto w-full [&>svg]:size-[30%] [&>svg]:max-h-14 [&>svg]:max-w-14 [&>svg]:opacity-55" /><strong className="wrap-anywhere text-base leading-[1.4] @max-[360px]/catalog:text-sm">{seasonTitle(item.season)}</strong><span className="text-sm font-normal text-muted-foreground">{item.episodeCount} episodes</span>
    </Button></li>)}</ul>}
    {!busy && browse.kind === "movies" && <ul className="divide-y">{items?.items.map(item => <li key={item.id} className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-start gap-4 py-3" data-video-item={item.id} data-nav-row>
      <Button variant="ghost" className="h-auto w-full min-w-0 flex-col items-stretch justify-start gap-2 whitespace-normal p-0 text-left" aria-label={`Details for ${item.title}`} onClick={event => openDetail(item, event.currentTarget)}>
        <AuthArtwork origin={origin} token={token} id={item.artworkId} video className="aspect-[2/3] h-auto w-full [&>svg]:size-[30%] [&>svg]:max-h-14 [&>svg]:max-w-14 [&>svg]:opacity-55" /><strong className="sr-only">{item.title}</strong>
      </Button>
      <div className="grid min-w-0 gap-3"><Button variant="link" className="h-auto w-fit justify-start p-0 text-left text-base whitespace-normal wrap-anywhere" onClick={event => openDetail(item, event.currentTarget)}>{item.title}</Button><div className="flex items-start justify-between gap-2"><div className="space-y-1">{summary(item)}</div>{progress(item)}</div>{actions(item)}</div>
    </li>)}</ul>}
    {!busy && browse.kind === "episodes" && <ul className="divide-y">{items?.items.map(item => <li key={item.id} className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 py-3 @min-[760px]/catalog:grid-cols-[minmax(0,1fr)_auto]" data-video-item={item.id} data-nav-row>
      <div className="flex min-w-0 items-center gap-3"><AuthArtwork origin={origin} token={token} id={item.artworkId} video className="aspect-video h-auto w-20 @max-[360px]/catalog:w-14" />
        <div className="min-w-0 flex-1 space-y-1"><Button variant="link" className="h-auto justify-start p-0 text-left text-base whitespace-normal wrap-anywhere" aria-label={`Details for ${item.title}`} onClick={event => openDetail(item, event.currentTarget)}>{item.title}</Button>{summary(item)}</div>{progress(item)}</div>
      <div className="flex flex-wrap items-center gap-2 @min-[760px]/catalog:justify-end [&>button]:px-3 [&>button]:text-sm @max-[420px]/catalog:[&>button]:grow">{actions(item)}</div>
    </li>)}</ul>}
    {!busy && browse.kind !== "seasons" && total > pageSize && <nav className="flex items-center justify-between gap-2" aria-label="Video library pages">
      <Button variant="outline" disabled={!connected || loading || browse.offset === 0} onClick={() => setBrowse(value => ({ ...value, offset: Math.max(0, value.offset - pageSize) }))}>Previous</Button>
      <span className="text-sm text-muted-foreground">{browse.offset + 1}–{Math.min(browse.offset + pageSize, total)} of {total}</span>
      <Button variant="outline" disabled={!connected || loading || browse.offset + pageSize >= total} onClick={() => setBrowse(value => ({ ...value, offset: value.offset + pageSize }))}>Next</Button>
    </nav>}
    <Dialog open={active && detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}>
      <DialogContent className="video-detail" onCloseAutoFocus={event => { event.preventDefault(); if (active && detailTrigger.current?.isConnected) detailTrigger.current.focus(); }}>
        {detail && <><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{[detail.video?.show?.title, detail.video?.year, detail.video?.genres.join(" · ")].filter(Boolean).join(" · ") || "From your library folders"}</DialogDescription></DialogHeader>
          {detail.video?.fanartId && <AuthArtwork origin={origin} token={token} id={detail.video.fanartId} video className="aspect-video h-auto max-h-60 w-full [&>img]:object-cover" />}
          {detail.video?.originalTitle && detail.video.originalTitle !== detail.title && <p className="break-words text-sm text-muted-foreground">Original title: {detail.video.originalTitle}</p>}
          {detail.video?.premiered && <p className="text-sm text-muted-foreground">{detail.video.type === "episode" ? "Aired" : "Released"} {detail.video.premiered}</p>}
          <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed">{detail.video?.plot || "No description in this video's NFO."}</p>
          {canManage && <MetadataEditor key={detail.id} origin={origin} token={token} id={detail.id} connected={connected} onSaved={() => setRefresh(value => value + 1)} />}
          {summary(detail)}{actions(detail)}{notice && <p className="text-sm text-primary" role="status">{notice}</p>}{error && <p role="alert" className="border-l-2 border-destructive py-2 pl-3 text-destructive">{error}</p>}
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
