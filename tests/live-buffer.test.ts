import { expect, test } from "bun:test";
import { declareLiveBuffer } from "../src/client/session/live-buffer";
import { createLiveLead } from "../src/server/live-lead";

const steady = (latency: number) => Array(5).fill(latency);

test("a Receiver declares only its own need, from its first reading", () => {
  expect(declareLiveBuffer(undefined)).toBeUndefined();
  // Need = reading + 35 ms allowance; the host's room delay isn't part of it.
  expect(declareLiveBuffer(undefined, [40])).toBe(75);
  expect(declareLiveBuffer(undefined, steady(40))).toBe(75);
  expect(declareLiveBuffer(undefined, steady(0))).toBe(35);
});

test("after the first reading, only the median of five raises the declaration", () => {
  expect(declareLiveBuffer(75, [40, 200])).toBe(75);
  expect(declareLiveBuffer(75, [40, 200, 200, 200])).toBe(75);
  expect(declareLiveBuffer(75, [40, 200, 200, 200, 200])).toBe(235);
});

test("a declaration rises only when the smoothed need clearly outgrows it", () => {
  expect(declareLiveBuffer(75, steady(50))).toBe(75);
  expect(declareLiveBuffer(75, steady(51))).toBe(86);
  expect(declareLiveBuffer(75, [42, 900, 42, 900, 42])).toBe(75);
  expect(declareLiveBuffer(250, steady(27))).toBe(250);
});

test("the declaration respects Core's 5000 ms timing limit", () => {
  expect(declareLiveBuffer(150, steady(4990))).toBe(5000);
});

// Seconds of chunks on one wire that took `ms` from capture to Core, from the run's first second
// (the encoder's start, which doesn't count) through the sixth, then one more to close the last.
const measure = (
  lead: ReturnType<typeof createLiveLead>,
  ms: number,
  from = 0,
  seconds = 6,
  wire: "opus" | "pcm" = "opus",
) => {
  for (let second = from; second <= from + seconds; second++)
    lead.arrived(wire, (second * 1000 + 500 - ms) * 1000, (second * 1000 + 500) * 1000);
};

test("no listener's declaration raises the room's delay; one that doesn't fit plays a step later", () => {
  const lead = createLiveLead(100);
  measure(lead, 12);
  expect(lead.leadMs("earbuds", "opus", 75)).toBe(100);
  expect(lead.leadMs("bluetooth", "opus", 200)).toBe(220);
  expect(lead.leadMs("earbuds", "opus", 75)).toBe(100);
  expect(lead.roomMs).toBe(100);
});

test("Core's measured input-side time counts towards each listener's need", () => {
  const lead = createLiveLead(100);
  expect(lead.leadMs("phone", "opus", 80)).toBe(100);
  measure(lead, 30);
  expect(lead.leadMs("phone", "opus", 80)).toBe(110);
});

test("a listener waits in the room for the input side, then moves once, within two seconds", () => {
  const lead = createLiveLead(50);
  // The encoder's start: its backlog arrives late and doesn't count.
  lead.arrived("opus", 0, 300_000);
  expect(lead.leadMs("phone", "opus", 75)).toBe(50);
  measure(lead, 15, 0, 2);
  expect(lead.leadMs("phone", "opus", 75)).toBe(90);
});

test("each wire has its own input-side time", () => {
  const lead = createLiveLead(100);
  measure(lead, 40, 0, 6, "opus");
  measure(lead, 10, 0, 6, "pcm");
  expect(lead.leadMs("phone", "opus", 75)).toBe(120);
  expect(lead.leadMs("laptop", "pcm", 75)).toBe(100);
});

test("a listener's step only rises while it listens, and resets when it leaves", () => {
  const lead = createLiveLead(50);
  measure(lead, 0, 0, 2);
  expect(lead.leadMs("phone", "opus", 110)).toBe(110);
  expect(lead.leadMs("phone", "opus", 0)).toBe(110);
  lead.left("phone");
  expect(lead.leadMs("phone", "opus", 0)).toBe(50);
});

test("one slow second doesn't move the input-side time", () => {
  const lead = createLiveLead(50);
  measure(lead, 10);
  lead.arrived("opus", 6_000_000, 6_900_000);
  measure(lead, 10, 7);
  expect(lead.leadMs("wired", "opus", 40)).toBe(50);
});
