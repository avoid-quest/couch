import { expect, test } from "bun:test";
import { createMarkerSignal, createPcmAnalyzer, type MarkerObservation } from "./audio-lab/pcm.ts";

// Delays come from literal inserted sample counts, independently of the analyzer.
// These are synthetic analyzer checks, never audio-device calibration.
test("measures a 20 ms PCM delay across arbitrary chunks on a shared sample timeline", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const source = signal.render(0, 48_000);
  const output = new Float32Array(60_000);
  output.set(source, 960);
  const reference = new Float32Array(output.length);
  reference.set(source);
  const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed: 42, receiverIds: ["listener"], durationFrames: source.length, maxDelayMs: 200, clockUncertaintyMs: 0.1 });
  for (let frame = 0; frame < output.length; frame += 733) {
    analyzer.push("reference", { startFrame: frame, samples: reference.subarray(frame, frame + 733) });
    analyzer.push("listener", { startFrame: frame, samples: output.subarray(frame, frame + 733) });
  }
  const result = analyzer.finish();
  expect(result.reference.detected).toBe(10);
  expect(result.receivers[0]).toMatchObject({ id: "listener", expected: 10, detected: 10, missing: 0, duplicated: 0, outOfOrder: 0 });
  expect(result.receivers[0]!.latencyMs).toMatchObject({ count: 10, p50: 20, p95: 20, p99: 20, max: 20 });
  expect(result.receivers[0]!.latencyUpperBoundMs).toBeLessThanOrEqual(22);
});

function measure(outputs: Float32Array[], { seed = 42, reference = createMarkerSignal({ sampleRate: 48_000, seed }).render(0, 48_000), warmupFrames = 0, clockUncertaintyMs = 0.1 } = {}) {
  const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed, receiverIds: outputs.map((_, i) => `listener-${i}`), durationFrames: 48_000, maxDelayMs: 250, clockUncertaintyMs, warmupFrames });
  const length = Math.max(reference.length, ...outputs.map(output => output.length));
  for (let frame = 0; frame < length; frame += 733) {
    if (frame < reference.length) analyzer.push("reference", { startFrame: frame, samples: reference.subarray(frame, frame + 733) });
    outputs.forEach((output, i) => { if (frame < output.length) analyzer.push(`listener-${i}`, { startFrame: frame, samples: output.subarray(frame, frame + 733) }); });
  }
  return analyzer.finish();
}
const delayed = (frames: number, source = createMarkerSignal({ sampleRate: 48_000, seed: 42 }).render(0, 48_000)) => { const output = new Float32Array(62_400); output.set(source, frames); return output; };

for (const [delayMs, frames] of [[80, 3_840], [150, 7_200]] as const) {
  test(`measures an inserted ${delayMs} ms delay within the 2 ms analyzer goal`, () => {
    const result = measure([delayed(frames)]);
    expect(result.receivers[0]).toMatchObject({ detected: 10, missing: 0, duplicated: 0, outOfOrder: 0 });
    expect(result.receivers[0]!.latencyMs).toMatchObject({ p50: delayMs, p95: delayMs, p99: delayMs, max: delayMs });
    expect(result.uncertaintyMs).toBeLessThanOrEqual(2);
  });
}

test("reports every absent marker for silence, wrong source and stalled output", () => {
  const stalled = delayed(960); stalled.fill(0, 24_960);
  const wrongSource = delayed(960, createMarkerSignal({ sampleRate: 48_000, seed: 43 }).render(0, 48_000));
  const result = measure([new Float32Array(62_400), wrongSource, stalled]);
  expect(result.receivers[0]).toMatchObject({ expected: 10, detected: 0, missing: 10, latencyMs: { count: 0, max: null } });
  expect(result.receivers[1]).toMatchObject({ expected: 10, detected: 0, missing: 10 });
  expect(result.receivers[2]).toMatchObject({ expected: 10, detected: 5, missing: 5 });
});

test("detects duplicated and out-of-order markers instead of treating timestamps as proof", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const duplicate = delayed(960);
  duplicate.set(signal.marker(2).samples, 12_960); // A second copy 50 ms later.
  const reordered = delayed(960);
  reordered.set(signal.marker(2).samples, 15_360);
  reordered.set(signal.marker(3).samples, 10_560);
  const result = measure([duplicate, reordered]);
  expect(result.receivers[0]).toMatchObject({ detected: 10, missing: 0, duplicated: 1 });
  expect(result.receivers[1]!.outOfOrder).toBe(1);
});

test("reports maximum skew and includes clock error in the upper bound", () => {
  const result = measure([delayed(960), delayed(1_152)], { clockUncertaintyMs: 1.5 });
  expect(result.skewMs).toMatchObject({ count: 10, p50: 4, p95: 4, p99: 4, max: 4 });
  expect(result.skewUpperBoundMs).toBeGreaterThan(5);
});

test("a missing reference cannot produce a latency measurement", () => {
  const result = measure([delayed(960)], { reference: new Float32Array(62_400) });
  expect(result.reference).toMatchObject({ detected: 0, missing: 10 });
  expect(result.receivers[0]).toMatchObject({ detected: 10, latencyMs: { count: 0, max: null }, latencyUpperBoundMs: null });
});

test("fixes warmup before measurement and counts failures only in the declared window", () => {
  const output = delayed(960); output.fill(0, 0, 10_560);
  const result = measure([output], { warmupFrames: 9_600 });
  expect(result).toMatchObject({ warmupFrames: 9_600, warmupMarkers: 2, expectedMarkers: 8 });
  expect(result.receivers[0]).toMatchObject({ detected: 8, missing: 0 });
});

test("keeps PCM bounded even when the recorder sends a long tail after the source ends", () => {
  const analyzer = createPcmAnalyzer({ sampleRate: 8_000, seed: 42, receiverIds: ["listener"], durationFrames: 8_000, maxDelayMs: 200, clockUncertaintyMs: 0 });
  for (let frame = -800; frame < 80_000; frame += 800) {
    const samples = new Float32Array(800);
    analyzer.push("reference", { startFrame: frame, samples });
    analyzer.push("listener", { startFrame: frame, samples });
  }
  const result = analyzer.finish();
  expect(result.peakRetainedPcmFrames).toBeLessThan(10_000);
  expect(result.failurePcm.length).toBeLessThanOrEqual(8);
  expect(result.failurePcm.every(snippet => snippet.samples.length <= 256)).toBe(true);
});

test("graph calibration uses worst observed error and invalidates xruns even with exact medians", async () => {
  const { assessGraphCalibration } = await import("./audio-lab/calibration.ts");
  const analysis = measure([delayed(960), delayed(3_840), delayed(7_200)]);
  const expected = { "listener-0": 20, "listener-1": 80, "listener-2": 150 };
  expect(assessGraphCalibration(analysis, expected, { xruns: 0, overflow: false, exitCode: 0 })).toMatchObject({ status: "passed", maxAbsoluteErrorMs: 0 });
  expect(assessGraphCalibration(analysis, expected, { xruns: 1, overflow: false, exitCode: 0 }).status).toBe("inconclusive");
  const outlier = delayed(960);
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  outlier.fill(0, 20_160, 20_928);
  outlier.set(signal.marker(4).samples, 20_352); // One marker is 24 ms old, while the median remains 20.
  const result = assessGraphCalibration(measure([outlier]), { "listener-0": 20 }, { xruns: 0, overflow: false, exitCode: 0 });
  expect(result).toMatchObject({ status: "inconclusive", maxAbsoluteErrorMs: 4 });
});

test("reports invalid measurement on a sample gap, while negative preroll remains valid", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed: 42, receiverIds: ["listener"], durationFrames: 9_600, maxDelayMs: 200, clockUncertaintyMs: 0 });
  for (const id of ["reference", "listener"]) analyzer.push(id, { startFrame: -480, samples: new Float32Array(480) });
  analyzer.push("reference", { startFrame: 0, samples: signal.render(0, 9_600) });
  const output = new Float32Array(19_199); output.set(signal.render(0, 9_600));
  analyzer.push("listener", { startFrame: 1, samples: output });
  expect(analyzer.finish()).toMatchObject({ measurementValid: false, measurementIssues: ["Non-contiguous PCM on listener"] });
});

test("renders the same unique marker sequence regardless of file/chunk boundaries", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const whole = signal.render(-100, 10_000);
  const parts = new Float32Array(10_000);
  parts.set(signal.render(-100, 7_777)); parts.set(signal.render(7_677, 2_223), 7_777);
  expect(parts).toEqual(whole);
  expect(signal.marker(0).samples).not.toEqual(signal.marker(1).samples);
});

test("finds stale fixture activity in the recorded tail after marker searches have finished", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const output = delayed(960);
  output.set(signal.marker(0).samples, 60_000); // Beyond every marker's 250 ms search window.
  const result = measure([output]);
  expect(result.receivers[0]).toMatchObject({ detected: 10, missing: 0, duplicated: 0, unmatchedActivityFrames: 768, unmatchedActivityBursts: 1, unmatchedActivityFirstFrame: 60_000 });
  expect(result.failurePcm.some(snippet => snippet.markerId === "unmatched-activity" && snippet.startFrame === 60_000)).toBe(true);
});

test("delayed warmup markers cover their output activity without entering steady-state counts", () => {
  // The marker generated at 100 ms appears at 250 ms, after the 200 ms warmup.
  const result = measure([delayed(7_200)], { warmupFrames: 9_600 });
  expect(result.receivers[0]).toMatchObject({ expected: 8, detected: 8, missing: 0, unmatchedActivityFrames: 0 });
});

test("marker observations serialize every accepted receiver identity as an own key", () => {
  const ids = ["__proto__", "constructor", "toString"];
  const observations: MarkerObservation[] = [];
  const signal = createMarkerSignal({ sampleRate: 8_000, seed: 42 });
  const analyzer = createPcmAnalyzer({ sampleRate: 8_000, seed: 42, receiverIds: ids,
    durationFrames: 800, maxDelayMs: 200, clockUncertaintyMs: 0, onMarker: value => observations.push(value) });
  const source = signal.render(0, 800), output = new Float32Array(2_400); output.set(source, 160);
  analyzer.push("reference", { startFrame: 0, samples: source });
  for (const id of ids) analyzer.push(id, { startFrame: 0, samples: output });
  expect(analyzer.finish().receivers.every(receiver => receiver.detected === 1)).toBe(true);
  expect(observations).toHaveLength(1);
  const outputs = JSON.parse(JSON.stringify(observations[0]!.outputs));
  for (const id of ids) {
    expect(Object.hasOwn(outputs, id)).toBe(true);
    expect(outputs[id]).toBe(160);
  }
});

test("bounded correlation agrees with exhaustive scoring near the acceptance threshold", () => {
  const sampleRate = 8_000, signal = createMarkerSignal({ sampleRate, seed: 73 });
  const marker = signal.marker(0).samples;
  for (const gain of [0.001, 0.01, 0.5, 2]) for (const inverted of [0, 11, 12, 13, 14, 48, 64, 128]) {
    const output = new Float32Array(2_400);
    for (let i = 0; i < marker.length; i++) output[163 + i] = marker[i]! * gain * (i < inverted ? -1 : 1);
    let best = 0, bestFrame = 0;
    // Independent slow oracle: every candidate evaluates every chip, with no
    // partial-score rejection. Prefix inversions straddle the 0.8 threshold.
    for (let frame = 0; frame <= 1_600; frame++) {
      let dot = 0, energy = 0;
      for (let i = 0; i < marker.length; i++) { const value = output[frame + i]!; dot += value * marker[i]!; energy += value * value; }
      const score = energy > 0.0001 ? dot / Math.sqrt(energy * 128 * 0.0625) : 0;
      if (score > best) { best = score; bestFrame = frame; }
    }
    const analyzer = createPcmAnalyzer({ sampleRate, seed: 73, receiverIds: ["listener"], durationFrames: 800,
      maxDelayMs: 200, clockUncertaintyMs: 0 });
    analyzer.push("reference", { startFrame: 0, samples: signal.render(0, 800) });
    analyzer.push("listener", { startFrame: 0, samples: output });
    const receiver = analyzer.finish().receivers[0]!;
    expect(receiver.detected).toBe(best >= 0.8 ? 1 : 0);
    if (best >= 0.8) expect(receiver.latencyMs.max).toBe(bestFrame * 1000 / sampleRate);
  }
});

test("finds a filtered marker at every sub-chip sample phase", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 73 });
  const marker = signal.marker(0).samples;
  for (let phase = 0; phase < 6; phase++) {
    const delay = 960 + phase, output = new Float32Array(2_400);
    // A symmetric eleven-tap low-pass filter preserves the declared center.
    // Full-waveform identity stays above 0.8 even near a chip boundary.
    for (let i = -5; i < marker.length + 5; i++) {
      for (let tap = -5; tap <= 5; tap++) output[delay + i]! += (marker[i + tap] ?? 0) / 11;
    }
    let dot = 0, energy = 0;
    for (let i = 0; i < marker.length; i++) { const value = output[delay + i]!; dot += value * marker[i]!; energy += value * value; }
    expect(dot / Math.sqrt(energy * marker.length * 0.0625)).toBeGreaterThan(0.8);
    const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed: 73, receiverIds: ["listener"],
      durationFrames: 800, maxDelayMs: 30, clockUncertaintyMs: 0 });
    analyzer.push("reference", { startFrame: 0, samples: signal.render(0, 800) });
    analyzer.push("listener", { startFrame: 0, samples: output });
    const receiver = analyzer.finish().receivers[0]!;
    expect(receiver).toMatchObject({ detected: 1, missing: 0, duplicated: 0 });
    expect(Math.abs(receiver.latencyMs.max! * 48 - delay)).toBeLessThanOrEqual(1);
  }
});

test("a decimated false peak cannot hide a full-waveform marker nearby", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 73 });
  const marker = signal.marker(0).samples, output = new Float32Array(2_400);
  for (let i = 0; i < marker.length; i++) output[960 + i] = marker[i]! + 0.01 * Math.sin(i);
  // This sparse impostor correlates perfectly at one sample per chip, but
  // does not match the full waveform. Its window overlaps the actual marker.
  for (let i = 3; i < marker.length; i += 6) output[1_260 + i] = marker[i]!;
  let best = -Infinity, frameAtBest = -1;
  for (let frame = 0; frame <= 1_440; frame++) {
    let dot = 0, energy = 0;
    for (let i = 0; i < marker.length; i++) { const value = output[frame + i]!; dot += value * marker[i]!; energy += value * value; }
    const score = energy ? dot / Math.sqrt(energy * marker.length * 0.0625) : 0;
    if (score > best) { best = score; frameAtBest = frame; }
  }
  expect(best).toBeGreaterThan(0.8);
  expect(frameAtBest).toBe(960);
  const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed: 73, receiverIds: ["listener"], durationFrames: 800, maxDelayMs: 30, clockUncertaintyMs: 0 });
  analyzer.push("reference", { startFrame: 0, samples: signal.render(0, 800) });
  analyzer.push("listener", { startFrame: 0, samples: output });
  const receiver = analyzer.finish().receivers[0]!;
  expect(receiver).toMatchObject({ detected: 1, missing: 0, duplicated: 0 });
  expect(receiver.latencyMs.max).toBe(20);
});

test("complete markers do not hide truncated capture coverage", () => {
  const signal = createMarkerSignal({ sampleRate: 8_000, seed: 42 });
  for (const [referenceStart, referenceEnd, outputEnd] of [[0, 800, 2_399], [0, 799, 2_400], [1, 800, 2_400]]) {
    const analyzer = createPcmAnalyzer({ sampleRate: 8_000, seed: 42, receiverIds: ["listener"], durationFrames: 800, maxDelayMs: 200, clockUncertaintyMs: 0 });
    const reference = signal.render(0, 800), output = new Float32Array(outputEnd); output.set(reference, 160);
    analyzer.push("reference", { startFrame: referenceStart!, samples: reference.subarray(referenceStart, referenceEnd) });
    analyzer.push("listener", { startFrame: 0, samples: output });
    const result = analyzer.finish();
    expect(result.receivers[0]!.detected).toBe(1);
    expect(result.measurementValid).toBe(false);
    expect(result.measurementIssues.join(" ")).toContain("coverage");
  }
});

test("an observation writer failure invalidates measurement without recounting markers", () => {
  const signal = createMarkerSignal({ sampleRate: 8_000, seed: 42 });
  let writes = 0;
  const analyzer = createPcmAnalyzer({ sampleRate: 8_000, seed: 42, receiverIds: ["listener"], durationFrames: 1_600, maxDelayMs: 200, clockUncertaintyMs: 0,
    onMarker() { writes++; throw new Error("disk full"); } });
  const reference = new Float32Array(3_200), output = new Float32Array(3_200);
  reference.set(signal.render(0, 1_600)); output.set(reference.subarray(0, 1_600), 160);
  analyzer.push("reference", { startFrame: 0, samples: reference });
  expect(() => analyzer.push("listener", { startFrame: 0, samples: output })).toThrow("disk full");
  const result = analyzer.finish();
  expect(result.measurementValid).toBe(false);
  expect(result.measurementIssues.join(" ")).toContain("writer");
  expect(result.receivers[0]!.latencyMs.count).toBeLessThanOrEqual(result.receivers[0]!.detected);
  expect(writes).toBe(1);
});

test("full-waveform search agrees with an exhaustive oracle across phases and distortion", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 94 }), marker = signal.marker(0).samples;
  for (const inverted of [0, 64, 80, 96, 128]) for (const delay of [0, 1, 2, 3, 4, 5, 240]) {
    const output = new Float32Array(1_040);
    for (let i = 0; i < marker.length; i++) output[delay + i] = marker[i]! * (i < inverted ? -1 : 1) + 0.005 * Math.sin(i * 1.17);
    let best = -Infinity, bestFrame = -1;
    for (let frame = 0; frame <= 240; frame++) {
      let dot = 0, energy = 0;
      for (let i = 0; i < marker.length; i++) { const value = output[frame + i]!; dot += value * marker[i]!; energy += value * value; }
      const score = energy > 0.0006 ? dot / Math.sqrt(energy * 48) : 0;
      if (score > best) { best = score; bestFrame = frame; }
    }
    for (const size of [127, 1_040]) {
      const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed: 94, receiverIds: ["listener"], durationFrames: 800, maxDelayMs: 5, clockUncertaintyMs: 0 });
      const reference = new Float32Array(1_040); reference.set(marker);
      for (let frame = 0; frame < output.length; frame += size) {
        analyzer.push("reference", { startFrame: frame, samples: reference.subarray(frame, frame + size) });
        analyzer.push("listener", { startFrame: frame, samples: output.subarray(frame, frame + size) });
      }
      const result = analyzer.finish();
      expect(result.measurementValid).toBe(true);
      expect(result.receivers[0]!.detected).toBe(best >= 0.8 ? 1 : 0);
      if (best >= 0.8) expect(result.receivers[0]!.latencyMs.max).toBe(bestFrame / 48);
    }
  }
});
