import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { Minus, Pause, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
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

export function MiniPlayer({ state, connected, run, onOpen, localHost }: { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean>; onOpen: () => void; localHost: boolean }) {
  const playbackClock = usePlaybackClock();
  const bar = useRef<HTMLElement>(null);
  useBottomBar(bar);
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const paused = player.status === "paused";
  const length = playbackClock.duration ?? current.duration ?? 0;
  const remaining = Math.max(0, length - playbackClock.position) / (player.speed || 1);
  const status = !connected ? `Reconnecting to ${deviceName(state.installationName)}…` : player.status === "error" ? `Can't play ${current.title}` : current.live ? "Live" : length ? `${formatDuration(playbackClock.position)} / ${formatDuration(length)} · ends ${formatEndTime(remaining)}` : "Loading…";
  return <footer ref={bar} data-mini-player aria-label="Now playing" className="sticky bottom-0 z-20 flex items-center gap-3 border-t bg-background px-(--gutter) py-3 [view-transition-name:couch-player-band]">
    <Progress value={playbackClock.duration ? playbackClock.position / playbackClock.duration * 100 : 0} aria-label="Playback progress" className="absolute inset-x-0 -top-px h-px rounded-none bg-transparent" />
    <Button variant="ghost" size="icon" aria-label={paused ? "Play" : "Pause"} disabled={!connected || !player.playbackId || !["playing", "paused"].includes(player.status)} onClick={() => { if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: !paused }); }}>{paused ? <Play aria-hidden="true" className="fill-current" /> : <Pause aria-hidden="true" className="fill-current" />}</Button>
    <p className="grid min-w-0 flex-1">
      <span className="truncate text-base font-medium" title={current.title}>{current.title}</span>
      <span role="status" className="truncate text-sm text-muted-foreground">{status}</span>
    </p>
    {localHost && <ButtonGroup aria-label="Volume" className="max-sm:hidden"><Button variant="ghost" size="icon" aria-label="Volume down" disabled={!connected} onClick={() => void run({ type: "volume", volume: Math.max(0, player.volume - 5) })}><Minus aria-hidden="true" /></Button><ButtonGroupText className="border-0 bg-transparent tabular-nums">Volume {Math.round(player.volume)}</ButtonGroupText><Button variant="ghost" size="icon" aria-label="Volume up" disabled={!connected} onClick={() => void run({ type: "volume", volume: Math.min(100, player.volume + 5) })}><Plus aria-hidden="true" /></Button></ButtonGroup>}
    <Button variant="ghost" onClick={onOpen}>Open</Button>
  </footer>;
}
