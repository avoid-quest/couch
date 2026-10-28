// SDK 5.0.0 exposes output latency, but no arrival, queue or starvation statistics
// on SendspinPlayer. This allowance is fixed, not a measurement of network jitter.
export function declareLiveBuffer(previousMs: number, floorMs: number, outputLatencyMs?: number): number {
  const need = outputLatencyMs !== undefined && Number.isFinite(outputLatencyMs) && outputLatencyMs >= 0 ? outputLatencyMs + 35 : 0;
  return Math.min(5000, Math.ceil(Math.max(previousMs, floorMs, need) / 5) * 5);
}
