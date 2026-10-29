import { useSyncExternalStore } from "react";
import { formatDuration, formatRuntime } from "@/time-format";
import { Progress } from "@/components/ui/progress";

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    const tick = () => { now = Date.now(); listeners.forEach(notify => notify()); };
    tick();
    timer = setInterval(tick, 15_000);
  }
  return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); timer = undefined; } };
}
const snapshot = () => now;
const inactive = () => () => {};
const inactiveSnapshot = () => 0;
export function useDurationClock(enabled = true) { return useSyncExternalStore(enabled ? subscribe : inactive, enabled ? snapshot : inactiveSnapshot, enabled ? snapshot : inactiveSnapshot); }

/** Runtime is metadata, and live media has none. Only an item already started needs a progress bar. */
export function DurationBar({ duration, position = 0, live = false }: { duration?: number | null; position?: number; live?: boolean }) {
  if (live || duration == null) return null;
  const left = Math.max(0, duration - position);
  const started = position > 0 && duration > 0;
  const label = started ? `${formatDuration(left)} left` : formatDuration(duration);
  return <span className="grid w-full min-w-0 gap-2 text-sm text-muted-foreground">
    {started && <Progress className="mt-1 h-1 w-full max-w-64 rounded-none" value={Math.min(100, position / duration * 100)} aria-label={`Playback progress: ${label}`} />}
    <span className="tabular-nums">{label}</span>
  </span>;
}

/** How far it got as a slim line beside how much is left (and, playing, when it ends): the Stage's progress, on Home
 * and on Details alike. It advances while it plays. */
export function ProgressLine({ position, duration, label = `${formatRuntime(Math.max(0, duration - position))} left` }: { position: number; duration: number; label?: string }) {
  return <div className="flex w-full max-w-md items-center gap-4 text-sm text-muted-foreground tabular-nums">
    <Progress className="h-0.5 flex-1 rounded-none bg-foreground/25" value={Math.min(100, Math.max(0, position / duration * 100))} aria-label={`Playback progress: ${label}`} />
    <span className="shrink-0">{label}</span>
  </div>;
}
