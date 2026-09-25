import { useSyncExternalStore } from "react";
import { formatDuration, formatEndTime } from "@/time-format";

// All lengths use the same logarithmic horizon, from now to four hours out.
export const durationScale = (seconds: number) => Math.max(.03, Math.min(1, Math.log1p(Math.max(0, seconds) / 60) / Math.log1p(240)));

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

export function DurationRuler() {
  const now = useDurationClock();
  return <div className="find-time-ruler" aria-label="Duration ruler"><div className="find-time-ruler-track">{[0, 600, 3600, 10800].map(seconds => <span key={seconds} style={{ left: `${seconds ? durationScale(seconds) * 100 : 0}%` }}>{seconds ? formatEndTime(seconds, now) : `Now ${formatEndTime(0, now)}`}</span>)}</div></div>;
}

export function DurationBar({ duration, position = 0, live = false, collection = false }: { duration?: number | null; position?: number; live?: boolean; collection?: boolean }) {
  if (collection) return <span className="duration-bar duration-bar-live">Channel</span>;
  if (live || duration == null) return <span className="duration-bar duration-bar-live">Live</span>;
  return <TimedDurationBar duration={duration} position={position} />;
}

function TimedDurationBar({ duration, position }: { duration: number; position: number }) {
  const now = useDurationClock();
  const left = Math.max(0, duration - position);
  const width = `${durationScale(duration) * 100}%`;
  return <span className="duration-bar"><span className="duration-bar-track"><span className="duration-bar-fill" style={{ width }}>{position > 0 && <span className="duration-bar-watched" style={{ width: `${Math.min(100, position / duration * 100)}%` }} />}</span><span className="duration-bar-label" style={{ left: width }}>{position > 0 ? `Resume at ${formatDuration(position)}, ${formatDuration(left)} left, ends ${formatEndTime(left, now)}` : `${formatDuration(duration)}, ends ${formatEndTime(duration, now)}`}</span></span></span>;
}
