import { expect, test } from "bun:test";
import { assessActivityCoverage, createActivityMeasurement } from "./audio-lab/activity";

test("steady activity requires the entire declared PCM interval, including the final frame", () => {
  expect(assessActivityCoverage(480_000, 480_000).complete).toBe(true);
  expect(assessActivityCoverage(480_000, 384_000).complete).toBe(false);
  expect(assessActivityCoverage(480_000, 479_999).complete).toBe(false);
});

test("activity intervals ignore later samples and retain silent, invalid and clipped cells", () => {
  const measure = createActivityMeasurement(12, 4);
  for (const sample of [0.1, 0.1, 0.1, 0.1, 0, 0, 0, 0, NaN, 1, 0.1, 0.1, 0, 0, 0, 0]) measure.push(sample);
  const result = measure.finish();
  expect(result.coverage.complete).toBe(true);
  expect(result.coverage.observedFrames).toBe(12);
  expect(result.silentWindows).toBe(1);
  expect(result.invalidSamples).toBe(1);
  expect(result.clippedSamples).toBe(1);
  expect(result.passed).toBe(false);
  const truncated = createActivityMeasurement(8, 4);
  for (let i = 0; i < 7; i++) truncated.push(0.1);
  expect(truncated.finish().coverage.missingFrames).toBe(1);
});
