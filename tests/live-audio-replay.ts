// Offline only: bun tests/live-audio-replay.ts <retained run> <new output directory>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPcmAnalyzer } from "./audio-lab/pcm";
import { createContinuousAnalyzer } from "./audio-lab/continuous";
import { assessPresentation, createPresentationParser } from "./audio-lab/presentation";
import { assessRecording } from "./audio-lab/recording";
import { verifyJackBindings } from "./audio-lab/topology";

assert(process.argv[2] && process.argv[3], "Provide retained run and new output directories");
const input = resolve(process.argv[2]), output = resolve(process.argv[3]);
mkdirSync(output, { mode: 0o700 }); // Refuse overwriting any original or earlier replay.
const hashes: Record<string, string> = {}, started = performance.now();
const read = (name: string, limit = 16 * 1024 * 1024) => {
  const path = join(input, name);
  assert(statSync(path).size <= limit, `${name}: artifact exceeds replay bound`);
  const bytes = readFileSync(path);
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
  return bytes;
};
const write = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
try {
  const original = JSON.parse(read("result.json").toString());
  const manifest = JSON.parse(read("presentation-manifest.json").toString());
  const boundary = JSON.parse(read("presentation.json").toString());
  assert.equal(original.runId, manifest.runId); assert.equal(original.runId, boundary.runId);
  assert.equal(original.sampleRate, 48000); assert.equal(manifest.sampleRate, 48000);
  assert(["calibration", "direct", "sync", "ingress"].includes(original.mode));
  assert(["markers", "continuous"].includes(original.fixture));
  assert(Number.isInteger(original.receivers) && original.receivers > 0 && original.receivers <= 100);
  assert(Number.isInteger(original.seconds) && original.seconds >= 5 && original.seconds <= 120);
  assert.equal(manifest.bindings.length, original.receivers + 1);
  assert.equal(original.recorderDelayFrames, manifest.recorderDelayFrames);
  const rate = 48000, durationFrames = original.seconds * rate, maxDelayMs = original.mode === "sync" ? 8000 : 1000;
  const sourceBytes = read("source.f32", 120 * rate * 4);
  assert.equal(sourceBytes.length, durationFrames * 4);
  const source = Float32Array.from({ length: durationFrames }, (_, i) => sourceBytes.readFloatLE(i * 4));
  const capture = (name: string) => {
    const parser = createPresentationParser({ maxFrames: 140 * rate, maxChannels: original.receivers + 1, maxBytes: 256 * 1024 * 1024 });
    parser.push(read(name, 256 * 1024 * 1024)); return parser.finish();
  };
  const recorder = capture("recorder.pcmstream"), witness = capture("witness.pcmstream");
  assert.equal(recorder.channels, original.receivers + 1);
  assert.notEqual(recorder.end.sourceFirstFrame, null);
  const receiverIds = Array.from({ length: original.receivers }, (_, i) => `receiver-${i}`);
  const analyzer = createPcmAnalyzer({ sampleRate: rate, seed: original.seed, receiverIds, durationFrames, maxDelayMs,
    clockUncertaintyMs: 0, warmupFrames: original.mode === "calibration" ? 0 : 2 * rate,
    onMarker: marker => appendFileSync(join(output, "markers.ndjson"), JSON.stringify(marker) + "\n") });
  const continuous = original.fixture === "continuous" ? createContinuousAnalyzer({ sampleRate: rate, seed: original.seed,
    receiverIds, durationFrames, warmupFrames: 2 * rate, maxDelayMs, runId: original.runId,
    routeId: original.continuous?.routeId ?? "unrecorded-route", // Never supply a qualification calibration during replay.
  }) : null;
  for (const block of recorder.blocks) for (let channel = 0; channel < recorder.channels; channel++) {
    const samples = Float32Array.from({ length: block.frameCount }, (_, i) => block.samples[i * recorder.channels + channel]!);
    const chunk = { startFrame: (block.firstFrame - recorder.end.sourceFirstFrame!) | 0, samples };
    const id = channel === 0 ? "reference" : receiverIds[channel - 1]!;
    analyzer.push(id, chunk); continuous?.push(id, chunk);
  }
  const analysis = analyzer.finish();
  const bindings = (manifest.bindings as string[]).flatMap((port, index) => [
    { input: `couch_lab_record:input_${index}`, output: port }, { input: `couch_lab_witness:input_${index}`, output: port },
  ]);
  const topologyVerified = verifyJackBindings(boundary.topologyBefore, bindings).verified
    && verifyJackBindings(boundary.topologyAfter, bindings.filter(value => value.input.startsWith("couch_lab_record:"))).verified
    && (original.mode === "calibration" || boundary.pulseRoutes.length === original.receivers && boundary.pulseRoutes.every((route: any) => route.verified === true));
  const presentation = assessPresentation({ recorder, witness, source, receiverPorts: manifest.bindings.slice(1),
    expectedReceiverDelayFrames: original.recorderDelayFrames, topologyVerified,
    startFrame: original.mode === "calibration" ? 0 : 2 * rate, endFrame: durationFrames + maxDelayMs * rate / 1000 });
  const recording = assessRecording({ analysis, presentation,
    recorderExitCode: original.graphHealth?.exitCode ?? null, witnessExitCode: original.witnessHealth?.exitCode ?? null });
  const evaluators = Object.fromEntries(["pcm", "continuous", "presentation", "recording", "topology"].map(name =>
    [name, createHash("sha256").update(readFileSync(join(import.meta.dirname, "audio-lab", `${name}.ts`))).digest("hex")]));
  const result = { schema: "couch-audio-replay/1", originalRunId: original.runId, hashes, evaluators,
    elapsedMs: performance.now() - started, recording, presentation, analysis, continuous: continuous?.finish() ?? null,
    provenance: "Retained streams and source; process exits and browser/Pulse ownership rely on original run attestations",
    qualified: false };
  write("result.json", result);
  console.log(JSON.stringify({ output, elapsedMs: result.elapsedMs, complete: recording.complete,
    markers: analysis.receivers.map(track => [track.detected, track.expected]), maximaMs: analysis.receivers.map(track => track.latencyMs.max) }));
  process.exitCode = recording.complete ? 0 : 1;
} catch (error) {
  write("failure.json", { status: "inconclusive", error: String(error), hashes });
  throw error;
}
