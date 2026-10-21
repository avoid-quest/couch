export function assessActivityCoverage(expectedFrames: number, observedFrames: number) {
  return { complete: observedFrames === expectedFrames, expectedFrames, observedFrames,
    missingFrames: Math.max(0, expectedFrames - observedFrames) };
}

/** Delivered PCM activity only: no source identity or presentation clock. */
export function createActivityMeasurement(expectedFrames: number, windowFrames = 48000) {
  if (!Number.isSafeInteger(expectedFrames) || expectedFrames < 1 || !Number.isSafeInteger(windowFrames) || windowFrames < 1)
    throw new Error("Invalid activity interval");
  let frames = 0, pending = 0, square = 0, silentWindows = 0, windows = 0, invalidSamples = 0, clippedSamples = 0, finished = false;
  const score = () => { windows++; if (Math.sqrt(square / pending) <= .001) silentWindows++; pending = 0; square = 0; };
  return {
    get complete() { return frames === expectedFrames; },
    push(sample: number) {
      if (finished) throw new Error("Activity measurement is finished");
      if (frames === expectedFrames) return;
      frames++; pending++;
      if (!Number.isFinite(sample)) invalidSamples++;
      else { square += sample * sample; if (Math.abs(sample) >= 1) clippedSamples++; }
      if (pending === windowFrames || frames === expectedFrames) score();
    },
    finish() {
      if (finished) throw new Error("Activity measurement is finished");
      finished = true;
      const coverage = assessActivityCoverage(expectedFrames, frames);
      return { passed: coverage.complete && !silentWindows && !invalidSamples && !clippedSamples,
        coverage, windows, silentWindows, invalidSamples, clippedSamples, unscoredPartialFrames: pending };
    },
  };
}
