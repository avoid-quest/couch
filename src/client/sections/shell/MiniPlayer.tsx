import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { ListMusic, Maximize2, Pause, Play, RotateCcw, SkipForward, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackVolume, playbackCapabilities } from "@/components/PlaybackTransport";
import { useOptionalSessionGate } from "@/session/session-context";
import { RangeControl } from "@/components/RangeControl";
import type { Action } from "../../../shared/protocol";
import { offline } from "@/copy";
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

export function MiniPlayer({ state, connected, run, onOpen }: { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean>; onOpen: (panel?: "queue") => void }) {
  const playbackClock = usePlaybackClock();
  const credentials = useOptionalSessionGate()?.credentials;
  const bar = useRef<HTMLElement>(null);
  useBottomBar(bar);
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const { available, active, transportReady, nextReady, seekable, pausable, hasNext } = playbackCapabilities(state, connected);
  const paused = player.status === "paused";
  const ended = player.status === "ended";
  const live = current.live || current.kind === "radio" || current.source.startsWith("radio:");
  const length = playbackClock.duration ?? current.duration ?? 0;
  const remaining = Math.max(0, length - playbackClock.position) / (player.speed || 1);
  const status = !connected ? offline(state.installationName)
    : player.status === "error" ? `Can't play ${current.title}`
    : player.status === "loading" ? "Loading…"
    : player.status === "unavailable" ? (state as typeof state & { deviceIds?: string[] })?.deviceIds?.length === 0 ? "Choose devices" : "Player unavailable"
    : player.status === "ended" ? "Finished"
    : player.status === "idle" ? "Ready to play"
    : paused ? "Paused"
    : live ? "Live"
    : length ? `Ends ${formatEndTime(remaining)}` : "Playing";
  const programme = connected && state.radioProgramme?.playbackId === player.playbackId ? state.radioProgramme : null;
  const title = programme?.title || current.title;
  const context = programme ? current.title : current.subtitle;
  const artwork = programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} /> : current.artworkId && credentials ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} className="rounded-none" /> : <MediaArtwork thumbnail={current.thumbnail} title={current.title} />;
  return <footer ref={bar} data-mini-player aria-label="Now playing" className="sticky bottom-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 border-t bg-background px-(--gutter) py-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1.15fr)_minmax(0,1fr)] sm:gap-x-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(16rem,1.2fr)_minmax(0,1fr)] [view-transition-name:couch-player-band]">
    <Button variant="ghost" className="h-auto min-w-0 justify-start gap-3 p-0 text-left font-normal touch:h-auto" aria-label={`Open player: ${title}`} onClick={() => onOpen()}>
      <span aria-hidden="true" className="size-12 shrink-0 overflow-hidden bg-muted sm:size-14 [&_img]:size-full [&_img]:object-contain [&>*]:size-full">{artwork}</span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-medium" title={title}>{title}</span>
        <span role="status" className="truncate text-xs text-muted-foreground">{context && <><span>{context}</span><span aria-hidden="true"> · </span></>}{status}</span>
      </span>
    </Button>
    <div className="grid min-w-0 justify-items-center">
      <div className="flex items-center gap-0.5" role="group" aria-label="Playback controls">
        {pausable || ended ? <Button variant="ghost" size="icon" aria-label={ended ? "Replay" : paused ? "Play" : "Pause"} title={ended ? "Replay" : paused ? "Play" : "Pause"} disabled={ended ? !available : !transportReady} onClick={() => { if (ended) void run({ type: "play", entryId: current.id, fromStart: true }); else if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: !paused }); }}>{ended ? <RotateCcw aria-hidden="true" className="size-5" /> : paused ? <Play aria-hidden="true" className="size-5 fill-current" /> : <Pause aria-hidden="true" className="size-5 fill-current" />}</Button>
          : <Button variant="ghost" size="icon" aria-label="Stop" title="Stop" disabled={!available || !active} onClick={() => void run({ type: "stop" })}><Square aria-hidden="true" className="size-4 fill-current" /></Button>}
        {hasNext && <Button variant="ghost" size="icon" aria-label="Next" title="Next" disabled={!nextReady} onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><SkipForward aria-hidden="true" className="size-4 fill-current" /></Button>}
      </div>
      {seekable && !!playbackClock.duration && <div className="hidden w-full min-w-0 items-center gap-2 text-xs tabular-nums text-muted-foreground sm:flex [&_[data-slot=slider]]:min-h-4">
        <span>{formatDuration(playbackClock.position)}</span>
        <RangeControl key={player.playbackId || "idle"} label="Playback position" value={playbackClock.position} max={playbackClock.duration} showValue={false} keyboardStep={10} disabled={!transportReady}
          onCommit={position => player.playbackId ? run({ type: "seek", playbackId: player.playbackId, position }) : Promise.resolve(false)} />
        <span>{formatDuration(length)}</span>
      </div>}
    </div>
    <div className="flex min-w-0 items-center justify-end gap-0.5">
      <PlaybackVolume state={state} connected={connected} run={run} showValue={false} className="mr-3 w-28 min-w-0 flex-none max-[1100px]:hidden" />
      <Popover>
        <PopoverTrigger asChild><Button variant="ghost" size="icon" className="max-[480px]:hidden min-[1100px]:hidden" aria-label="Volume controls" title="Volume">{state.systemAudio?.muted ? <VolumeX aria-hidden="true" className="size-4" /> : <Volume2 aria-hidden="true" className="size-4" />}</Button></PopoverTrigger>
        <PopoverContent side="top" align="end" aria-label="Volume controls" className="w-64"><PlaybackVolume state={state} connected={connected} run={run} /></PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" aria-label="Up next" title="Up next" onClick={() => onOpen("queue")}><ListMusic aria-hidden="true" className="size-4" /></Button>
      <Button variant="ghost" size="icon" className="max-sm:hidden" aria-label="Expand player" title="Expand player" onClick={() => onOpen()}><Maximize2 aria-hidden="true" className="size-4" /></Button>
    </div>
  </footer>;
}
