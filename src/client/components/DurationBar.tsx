import { useSyncExternalStore } from "react";
import { formatDuration, formatEndTime } from "@/time-format";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// All lengths use the same logarithmic horizon, from now to four hours out.
export const durationScale = (seconds: number) => Math.max(.03, Math.min(1, Math.log1p(Math.max(0, seconds) / 60) / Math.log1p(240)));

// The full four-hour horizon is `--duration-width` wide, so bars in different
// rows, and the ruler above them, share one scale. Set it on a list.
const horizon = (seconds: number) => `calc(var(--duration-width, 8rem) * ${durationScale(seconds)})`;

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

/** Clock times for the horizon, drawn above bars that start at the same edge. */
export function DurationRuler({ className }: { className?: string }) {
  const now = useDurationClock();
  return <div className={cn("relative h-6 w-[var(--duration-width,8rem)] text-xs text-muted-foreground tabular-nums", className)} aria-hidden="true">
    {[0, 600, 3600, 10800].map(seconds => <span key={seconds} className={cn("absolute bottom-0 border-l pb-1 pl-1 whitespace-nowrap", !seconds && "border-foreground text-foreground")} style={{ left: seconds ? horizon(seconds) : 0 }}>{seconds ? formatEndTime(seconds, now) : `Now ${formatEndTime(0, now)}`}</span>)}
  </div>;
}

export function DurationBar({ duration, position = 0, live = false, collection = false }: { duration?: number | null; position?: number; live?: boolean; collection?: boolean }) {
  if (collection || live) return <span className="block text-sm">{collection ? "Channel" : "Live"}</span>;
  if (duration == null) return null;
  return <TimedDurationBar duration={duration} position={position} />;
}

function TimedDurationBar({ duration, position }: { duration: number; position: number }) {
  const now = useDurationClock();
  const left = Math.max(0, duration - position);
  const label = position > 0 ? `Resume at ${formatDuration(position)} · ${formatDuration(left)} left · ends ${formatEndTime(left, now)}` : `${formatDuration(duration)}, ends ${formatEndTime(duration, now)}`;
  // Bar width encodes total runtime; the indicator dims the watched part.
  return <span className="flex w-full min-w-0 items-center gap-2 text-sm">
    <Progress className="h-1 max-w-full shrink-0 rounded-none bg-current [&_[data-slot=progress-indicator]]:bg-muted-foreground" style={{ width: horizon(duration) }} value={duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0} aria-label={label} />
    <span className="min-w-0 truncate text-muted-foreground tabular-nums">{label}</span>
  </span>;
}
