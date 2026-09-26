import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useOptionalShell } from "@/sections/shell/shell-context";
import { cn } from "@/lib/utils";
import type { Action, QueueEntry, VideoQuality } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";
import { formatEndTime } from "@/time-format";
import { QueueActions } from "./QueueActions";

type Props = {
  state: ClientSessionState | null;
  credentials: Credentials;
  connected: boolean;
  available: boolean;
  nativeHost: boolean;
  defaultQuality: VideoQuality;
  run: (action: Action) => Promise<boolean>;
  /** Show the "Up next" heading; a sheet already titles it. */
  titled?: boolean;
};

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor(value % 3_600 / 60);
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function knownLength(entry: QueueEntry): number | null {
  return entry.live || entry.duration == null || !Number.isFinite(entry.duration) ? null : Math.max(0, entry.duration);
}

export function QueuePanel({ state, credentials, connected, available, run, titled = true }: Props) {
  const playbackClock = usePlaybackClock();
  const autoplayId = useId();
  const shell = useOptionalShell();
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState("");
  const keep = useMutation({ mutationFn: (name: string) => apiSend(credentials, "/api/playlists", { name, scope: "upNext" }, "POST", 20_000) });
  const autoplaySave = useMutation({ mutationFn: async (autoplay: boolean) => { if (state) await run({ type: "preferences", profileId: state.activeProfile.id, preferences: { autoplay } }); } });
  const keeping = keep.isPending;
  const panelRef = useRef<HTMLElement>(null);
  const focusedEntry = useRef<{ element: HTMLElement; id: string; index: number; label: string | null } | null>(null);
  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursorIndex = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const previous = queue.slice(0, cursorIndex + 1).filter(entry => entry.id !== state?.currentEntryId);
  const upNext = queue.slice(cursorIndex + 1);
  const current = currentIndex >= 0 ? queue[currentIndex] : null;
  const currentLabel = !connected ? "Reconnecting…" : state?.player.status === "ended" ? state.autoplay?.enabled && state.autoplay.pending ? "Finding the next item…" : "Finished"
    : state?.player.status === "loading" ? "Loading…" : state?.player.status === "error" ? "Playback error" : state?.player.status === "unavailable" ? "Player unavailable"
    : state?.player.status === "idle" ? "Ready to play" : state?.player.status === "paused" ? "Paused" : "Playing";
  const currentLength = current ? current.live ? null : playbackClock.duration ?? knownLength(current) : 0;
  let startsIn = currentLength == null ? null : Math.max(0, currentLength - (playbackClock.position ?? 0)) / (state?.player.speed || 1);
  const doneIn = upNext.reduce<number | null>((seconds, entry) => {
    const length = knownLength(entry);
    return seconds == null || length == null ? null : seconds + length;
  }, startsIn);

  const keepUpNext = async () => {
    if (!connected || keeping || !upNext.length || !listName.trim()) return;
    try {
      const name = listName.trim();
      await keep.mutateAsync(name);
      toast(`Saved as ${name}.`);
      setSaveOpen(false);
    } catch { /* The dialog keeps the name and shows the mutation error for retry. */ }
  };

  useLayoutEffect(() => {
    const focused = focusedEntry.current;
    if (!focused || focused.element.isConnected) return;
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-queue-entry-id]") ?? [])];
    const row = rows.find(row => row.dataset.queueEntryId === focused.id);
    const replacement = [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(button => button.getAttribute("aria-label") === focused.label)
      ?? rows[Math.min(focused.index, rows.length - 1)]?.querySelector<HTMLElement>("[data-queue-menu]")
      ?? panelRef.current?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panelRef.current?.closest("[data-player-sheet]")?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panelRef.current?.closest("[data-player-idle]")?.querySelector<HTMLElement>("[data-page-first]:not(:disabled)")
      ?? panelRef.current?.querySelector<HTMLElement>("#queue-title");
    focusedEntry.current = null;
    replacement?.focus({ preventScroll: true });
  });

  return <Dialog open={saveOpen} onOpenChange={setSaveOpen}><section ref={panelRef} data-queue-panel className="grid gap-6" aria-labelledby="queue-title" onFocusCapture={event => {
    const element = event.target;
    if (!panelRef.current?.contains(element)) return;
    const row = element.closest<HTMLElement>("[data-queue-entry-id]");
    focusedEntry.current = row ? { element, id: row.dataset.queueEntryId!, index: [...panelRef.current.querySelectorAll("[data-queue-entry-id]")].indexOf(row), label: element.getAttribute("aria-label") } : null;
  }}>
    <div className="flex items-center justify-between gap-4">
      <h2 id="queue-title" tabIndex={-1} className={cn("text-base font-medium", !titled && "sr-only")}>Up next</h2>
      <DialogTrigger asChild><Button variant="ghost" className="ml-auto" disabled={!connected || !upNext.length} onClick={() => { keep.reset(); setListName(""); }}>Save as list</Button></DialogTrigger>
    </div>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Save as list</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void keepUpNext(); }}>
          <div className="grid gap-2"><Label htmlFor="queue-list-name">List name</Label><Input id="queue-list-name" value={listName} maxLength={80} onChange={event => setListName(event.target.value)} /></div>
          {keep.error && <Alert variant="destructive"><AlertDescription>{keep.error.message || "Couldn't save Up next."}</AlertDescription></Alert>}
          <DialogFooter><DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose><Button type="submit" disabled={!connected || keeping || !upNext.length || !listName.trim()}>{keeping ? "Saving…" : "Save list"}</Button></DialogFooter>
        </form>
      </DialogContent>
    {current && <section aria-label={currentLabel} className="grid gap-2"><h3 className="text-sm text-muted-foreground">{currentLabel}</h3><ul className="m-0 list-none p-0"><QueueRow entry={current} credentials={credentials} meta={current.live ? "Live" : currentLength ? duration(currentLength) : undefined} /></ul></section>}
    {state?.queueError && <Alert variant="destructive"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
    {upNext.length ? <section className="grid gap-2" aria-labelledby="queue-next-title"><h3 id="queue-next-title" className="text-sm text-muted-foreground">{upNext.length} to play{doneIn == null ? "" : ` · done by ${formatEndTime(doneIn)}`}</h3>
      <ul aria-label="Up next" className="m-0 list-none divide-y border-y p-0">{upNext.map((entry, index) => {
        const starts = startsIn;
        const length = knownLength(entry);
        startsIn = startsIn == null || length == null ? null : startsIn + length;
        const meta = [entry.live ? "Live" : length == null ? null : duration(length), starts == null ? null : `starts ${formatEndTime(starts)}`, entry.addedBy && `added by ${entry.addedBy.name}`].filter(Boolean).join(" · ");
        return <QueueRow key={entry.id} entry={entry} credentials={credentials} meta={meta || undefined} disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })}
          actions={<QueueActions credentials={credentials} entry={entry} index={cursorIndex + 1 + index} queue={queue} connected={connected} run={run} firstUpcomingIndex={cursorIndex + 1} lastUpcomingIndex={queue.length - 1} />} />;
      })}</ul>
    </section> : state?.autoplay?.enabled && (state.autoplay.next || state.autoplay.pending) ? <p className="text-sm text-muted-foreground">Your queue is empty.</p> : <Empty className="items-start p-0 text-left"><EmptyHeader className="items-start text-left"><EmptyTitle>Nothing queued</EmptyTitle><EmptyDescription>Use Queue on anything in Find.</EmptyDescription></EmptyHeader>{shell && <EmptyContent className="items-start"><Button variant="outline" onClick={() => shell.changeSection("Find")}>Find</Button></EmptyContent>}</Empty>}
    {state?.autoplay && <section aria-label="Autoplay" className="grid gap-2">
      <div className="flex items-center justify-between gap-4"><h3><Label htmlFor={autoplayId} className="touch:min-h-11 text-base font-medium">Autoplay</Label></h3><Switch id={autoplayId} checked={state.autoplay.enabled} disabled={!connected || autoplaySave.isPending} onCheckedChange={value => autoplaySave.mutate(value)} /></div>
      {state.autoplay.enabled && state.autoplay.next ? <>
        <p className="text-sm text-muted-foreground">{state.autoplay.contextTitle}{upNext.length > 0 && " · after your queue"}</p>
        <ul aria-label="Autoplay next" className="m-0 list-none border-y p-0"><QueueRow entry={state.autoplay.next} credentials={credentials} meta={state.autoplay.next.duration ? duration(state.autoplay.next.duration) : undefined} /></ul>
      </> : <p className="text-sm text-muted-foreground">{state.autoplay.enabled ? state.autoplay.pending ? "Finding the next item…" : "Continues when this series, album or playlist has another item." : "Playback stops after your queued items."}</p>}
    </section>}
    {previous.length > 0 && <Collapsible className="grid gap-2"><CollapsibleTrigger asChild><Button variant="ghost" className="justify-between px-0 text-muted-foreground">Played<ChevronDown aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent>
      <ul aria-label="Played" className="m-0 list-none divide-y border-y p-0">{[...previous].reverse().map(entry => <QueueRow key={entry.id} entry={entry} credentials={credentials} disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })} actions={<QueueActions credentials={credentials} entry={entry} index={queue.indexOf(entry)} queue={queue} connected={connected} run={run} firstUpcomingIndex={cursorIndex + 1} lastUpcomingIndex={queue.length - 1} />} />)}</ul>
    </CollapsibleContent></Collapsible>}
  </section></Dialog>;
}


function QueueRow({ entry, credentials, meta, onPlay, disabled, actions }: { entry: QueueEntry; credentials: Credentials; meta?: string; onPlay?: () => void; disabled?: boolean; actions?: ReactNode }) {
  meta = [entry.subtitle, meta].filter(Boolean).join(" · ");
  const content = <><span aria-hidden="true" className="size-12 shrink-0 overflow-hidden bg-muted [&_img]:size-full [&_img]:object-cover [&>*]:size-full">{entry.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={entry.artworkId} className="rounded-none" /> : <MediaArtwork thumbnail={entry.thumbnail} title={entry.title} />}</span><span className="grid min-w-0 gap-1"><span className="truncate text-sm font-medium">{entry.title}</span>{meta && <span className="truncate text-xs text-muted-foreground">{meta}</span>}</span></>;
  return <li data-nav-row data-queue-entry-id={onPlay ? entry.id : undefined} className="flex min-w-0 items-center gap-2 py-2">
    {onPlay ? <Button data-play variant="ghost" aria-label={`Play ${entry.title}`} disabled={disabled} onClick={onPlay} className="h-auto touch:h-auto min-w-0 flex-1 justify-start gap-3 p-0 text-left font-normal">{content}</Button> : <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>}
    {actions}
  </li>;
}
