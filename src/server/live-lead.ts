import { liveStep, liveStepMs, risenNeed } from "../shared/live-need";

type Wire = "opus" | "pcm";
const logEveryMs = 10_000;
// Once measured, the input side rises only when the median of the last 30 seconds outgrows it, so
// more than half of them must agree. A few slow seconds on Core's host (a busy spell, a pause) would
// otherwise move every listener later for the rest of the run, though the listeners that lose
// chunks in such a spell already step on their own.
const inputReadings = 30;
// A rise reaches listeners one 5 ms step every two seconds, never at once: each listener's step
// then moves at most 5 ms at a time, which both players slew through within those two seconds
// (Couch's at 0.3 %, the SDK's a sample per 5 ms chunk). That stays well under the SDK's 30 ms
// re-place, so a rise is never a jump or a gap.
const inputPartSeconds = 2;
// Couch's own listener declares no need until it has measured how late chunks reach it, before its
// first sound (live-buffer.ts measuredLateMs). Meanwhile Core stamps its chunks this far past the
// input side. It plays none of them and its measurement doesn't depend on their stamps, so this only
// decides which chunks Core sends it: every one that reaches Core within a second of its capture,
// however slow its encoder or the host was, far past any need a listener has shown (the rig's phone
// ended near 170 ms).
const measureMs = 1000;

// One Live run's timing, or sender-timed AirPlay's. Every chunk is stamped at its capture time, and
// each listener plays it at its own need (its declaration and Sync delay, plus Core's measured
// input-side time) rounded up to a 5 ms step: the same chunks, stamped later. Listeners whose
// needs round up to the same step play together; others play a few ms apart.
// log gets one line each time a wire's input side changes, and one when a listener's step rises or
// its declaration changes, at most every ten seconds per listener unless its step rose, so the
// delays real devices get can be read from Couch's log and a client can't flood it.
export function createLiveLead(log: (line: string) => void = () => {}, nowMs = () => Date.now()) {
  // Each wire has its own input-side time: its frames take their own time to fill. ms: what
  // listeners are placed with; risen: what the readings call for, which ms climbs to in parts
  // (partSecond: the last one). held: kept from before the capture restarted, until the new
  // encoder's is measured.
  type Input = {
    second: number;
    highest: number;
    readings: number[];
    ms?: number;
    risen?: number;
    partSecond?: number;
  };
  const inputs = new Map<Wire, Input & { firstUs?: number; held?: boolean }>();
  const listeners = new Map<string, { step: number; declared: number }>();
  const logged = new Map<string, { step: number; atMs: number }>();
  return {
    // Capture to sending, for each chunk as Core gets it from the encoder: the sound card's buffer,
    // the transfer and the encoder, whatever card it is. Each second keeps its highest time, since
    // a typical one would leave the slower chunks of that second late. Negative for sound stamped
    // with a time still to come (sender-timed AirPlay): how early it arrives.
    arrived(wire: Wire, capturedAtUs: number, nowUs: number) {
      const input = inputs.get(wire) ?? { second: 0, highest: -Infinity, readings: [] };
      inputs.set(wire, input);
      input.firstUs ??= nowUs;
      const second = Math.floor((nowUs - input.firstUs) / 1e6);
      if (second !== input.second) {
        // The first second holds the encoder's start: what was captured while it started arrives
        // late, all at once, and would set every step too high for the rest of the run.
        if (input.second > 0) {
          input.readings = [...input.readings, input.highest].slice(-inputReadings);
          const before = { ms: input.ms, risen: input.risen };
          // The first reading places listeners at once (after a restart too: they're placed again).
          if (input.ms === undefined || input.held) {
            input.ms = input.risen = risenNeed(undefined, input.readings)!;
            input.held = false;
          } else {
            input.risen = risenNeed(input.risen, input.readings, 0, inputReadings)!;
            if (
              input.ms < input.risen &&
              second - (input.partSecond ?? -Infinity) >= inputPartSeconds
            ) {
              input.ms = Math.min(input.risen, input.ms + liveStepMs);
              input.partSecond = second;
            }
          }
          if (input.ms !== before.ms || input.risen !== before.risen)
            log(
              `live input side ${wire}: ${input.ms} ms${input.ms < input.risen ? `, rising to ${input.risen} ms` : ""}`,
            );
        }
        input.second = second;
        input.highest = -Infinity;
      }
      input.highest = Math.max(input.highest, (nowUs - capturedAtUs) / 1000);
    },
    // A listener's lead only rises while it listens, so nobody slips back and forth. It waits at 0
    // until both its wire's input side and its own need are known (undefined: it hasn't measured
    // yet), so it moves at most once to its first step. It hears nothing while it waits: every
    // chunk would be late.
    leadMs(clientId: string, wire: Wire, declaredMs: number | undefined, name = clientId) {
      const known = listeners.get(clientId);
      const inputMs = inputs.get(wire)?.ms;
      if (inputMs === undefined || declaredMs === undefined) return known?.step ?? 0;
      const step = Math.max(known?.step ?? 0, liveStep(declaredMs + inputMs));
      const last = logged.get(clientId);
      if (
        (step !== known?.step || declaredMs !== known.declared) &&
        (!last || step > last.step || nowMs() - last.atMs >= logEveryMs)
      ) {
        log(
          `live listener ${JSON.stringify(name)} ${wire}: declares ${declaredMs} ms, input side ${inputMs} ms, plays ${step} ms after capture`,
        );
        logged.set(clientId, { step, atMs: nowMs() });
      }
      listeners.set(clientId, { step, declared: declaredMs });
      return step;
    },
    // Where a listener that hasn't declared its need yet gets its chunks while it measures, before
    // its Sync delay: undefined until the wire's input side is known. Nothing is kept: its first
    // step is the one its declaration asks for, and only that one shows in the log.
    measureMs(wire: Wire) {
      const inputMs = inputs.get(wire)?.ms;
      return inputMs === undefined ? undefined : liveStep(inputMs + measureMs);
    },
    // The capture restarted (a new generation): its encoder starts again and every listener is
    // placed again. Until the new input side is measured (about two seconds), the last one stands
    // in, so listeners keep playing at their steps instead of waiting at 0.
    restart() {
      for (const input of inputs.values()) {
        const held = input.ms !== undefined;
        Object.assign(input, {
          firstUs: undefined,
          second: 0,
          highest: -Infinity,
          readings: [],
          partSecond: undefined,
          held,
        });
      }
      listeners.clear();
    },
    left(clientId: string) {
      listeners.delete(clientId);
    },
  };
}
