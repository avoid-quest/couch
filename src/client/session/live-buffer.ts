import { liveLateStepMs, risenNeed } from "../../shared/live-need";

// What a listener declares is its own output-side need; Core adds its measured input-side time and
// plays it at that need rounded up to a step. The need is what the player measures and what it
// structurally takes, nothing more:
// - syncInfo.outputLatencyMs: the device's reported output latency (SDK 6.0.0's raw reading). The
//   player starts each chunk that much before its time, and drops it when that start has passed.
// - the player's scheduling batch: it handles received chunks 15 ms after the first of them
//   (scheduler.js scheduleQueueProcessing, setTimeout(..., 15)), so a chunk may wait that long.
// Decoding and the network aren't measured: a listener that loses chunks to them counts that
// itself and asks for late steps (nextLateSteps).
const playerBatchMs = 15;
// Core and Sendspin bound declarations to 5 s.
const limitMs = 5000;

export function declareLiveBuffer(declaredMs: number | undefined, latencyMs: number[] = []) {
  const need = risenNeed(declaredMs, latencyMs, playerBatchMs);
  return need === undefined ? undefined : Math.min(limitMs, need);
}

// A listener that keeps losing chunks to its own lateness needs more than its output side and the
// player's batch: it asks for a late step, and Core moves it that much later. Every second it adds
// what it received and lost, and how late (live-loss.ts).
// - Loss recurs when the last ten seconds lost chunks in two separate spells, or in three seconds
//   running, or when the last minute lost chunks in three separate spells. One stall doesn't step: a
//   burst's late chunks are counted within two seconds (the count waits 100 ms past each start), and
//   its loss is over before a step could tell whether it helped. The minute: on the rig, a phone at
//   150 ms lost sound every 20 to 30 s and chunks every 25 to 90 s (late arrivals over Wi-Fi), never
//   twice in ten seconds, and 25 ms more would have cut most of it; three spells in a minute is a
//   pattern, not a one-off.
// - A step is as large as the lateness that recurred, rounded up to 10 ms (liveLateStepMs): the
//   second latest of the spells that caused it, each as late as its latest lost chunk, or of the
//   seconds of one spell that ran three seconds or more. The second latest, so one spell can't set
//   it, however late: only lateness two spells reached recurs. A dry-out, or loss with no lateness
//   measured, is 0, so loss without two late spells steps 10 ms. On the rig, 10 ms steps took the
//   phone from 75 to 125 ms over two minutes of gaps, one step at a time; a step sized by what it
//   missed by reaches the same place in one. A listener still ends at most 10 ms past the lateness
//   that recurred.
// - Core has applied a step when its chunks leave it half that step further ahead of their stamps
//   (send_ahead, which Core writes as it sends, so the network can't move it). With no room delay
//   Core applies every step a listener asks for, short of its 5 s limit; one not seen within 3 s
//   wasn't applied and isn't judged.
// - A step is judged when loss recurs after it: the chunks lost in the ten seconds that show it
//   against those of the ten seconds that caused it. The same rule picked both, so neither is clean by
//   construction. The player slews to a step (0.3 % slower plays 10 ms later every 3.3 s), but a
//   loss on the way places its next chunk at the new step at once, so loss that recurs is the step's.
//   Half as many or fewer: it helped, and the next step follows. Two windows of loss no step changes
//   rarely differ that much by chance. Spells over a minute never show that a step helped: each
//   minute that recurs holds three or more, and one spell's chunks would look like half a ten-second
//   window's. Otherwise no step for a while; after that, recurring loss steps again. Each 10 ms of
//   steps judged unhelpful pauses 24, 48, 96, 192, then at most 384 s, and a larger step pauses as
//   long as its 10 ms parts would have one after another: a 40 ms step that didn't help pauses
//   24 + 48 + 96 + 192 s. And a step adds at most what 10 ms steps that don't help could add in an
//   hour, less the parts whose pauses fell in the hour before it (mostMs): 130 ms at first. A step
//   is taken before its pause, so without this a few large ones would each come before the pauses
//   that bound them. So loss no step changes climbs no faster than with 10 ms steps, however late:
//   at most 130 ms in a listen's first hour and about 90 ms an hour after, and loss a step would
//   cure waits at most 6.4 minutes. It also keeps a step under the 200 ms at which the player
//   resyncs at once (a jump) instead of slewing. A step that helped, or 16 minutes with no recurring
//   loss, starts the pauses from 24 s again.
// Steps only add up: Core never moves a listener earlier while it listens. Each listen starts with
// none and learns its own: nothing is remembered across listens.
export type LossSecond = {
  chunks: number;
  lost: number;
  sendAheadMs?: number;
  lateMs?: number;
};
// Recurring loss: chunks lost in the ten seconds it recurred in, or spells in the minute, and the
// step it asks for.
type Recurring = {
  measure: "chunks" | "spells";
  count: number;
  stepMs: number;
};
type Phase =
  | { kind: "watching" }
  | { kind: "moving"; caused: Recurring; sendAheadMs?: number; waited: number }
  | { kind: "pausing"; left: number };
export type LateSteps = {
  // The late steps asked for so far, in ms.
  lateMs: number;
  // 10 ms parts of steps judged unhelpful since the pauses last started again.
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
  lateMs: 0,
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
const hourSeconds = 3600;

const lostIn = (seconds: LossSecond[]) => seconds.reduce((sum, second) => sum + second.lost, 0);
const median = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : undefined;
// Separate spells (a clean second between them), each as late as its latest second, and the
// lateness of the seconds of the longest run of lossy seconds.
function spellsIn(seconds: LossSecond[]) {
  const spells: number[] = [];
  let run: number[] = [],
    longest: number[] = [];
  for (const second of seconds) {
    if (second.lost === 0) {
      run = [];
      continue;
    }
    const lateMs = second.lateMs ?? 0;
    if (!run.length) spells.push(lateMs);
    else spells[spells.length - 1] = Math.max(spells.at(-1)!, lateMs);
    run.push(lateMs);
    if (run.length > longest.length) longest = run;
  }
  return { spells, longest };
}
// The step for loss as late as the second latest of these (a lone one is 0), in 10 ms.
function stepFor(lateMs: number[]) {
  const recurred = [...lateMs].sort((a, b) => b - a)[1] ?? 0;
  return Math.max(1, Math.ceil(recurred / liveLateStepMs)) * liveLateStepMs;
}
function recurs(seconds: LossSecond[]): Recurring | undefined {
  if (seconds.length < windowSeconds) return undefined;
  const window = seconds.slice(-windowSeconds);
  const recent = spellsIn(window);
  if (recent.spells.length >= 2)
    return {
      measure: "chunks",
      count: lostIn(window),
      stepMs: stepFor(recent.spells),
    };
  if (recent.longest.length >= 3)
    return {
      measure: "chunks",
      count: lostIn(window),
      stepMs: stepFor(recent.longest),
    };
  const { spells } = spellsIn(seconds);
  return spells.length >= horizonSpells
    ? { measure: "spells", count: spells.length, stepMs: stepFor(spells) }
    : undefined;
}

// The pause after the 10 ms part of steps that didn't help numbered `part`.
const partPause = (part: number) => Math.min(longestPauseSeconds, pauseSeconds * 2 ** part);
// The pause after an unhelpful step: its 10 ms parts' pauses, one after another.
function pauseAfter(unhelpful: number, stepMs: number) {
  let left = 0;
  for (let part = 0; part < stepMs / liveLateStepMs; part++) left += partPause(unhelpful + part);
  return left;
}
// The most a step adds: what 10 ms steps that don't help could add in an hour, the first and those
// whose pauses fit in it, less the parts already added whose pauses fall in the hour before it.
function mostMs(unhelpful: number) {
  let parts = 1;
  // Each further part comes when the pause after the one before it ends.
  for (let ahead = hourSeconds - partPause(unhelpful); ahead >= 0; parts++)
    ahead -= partPause(unhelpful + parts);
  for (let behind = hourSeconds, part = unhelpful - 1; part >= 0; part--) {
    behind -= partPause(part);
    if (behind <= 0) break;
    parts--;
  }
  return Math.max(1, parts) * liveLateStepMs;
}

// A step that's taken is past judging: the one before it helped, or was never judged.
function step(late: LateSteps, seconds: LossSecond[], recurring: Recurring): LateSteps {
  const caused = { ...recurring, stepMs: Math.min(recurring.stepMs, mostMs(late.unhelpful)) };
  return {
    ...late,
    lateMs: late.lateMs + caused.stepMs,
    caused: undefined,
    seconds,
    clean: 0,
    phase: {
      kind: "moving",
      caused,
      sendAheadMs: median(seconds.flatMap((second) => second.sendAheadMs ?? [])),
      waited: 0,
    },
  };
}

const watching: Phase = { kind: "watching" };

function move(late: LateSteps, phase: Phase & { kind: "moving" }, second: LossSecond): LateSteps {
  const seconds = [...late.seconds, second].slice(-horizonSeconds);
  const applied =
    phase.sendAheadMs !== undefined &&
    second.sendAheadMs !== undefined &&
    second.sendAheadMs >= phase.sendAheadMs + phase.caused.stepMs / 2;
  // The second it lands in is its changeover.
  if (applied) return { ...late, caused: phase.caused, seconds: [], phase: watching };
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
    unhelpful: next.unhelpful + caused.stepMs / liveLateStepMs,
    caused: undefined,
    phase: { kind: "pausing", left: pauseAfter(next.unhelpful, caused.stepMs) },
  };
}
export const withLateSteps = (needMs: number, lateMs: number) => Math.min(limitMs, needMs + lateMs);
