import { useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { useOptionalShell } from "@/sections/shell/shell-context";
import { cn } from "@/lib/utils";
import type { Action, QueueEntry, SessionState, VideoQuality } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";
import { formatEndTime } from "@/time-format";
import { QueueActions } from "./QueueActions";

type Props = {
  state: SessionState | null;
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
  const shell = useOptionalShell();
  const [keptQueue, setKeptQueue] = useState("");
  const keep = useMutation({ mutationFn: (name: string) => apiSend(credentials, "/api/playlists", { name, scope: "upNext" }, "POST", 20_000) });
  const keeping = keep.isPending;
  const panelRef = useRef<HTMLElement>(null);
  const focusedEntry = useRef<{ element: HTMLElement; id: string; label: string | null } | null>(null);
  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursorIndex = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const previous = queue.slice(0, cursorIndex + 1).filter(entry => entry.id !== state?.currentEntryId);
  const upNext = queue.slice(cursorIndex + 1);
  const upNextKey = upNext.map(entry => entry.id).join(",");
  const isKept = !!upNext.length && keptQueue === upNextKey;
  const current = currentIndex >= 0 ? queue[currentIndex] : null;
  const currentLength = current ? current.live ? null : state?.player.duration ?? knownLength(current) : 0;
  let startsIn = currentLength == null ? null : Math.max(0, currentLength - (state?.player.position ?? 0)) / (state?.player.speed || 1);
  const doneIn = upNext.reduce<number | null>((seconds, entry) => {
    const length = knownLength(entry);
    return seconds == null || length == null ? null : seconds + length;
  }, startsIn);

  const keepUpNext = async () => {
    if (!connected || keeping || !upNext.length) return;
    try {
      const name = `Up next, ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      await keep.mutateAsync(name);
      toast(`Saved as ${name}.`);
      setKeptQueue(upNextKey);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't save Up next."); }
  };

  useLayoutEffect(() => {
    const focused = focusedEntry.current;
    if (!focused || focused.element.isConnected) return;
    const row = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-queue-entry-id]") ?? [])].find(row => row.dataset.queueEntryId === focused.id);
    const replacement = [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(button => button.getAttribute("aria-label") === focused.label)
      ?? row?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panelRef.current?.querySelector<HTMLElement>("[data-play]:not(:disabled)")
      ?? panelRef.current?.closest("[data-player-sheet]")?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panelRef.current?.closest('[data-page="Now"]')?.querySelector<HTMLElement>("[data-page-first]:not(:disabled)");
    focusedEntry.current = null;
    replacement?.focus({ preventScroll: true });
  });

  return <section ref={panelRef} data-queue-panel className="grid gap-6" aria-labelledby="queue-title" onFocusCapture={event => {
    const element = event.target, row = element.closest<HTMLElement>("[data-queue-entry-id]");
    focusedEntry.current = row ? { element, id: row.dataset.queueEntryId!, label: element.getAttribute("aria-label") } : null;
  }}>
    <div className="flex items-center justify-between gap-4">
      <h2 id="queue-title" className={cn("text-base font-medium", !titled && "sr-only")}>Up next</h2>
      <Button variant="ghost" className="ml-auto" disabled={!connected || !upNext.length || keeping || isKept} onClick={() => void keepUpNext()}>{keeping ? "Saving…" : isKept ? "Saved" : "Save as list"}</Button>
    </div>
    {state?.queueError && <Alert variant="destructive"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
    {upNext.length ? <section className="grid gap-2" aria-labelledby="queue-next-title"><h3 id="queue-next-title" className="text-sm text-muted-foreground">{upNext.length} to play{doneIn == null ? "" : ` · done by ${formatEndTime(doneIn)}`}</h3>
      {/* Rows stack their actions under the title: the sheet is narrow at every viewport. */}
      <MediaList aria-label="Up next" className="[&>li]:grid-cols-1 [&_[data-slot=item-actions]]:justify-start [&_[data-slot=item-actions]]:opacity-100">{upNext.map((entry, index) => {
        const starts = startsIn;
        const length = knownLength(entry);
        startsIn = startsIn == null || length == null ? null : startsIn + length;
        const meta = [entry.live ? "Live" : length == null ? null : duration(length), starts == null ? null : `starts ${formatEndTime(starts)}`, entry.addedBy && `added by ${entry.addedBy.name}`].filter(Boolean).join(" · ");
        return <MediaRow key={entry.id} data-queue-entry-id={entry.id} title={entry.title} meta={meta || undefined} primary={{ label: "Play", disabled: !available, onClick: () => void run({ type: "play", entryId: entry.id }) }}
          actions={<QueueActions credentials={credentials} entry={entry} index={cursorIndex + 1 + index} queue={queue} connected={connected} run={run} firstUpcomingIndex={cursorIndex + 1} lastUpcomingIndex={queue.length - 1} />} />;
      })}</MediaList>
    </section> : <Empty className="items-start p-0 text-left"><EmptyHeader className="items-start text-left"><EmptyTitle>Nothing queued</EmptyTitle><EmptyDescription>Use Queue on anything in Find.</EmptyDescription></EmptyHeader>{shell && <EmptyContent className="items-start"><Button variant="outline" onClick={() => shell.changeSection("Find")}>Find</Button></EmptyContent>}</Empty>}
    {previous.length > 0 && <section className="grid gap-2" aria-labelledby="queue-played-title"><h3 id="queue-played-title" className="text-sm text-muted-foreground">Played</h3>
      <MediaList aria-label="Played">{[...previous].reverse().map(entry => <MediaRow key={entry.id} data-queue-entry-id={entry.id} title={entry.title} className="text-muted-foreground" primary={{ label: "Play", disabled: !available, onClick: () => void run({ type: "play", entryId: entry.id }) }} />)}</MediaList>
    </section>}
  </section>;
}
