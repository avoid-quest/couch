import { liveReadings, liveStep, risenNeed } from "../shared/live-need";

// One Live run's timing. The room's delay is the host's setting and nothing a listener declares
// moves it. A listener whose own need (its declaration and Sync delay, plus Core's measured
// input-side time) doesn't fit plays on its own, a step later: the same chunks, stamped later.
export function createLiveLead(roomMs: number) {
  let inputMs: number | undefined,
    readings: number[] = [],
    second: number | undefined,
    highest = 0;
  const steps = new Map<string, number>();
  return {
    roomMs,
    // Capture to sending, for each chunk as Core gets it from the encoder: the sound card's buffer,
    // the transfer and the encoder, whatever card it is. Each second keeps its highest time, since
    // a typical one would leave the slower chunks of that second late.
    arrived(capturedAtUs: number, nowUs: number) {
      const at = Math.floor(nowUs / 1e6);
      if (second !== undefined && at !== second) {
        readings = [...readings, highest].slice(-liveReadings);
        inputMs = risenNeed(inputMs, readings);
        highest = 0;
      }
      second = at;
      highest = Math.max(highest, (nowUs - capturedAtUs) / 1000);
    },
    // A listener's lead only rises while it listens, so nobody slips back and forth.
    leadMs(clientId: string, declaredMs: number) {
      const need = declaredMs + (inputMs ?? 0);
      const step = Math.max(steps.get(clientId) ?? roomMs, need > roomMs ? liveStep(need) : roomMs);
      steps.set(clientId, step);
      return step;
    },
    left(clientId: string) {
      steps.delete(clientId);
    },
  };
}
