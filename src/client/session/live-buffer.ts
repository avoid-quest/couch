// SDK 5.0.0 smooths output latency privately; its public syncInfo.outputLatencyMs is the raw
// reading, and it exposes no arrival, queue or starvation statistics. The allowance is fixed,
// not a measurement of network jitter.
const allowanceMs = 35, stepMs = 25;
export const liveBufferReadings = 5;

// Every increase moves later timestamps forward and leaves a short gap on every Receiver.
// So a Receiver declares the host floor at stream start, and raises only when the median of
// its last five once-per-second readings, plus the allowance, outgrows that by more than a
// step: to whole 25 ms steps, which a small drift or a single spike can't reach.
export function declareLiveBuffer(declaredMs: number, floorMs: number, latencyMs: number[] = []): number {
  const recent = latencyMs.slice(-liveBufferReadings).sort((a, b) => a - b);
  const need = recent.length === liveBufferReadings ? recent[liveBufferReadings >> 1]! + allowanceMs : 0;
  return Math.min(5000, Math.max(need > declaredMs + stepMs ? Math.ceil(need / stepMs) * stepMs : declaredMs, floorMs));
}
