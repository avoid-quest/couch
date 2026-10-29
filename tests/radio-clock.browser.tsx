// On an empty Vite page, import this module and call runRadioClockSubscriptionRegression().
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useRadioClock } from "../src/client/radio-clock";
import { useDurationClock } from "../src/client/components/DurationBar";
import type { RadioProgrammeDetails } from "../src/shared/radio";

/** Actual React subscriptions: empty metadata must not create or follow progress ticks. */
export async function runRadioClockSubscriptionRegression() {
  const originalInterval = window.setInterval, originalClear = window.clearInterval, originalNow = Date.now;
  let now = originalNow(), timerId = 100000, radioRenders = 0, radioNow = 0;
  const timers = new Map<number, () => void>();
  window.setInterval = ((callback: () => void, delay: number) => {
    if (delay !== 15_000) throw new Error(`Unexpected interval ${delay}`);
    const id = ++timerId; timers.set(id, callback); return id;
  }) as typeof window.setInterval;
  window.clearInterval = id => { if (!timers.delete(Number(id))) originalClear(id); };
  Date.now = () => now;
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  function Radio({ programme }: { programme?: RadioProgrammeDetails }) { radioRenders++; radioNow = useRadioClock([], programme); return null; }
  function ActiveClock() { useDurationClock(); return null; }
  const render = async (programme?: RadioProgrammeDetails, peer = false) => {
    flushSync(() => root.render(<><Radio programme={programme} />{peer && <ActiveClock />}</>));
    await new Promise(resolve => setTimeout(resolve, 0)); // Settle metadata-boundary effects before measuring ticks.
  };
  const tick = () => flushSync(() => { now += 15_000; for (const callback of timers.values()) callback(); });
  try {
    await render(); assert(timers.size === 0, "Empty radio metadata created a periodic clock");
    await render(undefined, true); const emptyRenders = radioRenders;
    tick(); assert(radioRenders === emptyRenders, "Another progress clock rerendered empty radio metadata");
    const programme = { title: "A real programme", start: now - 1000, end: now + 120_000, expiresAt: now + 120_000 } as RadioProgrammeDetails;
    await render(programme, true); const activeRenders = radioRenders;
    tick(); assert(radioRenders > activeRenders && radioNow === now, "Real programme progress stopped updating");
    await render(undefined, true); const clearedRenders = radioRenders;
    tick(); assert(radioRenders === clearedRenders, "Cleared metadata retained its clock subscription");
    await render(); assert(timers.size === 0, "Last subscriber left its interval running");
    return { passed: true, checks: ["empty metadata", "unrelated progress ticks", "real programme updates", "metadata removal", "timer cleanup"] };
  } finally { flushSync(() => root.unmount()); host.remove(); window.setInterval = originalInterval; window.clearInterval = originalClear; Date.now = originalNow; }
}
