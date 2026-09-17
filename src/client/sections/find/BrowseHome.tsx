import { useEffect, useRef, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronRight, Film, Play, Plus, Radio, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { HistoryItem, LibraryItem } from "../../../shared/library";
import type { ProviderId } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import type { SessionState } from "../../../shared/protocol";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { LiveNow } from "../now/LiveNow";
import { ForLaterSection } from "../saved/ForLaterSection";
import { Eye, EyeOff } from "lucide-react";
import { SortableRow, useDndSensors } from "../../lib/dnd";
import { findSectionIds, findSectionLabels, type FindSectionId } from "../../find-sections";
import { ProgressActions, progressTime, type HistoryPlayback } from "@/components/HistoryPanel";
import type { Credentials } from "../../session/session";
import { SaveForLater } from "@/components/SaveForLater";

const asHistory = (item: LibraryItem): HistoryItem => ({
  mediaId: `library:${item.id}`, libraryItemId: item.id, title: item.title,
  position: item.progress?.position ?? 0, duration: item.progress?.duration ?? item.duration,
  watched: item.progress?.watched ?? false, lastPlayedAt: item.progress?.lastPlayedAt ?? null,
});

export function BrowseHome({ state, credentials, connected, canPlay, active, onBrowse, onProvider, onAddSource, onPlay, onAdd, recentRadio, onRadio, editing = false, order, hiddenSections = [], onToggleSection, onMoveSection }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  playing: boolean;
  active: boolean;
  onBrowse: (section: string) => void;
  onProvider?: (provider: ProviderId) => void;
  onAddSource?: () => void;
  onPlay: HistoryPlayback;
  onAdd: (item: HistoryItem) => Promise<boolean>;
  recentRadio?: RadioStation[];
  onRadio?: (station: RadioStation) => Promise<boolean>;
  editing?: boolean;
  order?: FindSectionId[];
  hiddenSections?: FindSectionId[];
  onToggleSection?: (id: FindSectionId) => void;
  onMoveSection?: (activeId: string, overId: string) => void;
}) {
  const { origin, token } = credentials;
  const profileId = state?.activeProfile.id;
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [loadedProfile, setLoadedProfile] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => { setDetailId(null); setNotice(null); }, [origin, token, profileId]);

  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    const read = async (path: string) => {
      const response = await fetch(`${origin}${path}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load your media.");
      return result;
    };
    void Promise.allSettled([read("/api/progress/history?limit=40"), read("/api/library/items?limit=24")]).then(([recent, catalog]) => {
      if (controller.signal.aborted) return;
      setHistory(recent.status === "fulfilled" ? recent.value.items : []);
      setLibrary(catalog.status === "fulfilled" ? catalog.value.items : []);
      const failures = [recent, catalog].filter(result => result.status === "rejected");
      setError(failures.map(result => result.reason instanceof Error ? result.reason.message : "Could not load your media.").filter((message, index, all) => all.indexOf(message) === index).join(" ") || null);
      setLoadedProfile(profileId); setLoading(false);
    });
    return () => controller.abort();
  }, [origin, token, connected, active, profileId, state?.libraryVersion, refresh]);

  const currentProfile = loadedProfile === profileId;
  const unfinished = currentProfile ? history.filter(item => item.position > 0 && !item.watched) : [];
  const hero = unfinished[0];
  const cards = currentProfile ? library.filter(item => item.id !== hero?.libraryItemId).slice(0, 3) : [];
  const metadata = (item: HistoryItem) => library.find(entry => entry.id === item.libraryItemId);
  const playable = (item: HistoryItem) => connected && canPlay && currentProfile && !loading && !pending && !!(item.playable || item.libraryItemId || item.queueEntryId) && metadata(item)?.available !== false;
  const openDetail = (item: HistoryItem, trigger: HTMLElement) => { detailTrigger.current = trigger; setDetailId(item.mediaId); };
  const play = async (item: HistoryItem, fromStart = false) => {
    setPending(true); setNotice(null); setError(null);
    try {
      if (await onPlay(item, { fromStart })) { setNotice(`${fromStart || !item.position ? "Starting" : "Resuming"} ${item.title} on the playback computer.`); setDetailId(null); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not play this item."); }
    finally { setPending(false); }
  };
  const add = async (item: HistoryItem) => {
    setPending(true); setNotice(null); setError(null);
    try { if (await onAdd(item)) setNotice(`Added ${item.title} to Up next.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add this item to Up next."); }
    finally { setPending(false); }
  };
  const artwork = (item: HistoryItem, className = "") => {
    const media = metadata(item);
    const id = media?.video?.fanartId || media?.artworkId || item.artworkId;
    return <span className={`media-frame ${className}`}>
      {id ? <AuthArtwork origin={origin} token={token} id={id} video={media?.kind !== "audio"} className="absolute inset-0 size-full rounded-[inherit] object-cover" /> : item.thumbnail ? <MediaArtwork thumbnail={item.thumbnail} title={item.title} className="absolute inset-0 size-full rounded-[inherit] object-cover" /> : <><Film aria-hidden="true" /><span>{item.title}</span></>}
      {item.position > 0 && !!item.duration && <span className="absolute inset-x-0 bottom-0 z-[1] h-[3px] bg-white/15" aria-label={`${Math.round(Math.min(1, item.position / item.duration) * 100)}% watched`}><i style={{ width: `${Math.min(1, item.position / item.duration) * 100}%` }} /></span>}
    </span>;
  };
  const playbackActions = (item: HistoryItem) => <div className="mt-3 flex flex-wrap gap-1">
    <Button disabled={!playable(item)} aria-label={`${item.position ? "Resume" : item.watched ? "Play again" : "Play now"} ${item.title}`} onClick={() => void play(item)}><Play aria-hidden="true" />{pending ? "Starting…" : item.position ? "Resume" : item.watched ? "Play again" : "Play now"}</Button>
    {item.position > 0 && <Button variant="outline" disabled={!playable(item)} aria-label={`Play ${item.title} from start`} onClick={() => void play(item, true)}><RotateCcw aria-hidden="true" />From start</Button>}
    {item.libraryItemId && <Button variant="outline" disabled={!connected || !currentProfile || loading || pending || metadata(item)?.available === false} aria-label={`Add to queue: ${item.title}`} onClick={() => void add(item)}><Plus aria-hidden="true" />Add to queue</Button>}
    {(item.libraryItemId || item.queueEntryId) && <SaveForLater origin={origin} token={token} connected={connected && currentProfile && !loading} reference={item.libraryItemId ? { kind: "library", id: item.libraryItemId } : { kind: "queue", id: item.queueEntryId! }} title={item.title} />}
  </div>;
  const radioArt = (station: RadioStation) => <span className="relative grid aspect-[.85] place-items-center overflow-hidden rounded-xl bg-muted from-emerald-800 to-slate-900 bg-gradient-to-br p-3.5 text-center text-2xl font-semibold">
    {station.logoUrl ? <MediaArtwork thumbnail={station.logoUrl} title={station.name} className="absolute inset-0 size-full rounded-[inherit] object-cover" /> : <><Radio aria-hidden="true" /><span>{station.name}</span></>}
  </span>;
  const radioCards = !!recentRadio?.length && onRadio && <>{recentRadio.map(station => <li key={`radio:${station.id}`}>
    <button type="button" className="flex min-w-0 flex-col items-start gap-1 rounded-xl text-left" aria-label={`Play now: ${station.name}`} disabled={!connected || !canPlay} onClick={() => void onRadio!(station)}>
      {radioArt(station)}<strong className="mt-1.5 text-sm font-semibold break-words">{station.name}</strong><small>Radio station</small>
    </button>
  </li>)}</>;
  const detailLibrary = library.find(item => `library:${item.id}` === detailId);
  const detail = currentProfile ? history.find(item => item.mediaId === detailId) ?? (detailLibrary ? asHistory(detailLibrary) : null) : null;
  const selected = detail && metadata(detail);

  const sectionsById: Partial<Record<FindSectionId, React.ReactNode>> = {
    continue: hero ? <>{hero && <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold tracking-tight">Continue playing</h2></div>}
      <section className="relative min-h-[280px] overflow-hidden rounded-2xl bg-card p-6" aria-label="Continue watching">
        {artwork(hero, "browse-hero-art")}
        <div className="relative z-[1] max-w-[36rem]"><p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">{hero.sourceLabel || (hero.libraryItemId ? "TV folders" : "Recently played")}</p><h2 className="mt-2 text-3xl font-semibold leading-tight tracking-tight break-words md:text-4xl">{hero.title}</h2><p className="mt-2 text-sm text-muted-foreground">{progressTime(hero.position)} watched{hero.duration ? ` of ${progressTime(hero.duration)}` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-1"><Button disabled={!playable(hero)} aria-label={`Resume ${hero.title}`} onClick={() => void play(hero)}><Play aria-hidden="true" />{pending ? "Starting…" : "Resume"}</Button><Button variant="outline" onClick={event => openDetail(hero, event.currentTarget)}>Details</Button></div>
        </div>
      </section></> : null,
    recent: currentProfile && (history.some(item => item.mediaId !== hero?.mediaId) || !!recentRadio?.length) ? <section aria-label="Recently played">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold tracking-tight">Recently played</h2></div>
      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-3 md:gap-[18px]">{radioCards}{history.filter(item => item.mediaId !== hero?.mediaId).map(item => <li key={item.mediaId}>
        <button type="button" className="flex min-w-0 flex-col items-start gap-1 rounded-xl text-left" aria-label={`Details for ${item.title}`} onClick={event => openDetail(item, event.currentTarget)}>
          {artwork(item)}<strong className="mt-1.5 text-sm font-semibold break-words">{item.title}</strong><small className="text-xs leading-relaxed text-muted-foreground">{item.position > 0 ? `Continue at ${progressTime(item.position)}` : item.watched ? "Finished" : item.sourceLabel || "Played"}</small>
        </button>{playbackActions(item)}
      </li>)}</ul>
    </section> : null,
    folders: !!cards.length ? <><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold tracking-tight">TV folders</h2>{onAddSource && <Button variant="ghost" onClick={onAddSource}><Plus aria-hidden="true" />Add source</Button>}{onBrowse && <Button variant="ghost" onClick={() => onBrowse("Files")}>View all<ChevronRight aria-hidden="true" /></Button>}</div>
      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-3 md:gap-[18px]">{cards.map(item => {
        const entry = asHistory(item);
        return <li key={item.id}><button type="button" className="flex min-w-0 flex-col items-start gap-1 rounded-xl text-left" aria-label={`Details for ${item.title}`} onClick={event => openDetail(entry, event.currentTarget)}>{artwork(entry)}<strong className="mt-1.5 text-sm font-semibold break-words">{item.title}</strong><small className="text-xs leading-relaxed text-muted-foreground">{[item.video?.year, item.kind === "audio" ? item.artist || "Music" : item.video?.show?.title || "Local video", !item.available ? "File unavailable" : item.progress?.watched ? "Watched" : item.progress?.position ? `Resume at ${progressTime(item.progress.position)}` : null].filter(Boolean).join(" · ")}</small></button>{playbackActions(entry)}</li>;
      })}</ul></> : null,
    sources: onAddSource ? <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold tracking-tight">Sources</h2><Button variant="ghost" onClick={onAddSource}><Plus aria-hidden="true" />Add source</Button></div> : null,
    radio: onRadio ? <LiveNow rail limit={8} heading="Live radio" credentials={credentials} connected={connected} canPlay={canPlay} onEnqueue={onRadio} active={active} /> : null,
    forlater: active ? <ForLaterSection origin={origin} token={token} connected={connected} canPlay={canPlay} onFind={() => onBrowse("Search")} /> : null,
  };
  const sensors = useDndSensors();
  const sectionOrder = order ?? [...findSectionIds];

  return <section className="min-w-0" aria-label="Browse and resume">
    {error && <Alert variant="destructive"><AlertDescription>{error}<Button variant="outline" disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}>Try again</Button></AlertDescription></Alert>}
    {notice && <p role="status" className="mb-4 text-[13px] text-[#d3c7a5]">{notice}</p>}
    {loading && connected && <p role="status" className="flex items-center gap-2 text-xs leading-relaxed text-muted-foreground"><Spinner className="size-3.5" />Loading your media…</p>}
    <DndContext sensors={sensors} onDragEnd={event => {
      if (!event.over) return;
      onMoveSection?.(String(event.active.id), String(event.over.id));
    }}>
      <SortableContext items={sectionOrder}>
        {sectionOrder.map(id => {
          const node = sectionsById[id];
          const isHidden = hiddenSections.includes(id);
          if (!node && !(isHidden && editing)) return null;
          if (isHidden && !editing) return null;
          return <SortableRow key={id} id={id} label={`Reorder ${findSectionLabels[id]}`} editing={editing && !!node}>{drag => <div ref={drag.setNodeRef} style={drag.style} className="relative mb-6">
            {isHidden || !node
              ? <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-dashed p-4 text-muted-foreground"><span>{findSectionLabels[id]}</span>{node && editing && <Button variant="ghost" aria-label={`Show ${findSectionLabels[id]}`} onClick={() => onToggleSection?.(id)}><Eye aria-hidden="true" />Show</Button>}</div>
              : <>{node}{editing && <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-xl bg-card/80 p-1 backdrop-blur"><Button variant="ghost" size="icon" aria-label={`Hide ${findSectionLabels[id]}`} onClick={() => onToggleSection?.(id)}><EyeOff aria-hidden="true" /></Button>{drag.handle}</div>}</>}
          </div>}</SortableRow>;
        })}
      </SortableContext>
    </DndContext>
    <Dialog open={active && !!detail} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (active && detailTrigger.current?.isConnected) detailTrigger.current.focus(); }}>
      {detail && <>{artwork(detail)}<DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{[selected?.video?.year, selected?.video?.genres.join(" · "), selected?.artist].filter(Boolean).join(" · ") || detail.sourceLabel || (detail.libraryItemId ? "TV folders" : "Recently played")}</DialogDescription></DialogHeader>
        {selected?.video?.plot && <p>{selected.video.plot}</p>}
        {detail.playedBy && <p className="text-xs leading-relaxed text-muted-foreground">Started from {detail.playedBy.name}</p>}
        {detail.position > 0 && <p className="text-xs leading-relaxed text-muted-foreground">Continue from {progressTime(detail.position)}{detail.duration ? ` of ${progressTime(detail.duration)}` : ""}</p>}
        {!detail.playable && !detail.libraryItemId && !detail.queueEntryId && <p>Open this file again on the TV to play it. Your resume point is saved.</p>}
        {selected?.available === false && <p>This file is unavailable. Check its TV folder.</p>}
        {playbackActions(detail)}
        <ProgressActions origin={origin} token={token} connected={connected && currentProfile && !loading} mediaId={detail.mediaId} title={detail.title} progress={detail} onUpdated={() => setRefresh(value => value + 1)} />
        {notice && <p role="status" className="mb-4 text-[13px] text-[#d3c7a5]">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </>}
    </DialogContent></Dialog>
  </section>;
}
