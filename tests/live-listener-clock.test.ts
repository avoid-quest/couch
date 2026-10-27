import { expect, test } from "bun:test";
import { line, type ClockFit } from "../src/client/session/live-listener/line";
import { CaptureClock, ServerClock } from "../src/client/session/live-listener/network-clock";
import { OutputClock, OutputClockPublisher } from "../src/client/session/live-listener/output-clock";
import { RenderProgress } from "../src/client/session/live-listener/render-progress";

const epoch = 1_800_000_000_000;
test("centred fits retain drift precision at epoch-sized times", () => {
  const fit = line(Array.from({ length: 201 }, (_, i) => [epoch + i * 50, epoch + 123 + i * 50 * 1.00025]), 5000);
  expect(fit.slope).toBeCloseTo(1.00025, 8);
  expect(fit.y0 - fit.x0).toBeCloseTo(125.5, 3);
  expect(line([[1, 5], [1, 7]], 0)).toEqual({ x0: 1, y0: 7, slope: 1 });
  expect(() => line([], 5000)).toThrow();
});

test("short clock histories use the upper median at the nominal rate", () => {
  expect(line([[0, 10], [10, 22], [20, 1000], [30, 41]], 5000)).toEqual({ x0: 30, y0: 42, slope: 1 });
});

test("output clock stays offset-only over 500 polls and ages out an old plateau", () => {
  const clock = new OutputClock();
  let fit: ClockFit | null = null;
  for (let i = 0; i < 500; i++) fit = clock.push(i * 20, epoch + i * 20 + (i % 5 === 0 ? 30 : 12));
  expect(fit!.slope).toBe(1);
  expect(fit!.y0 - fit!.x0).toBe(12 + epoch);
  for (let i = 500; i < 649; i++) fit = clock.push(i * 20, epoch + i * 20 + 22);
  expect(fit!.y0 - fit!.x0).toBe(12 + epoch);
  for (let i = 649; i < 1000; i++) fit = clock.push(i * 20, epoch + i * 20 + 22);
  expect(fit!.y0 - fit!.x0).toBe(22 + epoch);
  expect(clock.push(NaN, epoch)).toBeNull();
});

test("400 packets/s retain enough capture history to estimate drift across ten seconds", () => {
  const clock = new CaptureClock();
  let fit: ClockFit | null = null;
  for (let i = 0; i <= 4000; i++) {
    const next = clock.push(1e12 + i * 2500, i * 120 * 1.00025);
    if (next) fit = next;
    if (i < 2000 && next) expect(next.slope).toBe(0.048);
  }
  expect(fit!.slope / 0.048).toBeCloseTo(1.00025, 10);
  expect(fit!.y0 + fit!.slope * (1e12 + 10e6 - fit!.x0)).toBeCloseTo(480120, 5);
});

test("server clock admits after three pongs and fits the quickest third", () => {
  const clock = new ServerClock();
  for (let i = 0; i < 200; i++) {
    const t = epoch + i * 50, rtt = i % 3 ? 30 : 2;
    // Slow paths have asymmetric queueing; fastest paths are symmetric.
    clock.push(t, (t + rtt / 2 + 200 + i * 50 * 0.00025 + (rtt === 2 ? 0 : 10)) * 1000, t + rtt);
    expect(clock.ready).toBe(i >= 2);
  }
  expect(clock.fit.slope).toBeCloseTo(1.00025, 7);
  expect(clock.rttMinMs).toBe(2);
  expect(clock.push(epoch + 20, epoch, epoch)).toBeNull();
});

test("output clock delivery compares fitted lines and stays at one or two messages per second", () => {
  for (const drift of [0, 0.001]) {
    const sent: { now: number; fit: ClockFit }[] = [];
    let now = 0;
    const publisher = new OutputClockPublisher({ postMessage: m => sent.push({ now, fit: { ...m.fit } }) });
    for (; now < 10_000; now += 20) publisher.push({ x0: now, y0: epoch + now * (1 + drift), slope: 1 }, now);
    expect(sent).toHaveLength(drift ? 20 : 10);
    expect(sent[0]!.now).toBe(0);
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.now - sent[i - 1]!.now).toBeGreaterThanOrEqual(500);
  }
});

test("render progress needs two sustained deficits and ignores suspension and background gaps", () => {
  const progress = new RenderProgress();
  expect(progress.push(0, 0, true, 128 / 48)).toBeNull();
  expect(progress.push(1000, 900, true, 128 / 48)).toBeNull();
  expect(progress.push(2000, 1800, true, 128 / 48)).toBe(100);
  expect(progress.push(3000, 1800, false, 128 / 48)).toBeNull();
  expect(progress.push(4000, 1800, true, 128 / 48)).toBeNull();
  expect(progress.push(8000, 1800, true, 128 / 48)).toBeNull();
  expect(progress.push(9000, 2700, true, 128 / 48)).toBeNull();
  expect(progress.push(10000, 3600, true, 128 / 48)).toBe(100);
});
