import { risenNeed } from "../../shared/live-need";

// What a listener declares is its own output-side need; Core adds its measured input-side time and
// decides whether that fits the room's delay. SDK 6.0.0's syncInfo.outputLatencyMs is the raw
// reading and it exposes no arrival, queue or late-chunk statistics, so the allowance stands in
// for what Couch doesn't measure yet: the player's 15 ms scheduling batch (scheduler.js), decoding
// and the network.
const allowanceMs = 35;
// Core and Sendspin bound declarations to 5 s.
const limitMs = 5000;

export function declareLiveBuffer(declaredMs: number | undefined, latencyMs: number[] = []) {
  const need = risenNeed(declaredMs, latencyMs, allowanceMs);
  return need === undefined ? undefined : Math.min(limitMs, need);
}
