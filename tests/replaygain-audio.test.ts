import { expect, test } from "bun:test";
import { analyzeReplayGain } from "./linux/replaygain-audio";

const sampleRate = 8000;
const reference = Float64Array.from({ length: sampleRate * 3 }, (_, sample) => {
  const time = sample / sampleRate;
  return 0.8 * Math.sin(2 * Math.PI * (317 * time + 23 * time * time));
});

test("gain measurements identify offset audio and distinguish saturation from mixer gain", () => {
  for (const [db, clipping] of [[-6, false], [-3, false], [6, false], [6, true]] as const) {
    const captured = new Float64Array(reference.length + 173);
    const gain = 10 ** (db / 20);
    reference.forEach((value, sample) => captured[sample + 173] = clipping ? Math.max(-1, Math.min(1, value * gain)) : value * gain);
    const result = analyzeReplayGain(reference, captured, sampleRate);
    expect(result.captureSample - result.referenceSample).toBe(173);
    expect(result.gainDb).toBeCloseTo(db, 8);
    expect(result.correlation).toBeGreaterThan(0.98);
    expect(result.aboveFullScaleSamples > 0).toBe(db > 0 && !clipping);
    if (clipping) {
      expect(result.nearFullScaleSamples).toBeGreaterThan(0);
      expect(result.rmsGainDb).toBeLessThan(db - 1);
      expect(result.residualRms).toBeGreaterThan(0.1);
    } else {
      expect(result.rmsGainDb).toBeCloseTo(db, 8);
      expect(result.residualRms).toBeLessThan(1e-10);
    }
  }
});

test("gain measurements reject silent, unrelated and short captures", () => {
  expect(() => analyzeReplayGain(reference, new Float64Array(reference.length), sampleRate)).toThrow("does not match");
  const unrelated = Float64Array.from(reference, (_, sample) => Math.sin(sample * 0.19) * 0.5);
  expect(() => analyzeReplayGain(reference, unrelated, sampleRate)).toThrow("does not match");
  expect(() => analyzeReplayGain(reference, new Float64Array(20), sampleRate)).toThrow("half a second");
});
