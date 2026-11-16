// Live steps: a listener that doesn't fit the room's delay plays at its need rounded up to the next
// step, and a need moves only when it outgrows its last value by more than a step, so drift or one
// spike can't reach it. Each move is a short slew or gap for that listener.
const liveStepMs = 25;
export const liveReadings = 5;

export const liveStep = (needMs: number) => Math.ceil(needMs / liveStepMs) * liveStepMs;

// The median of the last five once-a-second readings, plus an allowance: the first one sets the
// need, later ones only raise it.
export function risenNeed(currentMs: number | undefined, readingsMs: number[], allowanceMs = 0) {
  const recent = readingsMs.slice(-liveReadings).sort((a, b) => a - b);
  if (recent.length < liveReadings) return currentMs;
  const need = Math.ceil(recent[liveReadings >> 1]! + allowanceMs);
  return currentMs === undefined || need > currentMs + liveStepMs ? need : currentMs;
}
