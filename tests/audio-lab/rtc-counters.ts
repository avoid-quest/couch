export const inboundCounterNames = ["packetsLost", "packetsReceived", "totalSamplesReceived", "concealedSamples", "silentConcealedSamples", "concealmentEvents", "jitterBufferDelay", "jitterBufferEmittedCount", "insertedSamplesForDeceleration", "removedSamplesForAcceleration"] as const;
export type CounterName = typeof inboundCounterNames[number];
export type InboundPeer = { index: number; stats: Record<string, unknown>[] };

export function assessInboundCounters(before: InboundPeer | undefined, after: InboundPeer | undefined) {
  const streams = (peer: InboundPeer | undefined) => peer?.stats.filter(s => s.type === "inbound-rtp" && s.kind === "audio") ?? [];
  const previousStreams = streams(before), currentStreams = streams(after);
  const old = previousStreams[0] ?? {}, current = currentStreams[0] ?? {};
  const reasons: string[] = [];
  if (!before || !after || before.index !== after.index || previousStreams.length !== 1 || currentStreams.length !== 1
    || typeof old.id !== "string" || !old.id || old.id !== current.id || !Number.isSafeInteger(old.ssrc) || old.ssrc !== current.ssrc
    || typeof old.timestamp !== "number" || !Number.isFinite(old.timestamp) || typeof current.timestamp !== "number"
    || !Number.isFinite(current.timestamp) || current.timestamp <= old.timestamp) {
    return { status: "inconclusive" as const, reasons: ["Inbound stream identity or stats time is missing, ambiguous or changed"],
      delta: Object.fromEntries(inboundCounterNames.map(key => [key, null])) as Record<CounterName, number | null> };
  }
  const delta = Object.fromEntries(inboundCounterNames.map(key => {
    const a = old[key], b = current[key];
    const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
      && (key === "jitterBufferDelay" || Number.isSafeInteger(value)) && (key === "packetsLost" || value >= 0);
    // packetsLost is a signed RTP estimate; late/duplicate arrivals may reduce
    // it below zero. Other fields here are cumulative nonnegative counters.
    if (!valid(a) || !valid(b) || key !== "packetsLost" && b < a) {
      reasons.push(`${key}: unavailable, malformed or reset`); return [key, null];
    }
    return [key, b - a];
  })) as Record<CounterName, number | null>;
  return { status: reasons.length ? "inconclusive" as const : "observed" as const, reasons, delta };
}

export function totalObservedCounter(values: (number | null)[]) {
  if (!values.length || values.some(value => value === null || !Number.isFinite(value))) return null;
  const total = values.reduce<number>((sum, value) => sum + value!, 0);
  return Number.isFinite(total) ? total : null;
}
