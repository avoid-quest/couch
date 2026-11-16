import { expect, test } from "bun:test";
import { heard, reported } from "../src/client/session/live-output";
import { LiveTimeline, addStats, noStats } from "../src/client/session/live-timeline";

const rate = 48_000;
const chunkFrames = 240;
const quantum = 128;
// Each sample's value is its place in the stream, so the output shows which sample played when. The
// output keeps what the timeline computes exactly: a 32-bit float can't tell 1.003 from 1 there.
type Sent = { index: number; frame: number; arrival: number; stampUs: number };
// Core's stream: chunk `index` holds samples index × 240 on, stamped `stampUs`, is due at `frame` and
// reaches the worklet before the render quantum at `arrival` (messages run between quanta), and
// never before the one sent before it (one connection).
function play(sent: Sent[], frames: number) {
  const timeline = new LiveTimeline(rate),
    left = new Float64Array(frames),
    right = new Float64Array(frames),
    stats = noStats(),
    queue = sent.map((chunk, i) => ({
      ...chunk,
      arrival: Math.max(...sent.slice(0, i + 1).map(({ arrival }) => arrival)),
    }));
  for (let frame = 0; frame < frames; frame += quantum) {
    while (queue.length && queue[0]!.arrival <= frame) {
      const { index, frame: due, stampUs } = queue.shift()!,
        samples = Float32Array.from({ length: chunkFrames }, (_, i) => index * chunkFrames + i);
      timeline.push({ frame: due, stampUs, channels: [samples] }, frame);
    }
    const output = [left.subarray(frame, frame + quantum), right.subarray(frame, frame + quantum)];
    timeline.render(frame, output as unknown as Float32Array[]);
    addStats(stats, timeline.takeStats());
  }
  return { left, right, stats };
}
const startFrame = 9_600;
const chunkUs = (chunkFrames / rate) * 1e6;
// A stream whose chunk i is stamped and due 5 ms after the one before, and arrives 100 ms ahead.
// `later`: from that chunk on, Core stamps this much later (µs), and the chunks are due that much later.
const steady = (
  count: number,
  later?: { from: number; us: number },
  frameOf = (stampUs: number) => startFrame + (stampUs / 1e6) * rate,
) =>
  Array.from({ length: count }, (_, index) => {
    const stampUs = index * chunkUs + (later && index >= later.from ? later.us : 0),
      frame = frameOf(stampUs);
    return { index, stampUs, frame, arrival: frame - rate / 10 };
  });

test("each sample is heard at its own frame, on every channel", () => {
  const { left, right, stats } = play(steady(400), startFrame + 400 * chunkFrames);
  expect(left.subarray(0, startFrame).every((sample) => sample === 0)).toBe(true);
  for (let frame = startFrame; frame < left.length; frame++)
    expect(left[frame]).toBe(frame - startFrame);
  expect(right).toEqual(left);
  expect(stats).toMatchObject({ chunks: 400, lost: 0, skipped: 0, filled: 0, corrections: 0 });
  expect(stats.slack).toBeGreaterThanOrEqual(rate / 10 - quantum);
});

test("a chunk that comes late is lost and its passed samples skipped, and the timeline stays where it was", () => {
  const sent = steady(400);
  // Chunk 50 comes after it was due (at the next render quantum), once the one before it ran out.
  sent[50]!.arrival = sent[50]!.frame + 1;
  const { left, stats } = play(sent, startFrame + 400 * chunkFrames);
  const late = sent[50]!.frame,
    passed = Math.ceil(late / quantum) * quantum - late;
  expect(stats).toMatchObject({ chunks: 400, lost: 1, skipped: passed, filled: passed });
  // How late it came: what a step must add for it to come in time.
  expect(stats.slack).toBe(-passed);
  expect(left.subarray(late, late + passed).every((sample) => sample === 0)).toBe(true);
  for (let frame = late + passed; frame < left.length; frame++)
    expect(left[frame]).toBe(frame - startFrame);
});

test("a chunk that comes in time after the sound before it ran dry is lost too, not a chunk Core never sent", () => {
  // The listener plays 5 ms early (a step it is slewing to): the sound before chunk 50 runs out
  // before chunk 50 arrives, though chunk 50 is still ahead of its own frame.
  const early = steady(200, { from: 40, us: chunkUs });
  early[50]!.arrival = early[50]!.frame - 120;
  const dry = play(early, startFrame + 210 * chunkFrames).stats;
  expect(dry).toMatchObject({ lost: 1, skipped: 0 });
  // Nothing came late: no lateness to size a step by.
  expect(dry.slack).toBeGreaterThanOrEqual(0);
  // Core never sent chunk 50: the sound goes on with chunk 51 and slews back to its frames, as
  // through a step.
  const gap = steady(200).filter((chunk) => chunk.index !== 50);
  const { stats } = play(gap, startFrame + 210 * chunkFrames);
  expect(stats).toMatchObject({ lost: 0, skipped: 0, corrections: 1 });
});

test("a late step and a drifting clock are slewed within 0.3 %, never jumped", () => {
  const seconds = 60,
    count = (seconds * rate) / chunkFrames;
  // The device's clock runs 100 ppm slow against Core's; Core stamps 10 ms later from chunk 1000 on.
  const frameOf = (stampUs: number) => startFrame + (stampUs / 1e6) * rate * (1 - 1e-4);
  const sent = steady(count, { from: 1000, us: 10_000 }, frameOf),
    due = (index: number) => sent[index]!.frame;
  const { left, stats } = play(sent, Math.floor(due(count - 1)));
  expect(stats).toMatchObject({ lost: 0, skipped: 0, filled: 0 });
  let fastest = 1,
    slowest = 1;
  for (let frame = startFrame + 1; frame < left.length; frame++) {
    const step = left[frame]! - left[frame - 1]!;
    fastest = Math.max(fastest, step);
    slowest = Math.min(slowest, step);
  }
  // Ending a correction moves the timeline by under 0.3 % of a sample once.
  expect(fastest).toBeLessThanOrEqual(1.006);
  expect(slowest).toBeGreaterThanOrEqual(0.994);
  // Within a millisecond of its frames once it has slewed the step (5 s after it).
  const settled = Math.ceil(due(1000) + 5 * rate);
  for (let frame = settled; frame < left.length; frame += 4_800) {
    const index = Math.floor(left[frame]! / chunkFrames),
      offset = left[frame]! - index * chunkFrames,
      wanted = due(index) + offset;
    expect(Math.abs(wanted - frame)).toBeLessThanOrEqual(rate / 1000 + 1);
  }
});

test("a clock that moved by more than a slew can take back is placed again, without counting loss", () => {
  // The device's output changed: the same stamps are due a second later from chunk 100 on.
  const sent = steady(300).map((chunk) =>
    chunk.index >= 100 ? { ...chunk, frame: chunk.frame + rate } : chunk,
  );
  const { left, stats } = play(sent, sent[299]!.frame + chunkFrames);
  expect(stats).toMatchObject({ lost: 0, skipped: 0 });
  const replaced = sent[100]!.frame;
  expect(left[replaced - 1]).toBe(0);
  expect(left[replaced]).toBe(100 * chunkFrames);
});

// The player's output reading (live-output.ts): a stamp says context second 10 is heard at
// performance 5000 ms; the render clock reads 10.031 s 2 ms later.
const output = (underrunSec?: number) => ({
  currentTime: 10.031,
  baseLatency: 0.005,
  outputLatency: 0.032,
  getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 5000 }),
  playbackStats: underrunSec === undefined ? undefined : { underrunDuration: underrunSec },
});
// The context frame a sample heard at performance `ms` is due at.
const dueFrame = ({ offset }: { offset: number }, ms: number) => (offset + ms / 1000) * rate;

test("Android's FIFO underruns place every sample that much earlier and declare that much more lead", () => {
  const stamps = heard(output(), 5002, true)!,
    underran = heard(output(0.045), 5002, true)!;
  expect(stamps.lead * 1000).toBeCloseTo(29, 9);
  expect(underran.lead * 1000).toBeCloseTo(29 + 45, 9);
  expect(dueFrame(stamps, 5100)).toBeCloseTo(10.1 * rate, 6);
  expect(dueFrame(underran, 5100)).toBeCloseTo(10.055 * rate, 6);
});

test("elsewhere the output timestamp alone places samples, whatever playbackStats counts", () => {
  expect(heard(output(0.045), 5002, false)).toEqual(heard(output(), 5002, true));
  expect(reported(output(0.045), 5002).lead * 1000).toBeCloseTo(37, 9);
});
