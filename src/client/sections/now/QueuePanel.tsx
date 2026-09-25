import { useLayoutEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item } from "@/components/ui/item";
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

export function QueuePanel({ state, credentials, connected, available, run }: Props) {
  const [notice, setNotice] = useState("");
  const [keeping, setKeeping] = useState(false);
  const [keptQueue, setKeptQueue] = useState("");
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
    if (!focused || focused.element.isConnected) return;
    const row = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-queue-entry-id]") ?? [])].find(row => row.dataset.queueEntryId === focused.id);
    const replacement = [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(button => button.getAttribute("aria-label") === focused.label)
      ?? row?.querySelector<HTMLElement>("button:not(:disabled)")
      ?? panelRef.current?.querySelector<HTMLElement>(".queue-standard-entry:not(:disabled), .queue-standard-played:not(:disabled)");
    focusedEntry.current = null;
    replacement?.focus({ preventScroll: true });
  });

  return <section ref={panelRef} className="queue-panel queue-panel-standard" aria-labelledby="queue-title" onFocusCapture={event => {
    const element = event.target, row = element.closest<HTMLElement>("[data-queue-entry-id]");
    focusedEntry.current = row ? { element, id: row.dataset.queueEntryId!, label: element.getAttribute("aria-label") } : null;
  }}>
    <div className="queue-standard-header"><h2 id="queue-title">Up next</h2><Button variant="ghost" disabled={!connected || !upNext.length || keeping || isKept} onClick={() => void keepUpNext()}>{keeping ? "Keeping…" : isKept ? "Kept in Saved" : "Keep as a list"}</Button></div>
    {state?.queueError && <Alert variant="destructive" className="queue-feedback"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
    {notice && <p className="queue-feedback" role="status">{notice}</p>}
    {upNext.length ? <section className="queue-standard-group" aria-labelledby="queue-next-title"><h3 id="queue-next-title">{upNext.length} to play{doneIn == null ? "" : `, done by ${formatEndTime(doneIn)}`}</h3>
      <ol className="queue-standard-list" aria-label="Up next">{upNext.map((entry, index) => {
        const starts = startsIn;
        const length = knownLength(entry);
        startsIn = startsIn == null || length == null ? null : startsIn + length;
        const meta = [entry.live ? "Live" : length == null ? "Length unknown" : duration(length), starts == null ? null : `starts ${formatEndTime(starts)}`, entry.addedBy && `added by ${entry.addedBy.name}`].filter(Boolean).join(", ");
        return <Item asChild key={entry.id} className="queue-standard-row" data-queue-entry-id={entry.id}><li>
          <Button variant="ghost" className="queue-play queue-standard-entry" aria-label={`Play ${entry.title}`} disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}><span className="queue-standard-title">{entry.title}</span><span className="queue-standard-meta">{meta}</span></Button>
          <QueueActions credentials={credentials} entry={entry} index={cursorIndex + 1 + index} queue={queue} connected={connected} run={run} firstUpcomingIndex={cursorIndex + 1} lastUpcomingIndex={queue.length - 1} />
        </li></Item>;
      })}</ol>
    </section> : <Empty className="queue-standard-empty items-start border-0 p-0 text-left"><EmptyHeader className="items-start text-left"><EmptyTitle>Nothing queued</EmptyTitle><EmptyDescription>Use Queue on any result and it plays after this.</EmptyDescription></EmptyHeader></Empty>}
    {previous.length > 0 && <section className="queue-standard-group" aria-labelledby="queue-played-title"><h3 id="queue-played-title">Played</h3><ol className="queue-standard-list" aria-label="Played">{[...previous].reverse().map(entry => <li key={entry.id} data-queue-entry-id={entry.id}><Button variant="ghost" className="queue-standard-played" aria-label={`Play ${entry.title}`} disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}>{entry.title}</Button></li>)}</ol></section>}
  </section>;
}
