import { liveLateStepMs, risenNeed } from "../../shared/live-need";

// What a listener declares is its own output-side need; Core adds its measured input-side time and
// plays it at that need rounded up to a step. The need is what the player measures and what it
// structurally takes, nothing more:
// - syncInfo.outputLatencyMs: the device's reported output latency (SDK 6.0.0's raw reading). The
//   player starts each chunk that much before its time, and drops it when that start has passed.
// - the player's scheduling batch: it handles received chunks 15 ms after the first of them
//   (scheduler.js scheduleQueueProcessing, setTimeout(..., 15)), so a chunk may wait that long.
// Decoding and the network aren't measured: a listener that loses chunks to them counts that
// itself and asks for 10 ms steps (nextLateSteps).
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
//   pattern, not a one-off. Each step is 10 ms (liveLateStepMs): a listener ends at most that much
//   past the delay that stops its loss.
// - Core has applied a step when its chunks leave it half a step further ahead of their stamps
//   (send_ahead, which Core writes as it sends, so the network can't move it). With no room delay
//   Core applies every step a listener asks for, short of its 5 s limit; one not seen within 3 s
//   wasn't applied, isn't judged, and isn't remembered.
// - A step is judged when loss recurs after it: the chunks lost in the ten seconds that show it
//   against those of the ten seconds that caused it. The same rule picked both, so neither is clean by
//   construction. The player slews to a step for about 8 s, but a loss on the way places its next
//   chunk at the new step at once, so loss that recurs is the step's.
//   Half as many or fewer: it helped, and the next step follows. Two windows of loss no step changes
//   rarely differ that much by chance. Spells over a minute never show that a step helped: each
//   minute that recurs holds three or more, and one spell's chunks would look like half a ten-second
//   window's. Otherwise no step for 24, 48, 96, 192, then at most 384 s; after that, recurring loss
//   steps again. A step that helped, or 16 minutes with no recurring loss, starts the pauses from
//   24 s again. Pauses are 2.4 s per ms of step: a 10 ms step rarely halves a broad tail of late
//   arrivals that 30 or 50 ms would cure, so it takes a few steps judged unhelpful, and the pauses
//   keep what they add per hour, not their count. In a long listen, steps that don't help stay
//   about nine an hour (90 ms), and loss a step would cure waits at most 6.4 minutes.
// Steps only add up: Core never moves a listener earlier while it listens.
// slackMs: the least time a chunk the player started that second had before its start passed.
export type LossSecond = { chunks: number; lost: number; sendAheadMs?: number; slackMs?: number };
// Recurring loss: chunks lost in the ten seconds it recurred in, or spells in the minute.
type Recurring = { measure: "chunks" | "spells"; count: number };
type Phase =
  | { kind: "watching" }
  | { kind: "moving"; caused: Recurring; sendAheadMs?: number; waited: number }
  | { kind: "pausing"; left: number };
export type LateSteps = {
  steps: number;
  // Of those, the steps Core applied that weren't judged unhelpful, and those the listen started
  // with, which are never doubted.
  kept: number;
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
  kept: 0,
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
const pauseSeconds = 2.4 * liveLateStepMs;
const longestPauseSeconds = 16 * pauseSeconds;
const forgetSeconds = 16 * 60;

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

// A step that's taken is past judging: the one before it helped, or was never judged.
const step = (late: LateSteps, seconds: LossSecond[], caused: Recurring): LateSteps => ({
  ...late,
  steps: late.steps + 1,
  caused: undefined,
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
    second.sendAheadMs >= phase.sendAheadMs + liveLateStepMs / 2;
  // The second it lands in is its changeover.
  if (applied)
    return { ...late, kept: late.kept + 1, caused: phase.caused, seconds: [], phase: watching };
  if (phase.waited + 1 < movingSeconds)
    return { ...late, seconds, phase: { ...phase, waited: phase.waited + 1 } };
  return { ...late, seconds, phase: watching };
}

export function nextLateSteps(late: LateSteps, second: LossSecond): LateSteps {
  const { phase } = late;
  if (phase.kind === "moving") return move(late, phase, second);
  const seconds = [...late.seconds, second].slice(-horizonSeconds);
  const recurring = recurs(seconds);
  const clean = recurring ? 0 : late.clean + 1;
  const next: LateSteps =
    clean >= forgetSeconds
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
  // Core never moves a listener earlier while it listens: the step stays until the listen ends.
  return {
    ...next,
    kept: next.kept - 1,
    unhelpful: next.unhelpful + 1,
    caused: undefined,
    phase: {
      kind: "pausing",
      left: Math.min(longestPauseSeconds, pauseSeconds * 2 ** next.unhelpful),
    },
  };
}
export const withLateSteps = (needMs: number, lateSteps: number) =>
  Math.min(limitMs, needMs + lateSteps * liveLateStepMs);

// A device remembers, per Couch, the late steps a listen ended at that held, so a listener that
// leaves and joins again, or reloads, starts there instead of losing chunks to find them again. A
// step holds when Core applied it and it wasn't judged unhelpful: it helped, or the last minute,
// all of it after the step, lost nothing. A listen that ends before its step is judged can't tell
// whether loss would have recurred; only a lossless minute keeps that step, so loss no step cures
// doesn't ratchet across joins. The next listen starts with them as steps never doubted, and
// judges only its own.
// A remembered step comes off only on evidence: a minute of listening at it (`spare`, over any
// number of listens), at one placement, in which no chunk was lost and every chunk the player
// started had two steps' slack. A step earlier each would still have had a step's slack. A device
// that stepped because loss kept recurring sees that loss as chunks with less, so it stays.
type Remembered = { steps: number; spare: number };
// The placement the spare seconds were counted at: Core's send_ahead. Not stored: a listen that
// joins again starts its own.
export type Evidence = Remembered & { sendAheadMs?: number };
const spareMs = 2 * liveLateStepMs;
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
// What the next listen starts from; anything malformed counts as nothing learned.
export function startingSteps(saved: unknown): Remembered {
  const { steps, spare } = (saved ?? {}) as Remembered;
  if (!isCount(steps) || !isCount(spare) || steps > limitMs / liveLateStepMs)
    return { steps: 0, spare: 0 };
  return steps > 0 && spare >= horizonSeconds ? { steps: steps - 1, spare: 0 } : { steps, spare };
}
export const restoredLateSteps = (steps: number): LateSteps => ({
  ...noLateSteps,
  steps,
  kept: steps,
});
// The rule's seconds start again when Core applies a step, and keep the last minute.
const heldSteps = (late: LateSteps) =>
  late.kept -
  (late.caused !== undefined && (late.seconds.length < horizonSeconds || lostIn(late.seconds) > 0)
    ? 1
    : 0);
// After each counted second, with the rule's state after it.
export function nextEvidence(evidence: Evidence, late: LateSteps, second: LossSecond): Evidence {
  const steps = heldSteps(late);
  if (steps !== evidence.steps) return { steps, spare: 0 };
  const { sendAheadMs, slackMs } = second;
  const placedAt = evidence.spare > 0 ? evidence.sendAheadMs : undefined;
  const placed =
    late.steps === steps &&
    late.phase.kind !== "moving" &&
    (placedAt === undefined ||
      sendAheadMs === undefined ||
      Math.abs(sendAheadMs - placedAt) < liveLateStepMs / 2);
  if (!placed || second.lost > 0 || (slackMs !== undefined && slackMs < spareMs))
    return { steps, spare: 0 };
  // A second in which the player started or received nothing shows nothing either way.
  if (slackMs === undefined || sendAheadMs === undefined) return evidence;
  return { steps, spare: evidence.spare + 1, sendAheadMs: placedAt ?? sendAheadMs };
}
