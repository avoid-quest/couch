import { playbackControls } from "@/session/playback-controls";
import { metaLine } from "@/media-caption";
import { useRelatedMenu } from "@/components/MediaContext";
import { queueItemLocation, useDetailNavigation } from "@/detail-navigation";
import { artAspect, artShape, fillsFrame, majorityShape, type ArtShape } from "@/art-shape";
import { sourceLabel } from "@/source-label";
import { isRadio } from "../../../shared/radio";
import { playbackStatus } from "@/playback-status";
import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type Ref } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ListMusic, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Action, QueueEntry, VideoQuality } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";
import { deviceId } from "@/session/device-id";
import { formatEndTime } from "@/time-format";
import { useQueueActions, type QueueActionsProps } from "./QueueActions";
import { browserActions, queuePageUrl } from "@/original-page";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { queueCursorIndex } from "../../../shared/queue";

/** An entry's artwork shape (art-shape.ts): a station is square, an episode a frame, the rest go by their source. */
export const entryShape = (entry: QueueEntry): ArtShape => isRadio(entry) ? "square" : artShape(sourceLabel(entry.source), entry.collection ? "episode" : "media");

type Props = {
  state: ClientSessionState | null;
  credentials: Credentials;
  connected: boolean;
  available: boolean;
  nativeHost: boolean;
  defaultQuality: VideoQuality;
  run: (action: Action) => Promise<boolean>;
  /** Show the "Up next" heading row; a sheet's header already titles it and closes it. */
  titled?: boolean;
  /** Show what plays now above the list; beside Now playing's artwork and title it would repeat them. */
  current?: boolean;
  /** Opened over the player, the heading row ends with its Close, as a sheet's does. */
  onClose?: () => void;
  closeRef?: Ref<HTMLButtonElement>;
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

/**
 * Whether Up next has anything to show: a queued or played row, Autoplay's picks or its search, or a queue error.
 * Empty, it isn't offered as a panel that only says so.
 */
export function hasUpNext(state: ClientSessionState | null | undefined) {
  return !!state && playbackControls(state).queue && (state.queue.some(entry => entry.id !== state.currentEntryId) || !!state.autoplay?.upcoming.length || !!state.autoplay?.enabled && !!state.autoplay.pending || !!state.queueError);
}

/**
 * Up next's button in the band and the now-playing bar. While there is nothing to show it keeps its slot, disabled, and
 * says so as its tooltip (a disabled button takes no pointer, so its slot holds the tooltip).
 */
export function UpNextButton({ state, className, ...props }: ComponentProps<typeof Button> & { state: ClientSessionState | null }) {
  if (!playbackControls(state).queue) return null;
  const empty = !hasUpNext(state) && props["aria-expanded"] !== true;
  return <span title={empty ? "Nothing queued" : undefined} className={cn("inline-flex", className)}>
    <Button data-panel="queue" variant="ghost" size="icon-lg" aria-label="Up next" title="Up next" disabled={empty} {...props}><ListMusic aria-hidden="true" /></Button>
  </span>;
}

export function QueuePanel({ state, credentials, connected, available, run, titled = true, current: showCurrent = true, onClose, closeRef }: Props) {
  const playbackClock = usePlaybackClock();
  const autoplayId = useId();
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState("");
  const keep = useMutation({ mutationFn: (name: string) => apiSend(credentials, "/api/playlists", { name, scope: "upNext" }, "POST", 20_000) });
  const autoplaySave = useMutation({ mutationFn: async (autoplay: boolean) => { if (state) await run({ type: "preferences", profileId: state.activeProfile.id, preferences: { autoplay } }); } });
  const keeping = keep.isPending;
  const panelRef = useRef<HTMLElement>(null);
  const focusedEntry = useRef<{ element: HTMLElement; id: string; index: number; label: string | null } | null>(null);
  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursorIndex = state ? queueCursorIndex(state) : -1;
  const previous = queue.slice(0, cursorIndex + 1).filter(entry => entry.id !== state?.currentEntryId);
  const upNext = queue.slice(cursorIndex + 1);
  const current = currentIndex >= 0 ? queue[currentIndex] : null;
  const currentLabel = playbackStatus(state, connected).label;
  const currentLength = current ? current.live ? null : playbackClock.duration ?? knownLength(current) : 0;
  let startsIn = currentLength == null ? null : Math.max(0, currentLength - (playbackClock.position ?? 0)) / (state?.player.speed || 1);
  const doneIn = upNext.reduce<number | null>((seconds, entry) => {
    const length = knownLength(entry);
    return seconds == null || length == null ? null : seconds + length;
  }, startsIn);
  // Each row is a board line starting when the one before it ends: the queued rows, then Autoplay's.
  const board = (entry: QueueEntry) => {
    const starts = startsIn;
    const length = knownLength(entry);
    startsIn = startsIn == null || length == null ? null : startsIn + length;
    return { time: starts == null ? undefined : formatEndTime(starts), length: entry.live || length == null ? null : duration(length) };
  };
  const autoplay = state?.autoplay;
  // The switch shows only where Autoplay has something to continue; Settings → Playback always holds it.
  const autoplayUpcoming = autoplay?.enabled ? autoplay.upcoming : [];
  // The list takes its rows' majority shape, as Home's Up next does; a row of another shape is contained in that frame.
  const shape = majorityShape([...upNext, ...autoplayUpcoming, ...previous].map(entryShape), current ? entryShape(current) : "video");
  const autoplayFinding = !!autoplay?.enabled && !!autoplay.pending && !autoplayUpcoming.length;

  const keepUpNext = async () => {
    if (!connected || keeping || !upNext.length || !listName.trim()) return;
    try {
      const name = listName.trim();
      await keep.mutateAsync(name);
      setSaveOpen(false);
    } catch { /* The dialog keeps the name and shows the mutation error for retry. */ }
  };

  useLayoutEffect(() => {
    const focused = focusedEntry.current;
    if (!focused || focused.element.isConnected) return;
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-queue-entry-id]") ?? [])];
    const row = rows.find(row => row.dataset.queueEntryId === focused.id);
    const adjacent = rows[Math.min(focused.index, rows.length - 1)];
    // A removed row leaves focus on the adjacent one, on the control that opened its menu: its "…", else its one target.
    const replacement = [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(button => button.getAttribute("aria-label") === focused.label)
      ?? (focused.element.matches("[data-row-options]") ? adjacent?.querySelector<HTMLElement>("[data-row-options]") : null) ?? adjacent?.querySelector<HTMLElement>("[data-play]:not(:disabled)")
      ?? panelRef.current?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panelRef.current?.closest('[data-slot="sheet-content"]')?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panelRef.current?.closest("[data-player-idle]")?.querySelector<HTMLElement>("[data-page-first]:not(:disabled)")
      ?? panelRef.current?.querySelector<HTMLElement>("#queue-title");
    focusedEntry.current = null;
    replacement?.focus({ preventScroll: true });
  });

  if (!playbackControls(state).queue) return null;
  return <Dialog open={saveOpen} onOpenChange={setSaveOpen}><section ref={panelRef} data-queue-panel className="flex min-h-0 flex-col gap-4" aria-labelledby="queue-title" onFocusCapture={event => {
    const element = event.target;
    if (!panelRef.current?.contains(element)) return;
    const row = element.closest<HTMLElement>("[data-queue-entry-id]");
    focusedEntry.current = row ? { element, id: row.dataset.queueEntryId!, index: [...panelRef.current.querySelectorAll("[data-queue-entry-id]")].indexOf(row), label: element.getAttribute("aria-label") } : null;
  }}>
    {/* The heading row stays while the list scrolls under it: the title, Autoplay's switch, then its Close. Under a sheet's own header only the switch shows. */}
    <div className={cn("flex min-h-11 shrink-0 items-center justify-between gap-4", !titled && !autoplay?.upcoming.length && "sr-only")}>
      <h2 id="queue-title" tabIndex={-1} className={cn("text-base font-medium", !titled && "sr-only")}>Up next</h2>
      {autoplay && autoplay.upcoming.length > 0 && <div className="ml-auto flex items-center gap-3"><Label htmlFor={autoplayId} className="touch:min-h-11 text-sm font-normal text-muted-foreground">Autoplay</Label><Switch id={autoplayId} checked={autoplay.enabled} disabled={!connected || autoplaySave.isPending} onCheckedChange={value => autoplaySave.mutate(value)} /></div>}
      {onClose && <Button ref={closeRef} variant="ghost" size="icon-lg" className="-mr-2.5 size-11" aria-label="Close Up next" title="Close Up next" onClick={onClose}><X aria-hidden="true" /></Button>}
    </div>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Save as list</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void keepUpNext(); }}>
          <div className="grid gap-2"><Label htmlFor="queue-list-name">List name</Label><Input id="queue-list-name" value={listName} maxLength={80} onChange={event => setListName(event.target.value)} /></div>
          {keep.error && <Alert variant="destructive"><AlertDescription>{keep.error.message || "Couldn't save Up next."}</AlertDescription></Alert>}
          <DialogFooter><DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose><Button type="submit" disabled={!connected || keeping || !upNext.length || !listName.trim()}>{keeping ? "Saving…" : "Save list"}</Button></DialogFooter>
        </form>
      </DialogContent>
    {/* Its rows' controls pull back past the text (Save as list, Played, a row's "…"), so the scroller pads for them, with a
        little to spare: a vertical scroller with a stray pixel of overflow shifts its text when one takes focus. */}
    <div className="-mx-3 grid min-h-0 content-start gap-6 overflow-y-auto overscroll-contain px-3 pb-1">
    {current && showCurrent && <section aria-label={currentLabel} className="grid gap-2"><h3 className="text-sm text-muted-foreground">{currentLabel}</h3><ul className="m-0 list-none p-0"><QueueRow entry={current} shape={shape} meta={!current.live && currentLength ? duration(currentLength) : undefined} /></ul></section>}
    {state?.queueError && <Alert variant="destructive"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
    {upNext.length || autoplayUpcoming.length || autoplayFinding ? <div className="grid gap-2">
      {/* The list's status line, with the verb that saves it. */}
      {upNext.length > 0 && <><div className="flex items-center justify-between gap-4"><h3 className="text-sm text-muted-foreground">{upNext.length} to play{doneIn == null ? "" : `, until ${formatEndTime(doneIn)}`}</h3>
        <DialogTrigger asChild><Button variant="ghost" className="-mr-2.5" disabled={!connected} onClick={() => { keep.reset(); setListName(""); }}>Save as list</Button></DialogTrigger></div>
      <ul aria-label="Up next" className="m-0 list-none divide-y border-y p-0">{upNext.map((entry, index) => {
        const { time, length } = board(entry);
        const meta = [length, entry.addedBy && entry.addedBy.deviceId !== deviceId() && `added by ${entry.addedBy.name}`].filter(Boolean).join(", ");
        return <QueueRow key={entry.id} entry={entry} shape={shape} meta={meta || undefined} time={time} disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })}
          verbs={{ credentials, entry, index: cursorIndex + 1 + index, queue, connected, run, firstUpcomingIndex: cursorIndex + 1, lastUpcomingIndex: queue.length - 1 }} />;
      })}</ul></>}
      {/* What Autoplay picked continues the list, quieter than what someone queued. */}
      {autoplayUpcoming.length > 0 && <><h3 className={cn("text-sm text-muted-foreground", upNext.length > 0 && "pt-4")}>Then from {autoplay!.contextTitle}</h3>
        <ul aria-label="Autoplay" className="m-0 list-none divide-y border-y p-0">{autoplayUpcoming.map(entry => {
          const { time, length } = board(entry);
          return <QueueRow key={entry.id} entry={entry} shape={shape} meta={length ?? undefined} time={time} quiet disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })} />;
        })}</ul></>}
      {autoplayFinding && <p className="text-sm text-muted-foreground">Finding the next item…</p>}
    </div> : <p className="text-sm text-muted-foreground">Nothing queued.</p>}
    {previous.length > 0 && <Collapsible className="grid gap-2"><CollapsibleTrigger asChild><Button variant="ghost" className="-mx-2.5 justify-between text-base">Played<ChevronDown aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent>
      <ul aria-label="Played" className="m-0 list-none divide-y border-y p-0">{[...previous].reverse().map(entry => <QueueRow key={entry.id} entry={entry} shape={shape} disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })} verbs={{ credentials, entry, index: queue.indexOf(entry), queue, connected, run, firstUpcomingIndex: cursorIndex + 1, lastUpcomingIndex: queue.length - 1 }} />)}</ul>
    </CollapsibleContent></Collapsible>}
    </div>
  </section></Dialog>;
}


// One target that plays the entry, with its other verbs in its menu, where it leads (its series, channel, station) last, as
// a tile's. An entry's page holds only Play and Save, so the row keeps its "…". Its start time ends the row as a board line
// does: the name heavy, the time light (docs/design.md).
// `quiet` mutes its title (what Autoplay picked), leaving its meta and links at their contrast.
function QueueRow({ entry, shape, meta, time, onPlay, disabled, verbs, quiet = false }: { entry: QueueEntry; shape: ArtShape; meta?: string; time?: string; onPlay?: () => void; disabled?: boolean; verbs?: QueueActionsProps; quiet?: boolean }) {
  const details = useDetailNavigation();
  const actions = useQueueActions(verbs);
  const related = useRelatedMenu({ collection: entry.collection, creator: entry.creator, radio: entry.source.startsWith("radio:") ? { id: entry.source.slice(6), title: entry.title } : undefined });
  const options = useItemMenu([...verbs ? actions : [{ label: "Details", run: () => details.open(queueItemLocation(entry)) }, ...browserActions(queuePageUrl(entry))], ...related]);
  meta = metaLine(entry.subtitle, meta);
  const content = <><span aria-hidden="true" className={cn("relative h-12 shrink-0 overflow-hidden rounded-sm bg-muted [&_img]:size-full [&>*]:size-full", artAspect[shape], fillsFrame(entryShape(entry), shape) ? "[&_img]:object-cover" : "[&_img]:object-contain")}><MediaArtwork thumbnail={entry.thumbnail} title={entry.title} />{onPlay && <span className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 touch:opacity-100"><Play className="size-5 fill-current" /></span>}</span><span className="grid min-w-0 flex-1 gap-0.5"><span className={cn("line-clamp-2 text-base font-medium break-words", quiet && "text-muted-foreground")}>{entry.title}</span>{meta && <span className="truncate text-sm text-muted-foreground">{meta}</span>}</span>{time && <span data-queue-time title={`Estimated start ${time}`} className="shrink-0 pl-2 text-base font-light tabular-nums">{time}</span>}</>;
  return <li data-nav-row data-queue-entry-id={onPlay ? entry.id : undefined} {...options.item} className={cn("flex min-w-0 items-center gap-2 py-3", options.item.className)}>
    {onPlay ? <Button data-play variant="ghost" {...options.target} aria-label={`Play ${entry.title}`} disabled={disabled} onClick={onPlay} className="group text-foreground h-auto min-w-0 flex-1 justify-start gap-3 p-0 text-left font-normal whitespace-normal">{content}</Button> : <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>}
    <ItemMenu menu={options} title={entry.title} />
  </li>;
}
