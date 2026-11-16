import { expect, test } from "bun:test";
import {
  declareLiveBuffer,
  nextLateSteps,
  noLateSteps,
  withLateSteps,
  type LateSteps,
  type LossSecond,
} from "../src/client/session/live-buffer";
import { createLiveLead } from "../src/server/live-lead";

const steady = (latency: number) => Array(5).fill(latency);

test("a Receiver declares only its own need, from its first reading", () => {
  expect(declareLiveBuffer(undefined)).toBeUndefined();
  // Need = reading + the player's 15 ms scheduling batch; the host's room delay isn't part of it.
  expect(declareLiveBuffer(undefined, [40])).toBe(55);
  expect(declareLiveBuffer(undefined, steady(40))).toBe(55);
  expect(declareLiveBuffer(undefined, steady(0))).toBe(15);
});

test("after the first reading, only the median of five raises the declaration", () => {
  expect(declareLiveBuffer(75, [40, 200])).toBe(75);
  expect(declareLiveBuffer(75, [40, 200, 200, 200])).toBe(75);
  expect(declareLiveBuffer(75, [40, 200, 200, 200, 200])).toBe(215);
});

test("a declaration rises only when the smoothed need clearly outgrows it", () => {
  expect(declareLiveBuffer(75, steady(85))).toBe(75);
  expect(declareLiveBuffer(75, steady(86))).toBe(101);
  expect(declareLiveBuffer(75, [42, 900, 42, 900, 42])).toBe(75);
  expect(declareLiveBuffer(250, steady(27))).toBe(250);
});

test("the declaration respects Core's 5000 ms timing limit", () => {
  expect(declareLiveBuffer(150, steady(4990))).toBe(5000);
});

// Seconds of a listener's sound: 50 chunks each, `lost` of them lost, arriving `margin` ms early.
const second = (lost = 0, marginMs = 100): LossSecond => ({ chunks: 50, lost, marginMs });
const run = (late: LateSteps, seconds: LossSecond[]) => seconds.reduce(nextLateSteps, late);
const repeat = (count: number, each: LossSecond) => Array<LossSecond>(count).fill(each);
// Ten seconds that lose one chunk in each half: loss that recurs.
const recurring = (lost = 1, marginMs = 100) => [
  ...repeat(4, second(0, marginMs)),
  second(lost, marginMs),
  ...repeat(4, second(0, marginMs)),
  second(lost, marginMs),
];

test("a listener steps when loss recurs through ten seconds, not for one stall however long", () => {
  // One stall: 20 chunks lost at once.
  expect(run(noLateSteps, [...repeat(9, second()), second(20)]).steps).toBe(0);
  expect(run(noLateSteps, [second(20), ...repeat(20, second())]).steps).toBe(0);
  // Two lossy seconds in five, every five seconds: it steps.
  expect(run(noLateSteps, recurring()).steps).toBe(1);
  // Not before ten seconds are in.
  expect(run(noLateSteps, recurring().slice(1)).steps).toBe(0);
});

test("a step is judged only once Core applied it, after its changeover second", () => {
  let late = run(noLateSteps, recurring(2));
  expect(late.phase.kind).toBe("moving");
  // Core hasn't moved it yet: chunks arrive with the same time left.
  late = run(late, [second(2)]);
  expect(late.phase.kind).toBe("moving");
  // They arrive a step earlier relative to their stamp: applied. That second doesn't count.
  late = run(late, [second(20, 125)]);
  expect(late).toMatchObject({ steps: 1, seconds: [], phase: { kind: "judging" } });
});

test("a step Core didn't apply, because the room's delay had slack, isn't judged: loss steps again", () => {
  const late = run(noLateSteps, [...recurring(2), ...repeat(3, second(1))]);
  expect(late).toMatchObject({ steps: 2, unhelpful: 0, phase: { kind: "moving" } });
});

test("a step that cut the share lost is kept and stepping goes on while loss recurs", () => {
  let late = run(noLateSteps, [...recurring(4), second(0, 125)]);
  // Half the loss, still recurring: another step at once.
  late = run(late, recurring(2, 125));
  expect(late).toMatchObject({ steps: 2, unhelpful: 0, phase: { kind: "moving" } });
  // Cured: it stays.
  late = run(late, [second(0, 150), ...repeat(30, second(0, 150))]);
  expect(late).toMatchObject({ steps: 2, phase: { kind: "watching" } });
});

test("a step that didn't cut the loss pauses stepping, longer each time, and never for good", () => {
  let late = run(noLateSteps, [...recurring(), second(0, 125), ...recurring(1, 125)]);
  expect(late).toMatchObject({ steps: 1, unhelpful: 1, phase: { kind: "pausing", left: 60 } });
  // Still losing during the pause: no step.
  late = run(late, repeat(59, second(1, 125)));
  expect(late.steps).toBe(1);
  // After it, recurring loss steps again; another step that doesn't help pauses twice as long.
  late = run(late, [second(1, 125), ...recurring(1, 125)]);
  expect(late).toMatchObject({ steps: 2, phase: { kind: "moving" } });
  late = run(late, [second(0, 150), ...recurring(1, 150)]);
  expect(late).toMatchObject({ steps: 2, unhelpful: 2, phase: { kind: "pausing", left: 120 } });
});

test("a step is weighed against the ten seconds before the loss that caused it", () => {
  // Clean, then loss that recurs: less loss after the step still isn't less than before it.
  const late = run(noLateSteps, [
    ...repeat(10, second()),
    ...recurring(4),
    second(0, 125),
    ...recurring(1, 125),
  ]);
  expect(late).toMatchObject({ steps: 1, unhelpful: 1, phase: { kind: "pausing" } });
});

test("steady loss that no step changes climbs at most six steps in an hour", () => {
  let late = noLateSteps,
    marginMs = 100;
  for (let second = 0; second < 3600; second++) {
    const before = late.steps;
    // Every second loses chunks, whatever the step.
    late = nextLateSteps(late, { chunks: 50, lost: 1, marginMs });
    if (late.steps > before) marginMs += 25;
  }
  expect(late.steps).toBeLessThanOrEqual(6);
});

test("each late step adds one step to the declaration, within Core's limit", () => {
  expect(withLateSteps(75, 0)).toBe(75);
  expect(withLateSteps(75, 1)).toBe(100);
  expect(withLateSteps(4990, 1)).toBe(5000);
});

test("a declaration one step higher moves a listener at most one step later", () => {
  const lead = createLiveLead(100);
  measure(lead, 15);
  // In the room with slack: it stays until its need outgrows the room, then plays a step later.
  expect(lead.leadMs("phone", "opus", withLateSteps(60, 1))).toBe(100);
  expect(lead.leadMs("phone", "opus", withLateSteps(60, 2))).toBe(125);
  // Already a step later: one more.
  expect(lead.leadMs("phone", "opus", withLateSteps(60, 3))).toBe(150);
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
  expect(lead.leadMs("bluetooth", "opus", 200)).toBe(225);
  expect(lead.leadMs("earbuds", "opus", 75)).toBe(100);
  expect(lead.roomMs).toBe(100);
});

test("Core's measured input-side time counts towards each listener's need", () => {
  const lead = createLiveLead(100);
  expect(lead.leadMs("phone", "opus", 80)).toBe(100);
  measure(lead, 30);
  expect(lead.leadMs("phone", "opus", 80)).toBe(125);
});

test("a listener waits in the room for the input side, then moves once, within two seconds", () => {
  const lead = createLiveLead(50);
  // The encoder's start: its backlog arrives late and doesn't count.
  lead.arrived("opus", 0, 300_000);
  expect(lead.leadMs("phone", "opus", 75)).toBe(50);
  measure(lead, 15, 0, 2);
  expect(lead.leadMs("phone", "opus", 75)).toBe(100);
});

test("each wire has its own input-side time", () => {
  const lead = createLiveLead(100);
  measure(lead, 40, 0, 6, "opus");
  measure(lead, 10, 0, 6, "pcm");
  expect(lead.leadMs("phone", "opus", 75)).toBe(125);
  expect(lead.leadMs("laptop", "pcm", 75)).toBe(100);
});

test("a listener's step only rises while it listens, and resets when it leaves", () => {
  const lead = createLiveLead(50);
  measure(lead, 0, 0, 2);
  expect(lead.leadMs("phone", "opus", 110)).toBe(125);
  expect(lead.leadMs("phone", "opus", 0)).toBe(125);
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

test("with no room delay, a listener waits for its need, and needs in the same step play together", () => {
  const lines: string[] = [];
  const lead = createLiveLead(0, (line) => lines.push(line));
  measure(lead, 26);
  // Not measured yet: it waits at the room's 0, where Core sends it nothing.
  expect(lead.leadMs("phone", "opus", undefined, "Phone")).toBe(0);
  // 55 + 26 and 70 + 26 both round up to 100.
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(100);
  expect(lead.leadMs("laptop", "opus", 70, "Laptop")).toBe(100);
  expect(lead.leadMs("wired", "opus", 47, "Wired")).toBe(75);
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(100);
  expect(lines).toEqual([
    "live input side opus: 26 ms",
    'live listener "Phone" opus: declares 55 ms, input side 26 ms, plays 100 ms after capture (room 0 ms)',
    'live listener "Laptop" opus: declares 70 ms, input side 26 ms, plays 100 ms after capture (room 0 ms)',
    'live listener "Wired" opus: declares 47 ms, input side 26 ms, plays 75 ms after capture (room 0 ms)',
  ]);
});

test("a restarted capture keeps its input side until the new encoder's is measured", () => {
  const lines: string[] = [];
  const lead = createLiveLead(0, (line) => lines.push(line));
  measure(lead, 26);
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(100);
  lead.restart();
  // Listeners play again at once, at the step the last input side gives.
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(100);
  // The new encoder's own, once measured, replaces it, lower or not.
  measure(lead, 10, 100, 2);
  expect(lead.leadMs("laptop", "opus", 55, "Laptop")).toBe(75);
  expect(lines).toContain("live input side opus: 10 ms");
});

test("a listener's log line comes at most every ten seconds unless its step rose", () => {
  const lines: string[] = [];
  let now = 0;
  const lead = createLiveLead(
    0,
    (line) => lines.push(line),
    () => now,
  );
  measure(lead, 26);
  lines.length = 0;
  for (let flip = 0; flip < 100; flip++) lead.leadMs("phone", "opus", flip % 2 ? 50 : 55, "Phone");
  expect(lines).toHaveLength(1);
  now = 10_000;
  lead.leadMs("phone", "opus", 55, "Phone");
  // A step later is always logged.
  lead.leadMs("phone", "opus", 80, "Phone");
  expect(lines).toHaveLength(3);
  // Leaving and joining again at the same step isn't.
  lead.left("phone");
  lead.leadMs("phone", "opus", 80, "Phone");
  expect(lines).toHaveLength(3);
});
