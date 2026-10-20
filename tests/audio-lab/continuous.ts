import { createHash } from "node:crypto";
import { createMarkerSignal, type PcmChunk } from "./pcm.ts";

/** Changing any tolerance or waveform requires a new profile/fixture version. */
export const continuousProfile = Object.freeze({
  id: "couch-continuous-pcm/1", fixture: "couch-continuous-signal/1", sampleRate: 48_000,
  bedAmplitude: 512 / 32768, chipFrames: 6, cellFrames: 240, acquisitionFrames: 960,
  rmsError: 0.10, peakError: 0.50, referenceError: 0.000001,
  rateMin: 0.995, rateMax: 1.005, rateStep: 0.000125, acquisitionPhaseStepFrames: 1 / 32,
  gainMin: 0.125, gainMax: 2, acquisitionCorrelation: 0.8,
  maxDurationFrames: 48_000 * 120, maxDelayMs: 1_000, maxReceivers: 100,
  inputSliceFrames: 1024, maxIntervals: 128, maxSnippets: 8, snippetFrames: 64,
  maxObservations: 4096, demonstratedFaultMs: 5,
});
const p = continuousProfile;
const integer = (value: number) => Number.isSafeInteger(value);

export function createContinuousSignal({ sampleRate, seed }: { sampleRate: number; seed: number }) {
  if (sampleRate !== p.sampleRate || !integer(seed)) throw new Error("Continuous fixture requires 48 kHz and a safe integer seed");
  const markers = createMarkerSignal({ sampleRate, seed });
  const codes = new Map<number, Buffer>();
  const chip = (index: number) => {
    const block = Math.floor(index / 256);
    let code = codes.get(block);
    if (!code) {
      code = createHash("sha256").update(`${p.fixture}:${seed}:${block}`).digest();
      if (codes.size === 2) codes.delete(codes.keys().next().value!);
      codes.set(block, code);
    }
    const bit = index % 256;
    return code[bit >>> 3]! & (1 << (bit & 7)) ? p.bedAmplitude : -p.bedAmplitude;
  };
  const render = (startFrame: number, frameCount: number) => {
    if (!integer(startFrame) || !integer(frameCount) || frameCount < 0 || frameCount > p.maxDurationFrames || !integer(startFrame + frameCount)
      || startFrame + frameCount > p.maxDurationFrames) throw new Error("Invalid continuous PCM range");
    const samples = new Float32Array(frameCount);
    for (let i = Math.max(0, -startFrame); i < frameCount; i++) {
      const frame = startFrame + i, index = Math.floor(frame / p.chipFrames), fraction = frame % p.chipFrames / p.chipFrames;
      samples[i] = chip(index) * (1 - fraction) + chip(index + 1) * fraction;
    }
    for (let index = Math.max(0, Math.floor(startFrame / markers.intervalFrames)); index * markers.intervalFrames < startFrame + frameCount; index++) {
      const marker = markers.marker(index);
      for (let i = Math.max(0, startFrame - marker.startFrame); i < markers.markerFrames && marker.startFrame + i < startFrame + frameCount; i++) samples[marker.startFrame + i - startFrame]! += marker.samples[i]!;
    }
    return samples;
  };
  return { manifest: Object.freeze({ version: p.fixture, sampleRate, seed, bedAmplitude: p.bedAmplitude, chipFrames: p.chipFrames }),
    sampleRate, seed, marker: markers.marker, markerFrames: markers.markerFrames, intervalFrames: markers.intervalFrames, render };
}

export type ContinuousCalibration = {
  kind: "synthetic" | "route";
  status: "passed" | "failed";
  /** Caller-retained artifact, whose contents/provenance the caller verifies. */
  artifact: string;
  sha256: string;
  runId: string;
  routeId: string;
  profileId: string;
};
export type ContinuousWindow = {
  trackId: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  outputStartFrame: number | null;
  outputEndFrame: number | null;
  verdict: "matched" | "mismatched" | "unresolved";
  rmsError: number | null;
  peakError: number | null;
  rate: number | null;
};
export type ContinuousAnalyzerOptions = {
  sampleRate: number;
  seed: number;
  receiverIds: string[];
  durationFrames: number;
  warmupFrames: number;
  maxDelayMs: number;
  runId: string;
  routeId: string;
  calibration?: ContinuousCalibration | null;
  /** At most profile.maxObservations calls; omitted observations are counted. */
  onWindow?: (window: ContinuousWindow) => void;
};
type Interval = { trackId: string; startFrame: number; endFrame: number; verdict: "mismatched" | "unresolved" };
type Track = {
  id: string; start: number; end: number | null; first: number | null; pcm: Float32Array;
  source: number; output: number | null; gain: number | null; anchor: number | null;
  acquired: boolean; invalid: boolean; lost: boolean; acquisitionFailed: boolean;
  matchedFrames: number; mismatchedFrames: number; unresolvedFrames: number;
  recordedSamples: number; checkedOutputSamples: number; unexpectedOutputSamples: number;
  maxRmsError: number | null; maxPeakError: number | null; rateMin: number | null; rateMax: number | null;
};

/** Sample-domain identity only. Does not measure a speaker, underruns, or lost/concealed duration. */
export function createContinuousAnalyzer(options: ContinuousAnalyzerOptions) {
  const { sampleRate, seed, durationFrames, warmupFrames, maxDelayMs, runId, routeId } = options;
  const receiverIds = [...options.receiverIds], calibration = options.calibration ? { ...options.calibration } : null;
  const signal = createContinuousSignal({ sampleRate, seed });
  if (!integer(durationFrames) || durationFrames > p.maxDurationFrames || !integer(warmupFrames) || warmupFrames < p.acquisitionFrames || warmupFrames >= durationFrames) throw new Error("Invalid duration or fixed warmup");
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0 || maxDelayMs > p.maxDelayMs || !runId?.trim() || !routeId?.trim()) throw new Error("Invalid delay or provenance");
  if (!receiverIds.length || receiverIds.length > p.maxReceivers || new Set(receiverIds).size !== receiverIds.length || receiverIds.some(id => !id || id === "reference")) throw new Error("Invalid receiver identities");
  const delayFrames = Math.ceil(maxDelayMs * sampleRate / 1000);
  const acquisitionEnd = delayFrames + Math.ceil(p.acquisitionFrames / p.rateMin) + 1;
  const retainedFramesPerTrack = acquisitionEnd + p.inputSliceFrames + p.cellFrames + 2;
  // Includes transient append/slice duplication, template/render workspace and
  // the full snippet allowance. This is a live-data bound, not process RSS/GC.
  const auxiliaryPcmFrames = retainedFramesPerTrack + p.acquisitionFrames + 2 + 2 * signal.markerFrames + p.cellFrames + 2 + p.maxSnippets * p.snippetFrames;
  const expectedFrames = durationFrames - warmupFrames;
  const tracks = new Map<string, Track>(["reference", ...receiverIds].map(id => [id, {
    id, start: 0, end: null, first: null, pcm: new Float32Array(0), source: 0,
    output: id === "reference" ? 0 : null, gain: id === "reference" ? 1 : null, anchor: id === "reference" ? 0 : null,
    acquired: id === "reference", invalid: false, lost: false, acquisitionFailed: false,
    matchedFrames: 0, mismatchedFrames: 0, unresolvedFrames: 0, recordedSamples: 0, checkedOutputSamples: 0, unexpectedOutputSamples: 0,
    maxRmsError: null, maxPeakError: null, rateMin: null, rateMax: null,
  }]));
  const issues = new Set<string>(), intervals: Interval[] = [];
  const snippets: { trackId: string; startFrame: number; samples: number[] }[] = [];
  let finished = false, peakRetainedPcmFrames = 0, omittedIntervals = 0, emittedObservations = 0, omittedObservations = 0;
  const onWindow = options.onWindow;
  const at = (track: Track, frame: number) => track.pcm[frame - track.start]!;
  const invalidate = (track: Track, reason: string) => { track.invalid = true; issues.add(`${track.id}: ${reason}`); };
  const snippet = (track: Track, frame: number) => {
    if (snippets.length < p.maxSnippets) snippets.push({ trackId: track.id, startFrame: frame, samples: Array.from(track.pcm.subarray(Math.max(0, frame - track.start), Math.max(0, frame - track.start) + p.snippetFrames)) });
  };
  const observe = (track: Track, start: number, end: number, verdict: ContinuousWindow["verdict"], rms: number | null, peak: number | null, outputStart: number | null, outputEnd: number | null, rate: number | null) => {
    start = Math.max(start, warmupFrames);
    if (end <= start) return;
    const frames = end - start;
    if (verdict === "matched") track.matchedFrames += frames;
    else {
      if (verdict === "mismatched") track.mismatchedFrames += frames; else track.unresolvedFrames += frames;
      const previous = intervals.at(-1);
      if (previous?.trackId === track.id && previous.verdict === verdict && previous.endFrame === start) previous.endFrame = end;
      else if (intervals.length < p.maxIntervals) intervals.push({ trackId: track.id, startFrame: start, endFrame: end, verdict });
      else omittedIntervals++;
    }
    if (rms !== null) track.maxRmsError = Math.max(track.maxRmsError ?? 0, rms);
    if (peak !== null) track.maxPeakError = Math.max(track.maxPeakError ?? 0, peak);
    if (onWindow && emittedObservations < p.maxObservations) {
      emittedObservations++;
      try { onWindow({ trackId: track.id, sourceStartFrame: start, sourceEndFrame: end, outputStartFrame: outputStart, outputEndFrame: outputEnd, verdict, rmsError: rms, peakError: peak, rate }); }
      catch (error) { invalidate(track, "observation writer failed"); throw error; }
    } else omittedObservations++;
  };
  // Expected reference has zero preroll/tail. All recorded output outside its
  // mapped source interval is checked too, without guessing a missing duration.
  const auditSilence = (track: Track, from: number, to: number) => {
    const threshold = track.id === "reference" ? p.referenceError : p.bedAmplitude * (track.gain ?? p.gainMin) * p.rmsError;
    for (let frame = from; frame < to; frame++) {
      if (Math.abs(at(track, frame)) > threshold) {
        if (!track.unexpectedOutputSamples) snippet(track, frame);
        track.unexpectedOutputSamples++;
      }
      track.checkedOutputSamples++;
    }
  };
  const discard = (track: Track, before: number) => {
    const count = Math.max(0, Math.min(track.pcm.length, before - track.start));
    track.pcm = track.pcm.slice(count); track.start += count;
  };
  const interpolate = (samples: Float32Array, position: number) => {
    if (position < 0 || position >= samples.length) return 0;
    const index = Math.floor(position), fraction = position - index;
    return samples[index]! * (1 - fraction) + (samples[index + 1] ?? 0) * fraction;
  };
  const template = signal.render(0, p.acquisitionFrames + 2);
  const acquireScore = (track: Track, delay: number, rate: number) => {
    const end = Math.ceil(delay + p.acquisitionFrames / rate);
    let dot = 0, energy = 0;
    for (let frame = Math.ceil(delay); frame < end; frame++) {
      const expected = interpolate(template, (frame - delay) * rate);
      dot += expected * at(track, frame); energy += expected * expected;
    }
    const gain = energy ? dot / energy : 0;
    if (!(gain > 0)) return { delay, rate, gain, rms: Infinity, peak: Infinity };
    let square = 0, peak = 0;
    for (let frame = Math.ceil(delay); frame < end; frame++) {
      const error = at(track, frame) - gain * interpolate(template, (frame - delay) * rate);
      square += error * error; peak = Math.max(peak, Math.abs(error));
    }
    return { delay, rate, gain, rms: Math.sqrt(square / (end - Math.ceil(delay))) / (p.bedAmplitude * Math.abs(gain)), peak: peak / (p.bedAmplitude * Math.abs(gain)) };
  };
  const acceptable = (score: { gain: number; rms: number; peak: number }) => score.gain >= p.gainMin && score.gain <= p.gainMax && score.rms <= p.rmsError && score.peak <= p.peakError;
  const acquire = (track: Track) => {
    // Coarse search uses the unchanged first marker, only in the declared
    // acquisition interval. Multiple separated copies cannot establish an anchor.
    const marker = signal.marker(0).samples;
    const peaks: { frame: number; score: number }[] = [];
    for (let frame = 0; frame <= delayFrames; frame += p.chipFrames / 2) {
      let score = 0;
      for (const rate of [p.rateMin, 1, p.rateMax]) {
        let dot = 0, energy = 0;
        for (let i = 3; i < marker.length; i += p.chipFrames) {
          const position = frame + i / rate, index = Math.floor(position), fraction = position - index;
          const value = at(track, index) * (1 - fraction) + at(track, index + 1) * fraction;
          dot += value * marker[i]!; energy += value * value;
        }
        score = Math.max(score, energy ? dot / Math.sqrt(energy * 128 * 0.0625) : 0);
      }
      if (score < p.acquisitionCorrelation) continue;
      const previous = peaks.at(-1);
      if (previous && frame - previous.frame < marker.length / 2) { if (score > previous.score) { previous.frame = frame; previous.score = score; } }
      else peaks.push({ frame, score });
    }
    if (peaks.length !== 1) { track.acquisitionFailed = true; return; }
    const lower = Math.max(0, peaks[0]!.frame - p.chipFrames), upper = Math.min(delayFrames, peaks[0]!.frame + p.chipFrames);
    let best = acquireScore(track, lower, 1);
    // Common integer-delay paths avoid the more expensive fractional/rate search.
    for (let delay = lower; delay <= upper; delay++) {
      const score = acquireScore(track, delay, 1);
      if (score.rms < best.rms) best = score;
    }
    if (!acceptable(best)) {
      for (let delay = lower; delay <= upper; delay += p.acquisitionPhaseStepFrames) {
        for (let step = -10; step <= 10; step++) {
          const score = acquireScore(track, delay, 1 + step * 0.0005);
          if (score.rms < best.rms) best = score;
        }
      }
    }
    if (!acceptable(best)) {
      const coarse = best, rateIndex = Math.round((coarse.rate - 1) / p.rateStep);
      for (let delay = Math.max(lower, coarse.delay - 0.5); delay <= Math.min(upper, coarse.delay + 0.5); delay += p.acquisitionPhaseStepFrames) {
        for (let step = -4; step <= 4; step++) {
          const rate = 1 + (rateIndex + step) * p.rateStep;
          if (rate < p.rateMin || rate > p.rateMax) continue;
          const score = acquireScore(track, delay, rate);
          if (score.rms < best.rms) best = score;
        }
      }
    }
    if (!acceptable(best)) { track.acquisitionFailed = true; return; }
    track.acquired = true; track.anchor = track.output = best.delay; track.gain = best.gain;
    auditSilence(track, track.start, Math.ceil(best.delay));
    discard(track, Math.ceil(best.delay));
  };
  const process = (track: Track, flush = false) => {
    if (track.invalid || track.lost || track.acquisitionFailed) { track.pcm = new Float32Array(0); return; }
    if (track.start < 0) { const end = Math.min(0, track.start + track.pcm.length); auditSilence(track, track.start, end); discard(track, end); }
    if (!track.acquired) {
      if (track.start + track.pcm.length < acquisitionEnd) return;
      acquire(track);
      if (!track.acquired) { track.pcm = new Float32Array(0); return; }
    }
    while (track.source < durationFrames) {
      const start = track.source, end = Math.min(durationFrames, start + p.cellFrames, start < warmupFrames ? warmupFrames : Infinity);
      const count = end - start, outputStart = track.output!;
      const needed = track.id === "reference" ? end : Math.ceil(outputStart + count / p.rateMin);
      if (!flush && track.start + track.pcm.length < needed) break;
      const expected = signal.render(start, Math.min(count + 2, durationFrames - start));
      let best: { rms: number; peak: number; rate: number; outputEnd: number; samples: number } | undefined;
      const steps = track.id === "reference" ? 0 : Math.round((p.rateMax - 1) / p.rateStep);
      // Every candidate shares the previously accepted endpoint. There is no
      // independent offset fit, gain fit, or retrospective change to older cells.
      for (let step = -steps; step <= steps; step++) {
        const rate = 1 + step * p.rateStep, outputEnd = outputStart + count / rate;
        if (Math.ceil(outputEnd) > track.start + track.pcm.length) continue;
        let square = 0, peak = 0, samples = 0;
        for (let frame = Math.ceil(outputStart); frame < Math.ceil(outputEnd); frame++) {
          const expectedValue = interpolate(expected, (frame - outputStart) * rate) * track.gain!;
          const error = at(track, frame) - expectedValue;
          square += error * error; peak = Math.max(peak, Math.abs(error)); samples++;
        }
        const scale = track.id === "reference" ? 1 : p.bedAmplitude * track.gain!;
        const score = { rms: Math.sqrt(square / samples) / scale, peak: peak / scale, rate, outputEnd, samples };
        if (!best || score.rms < best.rms) best = score;
        if (step === 0 && score.rms === 0) break;
      }
      if (!best) break;
      const score = best;
      const matched = track.id === "reference" ? score.peak <= p.referenceError : score.rms <= p.rmsError && score.peak <= p.peakError;
      track.checkedOutputSamples += score.samples;
      observe(track, start, end, matched ? "matched" : "mismatched", score.rms, score.peak, outputStart, score.outputEnd, score.rate);
      track.source = end;
      if (!matched) {
        snippet(track, Math.ceil(outputStart));
        if (track.id === "reference") issues.add("reference: recorded fixture mismatch");
        if (track.id !== "reference") { track.lost = true; track.pcm = new Float32Array(0); break; }
      }
      track.output = score.outputEnd;
      track.rateMin = Math.min(track.rateMin ?? score.rate, score.rate); track.rateMax = Math.max(track.rateMax ?? score.rate, score.rate);
      discard(track, Math.ceil(track.output));
    }
    if (track.source === durationFrames && !track.lost) { auditSilence(track, track.start, track.start + track.pcm.length); discard(track, track.start + track.pcm.length); }
  };
  return {
    push(trackId: string, chunk: PcmChunk) {
      if (finished) throw new Error("Continuous analyzer is already finished");
      const track = tracks.get(trackId);
      if (!track || !integer(chunk.startFrame) || !integer(chunk.startFrame + chunk.samples.length)) throw new Error("Invalid PCM track or frame");
      if (!chunk.samples.length) return;
      track.recordedSamples += chunk.samples.length;
      if (track.end !== null && track.end !== chunk.startFrame) invalidate(track, "non-contiguous recorded PCM");
      if (track.first === null) { track.first = chunk.startFrame; if (chunk.startFrame > 0) invalidate(track, "missing recording prefix"); }
      track.end = chunk.startFrame + chunk.samples.length;
      for (let offset = 0; offset < chunk.samples.length; offset += p.inputSliceFrames) {
        const samples = chunk.samples.subarray(offset, offset + p.inputSliceFrames);
        for (const sample of samples) if (!Number.isFinite(sample)) { invalidate(track, "non-finite recorded PCM"); break; }
        if (track.invalid || track.lost || track.acquisitionFailed) { track.pcm = new Float32Array(0); continue; }
        if (!track.pcm.length) track.start = chunk.startFrame + offset;
        const appended = new Float32Array(track.pcm.length + samples.length);
        appended.set(track.pcm); appended.set(samples, track.pcm.length); track.pcm = appended;
        peakRetainedPcmFrames = Math.max(peakRetainedPcmFrames, [...tracks.values()].reduce((sum, value) => sum + value.pcm.length, 0));
        if (track.pcm.length > retainedFramesPerTrack) invalidate(track, "bounded PCM retention exceeded");
        process(track);
      }
    },
    finish() {
      if (finished) throw new Error("Continuous analyzer is already finished");
      finished = true;
      for (const track of tracks.values()) {
        process(track, true);
        if (track.source < durationFrames) observe(track, track.source, durationFrames, "unresolved", null, null, track.output, null, null);
        track.pcm = new Float32Array(0);
      }
      const report = (track: Track) => ({
        id: track.id, acquisition: track.acquired ? "acquired" as const : track.acquisitionFailed ? "failed" as const : "incomplete" as const,
        anchorOutputFrame: track.anchor, frozenGain: track.gain,
        coverage: { startFrame: warmupFrames, endFrame: durationFrames, expectedFrames,
          evaluatedFrames: track.matchedFrames + track.mismatchedFrames, matchedFrames: track.matchedFrames,
          mismatchedFrames: track.mismatchedFrames, unresolvedFrames: track.unresolvedFrames },
        recordedRange: { startFrame: track.first, endFrame: track.end },
        recordedSamples: track.recordedSamples, uncheckedRecordedSamples: track.recordedSamples - track.checkedOutputSamples,
        checkedOutputSamples: track.checkedOutputSamples, unexpectedOutputSamples: track.unexpectedOutputSamples,
        maxRmsError: track.maxRmsError, maxPeakError: track.maxPeakError,
        acceptedRateMin: track.rateMin, acceptedRateMax: track.rateMax,
        lastAcceptedOutputFrame: track.output, identityLost: track.lost,
      });
      const reference = report(tracks.get("reference")!), receivers = receiverIds.map(id => report(tracks.get(id)!));
      const referenceValid = !tracks.get("reference")!.invalid && !reference.coverage.mismatchedFrames && !reference.coverage.unresolvedFrames && !reference.unexpectedOutputSamples;
      const measurementValid = issues.size === 0 && referenceValid;
      if (!referenceValid) issues.add("Recorded reference does not verify the complete declared fixture");
      const mismatch = receivers.some(value => value.coverage.mismatchedFrames || value.identityLost || value.unexpectedOutputSamples);
      const unresolved = receivers.some(value => value.acquisition !== "acquired" || value.coverage.unresolvedFrames || value.uncheckedRecordedSamples);
      const rawIdentity = !measurementValid ? "inconclusive" as const : mismatch ? "mismatched" as const : unresolved ? "inconclusive" as const : "matched" as const;
      const qualificationIssues: string[] = [];
      if (!calibration || calibration.kind !== "route" || calibration.status !== "passed") qualificationIssues.push("Independent successful route calibration is required; synthetic calibration verifies only the detector");
      if (calibration && (calibration.profileId !== p.id || calibration.routeId !== routeId || !calibration.runId?.trim() || calibration.runId === runId
        || !calibration.artifact?.trim() || !/^[a-f0-9]{64}$/i.test(calibration.sha256))) qualificationIssues.push("Calibration provenance does not match this profile/route or is not independent of this run");
      const status = rawIdentity === "mismatched" ? "failed" as const : rawIdentity === "matched" && !qualificationIssues.length ? "passed" as const : "inconclusive" as const;
      return { status, rawIdentity, measurementValid, measurementIssues: [...issues], qualificationIssues,
        profile: p, manifest: signal.manifest, runId, routeId, calibration, durationFrames, warmupFrames, maxDelayMs, maxAcquisitionDelayFrames: delayFrames,
        reference, receivers, intervals, omittedIntervals, failurePcm: snippets,
        observations: { emitted: emittedObservations, omitted: omittedObservations, limit: p.maxObservations },
        retention: { peakTrackBufferFrames: peakRetainedPcmFrames, peakRetainedPcmFrames: peakRetainedPcmFrames + auxiliaryPcmFrames,
          maxRetainedPcmFrames: retainedFramesPerTrack * tracks.size + auxiliaryPcmFrames,
          maxIntervals: p.maxIntervals, maxSnippets: p.maxSnippets, snippetFrames: p.snippetFrames },
        scope: "Continuous fixture identity within the frozen timing/error model; no missing/concealed duration, renderer health, backend presentation or physical sound measurement",
      };
    },
  };
}

export type ContinuousAnalysis = ReturnType<ReturnType<typeof createContinuousAnalyzer>["finish"]>;
