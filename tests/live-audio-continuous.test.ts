import { expect, test } from "bun:test";
import { continuousProfile as profile, createContinuousAnalyzer, createContinuousSignal, type ContinuousCalibration } from "./audio-lab/continuous.ts";
import { createMarkerSignal, createPcmAnalyzer } from "./audio-lab/pcm.ts";

const rate = 48_000, seed = 42, duration = 14_400, warmup = 4_800, delay = 960;
const signal = createContinuousSignal({ sampleRate: rate, seed });
const source = signal.render(0, duration);
// Independent synthetic transport: sample position, interpolation and mutation
// come from this fixture, never from the analyzer's selected alignment.
function transport(input = source, { speed = 1, gain = 1, phase = delay, quantize = false } = {}) {
  const output = new Float32Array(Math.ceil(phase + input.length / speed) + 480);
  for (let frame = 0; frame < output.length; frame++) {
    const position = (frame - phase) * speed, index = Math.floor(position), fraction = position - index;
    if (position < 0 || position >= input.length) continue;
    const sample = ((input[index] ?? 0) * (1 - fraction) + (input[index + 1] ?? 0) * fraction) * gain;
    output[frame] = quantize ? Math.round(sample * 32768) / 32768 : sample;
  }
  return output;
}
const synthetic: ContinuousCalibration = { kind: "synthetic", status: "passed", artifact: "synthetic-array.json", sha256: "a".repeat(64), runId: "calibration", routeId: "synthetic-test", profileId: profile.id };
function analyze(output: Float32Array, { input = source, chunk = 733, calibration = undefined as ContinuousCalibration | undefined, onWindow = undefined as Parameters<typeof createContinuousAnalyzer>[0]["onWindow"] } = {}) {
  const analyzer = createContinuousAnalyzer({ sampleRate: rate, seed, receiverIds: ["receiver"], durationFrames: input.length, warmupFrames: warmup,
    maxDelayMs: 30, runId: "measurement", routeId: "synthetic-test", calibration, onWindow });
  const reference = new Float32Array(Math.max(input.length, output.length)); reference.set(input);
  for (let frame = 0; frame < reference.length; frame += chunk) {
    analyzer.push("reference", { startFrame: frame, samples: reference.subarray(frame, frame + chunk) });
    if (frame < output.length) analyzer.push("receiver", { startFrame: frame, samples: output.subarray(frame, frame + chunk) });
  }
  return analyzer.finish();
}
function reconciles(result: ReturnType<typeof analyze>) {
  for (const track of [result.reference, ...result.receivers]) {
    const c = track.coverage;
    expect(c.matchedFrames + c.mismatchedFrames + c.unresolvedFrames).toBe(c.expectedFrames);
    expect(c.evaluatedFrames).toBe(c.matchedFrames + c.mismatchedFrames);
  }
  expect(result.retention.peakRetainedPcmFrames).toBeLessThanOrEqual(result.retention.maxRetainedPcmFrames);
  expect(result.intervals.length).toBeLessThanOrEqual(profile.maxIntervals);
  expect(result.failurePcm.length).toBeLessThanOrEqual(profile.maxSnippets);
  expect(result.failurePcm.every(value => value.samples.length <= profile.snippetFrames)).toBe(true);
}

test("continuous render is chunk-invariant, ordinal-specific, and preserves marker codes", () => {
  const whole = signal.render(-19, 10_000), pieces = new Float32Array(whole.length);
  for (let start = 0; start < whole.length; start += 137) pieces.set(signal.render(start - 19, Math.min(137, whole.length - start)), start);
  expect(pieces).toEqual(whole);
  expect(whole.subarray(0, 19)).toEqual(new Float32Array(19));
  expect(signal.render(2_000, 480)).not.toEqual(signal.render(6_800, 480));
  expect(signal.render(2_000, 480)).not.toEqual(createContinuousSignal({ sampleRate: rate, seed: 43 }).render(2_000, 480));
  const markers = createMarkerSignal({ sampleRate: rate, seed });
  expect(signal.marker(1)).toEqual(markers.marker(1));
  const markerAnalyzer = createPcmAnalyzer({ sampleRate: rate, seed, receiverIds: ["receiver"], durationFrames: duration, maxDelayMs: 30, clockUncertaintyMs: 0 });
  markerAnalyzer.push("reference", { startFrame: 0, samples: source });
  markerAnalyzer.push("receiver", { startFrame: 0, samples: transport() });
  expect(markerAnalyzer.finish().receivers[0]).toMatchObject({ detected: 3, missing: 0, duplicated: 0, latencyMs: { min: 20, max: 20 } });
});

test("matched synthetic PCM is not route-qualified; chunk boundaries do not change identity", () => {
  const output = transport(source, { gain: 0.8, quantize: true });
  const a = analyze(output, { chunk: 113 }), b = analyze(output, { chunk: 4097, calibration: synthetic });
  for (const result of [a, b]) {
    reconciles(result);
    expect(result).toMatchObject({ status: "inconclusive", rawIdentity: "matched", measurementValid: true });
    expect(result.receivers[0]!.coverage).toMatchObject({ matchedFrames: duration - warmup, mismatchedFrames: 0, unresolvedFrames: 0 });
    expect(result.receivers[0]!.uncheckedRecordedSamples).toBe(0);
    expect(result.qualificationIssues.join(" ")).toContain("route calibration");
    expect("missingSourceMs" in result.receivers[0]!).toBe(false);
    expect("concealedSourceMs" in result.receivers[0]!).toBe(false);
  }
  expect(a.receivers).toEqual(b.receivers);
});

test("route calibration must be independent and match the frozen profile and route", () => {
  // This exercises the metadata gate only; it is not actual route calibration.
  const valid = { ...synthetic, kind: "route" as const };
  expect(analyze(transport(), { calibration: valid }).status).toBe("passed");
  for (const calibration of [{ ...valid, runId: "measurement" }, { ...valid, profileId: "other" }, { ...valid, routeId: "other" },
    { ...valid, sha256: "" }, { ...valid, artifact: "" }, { ...valid, status: "failed" as const }]) {
    expect(analyze(transport(), { calibration }).status).toBe("inconclusive");
  }
});

test("silence, a wrong seed, looped source, and a bad recorded reference cannot pass", () => {
  const looped = source.slice();
  for (let at = warmup; at < looped.length; at++) looped[at] = source[at % warmup]!;
  for (const output of [new Float32Array(16_000), transport(createContinuousSignal({ sampleRate: rate, seed: 43 }).render(0, duration)), transport(looped)]) {
    const result = analyze(output); reconciles(result);
    expect(result.rawIdentity).not.toBe("matched");
    expect(result.status).not.toBe("passed");
  }
  for (const at of [0, warmup + 500]) {
    const reference = source.slice(); reference.fill(0, at, at + 240);
    const result = analyze(transport(), { input: reference }); reconciles(result);
    expect(result).toMatchObject({ status: "inconclusive", rawIdentity: "inconclusive", measurementValid: false });
  }
});

// All faults lie between the 100 and 200 ms markers. Offsets sweep both cell
// edges and the middle; a straddling 5 ms defect must not disappear into averaging.
for (const milliseconds of [5, 10, 20]) {
  test(`${milliseconds} ms mute/repeat/drop/insert/compensated faults fail across cell offsets`, () => {
    const length = milliseconds * 48;
    for (const offset of [0, 1, 59, 119, 179, 239]) {
      const at = 6_720 + offset;
      for (const kind of ["mute", "repeat", "drop", "insert", "compensated"] as const) {
        const changed = source.slice();
        if (kind === "mute") changed.fill(0, at, at + length);
        if (kind === "repeat") changed.set(source.subarray(at - 960, at - 960 + length), at);
        if (kind === "drop") { changed.copyWithin(at, at + length); changed.fill(0, changed.length - length); }
        if (kind === "insert") { changed.copyWithin(at + length, at); changed.set(source.subarray(at - length, at), at); }
        if (kind === "compensated") { changed.copyWithin(at, at + length, at + 2 * length); changed.set(source.subarray(at, at + length), at + length); }
        const result = analyze(transport(changed)); reconciles(result);
        expect(result.rawIdentity, `${milliseconds} ms ${kind}, offset ${offset}`).toBe("mismatched");
        expect(result.receivers[0]!.coverage.mismatchedFrames).toBeGreaterThan(0);
        expect(result.receivers[0]!.coverage.unresolvedFrames).toBeGreaterThan(0);
        expect(result.status).toBe("failed");
      }
    }
  });
}

test("accepted alignment is immutable and no matching suffix repairs an earlier failure", () => {
  const changed = source.slice(); changed.fill(0, 7_001, 7_241);
  const observations: { verdict: string; sourceStartFrame: number }[] = [];
  const result = analyze(transport(changed), { onWindow: value => { if (value.trackId === "receiver") observations.push(value); } });
  const failed = observations.findIndex(value => value.verdict === "mismatched");
  expect(failed).toBeGreaterThanOrEqual(0);
  expect(observations.slice(failed + 1).every(value => value.verdict === "unresolved")).toBe(true);
  expect(result.receivers[0]!.identityLost).toBe(true);
  expect(result.rawIdentity).toBe("mismatched");
});

for (const speed of [0.995, 0.995125, 0.997, 0.9995, 1, 1.000125, 1.003, 1.004875, 1.005]) {
  test(`independent fractional resampling at ${speed} stays inside the frozen envelope`, () => {
    const result = analyze(transport(source, { speed, phase: delay + 0.25, gain: 0.75 })); reconciles(result);
    expect(result.rawIdentity).toBe("matched");
    expect(result.receivers[0]!.acceptedRateMin!).toBeGreaterThanOrEqual(profile.rateMin);
    expect(result.receivers[0]!.acceptedRateMax!).toBeLessThanOrEqual(profile.rateMax);
    if (speed > 1.0005) expect(result.receivers[0]!.acceptedRateMin!).toBeGreaterThan(1);
    if (speed < 0.9995) expect(result.receivers[0]!.acceptedRateMax!).toBeLessThan(1);
    expect(result.status).toBe("inconclusive");
  });
}

test("an out-of-envelope rate and a later abrupt jump cannot be silently realigned", () => {
  for (const speed of [0.99, 1.01]) {
    const result = analyze(transport(source, { speed })); reconciles(result);
    expect(result.rawIdentity).not.toBe("matched");
  }
  const shifted = transport(); shifted.copyWithin(8_000, 8_480);
  expect(analyze(shifted).rawIdentity).toBe("mismatched");
});

test("partial final cells are evaluated and a truncated tail remains unresolved", () => {
  const partial = signal.render(0, duration + 13), output = transport(partial);
  const good = analyze(output, { input: partial }); reconciles(good);
  expect(good.rawIdentity).toBe("matched");
  expect(good.receivers[0]!.coverage.matchedFrames).toBe(partial.length - warmup);
  const truncated = analyze(output.subarray(0, delay + partial.length - 240), { input: partial }); reconciles(truncated);
  expect(truncated.rawIdentity).not.toBe("matched");
  expect(truncated.receivers[0]!.coverage.unresolvedFrames).toBeGreaterThan(0);
});

test("variable negative preroll and complete final callbacks keep source-relative indices unchanged", () => {
  for (const preroll of [1, 127, 128, 129, 511, 777]) {
    const rendered = transport(source, { speed: 1.003, phase: delay + 0.25, gain: 0.75 });
    const frames = Math.ceil((preroll + rendered.length + 128) / 128) * 128;
    const reference = new Float32Array(frames), output = new Float32Array(frames);
    reference.set(source, preroll); output.set(rendered, preroll);
    const analyzer = createContinuousAnalyzer({ sampleRate: rate, seed, receiverIds: ["receiver"], durationFrames: duration,
      warmupFrames: warmup, maxDelayMs: 30, runId: "preroll", routeId: "synthetic-test" });
    const chunk = preroll % 2 ? 137 : 1024;
    for (let at = 0; at < frames; at += chunk) {
      analyzer.push("reference", { startFrame: at - preroll, samples: reference.subarray(at, at + chunk) });
      analyzer.push("receiver", { startFrame: at - preroll, samples: output.subarray(at, at + chunk) });
    }
    const result = analyzer.finish(); reconciles(result);
    expect(result.rawIdentity, `preroll ${preroll}`).toBe("matched");
    expect(result.reference.recordedRange).toEqual({ startFrame: -preroll, endFrame: frames - preroll });
    expect(result.reference.unexpectedOutputSamples).toBe(0);
    expect(result.reference.uncheckedRecordedSamples).toBe(0);
    expect(result.receivers[0]!.uncheckedRecordedSamples).toBe(0);
    expect(result.receivers[0]!.anchorOutputFrame).toBe(delay + 0.25);
  }
});

test("nonzero recorded reference preroll or tail cannot verify the fixture", () => {
  for (const position of [0, 128 + duration]) {
    const reference = new Float32Array(duration + 2048); reference.set(source, 128); reference[position] = 0.01;
    const output = new Float32Array(reference.length); output.set(source, 128 + delay);
    const analyzer = createContinuousAnalyzer({ sampleRate: rate, seed, receiverIds: ["receiver"], durationFrames: duration,
      warmupFrames: warmup, maxDelayMs: 30, runId: "preroll", routeId: "synthetic-test" });
    analyzer.push("reference", { startFrame: -128, samples: reference });
    analyzer.push("receiver", { startFrame: -128, samples: output });
    const result = analyzer.finish(); reconciles(result);
    expect(result).toMatchObject({ rawIdentity: "inconclusive", measurementValid: false });
    expect(result.reference.unexpectedOutputSamples).toBe(1);
  }
});

test("5 ms between-marker corruption also fails within a permitted resampling trajectory", () => {
  const changed = source.slice(); changed.fill(0, 7_001, 7_241);
  const result = analyze(transport(changed, { speed: 1.005, phase: delay + 0.25 })); reconciles(result);
  expect(result.rawIdentity).toBe("mismatched");
  expect(result.receivers[0]!.identityLost).toBe(true);
});

test("unexpected tail replay is measured without inferring missing/concealed duration", () => {
  const output = new Float32Array(18_000); output.set(source, delay); output.set(source.subarray(2_000, 2_240), 16_000);
  const result = analyze(output); reconciles(result);
  expect(result).toMatchObject({ rawIdentity: "mismatched", status: "failed" });
  expect(result.receivers[0]!.unexpectedOutputSamples).toBeGreaterThan(0);
});

test("capture gaps, overlaps, non-finite samples, and missing tracks remain inconclusive", () => {
  for (const shift of [-1, 1]) {
    const analyzer = createContinuousAnalyzer({ sampleRate: rate, seed, receiverIds: ["receiver"], durationFrames: duration, warmupFrames: warmup, maxDelayMs: 30, runId: "measurement", routeId: "synthetic-test" });
    analyzer.push("reference", { startFrame: 0, samples: source.subarray(0, 1_000) });
    analyzer.push("reference", { startFrame: 1_000 + shift, samples: source.subarray(1_000) });
    analyzer.push("receiver", { startFrame: 0, samples: transport() });
    const result = analyzer.finish(); reconciles(result);
    expect(result).toMatchObject({ measurementValid: false, rawIdentity: "inconclusive" });
  }
  for (const value of [NaN, Infinity]) { const bad = transport(); bad[8_000] = value; expect(analyze(bad).measurementValid).toBe(false); }
  const missing = analyze(new Float32Array(0)); reconciles(missing);
  expect(missing.rawIdentity).toBe("inconclusive");
  expect(missing.receivers[0]!.coverage.unresolvedFrames).toBe(duration - warmup);
});

test("PCM, failure intervals, snippets and callback observations stay bounded for a stalled track", () => {
  let calls = 0;
  const frames = 1_200_000;
  const analyzer = createContinuousAnalyzer({ sampleRate: rate, seed, receiverIds: ["receiver"], durationFrames: frames, warmupFrames: warmup,
    maxDelayMs: 30, runId: "bounded", routeId: "synthetic-test", onWindow: () => { calls++; } });
  // Reference-only synthetic verification is cheap; no receiver search or load run.
  for (let at = 0; at < frames; at += 1024) {
    const samples = signal.render(at, Math.min(1024, frames - at));
    for (let i = 0; i < samples.length; i++) if (at + i >= warmup && Math.floor((at + i) / profile.cellFrames) % 2) samples[i] = 0;
    analyzer.push("reference", { startFrame: at, samples });
  }
  const result = analyzer.finish(); reconciles(result);
  expect(calls).toBe(profile.maxObservations);
  expect(result.observations.omitted).toBeGreaterThan(0);
  expect(result.omittedIntervals).toBeGreaterThan(0);
  expect(result.intervals.length).toBe(profile.maxIntervals);
  expect(result.receivers[0]!.coverage.unresolvedFrames).toBe(frames - warmup);
});

test("rejects unsupported configuration and finalizes only once", () => {
  const options = { sampleRate: rate, seed, receiverIds: ["receiver"], durationFrames: duration, warmupFrames: warmup, maxDelayMs: 30, runId: "measurement", routeId: "synthetic-test" };
  for (const invalid of [{ sampleRate: 44_100 }, { seed: NaN }, { warmupFrames: 0 }, { maxDelayMs: 1001 }, { receiverIds: ["reference"] }, { receiverIds: ["x", "x"] }, { durationFrames: Infinity }, { runId: "" }]) {
    expect(() => createContinuousAnalyzer({ ...options, ...invalid })).toThrow();
  }
  const analyzer = createContinuousAnalyzer(options); analyzer.finish();
  expect(() => analyzer.finish()).toThrow();
  expect(() => analyzer.push("reference", { startFrame: 0, samples: source })).toThrow();
});
