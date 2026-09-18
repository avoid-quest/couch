import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, ChevronRight, Eye, Play, Search, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { reorderedIds, SortableRow, useDndSensors } from "../../lib/dnd";
import type { Action, SessionState } from "../../../shared/protocol";
import { AuthArtwork } from "@/components/AuthArtwork";
import { PlaybackControls, sourceLabel } from "@/components/PlaybackControls";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { MediaArtwork } from "@/components/MediaArtwork";
import type { Credentials } from "../../session/session";
import { cn } from "cn";

export function NowPlaying({ state, credentials, connected, run, onBack, onBrowse, onRemote, active = true, embedded = false, part = "both" }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  onBack?: () => void;
  onBrowse?: (section: string) => void;
  onRemote?: () => void;
  active?: boolean;
  embedded?: boolean;
  part?: "current" | "next" | "both";
}) {
  const panel = useRef<HTMLElement | null>(null);
  const back = useRef<HTMLButtonElement | null>(null);
  const focused = useRef<{ element: HTMLElement; queueIndex: number } | null>(null);
  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursorIndex = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const upcoming = queue.slice(cursorIndex + 1);
  const current = queue[currentIndex];
  const { available } = playbackCapabilities(state, connected);
  const sensors = useDndSensors();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const next = reorderedIds(upcoming, entry => entry.id, String(active.id), String(over.id));
    if (!next) return;
    const position = next.findIndex(entry => entry.id === String(active.id));
    void run({ type: "move", entryId: String(active.id), beforeEntryId: next[position + 1]?.id ?? null });
  };

  useLayoutEffect(() => { if (active) back.current?.focus({ preventScroll: true }); }, [active]);
  useLayoutEffect(() => {
    const previous = focused.current;
    if (!active) { focused.current = null; return; }
    if (!previous || previous.element.isConnected && !previous.element.matches(":disabled")) return;
    if (document.activeElement !== document.body && document.activeElement !== previous.element) return;
    focused.current = null;
    const rows = panel.current?.querySelectorAll<HTMLElement>("[data-upcoming-entry]");
    const row = rows?.[Math.min(previous.queueIndex, rows.length - 1)];
    const replacement = row?.querySelector<HTMLElement>("button:not([aria-label^='Reorder']):not(:disabled)")
      ?? row?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panel.current?.querySelector<HTMLElement>(".play-button:not(:disabled), .transport-stop:not(:disabled)")
      ?? back.current;
    replacement?.focus({ preventScroll: true });
  });

  return <section ref={panel} className="pt-5 [&_.radio-programme_a]:underline [underline-offset:3px] [&_.radio-programme-description]:mt-2 [&_.radio-programme-description]:text-[13px] [&_.radio-programme-description]:leading-relaxed [&_.radio-programme-description]:whitespace-pre-line [&_.session-next-copy]:mt-0 max-md:[&_.session-next]:mt-[26px]" aria-label="Now playing" onFocusCapture={event => {
    // Portaled playback settings keep their own focus recovery.
    focused.current = event.currentTarget.contains(event.target) ? { element: event.target, queueIndex: Number(event.target.closest<HTMLElement>("[data-upcoming-entry]")?.dataset.upcomingEntry ?? -1) } : null;
  }} onBlurCapture={event => {
    if (event.target.isConnected && !event.target.matches(":disabled") && !event.currentTarget.contains(event.relatedTarget as Node | null)) focused.current = null;
  }}>
    {!embedded && <Button ref={back} variant="ghost" className="browse-back mx-5 mt-4 min-h-11" onClick={onBack}><ArrowLeft aria-hidden="true" />Back to browsing</Button>}
    {part !== "next" && <div className={cn("session-home", part === "current" && "session-home-wide")}><div className="session-current">
        {current ? <><p className="eyebrow mb-3">Now playing{state?.installationName && ` · ${state.installationName}`}</p><PlaybackControls state={state} credentials={credentials} connected={connected} run={run} presentation="session" onRemote={onRemote} /></> : <Empty className="items-start! rounded-xl p-6 text-left!">
          <EmptyHeader className="items-start! gap-1"><EmptyTitle><h1>Nothing playing</h1></EmptyTitle><EmptyDescription>Search or paste a link above, or browse Find.</EmptyDescription></EmptyHeader>
          <EmptyContent className="items-start! gap-4"><Button onClick={() => onBrowse ? onBrowse(embedded ? "Find" : "Home") : onBack?.()}><Search aria-hidden="true" />Find something to play</Button></EmptyContent>
        </Empty>}
      </div></div>}
      {part !== "current" && <section className="session-next" aria-labelledby="now-playing-next-title">
        <div className="session-section-heading"><h2 id="now-playing-next-title">Up next <span className="count text-sm text-muted-foreground">{upcoming.length}</span></h2>{onBrowse && !embedded && <Button variant="ghost" onClick={() => onBrowse("Queue")}>Manage queue<ChevronRight aria-hidden="true" /></Button>}</div>
        {state?.queueError && <Alert variant="destructive"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
        {upcoming.length ? <DndContext sensors={sensors} onDragEnd={onDragEnd}><SortableContext items={upcoming.map(entry => entry.id)} strategy={verticalListSortingStrategy}><ol className="session-next-list">{upcoming.map((entry, index) => <SortableRow key={entry.id} id={entry.id} label={`Reorder ${entry.title}`} editing>{drag => <li ref={drag.setNodeRef} style={drag.style} data-upcoming-entry={index}>
          {drag.handle}
          {entry.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={entry.artworkId} className="session-next-art" video={entry.kind !== "radio"} /> : entry.thumbnail && <MediaArtwork key={entry.thumbnail} thumbnail={entry.thumbnail} title={entry.title} className="session-next-art" />}
          <div className="session-next-copy gap-2"><strong>{entry.title}</strong><small>{sourceLabel(entry.source)}{entry.live || entry.kind === "radio" ? " · Live" : ""}</small></div>
          <Button variant="secondary" size="icon" className="session-next-play" aria-label={`Play ${entry.title}`} title="Play" disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}><Play aria-hidden="true" /></Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${entry.title} from Up next`} disabled={!connected} onClick={() => void run({ type: "remove", entryId: entry.id })}><X aria-hidden="true" /></Button>
        </li>}</SortableRow>)}</ol></SortableContext></DndContext> : <Empty className="now-playing-queue-empty items-start! rounded-xl p-6 text-left!"><EmptyHeader className="items-start! text-left!"><EmptyTitle>Nothing queued</EmptyTitle><EmptyDescription>Add something from Home or Saved.</EmptyDescription></EmptyHeader></Empty>}
      </section>}
  </section>;
}
