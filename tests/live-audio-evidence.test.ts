import { expect, test } from "bun:test";
import { createLiveAudioEvidence, liveAudioAcceptance, type LiveAudioRun } from "./audio-lab/evidence.ts";
import { createMarkerSignal, createPcmAnalyzer } from "./audio-lab/pcm.ts";

function run(delayFrames = 960): LiveAudioRun {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const source = signal.render(0, 9_600);
  const reference = new Float32Array(24_000); reference.set(source);
  const output = new Float32Array(24_000); output.set(source, delayFrames);
  const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed: 42, durationFrames: source.length, receiverIds: ["one", "two"], maxDelayMs: 200, clockUncertaintyMs: 0.1 });
  for (let startFrame = 0; startFrame < reference.length; startFrame += 1_000) {
    analyzer.push("reference", { startFrame, samples: reference.subarray(startFrame, startFrame + 1_000) });
    for (const id of ["one", "two"]) analyzer.push(id, { startFrame, samples: output.subarray(startFrame, startFrame + 1_000) });
  }
  return {
    evidenceKind: "virtual-output", input: "test fixture (no real device)", route: "synthetic-array",
    codec: { name: "pcm-f32", packetDurationMs: 10 }, source: { count: 1, sampleRate: 48_000, channels: 1 },
    receivers: { requested: 2, admitted: 2, activelyRendering: 2, excluded: 0 },
    network: { profile: "control", seed: 42, quality: "clean", configuration: "no impairment" },
    timeline: { basis: "shared-graph", clockMappingErrorMs: 0.1 },
    calibration: { method: "synthetic", status: "measured", sourceToCaptureMs: 0, outputPresentationOffsetMs: 0, uncertaintyMs: 0.1, artifact: "synthetic-fixture.json" },
    workers: [{ id: "test", cpuCount: 4, memoryBytes: 8_000_000_000, cpuPercentMax: 20, rssBytesMax: 100_000_000, overloaded: false }],
    telemetry: ["one", "two"].map(id => ({ id, rendererUnderruns: 0, unexpectedMutes: 0, disconnects: 0, missingSourceMs: 0, concealedSourceMs: 0, longestInterruptionMs: 0, queueAgeMsMax: 0, queueBytesMax: 0 })),
    analysis: analyzer.finish(), fixedWarmupMs: 0, untested: ["real decoder"],
  };
}

test("reuses couch-evidence/1 and never turns synthetic timing into acoustic or venue Wi-Fi evidence", () => {
  const result = createLiveAudioEvidence(run());
  expect(result).toMatchObject({ schema: "couch-evidence/1", kind: "live-audio" });
  expect(result.measured.conditions).toMatchObject({ captureToSpeaker: { status: "unmeasured" }, physicalSpeakerSkew: { status: "unmeasured" }, venueWifi: { status: "unmeasured" } });
  expect(result.measured.gates.softwareLatency.status).toBe("inconclusive");
  expect(result.measured.gates.quality.status).toBe("inconclusive");
  expect(result.measured.status).toBe("inconclusive");
  expect(result.untested).toContain("phone acoustic latency");
  expect(Object.isFrozen(liveAudioAcceptance)).toBe(true);
});

// This supplies calibration metadata to exercise policy. It is a unit-test
// fixture, not a claim that these arrays ran through an audio device.
const calibratedFixture = (delayFrames = 960) => {
  const value = run(delayFrames);
  value.calibration.method = "audio-graph";
  value.calibration.fixtureActivityPath = "exact-pcm";
  return value;
};

test("gates the observed maximum plus uncertainty, never just the median", () => {
  const result = createLiveAudioEvidence(calibratedFixture(2_880)); // Exactly 60 ms before uncertainty.
  expect(result.measured.gates.softwareLatency.status).toBe("failed");
  expect(result.measured.latencyUpperBoundsMs[0]!.rawObservedMaxMs).toBe(60);
  expect(result.measured.latencyUpperBoundsMs[0]!.upperBoundMs).toBeGreaterThan(60);
  expect(createLiveAudioEvidence(calibratedFixture()).measured.gates.softwareLatency.status).toBe("passed");
});

test("one measured output cannot pass the two-output alignment contract", () => {
  const value = calibratedFixture();
  value.analysis!.receivers.splice(1);
  value.receivers = { requested: 1, admitted: 1, activelyRendering: 1, excluded: 0 };
  value.telemetry.splice(1);
  const result = createLiveAudioEvidence(value).measured;
  expect(result.gates.softwareLatency.status).toBe("passed");
  expect(result.gates.quality.status).toBe("passed");
  expect(result.gates.alignment.status).toBe("unmeasured");
  expect(result.status).toBe("unmeasured");
});

test("preserves unknown capture delay and rejects unmeasured output correction", () => {
  const value = calibratedFixture(); value.calibration.sourceToCaptureMs = null;
  const result = createLiveAudioEvidence(value);
  expect(result.measured.calibration.sourceToCaptureMs).toBeNull();
  expect(result.measured.latencyUpperBoundsMs[0]!.rawObservedMaxMs).toBe(20);
  value.calibration.outputPresentationOffsetMs = null;
  expect(createLiveAudioEvidence(value).measured.gates.softwareLatency.status).toBe("inconclusive");
  expect(createLiveAudioEvidence(value).measured.latencyUpperBoundsMs[0]!.upperBoundMs).toBeNull();
});

test("worker overload makes a slow run inconclusive, and excluded listeners cannot manufacture a pass", () => {
  const value = calibratedFixture(3_840); value.workers[0]!.overloaded = true;
  expect(createLiveAudioEvidence(value).measured.status).toBe("inconclusive");
  const excluded = calibratedFixture(); excluded.receivers.activelyRendering = 1; excluded.receivers.excluded = 1;
  expect(createLiveAudioEvidence(excluded).measured.gates.participation.status).toBe("failed");
});

test("missing markers and absent underrun telemetry cannot disappear from a clean run", () => {
  const missing = calibratedFixture(); missing.analysis!.receivers[0]!.missing = 1; missing.analysis!.receivers[0]!.detected--;
  expect(createLiveAudioEvidence(missing).measured.gates.quality.status).toBe("failed");
  const unknown = calibratedFixture(); unknown.telemetry[0]!.rendererUnderruns = null;
  expect(createLiveAudioEvidence(unknown).measured.gates.quality.status).toBe("inconclusive");
});

test("observed clipping cannot pass quality, and a clipped reference invalidates measurement", () => {
  const output = calibratedFixture(); output.analysis!.receivers[0]!.clippedSamples = 1;
  expect(createLiveAudioEvidence(output).measured.gates.quality.status).toBe("failed");
  const reference = calibratedFixture(); reference.analysis!.reference.clippedSamples = 1;
  expect(createLiveAudioEvidence(reference).measured.status).toBe("inconclusive");
});

test("duplicate telemetry identities cannot hide a conflicting observation", () => {
  const value = calibratedFixture();
  value.telemetry.push({ ...value.telemetry[0]!, rendererUnderruns: 1 });
  const result = createLiveAudioEvidence(value).measured;
  expect(result.status).toBe("inconclusive");
  expect(result.gates.quality.reasons.join(" ")).toContain("Duplicate");
});

test("warmup and clock bounds cannot be changed after PCM analysis", () => {
  const value = calibratedFixture(); value.fixedWarmupMs = 100;
  expect(createLiveAudioEvidence(value).measured.status).toBe("inconclusive");
  value.fixedWarmupMs = 0; value.timeline.clockMappingErrorMs = 0;
  expect(createLiveAudioEvidence(value).measured.status).toBe("inconclusive");
  value.fixedWarmupMs = 10_001;
  expect(() => createLiveAudioEvidence(value)).toThrow("Fixed warmup");
});

test("writes the shared envelope with checkout, runtime and worker environment", async () => {
  const { mkdtempSync, readdirSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeLiveAudioEvidence } = await import("./evidence.ts");
  const directory = mkdtempSync(join(tmpdir(), "couch-evidence-test-"));
  const previous = process.env.COUCH_EVIDENCE;
  try {
    process.env.COUCH_EVIDENCE = directory;
    await writeLiveAudioEvidence(run());
    const result = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]!), "utf8"));
    expect(result).toMatchObject({ schema: "couch-evidence/1", kind: "live-audio", runtime: { node: process.versions.node } });
    expect(typeof result.revision).toBe("string");
    expect(typeof result.dirty).toBe("boolean");
    expect(typeof result.environment.kernel).toBe("string");
    expect(result.measured.conditions.venueWifi.status).toBe("unmeasured");
  } finally {
    if (previous === undefined) delete process.env.COUCH_EVIDENCE; else process.env.COUCH_EVIDENCE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

function observedFixture(source: Float32Array, outputs: Float32Array[], maxDelayMs = 1_000) {
  const value = calibratedFixture();
  const ids = outputs.map((_, index) => `listener-${index}`);
  const analyzer = createPcmAnalyzer({ sampleRate: 48_000, seed: 42, durationFrames: source.length, receiverIds: ids, maxDelayMs, clockUncertaintyMs: 0.1 });
  const length = Math.max(source.length, ...outputs.map(output => output.length));
  const reference = new Float32Array(length); reference.set(source);
  for (let startFrame = 0; startFrame < length; startFrame += 733) {
    analyzer.push("reference", { startFrame, samples: reference.subarray(startFrame, startFrame + 733) });
    outputs.forEach((output, index) => analyzer.push(ids[index]!, { startFrame, samples: output.subarray(startFrame, startFrame + 733) }));
  }
  value.analysis = analyzer.finish();
  value.receivers = { requested: ids.length, admitted: ids.length, activelyRendering: ids.length, excluded: 0 };
  value.telemetry = ids.map(id => ({ ...value.telemetry[0]!, id }));
  return value;
}

test.each(["duplicated", "outOfOrder"] as const)("alignment cannot pass complete but %s output", failure => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const source = signal.render(0, 9_600);
  const output = new Float32Array(24_000); output.set(source, 960);
  if (failure === "duplicated") output.set(signal.marker(0).samples, 2_400);
  else {
    output.fill(0, 960, 960 + signal.markerFrames);
    output.set(signal.marker(0).samples, 7_200);
  }
  // Identical ambiguous outputs still have zero first-occurrence skew.
  const value = observedFixture(source, [output, output], 200);
  expect(value.analysis!.receivers[0]![failure]).toBe(1);
  expect(value.analysis!.skewMs).toMatchObject({ count: 2, max: 0 });
  const result = createLiveAudioEvidence(value).measured;
  expect(result.gates.alignment.status).toBe("failed");
  expect(result.gates.alignment.reasons.join(" ")).toContain("repeated or out-of-order");
});

test.each([["opus", "lossy"], [null, "unknown"], ["pcm-f32", undefined]] as const)("unmatched spread is inconclusive for codec %s and path %s", (codec, path) => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const source = signal.render(0, 9_600);
  const output = new Float32Array(24_000); output.set(source, 960);
  // Controlled activity around exact marker spans exercises policy, not an Opus encoder.
  for (const start of [960, 5_760]) {
    output.fill(0.1, start - 14, start);
    output.fill(0.1, start + signal.markerFrames, start + signal.markerFrames + 102);
  }
  const value = observedFixture(source, [output], 200);
  value.codec.name = codec;
  value.calibration.fixtureActivityPath = path;
  expect(value.analysis!.reference.unmatchedActivityFrames).toBe(0);
  expect(value.analysis!.receivers[0]).toMatchObject({ detected: 2, missing: 0, duplicated: 0, outOfOrder: 0,
    unmatchedActivityFrames: 232, unmatchedActivityBursts: 4, unmatchedActivityFirstFrame: 946 });
  const result = createLiveAudioEvidence(value);
  expect(result.measured.gates.quality.status).toBe("inconclusive");
  expect(result.measured.gates.quality.reasons.join(" ")).toContain("codec/filter spread");
  expect(result.measured.status).toBe("inconclusive");
  expect(result.measured.analysis).toEqual(value.analysis);
  expect(result.measured.calibration.fixtureActivityPath).toBe(path ?? "unknown");
});

test("preserves reported Opus activity counts without asserting stale replay", () => {
  const value = calibratedFixture();
  value.codec.name = "opus";
  value.calibration.fixtureActivityPath = "lossy";
  value.analysis!.receivers[0]!.unmatchedActivityFrames = 5_971;
  value.analysis!.receivers[1]!.unmatchedActivityFrames = 6_572;
  const result = createLiveAudioEvidence(value);
  expect(result.measured.gates.quality.status).toBe("inconclusive");
  expect(result.measured.analysis!.reference.unmatchedActivityFrames).toBe(0);
  expect(result.measured.analysis!.receivers.map(receiver => receiver.unmatchedActivityFrames)).toEqual([5_971, 6_572]);
});

test.each(["duplicated", "outOfOrder"] as const)("identified %s markers still fail with unmatched activity on lossy or unknown paths", failure => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const source = signal.render(0, 9_600);
  const output = new Float32Array(24_000); output.set(source, 960);
  if (failure === "duplicated") output.set(signal.marker(0).samples, 2_400);
  else {
    output.fill(0, 960, 960 + signal.markerFrames);
    output.set(signal.marker(0).samples, 7_200); // After marker 1, but still after its own reference.
  }
  output.fill(0.1, 10_000, 10_020);
  const value = observedFixture(source, [output], 200);
  expect(value.analysis!.receivers[0]![failure]).toBe(1);
  expect(value.analysis!.receivers[0]!.unmatchedActivityFrames).toBeGreaterThan(0);
  for (const path of ["lossy", "unknown", undefined] as const) {
    value.codec.name = path === "lossy" ? "opus" : null;
    value.calibration.fixtureActivityPath = path;
    const result = createLiveAudioEvidence(value);
    expect(result.measured.gates.quality.status).toBe("failed");
    expect(result.measured.gates.quality.reasons.join(" ")).toContain("repeated/out-of-order markers");
    expect(result.measured.status).toBe("failed");
  }
});

test("exact PCM path metadata cannot replace measured calibration even with no unmatched activity", () => {
  const value = calibratedFixture();
  expect(value.analysis!.receivers.every(receiver => receiver.unmatchedActivityFrames === 0)).toBe(true);
  value.calibration.status = "unmeasured";
  expect(createLiveAudioEvidence(value).measured.gates.quality.status).toBe("inconclusive");
  value.calibration.status = "measured"; value.calibration.artifact = null;
  expect(createLiveAudioEvidence(value).measured.gates.quality.status).toBe("inconclusive");
  expect(createLiveAudioEvidence(value).measured.status).toBe("inconclusive");
});

test("mild-profile PCM loss cannot pass with contradictory zero-loss telemetry", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const output = new Float32Array(96_000); output.set(signal.marker(0).samples, 960);
  const value = observedFixture(signal.render(0, 48_000), [output]);
  value.network.quality = "mild";
  expect(value.analysis!.receivers[0]).toMatchObject({ expected: 10, detected: 1, missing: 9 });
  const report = createLiveAudioEvidence(value);
  expect(report.measured.gates.quality.status).toBe("inconclusive");
  expect(report.measured.gates.quality.reasons.join(" ")).toContain("missing markers contradict zero");
  expect(report.measured.status).not.toBe("passed");
  value.telemetry[0]!.missingSourceMs = 1; // A nonzero assertion still cannot reconcile nine absent markers.
  const unresolved = createLiveAudioEvidence(value);
  expect(unresolved.measured.gates.quality.status).toBe("inconclusive");
  expect(unresolved.measured.conditions.continuousAudioIntegrity.status).toBe("unmeasured");
  expect(unresolved.measured.telemetry[0]!.missingSourceMs).toBe(1); // Never invent lost milliseconds from marker spacing.
});

test("a stale marker outside its correlation window fails calibrated exact PCM quality and is inconclusive on unknown paths", () => {
  const signal = createMarkerSignal({ sampleRate: 48_000, seed: 42 });
  const source = signal.render(0, 96_000);
  const clean = new Float32Array(144_000); clean.set(source, 960);
  const replay = clean.slice(); replay.set(signal.marker(0).samples, 50_400);
  const value = observedFixture(source, [replay, replay]);
  expect(value.analysis!.receivers.every(receiver => receiver.detected === 20 && receiver.missing === 0 && receiver.duplicated === 0)).toBe(true);
  expect(value.analysis!.receivers[0]).toMatchObject({ unmatchedActivityFrames: 768, unmatchedActivityBursts: 1, unmatchedActivityFirstFrame: 50_400 });
  expect(createLiveAudioEvidence(value).measured.gates.quality.status).toBe("failed");
  expect(createLiveAudioEvidence(observedFixture(source, [clean, clean])).measured.gates.quality.status).toBe("passed");
  delete value.calibration.fixtureActivityPath;
  expect(createLiveAudioEvidence(value).measured.gates.quality.status).toBe("inconclusive");
  value.calibration.fixtureActivityPath = "exact-pcm"; value.calibration.status = "unmeasured";
  expect(createLiveAudioEvidence(value).measured.gates.quality.status).toBe("inconclusive");
});
