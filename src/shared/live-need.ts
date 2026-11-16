// Live steps: a listener plays at its need rounded up to the next 5 ms step, and a need moves only
// when it outgrows its last value by more than a step, so drift or one spike can't reach it. Each
// move is a short slew or gap for that listener. 5 ms keeps a listener within 5 ms of its need;
// listeners whose needs round up to the same step play together, and others a few ms apart.
const liveStepMs = 5;
// A listener that keeps losing chunks asks for more in 10 ms units, as late as its lost chunks were:
// two placement steps each, so Core always moves it by exactly that, and the send_ahead that shows
// it can't be read as jitter.
export const liveLateStepMs = 10;
export const liveReadings = 5;

export const liveStep = (needMs: number) => Math.ceil(needMs / liveStepMs) * liveStepMs;

// Once-a-second readings plus an allowance. The first reading sets the need, so a listener reaches
// its step within a second; later only the median of the last five raises it.
export function risenNeed(currentMs: number | undefined, readingsMs: number[], allowanceMs = 0) {
  const recent = readingsMs.slice(-liveReadings).sort((a, b) => a - b);
  if (!recent.length || (currentMs !== undefined && recent.length < liveReadings)) return currentMs;
  const need = Math.ceil(recent[recent.length >> 1]! + allowanceMs);
  return currentMs === undefined || need > currentMs + liveStepMs ? need : currentMs;
}
