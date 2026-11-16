import { liveReadings, liveStep, risenNeed } from "../shared/live-need";

type Wire = "opus" | "pcm";
const logEveryMs = 10_000;

// One Live run's timing, or sender-timed AirPlay's. Every chunk is stamped at its capture time, and
// each listener plays it at its own need (its declaration and Sync delay, plus Core's measured
// input-side time) rounded up to a 25 ms step: the same chunks, stamped later. Listeners whose
// needs round up to the same step play together.
// log gets one line each time a wire's input side changes, and one when a listener's step rises or
// its declaration changes, at most every ten seconds per listener unless its step rose, so the
// delays real devices get can be read from Couch's log and a client can't flood it.
export function createLiveLead(log: (line: string) => void = () => {}, nowMs = () => Date.now()) {
  // Each wire has its own input-side time: its frames take their own time to fill. held: kept from
  // before the capture restarted, until the new encoder's is measured.
  type Input = { second: number; highest: number; readings: number[]; ms?: number };
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
          input.readings = [...input.readings, input.highest].slice(-liveReadings);
          const before = input.ms;
          input.ms = risenNeed(input.held ? undefined : input.ms, input.readings);
          input.held = false;
          if (input.ms !== before) log(`live input side ${wire}: ${input.ms} ms`);
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
