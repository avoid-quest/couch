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
// - Loss recurs when the last ten seconds lost chunks in two separate spells, or in three seconds
//   running, or when the last minute lost chunks in three separate spells. One stall doesn't step: a
//   burst's late chunks are counted within two seconds (the count waits 100 ms past each start), and
//   its loss is over before a step could tell whether it helped. The minute: on the rig, a phone at
//   150 ms lost sound every 20 to 30 s and chunks every 25 to 90 s (late arrivals over Wi-Fi), never
//   twice in ten seconds, and 25 ms more would have cut most of it; three spells in a minute is a
//   pattern, not a one-off.
// - Core has applied a step when its chunks leave it half a step further ahead of their stamps
//   (send_ahead, which Core writes as it sends, so the network can't move it). A step not seen within
//   3 s fell in the room's slack: recurring loss steps again at once.
// - A step is judged when loss recurs after it: the chunks lost in the ten seconds that show it
//   against those of the ten seconds that caused it. The same rule picked both, so neither is clean by
//   construction. The player slews to a step for about 12 s, but a loss on the way places its next
//   chunk at the new step at once, so loss that recurs is the step's.
//   Half as many or fewer: it helped, and the next step follows. Two windows of loss no step changes
//   rarely differ that much by chance. Spells over a minute never show that a step helped: each
//   minute that recurs holds three or more, and one spell's chunks would look like half a ten-second
//   window's. Otherwise no step for 1, 2, 4, 8, then at most 16 minutes; after that, recurring loss
//   steps again. A step that helped, or 16 minutes with no recurring loss, starts the pauses from a
//   minute again. In a long listen, steps that don't help stay about four an hour, and loss a step
//   would cure waits at most 16 minutes.
// Steps only add up: Core never moves a listener earlier while it listens.
export type LossSecond = { chunks: number; lost: number; sendAheadMs?: number };
// Recurring loss: chunks lost in the ten seconds it recurred in, or spells in the minute.
type Recurring = { measure: "chunks" | "spells"; count: number };
type Phase =
  | { kind: "watching" }
  | { kind: "moving"; caused: Recurring; sendAheadMs?: number; waited: number }
  | { kind: "pausing"; left: number };
export type LateSteps = {
  steps: number;
  unhelpful: number;
  // The loss that caused the last step Core applied, until it's judged.
  caused?: Recurring;
  // Seconds since loss last recurred.
  clean: number;
  // The last minute.
  seconds: LossSecond[];
  phase: Phase;
};
export const noLateSteps: LateSteps = {
  steps: 0,
  unhelpful: 0,
  clean: 0,
  seconds: [],
  phase: { kind: "watching" },
};
const windowSeconds = 10;
const horizonSeconds = 60;
const horizonSpells = 3;
// Core stamps its next chunk with a new declaration, which reaches the listener after its transit
// (well under a second even on the rig's Wi-Fi): a step not seen by then wasn't applied.
const movingSeconds = 3;
const pauseSeconds = 60;
const longestPauseSeconds = 16 * 60;

const lostIn = (seconds: LossSecond[]) => seconds.reduce((sum, second) => sum + second.lost, 0);
const median = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : undefined;
// Separate spells (a clean second between them), and the longest run of lossy seconds.
function spellsIn(seconds: LossSecond[]) {
  let spells = 0,
    running = 0,
    longest = 0;
  for (const second of seconds) {
    running = second.lost > 0 ? running + 1 : 0;
    if (running === 1) spells++;
    longest = Math.max(longest, running);
  }
  return { spells, longest };
}
function recurs(seconds: LossSecond[]): Recurring | undefined {
  if (seconds.length < windowSeconds) return undefined;
  const window = seconds.slice(-windowSeconds);
  const recent = spellsIn(window);
  if (recent.spells >= 2 || recent.longest >= 3)
    return { measure: "chunks", count: lostIn(window) };
  const { spells } = spellsIn(seconds);
  return spells >= horizonSpells ? { measure: "spells", count: spells } : undefined;
}

const step = (late: LateSteps, seconds: LossSecond[], caused: Recurring): LateSteps => ({
  ...late,
  steps: late.steps + 1,
  seconds,
  clean: 0,
  phase: {
    kind: "moving",
    caused,
    sendAheadMs: median(seconds.flatMap((second) => second.sendAheadMs ?? [])),
    waited: 0,
  },
});

const watching: Phase = { kind: "watching" };

function move(late: LateSteps, phase: Phase & { kind: "moving" }, second: LossSecond): LateSteps {
  const seconds = [...late.seconds, second].slice(-horizonSeconds);
  const applied =
    phase.sendAheadMs !== undefined &&
    second.sendAheadMs !== undefined &&
    second.sendAheadMs >= phase.sendAheadMs + liveStepMs / 2;
  // The second it lands in is its changeover.
  if (applied) return { ...late, caused: phase.caused, seconds: [], phase: watching };
  if (phase.waited + 1 < movingSeconds)
    return { ...late, seconds, phase: { ...phase, waited: phase.waited + 1 } };
  const recurring = recurs(seconds);
  return recurring ? step(late, seconds, recurring) : { ...late, seconds, phase: watching };
}

export function nextLateSteps(late: LateSteps, second: LossSecond): LateSteps {
  const { phase } = late;
  if (phase.kind === "moving") return move(late, phase, second);
  const seconds = [...late.seconds, second].slice(-horizonSeconds);
  const recurring = recurs(seconds);
  const clean = recurring ? 0 : late.clean + 1;
  const next: LateSteps =
    clean >= longestPauseSeconds
      ? { ...late, seconds, clean, unhelpful: 0, caused: undefined }
      : { ...late, seconds, clean };
  if (phase.kind === "pausing")
    return {
      ...next,
      phase: phase.left > 1 ? { kind: "pausing", left: phase.left - 1 } : watching,
    };
  if (!recurring) return next;
  const { caused } = next;
  if (caused === undefined) return step(next, seconds, recurring);
  if (
    recurring.measure === "chunks" &&
    caused.measure === "chunks" &&
    recurring.count * 2 <= caused.count
  )
    return step({ ...next, unhelpful: 0 }, seconds, recurring);
  return {
    ...next,
    unhelpful: next.unhelpful + 1,
    caused: undefined,
    phase: {
      kind: "pausing",
      left: Math.min(longestPauseSeconds, pauseSeconds * 2 ** next.unhelpful),
    },
  };
}
export const withLateSteps = (needMs: number, lateSteps: number) =>
  Math.min(limitMs, needMs + lateSteps * liveStepMs);
