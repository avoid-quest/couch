import { expect, test } from "bun:test";
import { createMarkerSignal, createPcmAnalyzer } from "./audio-lab/pcm";
import { assessRecording } from "./audio-lab/recording";

function recording() {
  const signal = createMarkerSignal({ sampleRate: 8_000, seed: 42 });
  const reference = new Float32Array(2_400), output = new Float32Array(2_400);
  reference.set(signal.render(0, 800)); output.set(reference.subarray(0, 800), 160);
  const analyzer = createPcmAnalyzer({ sampleRate: 8_000, seed: 42, receiverIds: ["listener"], durationFrames: 800, maxDelayMs: 200, clockUncertaintyMs: 0 });
  analyzer.push("reference", { startFrame: 0, samples: reference }); analyzer.push("listener", { startFrame: 0, samples: output });
  return { analysis: analyzer.finish(), presentation: { status: "passed" as const, reasons: [] as string[] }, recorderExitCode: 0, witnessExitCode: 0 };
}

test("recording completion requires every reference/output marker and both successful process exits", () => {
  expect(assessRecording(recording()).complete).toBe(true);
  for (const track of ["reference", "output"] as const) for (const field of ["missing", "duplicated", "outOfOrder", "clippedSamples"] as const) {
    const run = recording(), target = track === "reference" ? run.analysis.reference : run.analysis.receivers[0]!;
    target[field] = 1;
    expect(assessRecording(run).complete).toBe(false);
  }
  for (const key of ["recorderExitCode", "witnessExitCode"] as const) for (const code of [null, 1]) {
    expect(assessRecording({ ...recording(), [key]: code }).complete).toBe(false);
  }
  const invalid = recording(); invalid.analysis.measurementValid = false;
  expect(assessRecording(invalid).complete).toBe(false);
  expect(assessRecording({ ...recording(), presentation: { status: "inconclusive", reasons: ["missing tail"] } }).complete).toBe(false);
});
