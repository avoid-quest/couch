import { liveReadings, liveStepMs, risenNeed } from "../../shared/live-need";

// What a listener declares is its own output-side need; Core adds its measured input-side time and
// decides whether that fits the room's delay. SDK 6.0.0's syncInfo.outputLatencyMs is the raw
// reading and it exposes no arrival or queue statistics, so the allowance stands in for the
// player's 15 ms scheduling batch (scheduler.js), decoding and an ordinary network. A network
// slower than that loses chunks, which Couch counts itself (keepsLosing).
const allowanceMs = 35;
// Core and Sendspin bound declarations to 5 s.
const limitMs = 5000;

export function declareLiveBuffer(declaredMs: number | undefined, latencyMs: number[] = []) {
  const need = risenNeed(declaredMs, latencyMs, allowanceMs);
  return need === undefined ? undefined : Math.min(limitMs, need);
}

// A listener that keeps losing sound to late chunks needs more than its output side and the
// allowance: when most of the last five seconds lost some, it asks for one more step. Core then
// moves it at most one step later. A Wi-Fi hiccup, even across a second's edge, doesn't move it.
export function keepsLosing(lostSeconds: boolean[]) {
  const recent = lostSeconds.slice(-liveReadings);
  return recent.length === liveReadings && recent.filter(Boolean).length > liveReadings / 2;
}
export const withLateSteps = (needMs: number, lateSteps: number) =>
  Math.min(limitMs, needMs + lateSteps * liveStepMs);
