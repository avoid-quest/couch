import { expect, test } from "bun:test";
import { ClockSource } from "../node_modules/@sendspin/sendspin-js/dist/audio/clock-source.js";
import recorded from "./fixtures/mac-chrome-output-timestamps.json";

function withClock(run: (clock: ClockSource, sample: (now: number, context: number, timestamp: number, raw?: number, latency?: number) => void) => void) {
  const original = globalThis.performance;
  let now = 0;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
  try {
    const clock = new ClockSource();
    run(clock, (at, contextTime, performanceTime, raw = contextTime + .02, latency = .02) => {
      now = at;
      clock.getTimingSnapshot({ currentTime: raw, getOutputTimestamp: () => ({ contextTime, performanceTime }) } as AudioContext, latency);
    });
  } finally { Object.defineProperty(globalThis, "performance", { configurable: true, value: original }); }
}

test("recorded Chrome Mac timestamps prepare within the existing 75-sample startup bound", () => {
  withClock((clock, sample) => {
    let ready = false;
    for (const [now, raw, context, timestamp, base, output] of recorded.rows.slice(0, 75)) {
      sample(now!, context!, timestamp!, raw!, base! + output!);
      ready ||= clock.active === "timestamp";
    }
    expect(ready).toBe(true);
    expect(clock.active).toBe("timestamp");
  });
});

test.each([.94, 1.06])("sustained clock slope %s never prepares", slope => {
  withClock((clock, sample) => {
    for (let i = 0; i < 100; i++) {
      const now = 1000 + i * 40;
      sample(now, i * .04 * slope, now);
      expect(clock.active).toBe("estimated");
    }
    expect(clock.lastRejectReason).toContain("slope");
  });
});

test.each(["stale", "backward"])("prepared clock still immediately rejects %s timestamps", failure => {
  withClock((clock, sample) => {
    for (let i = 0; i < 25; i++) sample(1000 + i * 40, i * .04, 1000 + i * 40);
    expect(clock.active).toBe("timestamp");
    if (failure === "stale") sample(2300, .96, 1960, 1.32);
    else sample(2000, .95, 1950, 1.02);
    expect(clock.active).toBe("estimated");
    expect(clock.lastRejectReason).toContain(failure);
  });
});
