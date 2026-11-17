import { expect, test } from "bun:test";
import {
  declareLiveBuffer,
  nextLateSteps,
  noLateSteps,
  sdkLateSteps,
  withLateSteps,
  type LateSteps,
  type LossSecond,
} from "../src/client/session/live-buffer";
import { createLiveLead } from "../src/server/live-lead";

const steady = (latency: number) => Array(5).fill(latency);

test("a Receiver declares only its own need, from its first reading", () => {
  expect(declareLiveBuffer(undefined)).toBeUndefined();
  // Need = the reading: how far the render clock runs ahead of what's heard.
  expect(declareLiveBuffer(undefined, [40])).toBe(40);
  expect(declareLiveBuffer(undefined, steady(40.2))).toBe(41);
  expect(declareLiveBuffer(undefined, steady(0))).toBe(0);
});

test("after the first reading, only the median of five raises the declaration", () => {
  expect(declareLiveBuffer(75, [40, 200])).toBe(75);
  expect(declareLiveBuffer(75, [40, 200, 200, 200])).toBe(75);
  expect(declareLiveBuffer(75, [40, 200, 200, 200, 200])).toBe(200);
});

test("a declaration rises only when the smoothed need clearly outgrows it", () => {
  expect(declareLiveBuffer(75, steady(80))).toBe(75);
  expect(declareLiveBuffer(75, steady(81))).toBe(81);
  expect(declareLiveBuffer(75, [42, 900, 42, 900, 42])).toBe(75);
  expect(declareLiveBuffer(250, steady(27))).toBe(250);
});

test("the declaration respects Core's 5000 ms timing limit", () => {
  expect(declareLiveBuffer(150, steady(5010))).toBe(5000);
});

// Seconds of a listener's sound: 50 chunks each, `lost` of them lost (the latest `lateMs` past its
// start, unmeasured by default), sent `sendAheadMs` ahead of their stamps (Core's send_ahead: a
// step more once Core applied it).
const second = (lost = 0, sendAheadMs = 95, lateMs?: number): LossSecond => ({
  chunks: 50,
  lost,
  sendAheadMs,
  lateMs,
});
const chunks = (count: number) => ({ measure: "chunks" as const, count, stepMs: 10 });
const run = (late: LateSteps, seconds: LossSecond[]) => seconds.reduce(nextLateSteps, late);
const repeat = <T>(count: number, each: T) => Array<T>(count).fill(each);
// Ten seconds that lose chunks in two separate spells: loss that recurs.
const recurring = (lost = 1, sendAheadMs = 95, lateMs?: number) => [
  ...repeat(4, second(0, sendAheadMs)),
  second(lost, sendAheadMs, lateMs),
  ...repeat(4, second(0, sendAheadMs)),
  second(lost, sendAheadMs, lateMs),
];

test("a listener steps when loss recurs, not for one stall however its chunks are counted", () => {
  // One stall: 20 chunks lost at once, or a burst the count splits over two seconds.
  expect(run(noLateSteps, [...repeat(9, second()), second(20)]).lateMs).toBe(0);
  expect(
    run(noLateSteps, [...repeat(4, second()), second(15), second(5), ...repeat(20, second())])
      .lateMs,
  ).toBe(0);
  // Two spells in ten seconds, or loss three seconds running: it steps.
  expect(run(noLateSteps, recurring()).lateMs).toBe(10);
  expect(run(noLateSteps, [...repeat(7, second()), ...repeat(3, second(50))]).lateMs).toBe(10);
  // Not before ten seconds are in.
  expect(run(noLateSteps, recurring().slice(1)).lateMs).toBe(0);
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
    lateMs: 10,
    caused: { measure: "chunks", count: 4, stepMs: 10 },
    seconds: [],
    phase: { kind: "watching" },
  });
});

test("a step Core didn't apply (at its limit) isn't judged, and recurring loss steps again", () => {
  let late = run(noLateSteps, [...recurring(2), ...repeat(3, second(1))]);
  expect(late).toMatchObject({ lateMs: 10, phase: { kind: "watching" } });
  expect(late.caused).toBeUndefined();
  late = run(late, [second(1)]);
  expect(late).toMatchObject({ lateMs: 20, phase: { kind: "moving" } });
});

test("a step after which loss doesn't recur is kept", () => {
  const late = run(noLateSteps, [...recurring(4), second(0, 105), ...repeat(600, second(0, 105))]);
  expect(late).toMatchObject({ lateMs: 10, phase: { kind: "watching" } });
  // A lone stall later doesn't judge it.
  expect(run(late, [second(30, 105), ...repeat(10, second(0, 105))])).toMatchObject({
    lateMs: 10,
    unhelpful: 0,
    phase: { kind: "watching" },
  });
});

test("a step that halved the loss is kept and stepping goes on while loss recurs", () => {
  let late = run(noLateSteps, [...recurring(4), second(0, 105)]);
  // Half the loss, still recurring: another step at once.
  late = run(late, recurring(2, 105));
  expect(late).toMatchObject({
    lateMs: 20,
    unhelpful: 0,
    phase: { kind: "moving" },
  });
  // Cured: it stays.
  late = run(late, [second(0, 115), ...repeat(30, second(0, 115))]);
  expect(late).toMatchObject({ lateMs: 20, phase: { kind: "watching" } });
});

test("a step that didn't cut the loss pauses stepping, longer each time up to 384 s", () => {
  let late = run(noLateSteps, [...recurring(), second(0, 105), ...recurring(1, 105)]);
  expect(late).toMatchObject({
    lateMs: 10,
    unhelpful: 1,
    phase: { kind: "pausing", left: 24 },
  });
  // Still losing during the pause: no step.
  late = run(late, [...repeat(50, recurring(1, 105)).flat()].slice(0, 23));
  expect(late.lateMs).toBe(10);
  // After it, loss that still recurs steps again at once; another step that doesn't help pauses
  // twice as long.
  late = run(late, [second(0, 105), second(1, 105)]);
  expect(late).toMatchObject({ lateMs: 20, phase: { kind: "moving" } });
  late = run(late, [second(0, 115), ...recurring(1, 115)]);
  expect(late).toMatchObject({
    lateMs: 20,
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
    lateMs: 30,
    unhelpful: 3,
    phase: { kind: "watching" },
  };
  // Helped: half the loss of the ten seconds that caused it.
  expect(run({ ...paused, caused: chunks(8) }, recurring(2))).toMatchObject({
    lateMs: 40,
    unhelpful: 0,
  });
  // Sixteen minutes without recurring loss: the next loss is new, and steps.
  const quiet = run({ ...paused, caused: chunks(2) }, repeat(16 * 60, second()));
  expect(quiet).toMatchObject({ unhelpful: 0, caused: undefined });
  expect(run(quiet, recurring(5))).toMatchObject({
    lateMs: 40,
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
  expect(run(noLateSteps, sparse(600, 31)).lateMs).toBe(0);
  // Every 20 s: the third spell steps.
  expect(run(noLateSteps, sparse(59, 20))).toMatchObject({ lateMs: 0 });
  expect(run(noLateSteps, sparse(60, 20))).toMatchObject({
    lateMs: 10,
    phase: { kind: "moving", caused: { measure: "spells", count: 3 } },
  });
});

test("a step for spells that recur in the next minute pauses; fewer spells keep it", () => {
  const stepped = run(noLateSteps, [...sparse(60, 20), second(0, 105)]);
  expect(stepped).toMatchObject({
    lateMs: 10,
    caused: { measure: "spells", count: 3 },
  });
  // One spell every 31 s after it: not recurring, so it's never doubted.
  expect(run(stepped, sparse(900, 31, 105))).toMatchObject({
    lateMs: 10,
    unhelpful: 0,
  });
  // Still three spells a minute: it didn't help.
  expect(run(stepped, sparse(60, 20, 105))).toMatchObject({
    lateMs: 10,
    unhelpful: 1,
    phase: { kind: "pausing", left: 24 },
  });
  // Nor did a step for two spells in ten seconds after which spells recur over a minute, however
  // few chunks the last ten seconds lost.
  expect(run(noLateSteps, [...recurring(4), second(0, 105), ...sparse(60, 20, 105)])).toMatchObject(
    {
      lateMs: 10,
      unhelpful: 1,
      phase: { kind: "pausing", left: 24 },
    },
  );
});

// Two hours of loss no step changes: the ms of late steps each hour.
const climb = (lossy: (at: number) => boolean, lateMs?: number, start = noLateSteps) => {
  let late = start,
    sendAheadMs = 95;
  const hours = [0, 0];
  for (let at = 0; at < 2 * 3600; at++) {
    const before = late.lateMs;
    const lost = lossy(at) ? 2 : 0;
    late = nextLateSteps(late, {
      chunks: 50,
      lost,
      sendAheadMs,
      lateMs: lost ? lateMs : undefined,
    });
    sendAheadMs += late.lateMs - before;
    hours[at < 3600 ? 0 : 1]! += late.lateMs - before;
  }
  return hours;
};

test("loss that no step changes climbs at most 130 ms in the first hour and 90 ms an hour after, however late", () => {
  for (const lateMs of [undefined, 15, 35, 95, 250, 1000])
    for (const lossy of [() => true, (at: number) => at % 20 === 19])
      for (const start of [noLateSteps, sdkLateSteps]) {
        const [first, second] = climb(lossy, lateMs, start);
        expect(first).toBeLessThanOrEqual(130);
        expect(second).toBeLessThanOrEqual(90);
      }
});

test("a step is as large as the lateness that recurred, rounded up to 10 ms", () => {
  // Two spells of chunks lost 35 ms late: one 40 ms step, after which loss doesn't recur.
  let late = run(noLateSteps, recurring(2, 95, 35));
  expect(late).toMatchObject({ lateMs: 40, phase: { kind: "moving" } });
  late = run(late, [second(0, 135), ...repeat(600, second(0, 135))]);
  expect(late).toMatchObject({ lateMs: 40, unhelpful: 0, phase: { kind: "watching" } });
  // Two spells with clean seconds between them: as late as the less late of the two.
  expect(
    run(noLateSteps, [
      ...repeat(5, second()),
      second(2, 95, 25),
      ...repeat(3, second()),
      second(2, 95, 12),
    ]),
  ).toMatchObject({ lateMs: 20 });
  // Spells over a minute: by the second latest of them.
  const spells = sparse(60, 20).map((each, at) => ({
    ...each,
    lateMs: each.lost ? 10 + at : undefined,
  }));
  // Spells 29, 49 and 69 ms late.
  expect(run(noLateSteps, spells)).toMatchObject({
    lateMs: 50,
    phase: { kind: "moving", caused: { measure: "spells", count: 3 } },
  });
});

test("dry-outs and loss with no lateness measured step 10 ms", () => {
  expect(run(noLateSteps, recurring(2))).toMatchObject({ lateMs: 10 });
  // A late spell and a dry-out: only one spell was late.
  expect(
    run(noLateSteps, [
      ...repeat(4, second()),
      second(2, 95, 60),
      ...repeat(4, second()),
      second(2),
    ]),
  ).toMatchObject({ lateMs: 10 });
});

test("one stall steps 10 ms, however late and long, and however a clean second splits it", () => {
  // Three seconds running, or a stall a clean second splits.
  expect(
    run(noLateSteps, [...repeat(7, second()), ...[120, 210, 180].map((ms) => second(5, 95, ms))]),
  ).toMatchObject({ lateMs: 10 });
  const split = (clean: number) => [
    ...repeat(9 - clean, second()),
    second(5, 95, 45),
    ...repeat(clean, second()),
    second(5, 95, 38),
  ];
  expect(run(noLateSteps, split(1))).toMatchObject({ lateMs: 10 });
  // Two clean seconds between them: two spells, and lateness they both reached recurred.
  expect(run(noLateSteps, split(2))).toMatchObject({
    lateMs: 40,
    phase: { caused: { stepMs: 40 } },
  });
});

test("one spell, however late, doesn't set a step unless it recurs", () => {
  const spells = (lateMs: number[]) => [
    ...repeat(2, second()),
    second(2, 95, lateMs[0]),
    second(1, 95, lateMs[0]),
    ...repeat(4, second()),
    second(2, 95, lateMs[1]),
    second(),
  ];
  expect(run(noLateSteps, spells([35, 300]))).toMatchObject({ lateMs: 40 });
  expect(run(noLateSteps, spells([300, 35]))).toMatchObject({ lateMs: 40 });
  expect(run(noLateSteps, spells([300, 280]))).toMatchObject({ lateMs: 130 });
});

test("a step is at most what 10 ms steps could add in an hour, less what they added in the last", () => {
  // 130 ms from the start, or after a step that helped.
  expect(run(noLateSteps, recurring(2, 95, 1000))).toMatchObject({ lateMs: 130 });
  // After 40 ms that didn't help (24 + 48 + 96 + 192 s of pauses), 60 ms more.
  expect(run({ ...noLateSteps, unhelpful: 4 }, recurring(2, 95, 1000))).toMatchObject({
    lateMs: 60,
  });
  // After 130 ms that didn't help, whose pauses all fell in the last hour, 10 ms.
  expect(run({ ...noLateSteps, unhelpful: 13 }, recurring(2, 95, 1000))).toMatchObject({
    lateMs: 10,
  });
});

test("a step judged helped doesn't give back what the hour's steps added; only time does", () => {
  // 130 ms for loss 1000 ms late, which Core applies in the 11th second.
  let late = run(noLateSteps, [...recurring(4, 95, 1000), second(0, 225)]);
  expect(late).toMatchObject({ lateMs: 130, caused: { stepMs: 130 } });
  // Loss recurs at half (by chance, or not): it helped, and the pauses start again, but the hour
  // has no room left however long the loss goes on.
  late = run(late, recurring(2, 225, 1000));
  expect(late).toMatchObject({ lateMs: 130, unhelpful: 0, caused: undefined });
  late = run(late, repeat(3609 - 21, second(2, 225, 1000)));
  expect(late.lateMs).toBe(130);
  // An hour after the step, the hour has room again (10 ms: an hour of loss is one spell).
  expect(run(late, [second(2, 225, 1000)])).toMatchObject({ lateMs: 140 });
});

test("a step that didn't help pauses as long as its 10 ms parts would have", () => {
  let late = run(noLateSteps, [...recurring(2, 95, 35), second(0, 135)]);
  expect(late).toMatchObject({ lateMs: 40, caused: { stepMs: 40 } });
  late = run(late, recurring(2, 135, 35));
  expect(late).toMatchObject({
    lateMs: 40,
    unhelpful: 4,
    phase: { kind: "pausing", left: 24 + 48 + 96 + 192 },
  });
});

// A second on the SDK's player, which reports its sync error: negative while it slews to a step.
const slewing = (syncErrorMs: number, sendAheadMs: number, lost = 0): LossSecond => ({
  ...second(lost, sendAheadMs),
  syncErrorMs,
});

test("on the SDK's player a step comes in 10 ms parts, each once the player slewed to the last", () => {
  // Loss 35 ms late: a 40 ms step, of which Core is asked 10 ms.
  let late = run(sdkLateSteps, recurring(2, 95, 35));
  expect(late).toMatchObject({ lateMs: 10, phase: { kind: "moving", caused: { stepMs: 40 } } });
  // Core applies it (its chunks 10 ms further ahead); the player slews to it, 8 ms or more off.
  late = run(late, [slewing(-10, 105), slewing(-9, 105), slewing(-8, 105)]);
  expect(late).toMatchObject({ lateMs: 10, phase: { kind: "moving" } });
  // Within 8 ms: the next part, at most 18 ms for the player to slew.
  late = run(late, [slewing(-7, 105)]);
  expect(late.lateMs).toBe(20);
  // A part shows only once Core applied it, whatever the player reports.
  late = run(late, [slewing(0, 105)]);
  expect(late.lateMs).toBe(20);
  late = run(late, [slewing(-10, 115), slewing(-5, 115), slewing(-10, 125), slewing(-6, 125)]);
  expect(late).toMatchObject({ lateMs: 40, phase: { kind: "moving" } });
  // Applied in full and slewed to: judged from here, as the whole step.
  late = run(late, [slewing(-10, 135), slewing(-2, 135)]);
  expect(late).toMatchObject({
    lateMs: 40,
    caused: { stepMs: 40 },
    seconds: [],
    phase: { kind: "watching" },
  });
  // Every part counts towards the hour.
  expect(late.taken.map(({ ms }) => ms)).toEqual([10, 10, 10, 10]);
});

test("loss while the SDK's player takes a step in parts isn't the step's", () => {
  // Loss goes on at the same rate through all four parts of a 40 ms step.
  let late = run(sdkLateSteps, recurring(2, 95, 35));
  for (const sendAheadMs of [105, 115, 125, 135])
    late = run(late, [slewing(-10, sendAheadMs, 2), slewing(-2, sendAheadMs, 2)]);
  expect(late).toMatchObject({ lateMs: 40, seconds: [], phase: { kind: "watching" } });
  // It's judged only by loss that recurs after it.
  expect(run(late, recurring(1, 135))).toMatchObject({ lateMs: 50, unhelpful: 0 });
  expect(run(late, recurring(2, 135))).toMatchObject({ lateMs: 40, unhelpful: 4 });
});

test("on the SDK's player a step ends with its applied parts when the player doesn't settle, or Core stops", () => {
  let late = run(sdkLateSteps, [...recurring(2, 95, 35), slewing(-10, 105)]);
  // Ten seconds 8 ms or more off: something else moved it. No more parts.
  late = run(late, repeat(9, slewing(-12, 105)));
  expect(late).toMatchObject({ lateMs: 10, phase: { kind: "moving" } });
  late = run(late, [slewing(-12, 105)]);
  expect(late).toMatchObject({
    lateMs: 10,
    caused: { stepMs: 10 },
    phase: { kind: "watching" },
  });
  expect(late.taken.map(({ ms }) => ms)).toEqual([10]);
  // A part Core doesn't apply within 3 s (at its limit) isn't judged, as a whole step isn't.
  late = run(sdkLateSteps, [...recurring(2, 95, 35), slewing(-10, 105), slewing(-2, 105)]);
  expect(late.lateMs).toBe(20);
  late = run(late, repeat(3, slewing(0, 105)));
  expect(late).toMatchObject({ lateMs: 20, phase: { kind: "watching" } });
  expect(late.caused).toBeUndefined();
});

test("late steps add their ms to the declaration, within Core's limit", () => {
  expect(withLateSteps(75, 0)).toBe(75);
  expect(withLateSteps(75, 40)).toBe(115);
  expect(withLateSteps(4990, 40)).toBe(5000);
});

test("a late step moves a listener that much later", () => {
  const lead = createLiveLead();
  measure(lead, 15);
  expect(lead.leadMs("phone", "opus", withLateSteps(62, 0))).toBe(80);
  expect(lead.leadMs("phone", "opus", withLateSteps(62, 10))).toBe(90);
  expect(lead.leadMs("phone", "opus", withLateSteps(62, 40))).toBe(120);
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
