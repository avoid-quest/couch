// CPU-only throughput probe; no browser, audio device, network or qualification.
import { createMarkerSignal, createPcmAnalyzer } from "./pcm.ts";

const sampleRate = 48_000, audioSeconds = 10, maxDelayMs = 250;
const durationFrames = sampleRate * audioSeconds;
const ids = Array.from({ length: 50 }, (_, i) => `receiver-${i}`);
const source = createMarkerSignal({ sampleRate, seed: 42 }).render(0, durationFrames);
const length = durationFrames + maxDelayMs * sampleRate / 1000 + 1024;
const reference = new Float32Array(length); reference.set(source);
const outputs = ids.map((_, i) => { const output = new Float32Array(length); output.set(source, 960 + i); return output; });
const start = performance.now();
const analyzer = createPcmAnalyzer({ sampleRate, seed: 42, receiverIds: ids, durationFrames, maxDelayMs, clockUncertaintyMs: 0 });
let maxBatchMs = 0;
for (let frame = 0; frame < length; frame += 1024) {
  const batch = performance.now();
  analyzer.push("reference", { startFrame: frame, samples: reference.subarray(frame, frame + 1024) });
  ids.forEach((id, i) => analyzer.push(id, { startFrame: frame, samples: outputs[i]!.subarray(frame, frame + 1024) }));
  maxBatchMs = Math.max(maxBatchMs, performance.now() - batch);
}
const result = analyzer.finish(), elapsedMs = performance.now() - start;
const complete = result.measurementValid && result.reference.detected === 100 && result.receivers.every((receiver, i) =>
  receiver.detected === 100 && !receiver.missing && !receiver.duplicated && !receiver.outOfOrder
  && receiver.latencyMs.max === (960 + i) * 1000 / sampleRate);
console.log(JSON.stringify({ runtime: process.versions.bun, sampleRate, audioSeconds, receivers: ids.length, maxDelayMs,
  elapsedMs, maxBatchMs, complete, fasterThanInput: elapsedMs < audioSeconds * 1000,
  peakRetainedPcmFrames: result.peakRetainedPcmFrames,
  scope: "Synthetic analyzer throughput on this host; not native delivery, worker headroom or sustained 50-listener qualification" }));
process.exitCode = complete && elapsedMs < audioSeconds * 1000 ? 0 : 1;
