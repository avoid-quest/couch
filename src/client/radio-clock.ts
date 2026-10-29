import { useEffect, useState } from "react";
import type { RadioGuide, RadioProgrammeDetails } from "../shared/radio";
import { useDurationClock } from "./components/DurationBar";

/** Progress ticks slowly; metadata changes at each known broadcast/freshness boundary. */
export function useRadioClock(guides: RadioGuide[] = [], programme?: RadioProgrammeDetails | null) {
  const progressNow = useDurationClock(!!programme || guides.length > 0);
  const [boundaryNow, tick] = useState(Date.now);
  const now = Date.now();
  let next = Infinity, previous = -Infinity;
  const deadline = (at?: number) => {
    if (at === undefined) return;
    if (at > now) next = Math.min(next, at);
    else previous = Math.max(previous, at);
  };
  deadline(programme?.expiresAt); deadline(programme?.start); deadline(programme?.end);
  for (const guide of guides) {
    deadline(guide.live?.expiresAt);
    for (const show of guide.programmes) { deadline(show.start); deadline(show.end); }
  }
  useEffect(() => {
    tick(Date.now());
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => tick(Date.now()), Math.max(1, next - Date.now()));
    return () => clearTimeout(timer);
  }, [next, previous]);
  return Math.max(progressNow, boundaryNow);
}
