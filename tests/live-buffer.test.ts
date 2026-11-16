import { expect, test } from "bun:test";
import { declareLiveBuffer } from "../src/client/session/live-buffer";
import { createLiveLead } from "../src/server/live-lead";

const steady = (latency: number) => Array(5).fill(latency);

test("a Receiver declares only its own need, once it has five readings", () => {
  expect(declareLiveBuffer(undefined)).toBeUndefined();
  expect(declareLiveBuffer(undefined, [40, 40, 40, 40])).toBeUndefined();
  // Need = median reading + 35 ms allowance; the host's room delay isn't part of it.
  expect(declareLiveBuffer(undefined, steady(40))).toBe(75);
  expect(declareLiveBuffer(undefined, steady(0))).toBe(35);
});

test("a declaration rises only when the smoothed need clearly outgrows it", () => {
  expect(declareLiveBuffer(75, steady(65))).toBe(75);
  expect(declareLiveBuffer(75, steady(66))).toBe(101);
  expect(declareLiveBuffer(75, [42, 900, 42, 900, 42])).toBe(75);
  expect(declareLiveBuffer(250, steady(27))).toBe(250);
});

test("the declaration respects Core's 5000 ms timing limit", () => {
  expect(declareLiveBuffer(150, steady(4990))).toBe(5000);
});

// Five seconds of chunks that took `ms` from capture to Core, then one more to close the fifth.
const measure = (lead: ReturnType<typeof createLiveLead>, ms: number, from = 0) => {
  for (let second = from; second <= from + 5; second++)
    lead.arrived((second * 1000 + 500 - ms) * 1000, (second * 1000 + 500) * 1000);
};

test("no listener's declaration raises the room's delay; one that doesn't fit plays a step later", () => {
  const lead = createLiveLead(100);
  measure(lead, 12);
  expect(lead.leadMs("earbuds", 75)).toBe(100);
  expect(lead.leadMs("bluetooth", 200)).toBe(225);
  expect(lead.leadMs("earbuds", 75)).toBe(100);
  expect(lead.roomMs).toBe(100);
});

test("Core's measured input-side time counts towards each listener's need", () => {
  const lead = createLiveLead(100);
  expect(lead.leadMs("phone", 80)).toBe(100);
  measure(lead, 30);
  expect(lead.leadMs("phone", 80)).toBe(125);
});

test("a listener's step only rises while it listens, and resets when it leaves", () => {
  const lead = createLiveLead(50);
  expect(lead.leadMs("phone", 110)).toBe(125);
  expect(lead.leadMs("phone", 0)).toBe(125);
  lead.left("phone");
  expect(lead.leadMs("phone", 0)).toBe(50);
});

test("one slow second doesn't move the input-side time", () => {
  const lead = createLiveLead(50);
  measure(lead, 10);
  lead.arrived(5_000_000, 5_900_000);
  measure(lead, 10, 6);
  expect(lead.leadMs("wired", 40)).toBe(50);
});
