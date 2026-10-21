import { useSyncExternalStore } from "react";
import { formatDuration } from "@/time-format";
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
export function useDurationClock() { return useSyncExternalStore(subscribe, snapshot, snapshot); }

/** Runtime is metadata, and live media has none. Only an item already started needs a progress bar. */
export function DurationBar({ duration, position = 0, live = false, collection = false }: { duration?: number | null; position?: number; live?: boolean; collection?: boolean }) {
  if (collection) return <span className="block text-sm text-muted-foreground">Channel</span>;
  if (live || duration == null) return null;
  const left = Math.max(0, duration - position);
  const started = position > 0 && duration > 0;
  const label = started ? `${formatDuration(left)} left` : formatDuration(duration);
  return <span className="grid w-full min-w-0 gap-2 text-sm text-muted-foreground">
    {started && <Progress className="mt-1 h-1 w-full max-w-64 rounded-none" value={Math.min(100, position / duration * 100)} aria-label={`Playback progress: ${label}`} />}
    <span className="tabular-nums">{label}</span>
  </span>;
}
