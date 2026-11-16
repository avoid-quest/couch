import { liveReadings, liveStep, risenNeed } from "../shared/live-need";

type Wire = "opus" | "pcm";

// One Live run's timing, or sender-timed AirPlay's with a room delay of 0. The room's delay is the
// host's setting and nothing a listener declares moves it. A listener whose own need (its
// declaration and Sync delay, plus Core's measured input-side time) doesn't fit plays on its own,
// a step later: the same chunks, stamped later.
export function createLiveLead(roomMs: number) {
  // Each wire has its own input-side time: its frames take their own time to fill.
  const inputs = new Map<
    Wire,
    { firstUs: number; second: number; highest: number; readings: number[]; ms?: number }
  >();
  const steps = new Map<string, number>();
  return {
    roomMs,
    // Capture to sending, for each chunk as Core gets it from the encoder: the sound card's buffer,
    // the transfer and the encoder, whatever card it is. Each second keeps its highest time, since
    // a typical one would leave the slower chunks of that second late. Negative for sound stamped
    // with a time still to come (sender-timed AirPlay): how early it arrives.
    arrived(wire: Wire, capturedAtUs: number, nowUs: number) {
      const input = inputs.get(wire) ?? {
        firstUs: nowUs,
        second: 0,
        highest: -Infinity,
        readings: [],
      };
      inputs.set(wire, input);
      const second = Math.floor((nowUs - input.firstUs) / 1e6);
      if (second !== input.second) {
        // The first second holds the encoder's start: what was captured while it started arrives
        // late, all at once, and would set every step too high for the rest of the run.
        if (input.second > 0) {
          input.readings = [...input.readings, input.highest].slice(-liveReadings);
          input.ms = risenNeed(input.ms, input.readings);
        }
        input.second = second;
        input.highest = -Infinity;
      }
      input.highest = Math.max(input.highest, (nowUs - capturedAtUs) / 1000);
    },
    // A listener's lead only rises while it listens, so nobody slips back and forth. It waits in
    // the room until its wire's input side is known, so it moves at most once to its first step.
    leadMs(clientId: string, wire: Wire, declaredMs: number) {
      const inputMs = inputs.get(wire)?.ms;
      if (inputMs === undefined) return steps.get(clientId) ?? roomMs;
      const need = declaredMs + inputMs;
      const step = Math.max(steps.get(clientId) ?? roomMs, need > roomMs ? liveStep(need) : roomMs);
      steps.set(clientId, step);
      return step;
    },
    left(clientId: string) {
      steps.delete(clientId);
    },
  };
}
