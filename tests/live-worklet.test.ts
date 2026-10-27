import { describe, expect, test } from "bun:test";
import { LiveProcessor } from "../src/client/session/live-listener/processor";
import { base, calibration, publish, renderer, sampleRate } from "./fixtures/live-listener";

function run({ stallMs = 0, lead = 0, ppm = 0, seconds = 12, interp = "hermite", stretch = false }: {
  stallMs?: number; lead?: number; ppm?: number; seconds?: number; interp?: "sinc" | "hermite"; stretch?: boolean;
}) {
  const { processor: p, reports } = renderer(interp, stretch);
  const left = new Float32Array(128), right = new Float32Array(128);
  let sent = base - 64, maxZero = 0, zeros = 0, maxStep = 0, previousL = 0, previousR = 0;
  let maxLeadRate = 0, previousRead: number | null = null, advanced = false, drift = 1;
  const changedAt = Math.ceil(2 * sampleRate / 128) * 128;
  if (lead) p.message({ type: "lead", leadMs: lead, atServerUs: changedAt / sampleRate * 1e6 });
  for (let frame = 0; frame < seconds * sampleRate; frame += 128) {
    const now = frame / sampleRate;
    if (ppm && !advanced && frame >= changedAt) {
      drift = 1 + ppm / 1e6; advanced = true;
      p.clock(0, { x0: changedAt / sampleRate * 1e6, y0: base + 0.371 + changedAt, slope: 0.048 * drift });
    }
    const source = Math.min(frame, changedAt) + Math.max(0, frame - changedAt) * drift;
    const end = Math.floor(base + source + (lead ? 60 : 4) * sampleRate / 1000);
    if (!(now >= 2 && now < 2 + stallMs / 1000)) { publish(p, sent, end); sent = end; }
    p.process(left, right, frame);
    if (lead && previousRead !== null) maxLeadRate = Math.max(maxLeadRate, Math.abs((p.read! - previousRead) / 128 - 1) * 1000);
    previousRead = p.read;
    for (let i = 0; i < left.length; i++) {
      if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error("Non-finite audio");
      if (now > 1) {
        zeros = Math.abs(left[i]!) + Math.abs(right[i]!) < 1e-8 ? zeros + 1 : 0;
        maxZero = Math.max(maxZero, zeros);
        maxStep = Math.max(maxStep, Math.abs(left[i]! - previousL), Math.abs(right[i]! - previousR));
      }
      previousL = left[i]!; previousR = right[i]!;
    }
  }
  const all = [...reports, p.stats];
  const ledger = all.reduce((sum, r) => sum + r.clockShiftMs + r.leadShiftMs + r.holdDebtMs - r.driftCorrectionMs - r.rateCatchUpMs - r.stretchMs - r.crossfadeMs, 0);
  const debt = (p.target(p.frame + 128) - p.read!) / sampleRate * 1000;
  return { p, all, debt, ledger, maxZero, maxStep, maxLeadRate };
}

describe("elastic playout", () => {
  for (const interp of ["hermite", "sinc"] as const) for (const stallMs of [5, 20, 100]) {
    test(`${interp} holds through a ${stallMs} ms stall and catches up continuously`, () => {
      const result = run({ stallMs, interp });
      expect(result.maxZero).toBe(0);
      expect(result.maxStep).toBeLessThan(0.06);
      // Sinc retains sub-millisecond feasible debt with only 4 ms of runway.
      expect(Math.abs(result.debt)).toBeLessThan(1);
      expect(Math.abs(result.ledger - result.debt)).toBeLessThan(0.001);
      expect(result.all.reduce((s, r) => s + r.missing, 0)).toBeGreaterThan(0);
      expect(result.all.reduce((s, r) => s + r.crossfadeJumps, 0)).toBe(0);
    }, 30_000);
  }
  for (const lead of [-20, 20]) test(`scheduled ${lead} ms lead ramps at no more than 2 ms/s`, () => {
    const result = run({ lead, seconds: 18 });
    expect(result.p.meta[9]).toBeCloseTo(lead, 6);
    expect(result.maxLeadRate).toBeLessThanOrEqual(2.001);
    expect(result.maxZero).toBe(0);
    expect(Math.abs(result.debt)).toBeLessThan(0.05);
    expect(Math.abs(result.ledger - result.debt)).toBeLessThan(0.001);
    expect(result.all.reduce((s, r) => s + r.missing + r.crossfadeJumps, 0)).toBe(0);
  }, 30_000);
  for (const ppm of [-250, 250]) test(`tracks ${ppm} ppm drift to within 0.05 ms at 90 s`, () => {
    const result = run({ ppm, seconds: 90 });
    expect(Math.abs(result.debt)).toBeLessThan(0.05);
    expect(Math.abs(result.ledger - result.debt)).toBeLessThan(0.001);
    expect(result.maxZero).toBe(0);
  }, 30_000);
  test("admitted WSOLA recovers a stall with linked stereo splices", () => {
    const result = run({ stallMs: 100, stretch: true });
    expect(result.all.reduce((s, r) => s + r.splices, 0)).toBeGreaterThan(0);
    expect(result.maxZero).toBe(0);
    expect(Math.abs(result.debt)).toBeLessThan(0.05);
    expect(Math.abs(result.ledger - result.debt)).toBeLessThan(0.001);
  }, 30_000);
});

test("calibration selects Hermite at the half-quantum boundary and rescales without benchmarking", () => {
  const c = calibration("sinc", true);
  c.interp.costMs.sinc = 128 / sampleRate * 1000 / 2;
  const p = new LiveProcessor(sampleRate, c, { report() {}, recycle() {} });
  expect(p.interp.mode).toBe("hermite");
  expect(p.stretch.mode).toBe("wsola");
  p.applyCalibration(16);
  expect(p.stretch.mode).toBe("wsola");
  p.applyCalibration(8);
  expect(p.stretch.mode).toBe("rate");
  p.message({ type: "slow" });
  c.interp.costMs.sinc = 0.001;
  p.applyCalibration(128);
  expect(p.interp.mode).toBe("hermite");
  expect(p.stretch.mode).toBe("rate");
  const fallback = new LiveProcessor(sampleRate, null, { report() {}, recycle() {} });
  expect(fallback.interp.mode).toBe("hermite");
  expect(fallback.stretch.mode).toBe("rate");
});

test("epoch reset clears recovery and samples but keeps the AudioContext clock", () => {
  const { processor: p } = renderer();
  publish(p, base - 64, base + 512);
  p.process(new Float32Array(128), new Float32Array(128), 0);
  p.b = 960; p.integral = 7; p.beginSplice(480, false);
  p.message({ type: "reset" });
  expect(p.read).toBeNull(); expect(p.splice).toBeNull(); expect(p.b).toBe(0); expect(p.integral).toBe(0);
  expect(p.meta[11]).toBe(1); expect(p.meta[5]).toBe(1); expect(p.meta[10]).toBe(0);
  expect(p.stamps.every(Number.isNaN)).toBe(true);
});

test("joining waits for available interpolation support instead of holding before the stream began", () => {
  const { processor: p } = renderer("sinc");
  publish(p, base, base + 2048);
  const left = new Float32Array(128), right = new Float32Array(128);
  p.process(left, right, 0);
  expect(p.read).toBeNull(); expect(p.stats.missing).toBe(0);
  p.process(left, right, 128);
  expect(p.read).not.toBeNull(); expect(p.stats.played).toBe(128); expect(p.stats.missing).toBe(0);
});
