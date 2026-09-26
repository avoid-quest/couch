import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { ChevronUp, Pause, Play, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackVolume, playbackCapabilities } from "@/components/PlaybackTransport";
import { useOptionalSessionGate } from "@/session/session-context";
import { Progress } from "@/components/ui/progress";
import type { Action } from "../../../shared/protocol";
import { deviceName } from "@/copy";
import { formatDuration, formatEndTime } from "@/time-format";

// Bars at the bottom of the viewport (mini player, player band) can overlap
// for a commit during navigation, so the tallest registered one wins.
const bars = new Map<HTMLElement, number>();
function publishBars() {
  const height = Math.max(0, ...bars.values());
  if (height) document.documentElement.style.setProperty("--bottom-bar", `${height}px`);
  else document.documentElement.style.removeProperty("--bottom-bar");
}

/** Publishes a bar's height as --bottom-bar so toasts sit above it. */
export function useBottomBar(ref: RefObject<HTMLElement | null>, shown = true) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shown) return;
    const measure = () => { bars.set(element, element.offsetHeight); publishBars(); };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => { observer.disconnect(); bars.delete(element); publishBars(); };
  }, [ref, shown]);
}

export function MiniPlayer({ state, connected, run, onOpen }: { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean>; onOpen: () => void }) {
  const playbackClock = usePlaybackClock();
  const credentials = useOptionalSessionGate()?.credentials;
  const bar = useRef<HTMLElement>(null);
  useBottomBar(bar);
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const { transportReady, pausable, hasNext } = playbackCapabilities(state, connected);
  const paused = player.status === "paused";
  const length = playbackClock.duration ?? current.duration ?? 0;
  const remaining = Math.max(0, length - playbackClock.position) / (player.speed || 1);
  const status = !connected ? `Reconnecting to ${deviceName(state.installationName)}…` : player.status === "error" ? `Can't play ${current.title}` : current.live ? "Live" : length ? `${formatDuration(playbackClock.position)} / ${formatDuration(length)} · ends ${formatEndTime(remaining)}` : "Loading…";
  const programme = connected && state.radioProgramme?.playbackId === player.playbackId ? state.radioProgramme : null;
  const artwork = programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} className="text-xs" /> : current.artworkId && credentials ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : <MediaArtwork thumbnail={current.thumbnail} title={current.title} className="text-xs" />;
  return <footer ref={bar} data-mini-player aria-label="Now playing" className="sticky bottom-0 z-20 flex items-center gap-4 border-t bg-background px-(--gutter) py-2 max-sm:gap-2 [view-transition-name:couch-player-band]">
    <Progress value={playbackClock.duration ? playbackClock.position / playbackClock.duration * 100 : 0} aria-label="Playback progress" className="absolute inset-x-0 -top-px h-px rounded-none bg-transparent" />
    <Button variant="ghost" className="-ml-2.5 h-auto min-w-0 flex-1 justify-start gap-3 py-1.5 text-left font-normal touch:h-auto" aria-label={`Open player: ${current.title}`} onClick={onOpen}>
      <span aria-hidden="true" className="aspect-video h-10 shrink-0 overflow-hidden bg-muted [&_img]:size-full [&_img]:object-cover [&>*]:size-full">{artwork}</span>
      <span className="grid min-w-0">
        <span className="truncate text-base font-medium" title={current.title}>{current.title}</span>
        <span role="status" className="truncate text-sm text-muted-foreground">{status}</span>
      </span>
      <ChevronUp aria-hidden="true" className="shrink-0 text-muted-foreground" />
    </Button>
    <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Playback controls">
      {pausable && <Button variant="ghost" size="icon-lg" aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"} disabled={!transportReady} onClick={() => { if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: !paused }); }}>{paused ? <Play aria-hidden="true" className="fill-current" /> : <Pause aria-hidden="true" className="fill-current" />}</Button>}
      {hasNext && <Button variant="ghost" size="icon-lg" aria-label="Next" title="Next" disabled={!transportReady} onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><SkipForward aria-hidden="true" className="fill-current" /></Button>}
    </div>
    <PlaybackVolume state={state} connected={connected} run={run} className="w-48 flex-none max-sm:hidden" />
  </footer>;
}
