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
  // Need = reading + the player's 15 ms scheduling batch.
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
  expect(declareLiveBuffer(75, steady(65))).toBe(75);
  expect(declareLiveBuffer(75, steady(66))).toBe(81);
  expect(declareLiveBuffer(75, [42, 900, 42, 900, 42])).toBe(75);
  expect(declareLiveBuffer(250, steady(27))).toBe(250);
});

test("the declaration respects Core's 5000 ms timing limit", () => {
  expect(declareLiveBuffer(150, steady(4990))).toBe(5000);
});

// Seconds of a listener's sound: 50 chunks each, `lost` of them lost, sent `sendAheadMs` ahead of
// their stamps (Core's send_ahead: 10 ms more once Core applied a step).
const second = (lost = 0, sendAheadMs = 95): LossSecond => ({
  chunks: 50,
  lost,
  sendAheadMs,
});
const chunks = (count: number) => ({ measure: "chunks" as const, count });
const run = (late: LateSteps, seconds: LossSecond[]) => seconds.reduce(nextLateSteps, late);
const repeat = <T>(count: number, each: T) => Array<T>(count).fill(each);
// Ten seconds that lose chunks in two separate spells: loss that recurs.
const recurring = (lost = 1, sendAheadMs = 95) => [
  ...repeat(4, second(0, sendAheadMs)),
  second(lost, sendAheadMs),
  ...repeat(4, second(0, sendAheadMs)),
  second(lost, sendAheadMs),
];

test("a listener steps when loss recurs, not for one stall however its chunks are counted", () => {
  // One stall: 20 chunks lost at once, or a burst the count splits over two seconds.
  expect(run(noLateSteps, [...repeat(9, second()), second(20)]).steps).toBe(0);
  expect(
    run(noLateSteps, [...repeat(4, second()), second(15), second(5), ...repeat(20, second())])
      .steps,
  ).toBe(0);
  // Two spells in ten seconds, or loss three seconds running: it steps.
  expect(run(noLateSteps, recurring()).steps).toBe(1);
  expect(run(noLateSteps, [...repeat(7, second()), ...repeat(3, second(50))]).steps).toBe(1);
  // Not before ten seconds are in.
  expect(run(noLateSteps, recurring().slice(1)).steps).toBe(0);
});

test("a step counts as applied only when Core sends its chunks a step further ahead", () => {
  let late = run(noLateSteps, recurring(2));
  expect(late.phase.kind).toBe("moving");
  // Core hasn't moved it yet, whatever the network does to arrivals.
  late = run(late, [second(0, 99)]);
  expect(late.phase.kind).toBe("moving");
  // Core sends its chunks 10 ms further ahead: applied. That second doesn't count.
  late = run(late, [second(20, 105)]);
  expect(late).toMatchObject({
    steps: 1,
    caused: { measure: "chunks", count: 4 },
    seconds: [],
    phase: { kind: "watching" },
  });
});

test("a step Core didn't apply (at its limit) isn't judged, and recurring loss steps again", () => {
  let late = run(noLateSteps, [...recurring(2), ...repeat(3, second(1))]);
  expect(late).toMatchObject({ steps: 1, phase: { kind: "watching" } });
  expect(late.caused).toBeUndefined();
  late = run(late, [second(1)]);
  expect(late).toMatchObject({ steps: 2, phase: { kind: "moving" } });
});

test("a step after which loss doesn't recur is kept", () => {
  const late = run(noLateSteps, [...recurring(4), second(0, 105), ...repeat(600, second(0, 105))]);
  expect(late).toMatchObject({ steps: 1, phase: { kind: "watching" } });
  // A lone stall later doesn't judge it.
  expect(run(late, [second(30, 105), ...repeat(10, second(0, 105))])).toMatchObject({
    steps: 1,
    unhelpful: 0,
    phase: { kind: "watching" },
  });
});

test("a step that halved the loss is kept and stepping goes on while loss recurs", () => {
  let late = run(noLateSteps, [...recurring(4), second(0, 105)]);
  // Half the loss, still recurring: another step at once.
  late = run(late, recurring(2, 105));
  expect(late).toMatchObject({
    steps: 2,
    unhelpful: 0,
    phase: { kind: "moving" },
  });
  // Cured: it stays.
  late = run(late, [second(0, 115), ...repeat(30, second(0, 115))]);
  expect(late).toMatchObject({ steps: 2, phase: { kind: "watching" } });
});

test("a step that didn't cut the loss pauses stepping, longer each time up to 384 s", () => {
  let late = run(noLateSteps, [...recurring(), second(0, 105), ...recurring(1, 105)]);
  expect(late).toMatchObject({
    steps: 1,
    unhelpful: 1,
    phase: { kind: "pausing", left: 24 },
  });
  // Still losing during the pause: no step.
  late = run(late, [...repeat(50, recurring(1, 105)).flat()].slice(0, 23));
  expect(late.steps).toBe(1);
  // After it, loss that still recurs steps again at once; another step that doesn't help pauses
  // twice as long.
  late = run(late, [second(0, 105), second(1, 105)]);
  expect(late).toMatchObject({ steps: 2, phase: { kind: "moving" } });
  late = run(late, [second(0, 115), ...recurring(1, 115)]);
  expect(late).toMatchObject({
    steps: 2,
    unhelpful: 2,
    phase: { kind: "pausing", left: 48 },
  });
  expect(
    run(
      {
        ...late,
        unhelpful: 6,
        caused: chunks(2),
        seconds: [],
        phase: { kind: "watching" },
      },
      recurring(1, 115),
    ),
  ).toMatchObject({ phase: { kind: "pausing", left: 384 } });
});

test("a step that helps, or a long listen without recurring loss, starts the pauses again", () => {
  const paused: LateSteps = {
    ...noLateSteps,
    steps: 3,
    unhelpful: 3,
    phase: { kind: "watching" },
  };
  // Helped: half the loss of the ten seconds that caused it.
  expect(run({ ...paused, caused: chunks(8) }, recurring(2))).toMatchObject({
    steps: 4,
    unhelpful: 0,
  });
  // Sixteen minutes without recurring loss: the next loss is new, and steps.
  const quiet = run({ ...paused, caused: chunks(2) }, repeat(16 * 60, second()));
  expect(quiet).toMatchObject({ unhelpful: 0, caused: undefined });
  expect(run(quiet, recurring(5))).toMatchObject({
    steps: 4,
    phase: { kind: "moving" },
  });
});

// `count` seconds, one lossy second in each `every` of them, the first at `first`.
const sparse = (count: number, every: number, sendAheadMs = 95, first = every - 1) =>
  Array.from({ length: count }, (_, at) =>
    second(at >= first && (at - first) % every === 0 ? 1 : 0, sendAheadMs),
  );

test("spells that keep coming over a minute step, two in a minute don't", () => {
  // Every 31 s: never three in a minute.
  expect(run(noLateSteps, sparse(600, 31)).steps).toBe(0);
  // Every 20 s: the third spell steps.
  expect(run(noLateSteps, sparse(59, 20))).toMatchObject({ steps: 0 });
  expect(run(noLateSteps, sparse(60, 20))).toMatchObject({
    steps: 1,
    phase: { kind: "moving", caused: { measure: "spells", count: 3 } },
  });
});

test("a step for spells that recur in the next minute pauses; fewer spells keep it", () => {
  const stepped = run(noLateSteps, [...sparse(60, 20), second(0, 105)]);
  expect(stepped).toMatchObject({
    steps: 1,
    caused: { measure: "spells", count: 3 },
  });
  // One spell every 31 s after it: not recurring, so it's never doubted.
  expect(run(stepped, sparse(900, 31, 105))).toMatchObject({
    steps: 1,
    unhelpful: 0,
  });
  // Still three spells a minute: it didn't help.
  expect(run(stepped, sparse(60, 20, 105))).toMatchObject({
    steps: 1,
    unhelpful: 1,
    phase: { kind: "pausing", left: 24 },
  });
  // Nor did a step for two spells in ten seconds after which spells recur over a minute, however
  // few chunks the last ten seconds lost.
  expect(run(noLateSteps, [...recurring(4), second(0, 105), ...sparse(60, 20, 105)])).toMatchObject(
    {
      steps: 1,
      unhelpful: 1,
      phase: { kind: "pausing", left: 24 },
    },
  );
});

test("one spell every 20 s that no step changes climbs about nine steps (90 ms) an hour", () => {
  let late = noLateSteps,
    sendAheadMs = 95;
  const hours = [0, 0];
  for (let at = 0; at < 2 * 3600; at++) {
    const before = late.steps;
    late = nextLateSteps(late, second(at % 20 === 19 ? 2 : 0, sendAheadMs));
    if (late.steps > before) {
      sendAheadMs += 10;
      hours[at < 3600 ? 0 : 1]++;
    }
  }
  expect(hours[0]).toBeLessThanOrEqual(13);
  expect(hours[1]).toBeLessThanOrEqual(9);
});

test("steady loss that no step changes climbs about nine steps (90 ms) an hour", () => {
  let late = noLateSteps,
    sendAheadMs = 95;
  const hours = [0, 0];
  for (let second = 0; second < 2 * 3600; second++) {
    const before = late.steps;
    // Every second loses chunks, whatever the step.
    late = nextLateSteps(late, { chunks: 50, lost: 1, sendAheadMs });
    if (late.steps > before) {
      sendAheadMs += 10;
      hours[second < 3600 ? 0 : 1]++;
    }
  }
  expect(hours[0]).toBeLessThanOrEqual(13);
  expect(hours[1]).toBeLessThanOrEqual(9);
});

test("each late step adds 10 ms to the declaration, within Core's limit", () => {
  expect(withLateSteps(75, 0)).toBe(75);
  expect(withLateSteps(75, 1)).toBe(85);
  expect(withLateSteps(4990, 1)).toBe(5000);
});

test("each late step moves a listener 10 ms later", () => {
  const lead = createLiveLead();
  measure(lead, 15);
  expect(lead.leadMs("phone", "opus", withLateSteps(62, 0))).toBe(80);
  expect(lead.leadMs("phone", "opus", withLateSteps(62, 1))).toBe(90);
  expect(lead.leadMs("phone", "opus", withLateSteps(62, 2))).toBe(100);
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

test("one listener's need moves nobody else", () => {
  const lead = createLiveLead();
  measure(lead, 12);
  expect(lead.leadMs("earbuds", "opus", 75)).toBe(90);
  expect(lead.leadMs("bluetooth", "opus", 200)).toBe(215);
  expect(lead.leadMs("earbuds", "opus", 75)).toBe(90);
});

test("Core's measured input-side time counts towards each listener's need", () => {
  const lead = createLiveLead();
  measure(lead, 30);
  expect(lead.leadMs("phone", "opus", 80)).toBe(110);
});

test("a listener waits at 0 for the input side, then moves once, within two seconds", () => {
  const lead = createLiveLead();
  // The encoder's start: its backlog arrives late and doesn't count.
  lead.arrived("opus", 0, 300_000);
  expect(lead.leadMs("phone", "opus", 75)).toBe(0);
  measure(lead, 15, 0, 2);
  expect(lead.leadMs("phone", "opus", 75)).toBe(90);
});

test("each wire has its own input-side time", () => {
  const lead = createLiveLead();
  measure(lead, 40, 0, 6, "opus");
  measure(lead, 10, 0, 6, "pcm");
  expect(lead.leadMs("phone", "opus", 75)).toBe(115);
  expect(lead.leadMs("laptop", "pcm", 75)).toBe(85);
});

test("a listener's step only rises while it listens, and resets when it leaves", () => {
  const lead = createLiveLead();
  measure(lead, 0, 0, 2);
  expect(lead.leadMs("phone", "opus", 112)).toBe(115);
  expect(lead.leadMs("phone", "opus", 0)).toBe(115);
  lead.left("phone");
  expect(lead.leadMs("phone", "opus", 0)).toBe(0);
});

test("one slow second doesn't move the input-side time", () => {
  const lead = createLiveLead();
  measure(lead, 10);
  lead.arrived("opus", 6_000_000, 6_900_000);
  measure(lead, 10, 7);
  expect(lead.leadMs("wired", "opus", 40)).toBe(50);
});

test("a listener waits for its need, and needs in the same step play together", () => {
  const lines: string[] = [];
  const lead = createLiveLead((line) => lines.push(line));
  measure(lead, 26);
  // Not measured yet: it waits at 0, where Core sends it nothing.
  expect(lead.leadMs("phone", "opus", undefined, "Phone")).toBe(0);
  // 55 + 26 and 58 + 26 both round up to 85.
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(85);
  expect(lead.leadMs("laptop", "opus", 58, "Laptop")).toBe(85);
  expect(lead.leadMs("wired", "opus", 47, "Wired")).toBe(75);
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(85);
  expect(lines).toEqual([
    "live input side opus: 26 ms",
    'live listener "Phone" opus: declares 55 ms, input side 26 ms, plays 85 ms after capture',
    'live listener "Laptop" opus: declares 58 ms, input side 26 ms, plays 85 ms after capture',
    'live listener "Wired" opus: declares 47 ms, input side 26 ms, plays 75 ms after capture',
  ]);
});

test("a restarted capture keeps its input side until the new encoder's is measured", () => {
  const lines: string[] = [];
  const lead = createLiveLead((line) => lines.push(line));
  measure(lead, 26);
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(85);
  lead.restart();
  // Listeners play again at once, at the step the last input side gives.
  expect(lead.leadMs("phone", "opus", 55, "Phone")).toBe(85);
  // The new encoder's own, once measured, replaces it, lower or not.
  measure(lead, 10, 100, 2);
  expect(lead.leadMs("laptop", "opus", 55, "Laptop")).toBe(65);
  expect(lines).toContain("live input side opus: 10 ms");
});

test("a listener's log line comes at most every ten seconds unless its step rose", () => {
  const lines: string[] = [];
  let now = 0;
  const lead = createLiveLead(
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
