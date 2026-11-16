import { liveReadings, liveStep, risenNeed } from "../shared/live-need";

type Wire = "opus" | "pcm";

// One Live run's timing, or sender-timed AirPlay's with a room delay of 0. The room's delay is the
// host's setting, 0 unless an organiser sets a floor, and nothing a listener declares moves it. A
// listener whose own need (its declaration and Sync delay, plus Core's measured input-side time)
// doesn't fit plays on its own, a step later: the same chunks, stamped later. Listeners whose needs
// round up to the same step play together.
// log gets one line each time a wire's input side or a listener's declaration or step changes, so
// the delays real devices get can be read from Couch's log.
export function createLiveLead(roomMs: number, log: (line: string) => void = () => {}) {
  // Each wire has its own input-side time: its frames take their own time to fill.
  const inputs = new Map<
    Wire,
    { firstUs: number; second: number; highest: number; readings: number[]; ms?: number }
  >();
  const listeners = new Map<string, { step: number; declared: number }>();
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
          const before = input.ms;
          input.ms = risenNeed(input.ms, input.readings);
          if (input.ms !== before) log(`live input side ${wire}: ${input.ms} ms`);
        }
        input.second = second;
        input.highest = -Infinity;
      }
      input.highest = Math.max(input.highest, (nowUs - capturedAtUs) / 1000);
    },
    // A listener's lead only rises while it listens, so nobody slips back and forth. It waits in
    // the room until both its wire's input side and its own need are known (undefined: it hasn't
    // measured yet), so it moves at most once to its first step. In a room of 0 it hears nothing
    // while it waits: every chunk would be late.
    leadMs(clientId: string, wire: Wire, declaredMs: number | undefined, name = clientId) {
      const known = listeners.get(clientId);
      const inputMs = inputs.get(wire)?.ms;
      if (inputMs === undefined || declaredMs === undefined) return known?.step ?? roomMs;
      const need = declaredMs + inputMs;
      const step = Math.max(known?.step ?? roomMs, need > roomMs ? liveStep(need) : roomMs);
      if (step !== known?.step || declaredMs !== known.declared)
        log(
          `live listener ${JSON.stringify(name)} ${wire}: declares ${declaredMs} ms, input side ${inputMs} ms, plays ${step} ms after capture (room ${roomMs} ms)`,
        );
      listeners.set(clientId, { step, declared: declaredMs });
      return step;
    },
    left(clientId: string) {
      listeners.delete(clientId);
    },
  };
}
