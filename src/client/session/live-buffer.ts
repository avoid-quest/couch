import { liveLateStepMs, liveReadings, risenNeed } from "../../shared/live-need";

// What a listener declares is its own output-side need; Core adds its measured input-side time and
// plays it at that need rounded up to a step. The need is how far ahead of its time a sample has to
// reach the player:
// - Couch's Live player: the most the context's render clock runs ahead of what's heard
//   (LivePlayer.outputMs, the output's latency and its render callback). Nothing for the player
//   itself: it hands each decoded chunk to the worklet at once.
// - The SDK's player, which Live uses on Android and iOS (sendspin.ts): syncInfo.outputLatencyMs, plus its
//   scheduling batch: it handles received chunks 15 ms after the first of them (scheduler.js
//   scheduleQueueProcessing, setTimeout(..., 15)), so a chunk may wait that long.
// Plus how late chunks reach it, measured before its first sound (measuredLateMs). A listener whose
// network or page gets worse later loses chunks to it, counts that itself and asks for late steps
// (nextLateSteps).
export const sdkBatchMs = 15;
// Core and Sendspin bound declarations to 5 s.
const limitMs = 5000;

// Before its first sound a listener declares 0, and Core sends it its chunks stamped well past any
// need (live-lead.ts measureMs). It plays none of them: it measures how late each reached its player,
// decoded, and declares its need from that, so it starts where those chunks would all have played,
// instead of losing them and stepping later over its first minutes.
// How late a chunk arrived: Core's send_ahead (its stamp less Core's clock as Core wrote it) less
// what was left of it once decoded (its stamp less the synced clock): the network, the page and
// decoding, and any error of the synced clock, which the player's own timing has too. It doesn't
// depend on how late Core stamped the chunk, and Core's input side isn't in it (Core adds that).
export const arrivalLateMs = (sendAheadMs: number, stampUs: number, nowUs: number) =>
  sendAheadMs - (stampUs - nowUs) / 1000;
// It measures for as many seconds as the output side's median takes (liveReadings), so the wait
// grows by about three seconds over the two the output side alone took.
const measureSeconds = liveReadings;
// What this listener adds to its need: the second latest of its seconds' latest arrivals, to the
// nearest ms (the synced clock is good to about one).
// Lateness two seconds reached recurs, as with steps (nextLateSteps); one second's outlier, a single
// stall, doesn't set it. At 200 chunks a second over five seconds, only the latest chunks of one
// second arrive later: about the 99.9th percentile. Any lower and the chunks it leaves out are lost
// in most seconds, which is recurring loss: a step in the first seconds of sound. Undefined until it
// has measured that long.
export function measuredLateMs(seconds: number[]) {
  if (seconds.length < measureSeconds) return undefined;
  const second = [...seconds].sort((a, b) => b - a)[1]!;
  return Math.max(0, Math.round(second));
}

export function declareLiveBuffer(
  declaredMs: number | undefined,
  latencyMs: number[] = [],
  allowanceMs = 0,
) {
  const need = risenNeed(declaredMs, latencyMs, allowanceMs);
  return need === undefined ? undefined : Math.min(limitMs, need);
}

// A listener that keeps losing chunks to its own lateness needs more than its output side: it asks
// for a late step, and Core moves it that much later. Every second it adds what it received and
// lost, and how late (live-timeline.ts, or live-loss.ts for the SDK's player).
// - Loss recurs when the last ten seconds lost chunks in two separate spells, or in three seconds
//   running, or when the last minute lost chunks in three separate spells. One stall doesn't step: a
//   burst's late chunks are counted as they arrive, within two seconds, and
//   its loss is over before a step could tell whether it helped. The minute: on the rig, a phone at
//   150 ms lost sound every 20 to 30 s and chunks every 25 to 90 s (late arrivals over Wi-Fi), never
//   twice in ten seconds, and 25 ms more would have cut most of it; three spells in a minute is a
//   pattern, not a one-off.
// - Loss still running (each of the last three seconds lost chunks) is the clearest case for a step:
//   it steps at once, without ten seconds of history or a pause. Its seconds are as late as the
//   least late of those three: what recurred every second (a late Wi-Fi burst drains over seconds,
//   each less late), or the latest when all three were measured within 10 ms of each other (runStep).
//   On the rig, a phone that lost chunks
//   in most seconds stayed at 115 ms through a three-minute run, with 65 gaps; at 185 to 220 ms it
//   had 3 to 10. Its running loss was one spell, so it stepped 10 ms at a time, and each step that
//   didn't halve it paused 24, 48, then 96 s, as loss no step changes does.
// - A step is as large as the lateness that recurred, rounded up to 10 ms (liveLateStepMs): the
//   second latest of the spells that caused it, each as late as its latest lost chunk, counting only
//   spells with two clean seconds or more between them. The second latest, so one spell can't set
//   it, however late: only lateness two spells reached recurs. One stall's loss can fall either
//   side of a clean second, and one stall of three seconds or more is one spell. A dry-out, or loss
//   with no lateness measured, is 0, so loss without two late spells apart steps 10 ms. On the rig, 10 ms steps took the
//   phone from 75 to 125 ms over two minutes of gaps, one step at a time; a step sized by what it
//   missed by reaches the same place in one. A listener still ends at most 10 ms past the lateness
//   that recurred, or 20 ms past it for running loss whose seconds agreed.
// - Core has applied a step when its chunks leave it half that step further ahead of their stamps
//   (send_ahead, which Core writes as it sends, so the network can't move it). With no room delay
//   Core applies every step a listener asks for, short of its 5 s limit; one not seen within 3 s
//   wasn't applied and isn't judged. The SDK's player is asked a step 10 ms at a time, each part
//   once it slewed to the last (sdkLateSteps): a larger step at once is a gap there. A part it
//   can't be seen slewing to (no sync error reported) follows the last after ten seconds.
// - A step is judged when loss recurs after it: the chunks lost in the ten seconds that show it
//   against those of the ten seconds that caused it. The same rule picked both, so neither is clean by
//   construction. A step for running loss is judged only by running loss, its three seconds against
//   the three that caused it, and helped once a second after it is clean: the loss stopped running.
//   Any other loss after it comes after such a second, so a step that halved the loss counts as
//   helped whatever loss shows it. On the rig, judging it by a ten-second window or by spells over a
//   minute paused a phone whose 30 ms step had cut its loss for the 168 s that followed. The player slews to a step (0.3 % slower plays 10 ms later every 3.3 s), but a
//   loss on the way places its next chunk at the new step at once, so loss that recurs is the step's.
//   On the SDK's player the seconds count only once it slewed to the last part: loss while it's
//   asked part by part happens short of the step.
//   Half as many or fewer: it helped, and the next step follows. Two windows of loss no step changes
//   rarely differ that much by chance. Spells over a minute never show that a step helped: each
//   minute that recurs holds three or more, and one spell's chunks would look like half a ten-second
//   window's. Otherwise no step for a while; after that, recurring loss steps again. Running loss
//   doesn't wait: a step for it that didn't help counts as one, but the next follows at once. Each
//   10 ms of steps judged unhelpful pauses 24, 48, 96, 192, then at most 384 s, and a larger step
//   pauses as long as its 10 ms parts would have one after another, up to 384 s: a 40 ms step that
//   didn't help pauses 24 + 48 + 96 + 192 s. And a step adds at most what 10 ms steps that don't
//   help could add in an hour, less the parts whose pauses fell in the hour before it (mostMs):
//   130 ms at first. A step is taken before its pause, so without this a few large ones would each
//   come before the pauses that bound them. It also keeps a step under the 200 ms at which the
//   worklet places its sound again at once (live-timeline.ts) instead of slewing. Steps in a
//   listen's first hour add at most 130 ms together, and in any hour after at most 90 ms: so loss
//   no step changes, running or not, however late, climbs no faster than with 10 ms steps that
//   pause, and loss a step would cure waits at most 6.4 minutes. A step that helped, or 16 minutes
//   with no recurring loss, starts the pauses from 24 s again, but not the hour: a step can halve
//   the loss by chance, and a cap that came back with it let loss no step changes climb 340 ms in
//   an hour. What a step added comes back only as it falls out of the hour.
// Steps only add up: Core never moves a listener earlier while it listens. Each listen starts with
// none and learns its own: nothing is remembered across listens.
export type LossSecond = {
  chunks: number;
  lost: number;
  sendAheadMs?: number;
  lateMs?: number;
  // The SDK's player's sync error at the sample (syncInfo.syncErrorMs): negative while it still
  // plays earlier than its stamps ask, as it does while it slews to a step. The worklet has none.
  syncErrorMs?: number;
};
// Recurring loss: chunks lost in the ten seconds it recurred in, or spells in the minute, and the
// step it asks for.
// Running loss counts the chunks of its three seconds.
type Recurring = {
  measure: "running" | "chunks" | "spells";
  count: number;
  stepMs: number;
};
type Phase =
  | { kind: "watching" }
  | {
      kind: "moving";
      caused: Recurring;
      sendAheadMs?: number;
      // The parts of the step asked of Core so far, and those it applied.
      askedMs: number;
      landedMs: number;
      waited: number;
    }
  | { kind: "pausing"; left: number };
export type LateSteps = {
  // The late steps asked for so far, in ms.
  lateMs: number;
  // The most of a step asked of Core at once; a larger step is asked in parts (sdkLateSteps).
  partMs?: number;
  // 10 ms parts of steps judged unhelpful since the pauses last started again.
  unhelpful: number;
  // The loss that caused the last step Core applied, until it's judged.
  caused?: Recurring;
  // Seconds since loss last recurred.
  clean: number;
  // Seconds counted so far, and the steps of the last hour: the second each was taken, its ms.
  counted: number;
  taken: { at: number; ms: number }[];
  // The last minute.
  seconds: LossSecond[];
  phase: Phase;
};
export const noLateSteps: LateSteps = {
  lateMs: 0,
  unhelpful: 0,
  clean: 0,
  counted: 0,
  taken: [],
  seconds: [],
  phase: { kind: "watching" },
};
// The SDK's player (scheduler.js and recorrection-monitor.js, sendspin-js 6.0.0) places its sound
// again at once, a gap as long as the step, when a step moves the stamps by 100 ms or more (it
// chains a chunk only within 0.1 s of the last one's end) and also when its smoothed sync error stays
// 30 ms or more for 0.4 s (RECORRECTION_TRIGGER_MS, RECORRECTION_SUSTAIN_MS: a guarded cutover).
// A step shows as that error at once, so it slews only while what it still has to slew stays under
// 30 ms. So it's asked in 10 ms parts (late steps' unit), each once Core applied the last and the
// player slewed it to within 8 ms (rate1AboveMs: below it, it corrects a sample at a time): at
// most 18 ms to slew. It slews 0.3 % (3 ms a second) above 8 ms and a sample each 5 ms chunk
// (4 ms a second) below, so a part takes two to four seconds, and 130 ms under a minute.
export const sdkLateSteps: LateSteps = { ...noLateSteps, partMs: liveLateStepMs };
const settledMs = 8;
// 30 ms slews to 8 in under 8 s at 0.3 %: a player still not within 8 ms after 10 s is off for
// another reason, and the step ends with the parts Core applied.
const slewSeconds = 10;
const windowSeconds = 10;
const runSeconds = 3;
const apartSeconds = 2;
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
// Separate spells (a clean second between them), the longest run of lossy seconds, and how late
// the spells that lie apart were (two clean seconds or more between them), each as late as its
// latest second. One stall's loss can fall either side of a clean second, and a stall of three
// seconds or more is one spell however long: only lateness spells apart reached recurred.
function spellsIn(seconds: LossSecond[]) {
  const apart: number[] = [];
  let spells = 0,
    run = 0,
    longest = 0,
    clean = apartSeconds;
  for (const second of seconds) {
    if (second.lost === 0) {
      run = 0;
      clean++;
      continue;
    }
    const lateMs = second.lateMs ?? 0;
    if (!run) spells++;
    if (clean >= apartSeconds) apart.push(lateMs);
    else apart[apart.length - 1] = Math.max(apart.at(-1)!, lateMs);
    clean = 0;
    longest = Math.max(longest, ++run);
  }
  return { spells, longest, apart };
}
// The step for loss this late, in 10 ms.
const stepOf = (lateMs: number) => Math.max(1, Math.ceil(lateMs / liveLateStepMs)) * liveLateStepMs;
// The step for loss as late as the second latest of these (a lone one is 0).
const stepFor = (lateMs: number[]) => stepOf([...lateMs].sort((a, b) => b - a)[1] ?? 0);
// The step for running loss: as late as the least late of its seconds, what recurred in each. When
// all three were measured within 10 ms of each other the lateness held rather than drained: as late
// as the latest, so lateness the seconds straddle a 10 ms mark with doesn't take a second step.
function runStep(run: LossSecond[]) {
  const lateMs = run.map((second) => second.lateMs ?? 0),
    least = Math.min(...lateMs),
    latest = Math.max(...lateMs);
  const held =
    run.every((second) => second.lateMs !== undefined) && latest - least <= liveLateStepMs;
  return stepOf(held ? latest : least);
}
function recurs(seconds: LossSecond[]): Recurring | undefined {
  const window = seconds.slice(-windowSeconds),
    run = window.slice(-runSeconds);
  if (run.length === runSeconds && run.every((second) => second.lost > 0))
    return { measure: "running", count: lostIn(run), stepMs: runStep(run) };
  if (seconds.length < windowSeconds) return undefined;
  const recent = spellsIn(window);
  if (recent.spells >= 2 || recent.longest >= runSeconds)
    return { measure: "chunks", count: lostIn(window), stepMs: stepFor(recent.apart) };
  const { spells, apart } = spellsIn(seconds);
  return spells >= horizonSpells
    ? { measure: "spells", count: spells, stepMs: stepFor(apart) }
    : undefined;
}

// The pause after the 10 ms part of steps that didn't help numbered `part`.
const partPause = (part: number) => Math.min(longestPauseSeconds, pauseSeconds * 2 ** part);
// The pause after an unhelpful step: its 10 ms parts' pauses, one after another, up to the longest:
// loss a step would cure waits at most 6.4 minutes, however large the step that didn't help. The
// hour (hourMs) still bounds what steps add.
function pauseAfter(unhelpful: number, stepMs: number) {
  let left = 0;
  for (let part = 0; part < stepMs / liveLateStepMs; part++) left += partPause(unhelpful + part);
  return Math.min(longestPauseSeconds, left);
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
// What steps may add in a listen's first hour: what 10 ms steps that don't help add in it (130 ms).
const firstHourMs = mostMs(0);
// And in any hour after it: one 10 ms step each longest pause (90 ms), as loss no step changes
// climbed before running loss stepped without pausing.
const hourMs = Math.floor(hourSeconds / longestPauseSeconds) * liveLateStepMs;

// A step that's taken is past judging: the one before it helped, or was never judged. With the hour
// spent, none is taken until its oldest step falls out of it.
function step(late: LateSteps, seconds: LossSecond[], recurring: Recurring): LateSteps {
  const taken = late.taken.filter(({ at }) => late.counted - at < hourSeconds),
    leftMs =
      (late.counted <= hourSeconds ? firstHourMs : hourMs) -
      taken.reduce((sum, { ms }) => sum + ms, 0);
  const stepMs = Math.min(recurring.stepMs, mostMs(late.unhelpful), leftMs);
  if (stepMs <= 0) return { ...late, seconds, taken, caused: undefined };
  return ask(
    { ...late, taken, caused: undefined, seconds, clean: 0 },
    {
      kind: "moving",
      caused: { ...recurring, stepMs },
      sendAheadMs: median(seconds.flatMap((second) => second.sendAheadMs ?? [])),
      askedMs: 0,
      landedMs: 0,
      waited: 0,
    },
  );
}
// Asks Core for the step's next part.
function ask(late: LateSteps, phase: Moving): LateSteps {
  const partMs = Math.min(phase.caused.stepMs - phase.askedMs, late.partMs ?? Infinity);
  return {
    ...late,
    lateMs: late.lateMs + partMs,
    taken: [...late.taken, { at: late.counted, ms: partMs }],
    phase: { ...phase, askedMs: phase.askedMs + partMs, waited: 0 },
  };
}

const watching: Phase = { kind: "watching" };
type Moving = Phase & { kind: "moving" };

// Loss while a step is asked and slewed to isn't the step's: it's judged from when the player
// plays at all of it, and the seconds before don't count.
function move(late: LateSteps, phase: Moving, second: LossSecond): LateSteps {
  const seconds = [...late.seconds, second].slice(-horizonSeconds);
  const waiting = { ...late, seconds, phase: { ...phase, waited: phase.waited + 1 } };
  const done = (landedMs: number): LateSteps => ({
    ...late,
    caused: { ...phase.caused, stepMs: landedMs },
    seconds: [],
    phase: watching,
  });
  if (phase.askedMs > phase.landedMs) {
    // Core applied the part: its chunks leave half that part further ahead.
    const applied =
      phase.sendAheadMs !== undefined &&
      second.sendAheadMs !== undefined &&
      second.sendAheadMs >= phase.sendAheadMs + (phase.askedMs + phase.landedMs) / 2;
    if (!applied)
      return phase.waited + 1 < movingSeconds ? waiting : { ...late, seconds, phase: watching };
    // The second it lands in is its changeover. The worklet reports no slew: it's judged from then.
    if (second.syncErrorMs === undefined && phase.askedMs === phase.caused.stepMs)
      return done(phase.askedMs);
    return { ...late, seconds, phase: { ...phase, landedMs: phase.askedMs, waited: 0 } };
  }
  const { syncErrorMs } = second,
    settled = syncErrorMs !== undefined && syncErrorMs > -settledMs;
  if (!settled && phase.waited + 1 < slewSeconds) return waiting;
  // A player that reports no sync error can't show it slewed, but any part has by now: the next
  // part follows. One still 8 ms off is off for another reason: the step ends.
  if ((settled || syncErrorMs === undefined) && phase.landedMs < phase.caused.stepMs)
    return ask({ ...late, seconds }, phase);
  return done(phase.landedMs);
}

// Whether the step `caused` caused helped, by loss that recurs after it over a window as long as the
// one that caused it: half as many chunks or fewer. Spells over a minute never show it.
const halved = (caused: Recurring, recurring: Recurring) =>
  caused.measure !== "spells" &&
  caused.measure === recurring.measure &&
  recurring.count * 2 <= caused.count;

export function nextLateSteps(before: LateSteps, second: LossSecond): LateSteps {
  const late = { ...before, counted: before.counted + 1 },
    { phase } = late;
  if (phase.kind === "moving") return move(late, phase, second);
  const seconds = [...late.seconds, second].slice(-horizonSeconds);
  const recurring = recurs(seconds);
  const clean = recurring ? 0 : late.clean + 1;
  // A clean second after a step for running loss: the loss stopped running, and the step helped.
  const stopped = late.caused?.measure === "running" && second.lost === 0;
  const next: LateSteps =
    clean >= forgetSeconds || stopped
      ? { ...late, seconds, clean, unhelpful: 0, caused: undefined }
      : { ...late, seconds, clean };
  const running = recurring?.measure === "running";
  if (phase.kind === "pausing" && !running)
    return {
      ...next,
      phase: phase.left > 1 ? { kind: "pausing", left: phase.left - 1 } : watching,
    };
  if (!recurring) return next;
  const { caused } = next;
  // Running loss after a step for other loss steps unjudged: their windows differ.
  if (caused === undefined || (running && caused.measure !== "running"))
    return step(next, seconds, recurring);
  if (halved(caused, recurring)) return step({ ...next, unhelpful: 0 }, seconds, recurring);
  // Core never moves a listener earlier while it listens: the step stays until the listen ends.
  const unhelpful = next.unhelpful + caused.stepMs / liveLateStepMs;
  // Running loss doesn't pause.
  if (running) return step({ ...next, unhelpful }, seconds, recurring);
  return {
    ...next,
    unhelpful,
    caused: undefined,
    phase: { kind: "pausing", left: pauseAfter(next.unhelpful, caused.stepMs) },
  };
}
export const withLateSteps = (needMs: number, lateMs: number) => Math.min(limitMs, needMs + lateMs);
