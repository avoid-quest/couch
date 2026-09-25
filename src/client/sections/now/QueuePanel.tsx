import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useLayoutEffect, useRef, useState } from "react";
import { ListMusic, Play } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Action, QueueEntry, SessionState, VideoQuality } from "../../../shared/protocol";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { reorderedIds, SortableRow, useDndSensors, type RowDrag } from "@/lib/dnd";
import { videoQualityLabels } from "../../video-quality";
import { AddMediaDialog } from "./AddMediaDialog";
import { OpenFileButton } from "./OpenFileButton";
import { QueueActions } from "./QueueActions";
import { SavedPlaylists } from "@/components/SavedPlaylists";
import { formatEndTime } from "@/time-format";
import { type Credentials } from "../../session/session";

type Props = {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  available: boolean;
  nativeHost: boolean;
  defaultQuality: VideoQuality;
  run: (action: Action) => Promise<boolean>;
  presentation?: "legacy" | "standard";
};

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor(value % 3_600 / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(value % 60).padStart(2, "0")}`;
}

function sourceLabel(source: string) {
  try {
    const url = new URL(source.startsWith("web:") ? source.slice(4) : source);
    return { "file:": "Local file", "library:": "Your library", "jellyfin:": "Jellyfin", "radio:": "Radio playlist", "iptv:": "TV guide" }[url.protocol] ?? (url.host || "Media");
  } catch {
    return "Media";
  }
}

// The gesture for one drop, as the session command that persists it: the moved
// entry lands before its new follower, or at the queue's end.
export function queueMoveAction(upNext: QueueEntry[], activeId: string, overId: string): Action | null {
  const next = reorderedIds(upNext, entry => entry.id, activeId, overId);
  if (!next) return null;
  const after = next[next.findIndex(entry => entry.id === activeId) + 1];
  return { type: "move", entryId: activeId, beforeEntryId: after?.id ?? null };
}

export function QueuePanel({ state, credentials, connected, available, nativeHost, defaultQuality, editing = false, run, presentation = "legacy" }: Props & { editing?: boolean }) {
  const [notice, setNotice] = useState("");
  const [keeping, setKeeping] = useState(false);
  const [keptQueue, setKeptQueue] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const focusedEntry = useRef<{ element: HTMLElement; id: string; label: string | null } | null>(null);
  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursorIndex = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const previous = queue.map((entry, index) => ({ entry, index })).filter(({ index }) => index <= cursorIndex && index !== currentIndex);
  const upNext = queue.slice(cursorIndex + 1);
  const upNextKey = upNext.map(entry => entry.id).join(",");
  const isKept = !!upNext.length && keptQueue === upNextKey;
  const sensors = useDndSensors();
  const keepUpNext = async () => {
    if (!connected || keeping || !upNext.length) return;
    setKeeping(true);
    setNotice("");
    try {
      const name = `Up next, ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      const response = await fetch(`${credentials.origin}/api/playlists`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, scope: "upNext" }), signal: AbortSignal.timeout(20_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not keep Up next.");
      setNotice(`Kept ${name} in Saved.`);
      setKeptQueue(upNextKey);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not keep Up next."); }
    finally { setKeeping(false); }
  };
  useLayoutEffect(() => {
    const focused = focusedEntry.current;
    if (!focused || focused.element.isConnected || document.activeElement !== document.body) return;
    const row = [...panelRef.current!.querySelectorAll<HTMLElement>("[data-queue-entry-id]")].find(row => row.dataset.queueEntryId === focused.id);
    const replacement = row?.closest("details:not([open])")?.querySelector<HTMLElement>("summary")
      ?? [...(row?.querySelectorAll<HTMLElement>("button") ?? [])].find(button => button.getAttribute("aria-label") === focused.label)
      ?? panelRef.current!.querySelector<HTMLElement>(".queue-previous summary, .queue-play:not(:disabled)");
    focusedEntry.current = null;
    replacement?.focus({ preventScroll: true });
  });

  const renderEntry = (entry: QueueEntry, index: number, drag?: RowDrag) => {
    const current = entry.id === state?.currentEntryId;
    const ahead = (state?.currentEntryId ? Math.max(0, (state.player.duration ?? queue[currentIndex]?.duration ?? 0) - state.player.position) / (state.player.speed || 1) : 0) + queue.slice(cursorIndex + 1, index).reduce((seconds, item) => seconds + (item.duration ?? 0), 0);
    const label = [sourceLabel(entry.source), entry.live ? "Live" : entry.duration ? duration(entry.duration) : "", index > cursorIndex ? `starts ${formatEndTime(ahead)}` : "", entry.addedBy ? `added by ${entry.addedBy.name}` : "", entry.quality ? videoQualityLabels[entry.quality] : ""].filter(Boolean).join(" · ");
    return <li ref={drag?.setNodeRef} style={drag?.style} className={`queue-entry min-h-[72px] flex-nowrap gap-2.5 px-2 py-2.5 ${current ? "bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))] shadow-[inset_3px_0_var(--primary)]" : ""}`} key={entry.id} data-queue-entry-id={entry.id} aria-current={current ? "true" : undefined}>
      <Button variant="ghost" size="icon" className="queue-play min-h-11 min-w-11 shrink-0" aria-label={`Play ${entry.title}`} disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}><span className="queue-number">{String(index + 1).padStart(2, "0")}</span><Play aria-hidden="true" /></Button>
      {entry.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={entry.artworkId} className="queue-artwork size-12" /> : entry.thumbnail && <MediaArtwork key={entry.thumbnail} thumbnail={entry.thumbnail} title={entry.title} className="queue-artwork size-12" />}
      <div className="queue-entry-copy"><span className="queue-entry-title" title={entry.title}>{entry.title}</span><span className="source-label" title={label}>{current && <span className="queue-current-label">Playing · </span>}{label}</span></div>
      <QueueActions credentials={credentials} entry={entry} index={index} queue={queue} connected={connected} canPlay={available} run={run} />
      {drag?.handle}
    </li>;
  };

  if (presentation === "standard") {
    const current = currentIndex >= 0 ? queue[currentIndex] : null;
    let startsIn = current ? Math.max(0, (state!.player.duration ?? current.duration ?? 0) - state!.player.position) / (state!.player.speed || 1) : 0;
    const doneIn = startsIn + upNext.reduce((seconds, entry) => seconds + (entry.duration ?? 0), 0);
    return <section ref={panelRef} className="queue-panel queue-panel-standard" aria-labelledby="queue-title" onFocusCapture={event => {
      const element = event.target, row = element.closest<HTMLElement>("[data-queue-entry-id]");
      focusedEntry.current = row ? { element, id: row.dataset.queueEntryId!, label: element.getAttribute("aria-label") } : null;
    }}>
      <div className="queue-standard-header"><h2 id="queue-title">Up next</h2><Button variant="ghost" disabled={!connected || !upNext.length || keeping || isKept} onClick={() => void keepUpNext()}>{keeping ? "Keeping…" : isKept ? "Kept in Saved" : "Keep as a list"}</Button></div>
      {state?.queueError && <Alert variant="destructive" className="queue-feedback"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
      {notice && <p className="queue-feedback" role="status">{notice}</p>}
      {upNext.length ? <section className="queue-standard-group" aria-labelledby="queue-next-title"><h3 id="queue-next-title">{upNext.length} to play, done by {formatEndTime(doneIn)}</h3>
        <ol className="queue-standard-list" aria-label="Up next">{upNext.map((entry, index) => {
          const starts = startsIn;
          startsIn += entry.duration ?? 0;
          const meta = [entry.live || entry.duration == null ? "Live" : `${duration(entry.duration)}, starts ${formatEndTime(starts)}`, entry.addedBy && `added by ${entry.addedBy.name}`].filter(Boolean).join(", ");
          return <li className="queue-standard-row" key={entry.id} data-queue-entry-id={entry.id}>
            <Button variant="ghost" className="queue-play queue-standard-entry" disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}><span className="queue-standard-title">{entry.title}</span><span className="queue-standard-meta">{meta}</span></Button>
            <QueueActions credentials={credentials} entry={entry} index={cursorIndex + 1 + index} queue={queue} connected={connected} canPlay={available} run={run} presentation="standard" firstUpcomingIndex={cursorIndex + 1} lastUpcomingIndex={queue.length - 1} />
          </li>;
        })}</ol>
      </section> : <p className="queue-standard-empty">Nothing queued. Use Queue on any result and it plays after this.</p>}
      {previous.length > 0 && <section className="queue-standard-group" aria-labelledby="queue-played-title"><h3 id="queue-played-title">Played</h3><ol className="queue-standard-list" aria-label="Played">{[...previous].reverse().map(({ entry }) => <li key={entry.id}><Button variant="ghost" className="queue-standard-played" disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}>{entry.title}</Button></li>)}</ol></section>}
    </section>;
  }

  return <DndContext sensors={sensors} onDragEnd={({ active, over }: DragEndEvent) => {
    if (!over) return;
    const action = queueMoveAction(upNext, String(active.id), String(over.id));
    if (action) void run(action);
  }}><section ref={panelRef} className="queue-panel min-w-0" aria-labelledby="queue-title" onFocusCapture={event => {
    const element = event.target, row = element.closest<HTMLElement>("[data-queue-entry-id]");
    focusedEntry.current = row ? { element, id: row.dataset.queueEntryId!, label: element.getAttribute("aria-label") } : null;
  }}>
    <div className="queue-header flex flex-wrap items-center justify-between gap-4 border-b p-5 max-[480px]:gap-3.5 max-[480px]:p-4">
      <div className="queue-heading min-w-0"><h2 id="queue-title" className="flex items-center gap-1">Play queue <span className="count">{queue.length}</span></h2><p className="mt-1 text-sm leading-normal text-muted-foreground">Everyone can choose what plays next.</p></div>
      <div className="queue-header-actions flex flex-wrap items-center gap-2 max-[480px]:w-full [&>button]:min-h-11">
        <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.playlistVersion ?? 0} queueCount={queue.length} />
        {nativeHost && <OpenFileButton connected={connected} run={async action => { const ok = await run(action); if (ok) setNotice("Added to the queue."); return ok; }} />}
        <AddMediaDialog credentials={credentials} connected={connected} defaultQuality={defaultQuality} run={async action => { const ok = await run(action); if (ok) setNotice("Added to the queue."); return ok; }} />
      </div>
    </div>
    {state?.queueError && <Alert variant="destructive" className="queue-feedback mx-5 my-3 w-auto"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
    {notice && <p className="queue-feedback queue-notice mx-5 my-3 w-auto break-words text-sm text-primary" role="status">{notice}</p>}
    {queue.length ? <>
      {currentIndex >= 0 && <section className="queue-group border-t" aria-labelledby="queue-current-title"><h3 className="px-5 pt-4 pb-2 text-[0.95rem]"><span id="queue-current-title">Current item</span></h3><ol className="queue-list max-h-none overflow-visible p-2" aria-label="Current item">{renderEntry(queue[currentIndex]!, currentIndex)}</ol></section>}
      <section className="queue-group border-t" aria-labelledby="queue-next-title"><h3 className="px-5 pt-4 pb-2 text-[0.95rem]"><span id="queue-next-title">Up next <span className="count">{queue.length - cursorIndex - 1}</span></span></h3>
        {upNext.length ? <ol className="queue-list max-h-none overflow-visible p-2" aria-label="Up next"><SortableContext items={upNext.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
          {upNext.map((entry, index) => <SortableRow key={entry.id} id={entry.id} label={`Reorder ${entry.title}`} editing={editing}>{drag => renderEntry(entry, cursorIndex + 1 + index, drag)}</SortableRow>)}
        </SortableContext></ol> : <p className="queue-group-empty px-5 pt-2 pb-5 text-sm text-muted-foreground">Nothing queued next. Add something to keep watching or listening.</p>}
      </section>
      {previous.length > 0 && <details className="queue-group queue-previous border-t"><summary tabIndex={0} className="min-h-12 cursor-pointer px-5 pt-4 pb-2 text-[0.95rem] focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary">Previously queued <span className="count">{previous.length}</span></summary><ol className="queue-list max-h-none overflow-visible p-2" aria-label="Previously queued">{previous.map(({ entry, index }) => renderEntry(entry, index))}</ol></details>}
    </> : <div className="queue-empty grid justify-items-center gap-2 px-6 py-11 text-center max-[480px]:px-5 max-[480px]:py-8"><ListMusic aria-hidden="true" className="mb-2 size-[30px] text-primary" /><h3>What should play first?</h3><p className="max-w-80 text-[0.9rem] leading-relaxed text-muted-foreground">Browse your library, find a station, or add a link.</p></div>}
  </section></DndContext>;
}
