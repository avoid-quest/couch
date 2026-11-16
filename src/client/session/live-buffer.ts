import { liveReadings, liveStepMs, risenNeed } from "../../shared/live-need";

// What a listener declares is its own output-side need; Core adds its measured input-side time and
// decides whether that fits the room's delay. The need is what the player measures and what it
// structurally takes, nothing more:
// - syncInfo.outputLatencyMs: the device's reported output latency (SDK 6.0.0's raw reading). The
//   player starts each chunk that much before its time, and drops it when that start has passed.
// - the player's scheduling batch: it handles received chunks 15 ms after the first of them
//   (scheduler.js scheduleQueueProcessing, setTimeout(..., 15)), so a chunk may wait that long.
// Decoding and the network aren't measured: a listener that loses chunks to them counts that
// itself and asks for 25 ms steps (nextLateSteps).
const playerBatchMs = 15;
// Core and Sendspin bound declarations to 5 s.
const limitMs = 5000;

export function declareLiveBuffer(declaredMs: number | undefined, latencyMs: number[] = []) {
  const need = risenNeed(declaredMs, latencyMs, playerBatchMs);
  return need === undefined ? undefined : Math.min(limitMs, need);
}

// A listener that keeps losing sound to late chunks needs more than its output side and the
// player's batch: when most of the last five seconds lost some, it asks for one more step. Core then
// moves it at most one step later. A Wi-Fi hiccup, even across a second's edge, doesn't move it.
// A step has to help. The five seconds after it are judged: a listener that still loses in as many
// stops stepping for this listen, since more delay isn't what it lacks and each step costs it a slew
// (up to Core's 5 s). A declaration still within the room's delay isn't judged: Core adds its input
// side, which the listener doesn't know, so that step may not have moved it at all.
export type LateSteps = { steps: number; lostBefore?: number; stopped?: boolean };
export function nextLateSteps(
  late: LateSteps,
  lostSeconds: boolean[],
  declaredMs: number,
  roomMs: number,
): LateSteps {
  const recent = lostSeconds.slice(-liveReadings);
  if (late.stopped || recent.length < liveReadings) return late;
  const lost = recent.filter(Boolean).length;
  if (lost <= liveReadings / 2) return { steps: late.steps };
  if (late.lostBefore !== undefined && declaredMs > roomMs && lost >= late.lostBefore)
    return { ...late, stopped: true };
  return { steps: late.steps + 1, lostBefore: lost };
}
export const withLateSteps = (needMs: number, lateSteps: number) =>
  Math.min(limitMs, needMs + lateSteps * liveStepMs);
