import { liveStepMs, risenNeed } from "../../shared/live-need";

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

// A listener that keeps losing chunks to its own lateness needs more than its output side and the
// player's batch: it asks for one more step, and Core moves it one step later. Every second it adds
// what it received and lost (live-loss.ts).
// - Step when the last ten seconds lost chunks in both their halves: loss that recurs, which the
//   network's tail or a busy page leaves at a too-early step. One stall, however long, doesn't step:
//   its loss is over before a step could tell whether it helped. Ten seconds hold 500–1000 chunks,
//   enough for a step's partial cure to show in the share lost.
// - Judge a step once Core has applied it: chunks then arrive with half a step more time left. The
//   second it lands in is skipped (its changeover), then the next ten seconds are compared with the
//   ten before the ones that caused it: those were picked for their loss, so almost any ten seconds
//   after them would lose less. A step Core didn't apply (the room's delay had slack for it) isn't
//   judged.
// - A step that lowered the share lost is kept and stepping goes on: dropouts are never traded for
//   sync. One that didn't pauses stepping for a minute, then two, four… It never stops for good, and
//   steps that don't help stay few: one per pause, at most six in an hour.
// Steps only add up: Core never moves a listener earlier while it listens.
export type LossSecond = { chunks: number; lost: number; marginMs?: number };
type Phase =
  | { kind: "watching" }
  | { kind: "moving"; share: number; marginMs?: number; waited: number }
  | { kind: "judging"; share: number }
  | { kind: "pausing"; left: number };
export type LateSteps = {
  steps: number;
  unhelpful: number;
  seconds: LossSecond[];
  phase: Phase;
};
export const noLateSteps: LateSteps = {
  steps: 0,
  unhelpful: 0,
  seconds: [],
  phase: { kind: "watching" },
};
const windowSeconds = 10;
// Core stamps its next chunk with a new declaration, which reaches the listener after its transit
// (well under a second even on the rig's Wi-Fi): a step not seen by then wasn't applied.
const movingSeconds = 3;
const pauseSeconds = 60;

const lostShare = (seconds: LossSecond[]) => {
  const lost = seconds.reduce((sum, second) => sum + second.lost, 0);
  return (
    lost /
    Math.max(
      lost,
      seconds.reduce((sum, second) => sum + second.chunks, 0),
      1,
    )
  );
};
const median = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : undefined;
const recurs = (seconds: LossSecond[]) =>
  seconds.length === windowSeconds &&
  [seconds.slice(0, windowSeconds / 2), seconds.slice(windowSeconds / 2)].every((half) =>
    half.some((second) => second.lost > 0),
  );

function watch(late: LateSteps, kept: LossSecond[]): LateSteps {
  const seconds = kept.slice(-2 * windowSeconds),
    recent = seconds.slice(-windowSeconds);
  if (!recurs(recent)) return { ...late, seconds, phase: { kind: "watching" } };
  const before = seconds.length > windowSeconds ? seconds.slice(0, -windowSeconds) : recent;
  const marginMs = median(recent.flatMap((second) => second.marginMs ?? []));
  return {
    ...late,
    steps: late.steps + 1,
    seconds: recent,
    phase: { kind: "moving", share: lostShare(before), marginMs, waited: 0 },
  };
}

export function nextLateSteps(late: LateSteps, second: LossSecond): LateSteps {
  const seconds = [...late.seconds, second],
    { phase } = late;
  switch (phase.kind) {
    case "watching":
      return watch(late, seconds);
    case "moving":
      if (
        phase.marginMs !== undefined &&
        second.marginMs !== undefined &&
        second.marginMs >= phase.marginMs + liveStepMs / 2
      )
        return { ...late, seconds: [], phase: { kind: "judging", share: phase.share } };
      if (phase.waited + 1 < movingSeconds)
        return { ...late, seconds, phase: { ...phase, waited: phase.waited + 1 } };
      return watch(late, seconds.slice(-windowSeconds));
    case "judging":
      if (seconds.length < windowSeconds) return { ...late, seconds };
      if (lostShare(seconds) < phase.share) return watch(late, seconds);
      return {
        ...late,
        unhelpful: late.unhelpful + 1,
        seconds: [],
        phase: { kind: "pausing", left: pauseSeconds * 2 ** late.unhelpful },
      };
    case "pausing":
      return phase.left > 1
        ? { ...late, phase: { kind: "pausing", left: phase.left - 1 } }
        : { ...late, phase: { kind: "watching" } };
  }
}
export const withLateSteps = (needMs: number, lateSteps: number) =>
  Math.min(limitMs, needMs + lateSteps * liveStepMs);
