import { createHash } from "node:crypto";

/** Mono Float32 PCM on one graph's sample-frame timeline, never callback time.
 * https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/sampleRate
 * Synthetic delay checks validate this analyzer, not device presentation timing.
 */
export function createMarkerSignal({ sampleRate, seed, intervalMs = 100 }: { sampleRate: number; seed: number; intervalMs?: number }) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || !Number.isInteger(seed)) throw new Error("Invalid sample rate or seed");
  const chipFrames = Math.max(1, Math.round(sampleRate / 8_000));
  const markerFrames = 128 * chipFrames;
  const intervalFrames = Math.round(sampleRate * intervalMs / 1_000);
  if (intervalFrames < markerFrames * 2) throw new Error("Marker interval is too short");
  const marker = (index: number) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= 0xffff_ffff) throw new Error("Invalid marker index");
    // Hash both source identity and ordinal: nearby seeds must not produce a
    // permutation of the same short codes. Never repeat a duration-sized file.
    const code = createHash("sha256").update(`couch-live-pcm/1:${seed}:${index}`).digest();
    const samples = new Float32Array(markerFrames);
    for (let chip = 0; chip < 128; chip++) {
      samples.fill(code[chip >>> 3]! & (1 << (chip & 7)) ? 0.25 : -0.25, chip * chipFrames, (chip + 1) * chipFrames);
    }
    return { id: `${seed}:${index}`, index, startFrame: index * intervalFrames, samples };
  };
  const render = (startFrame: number, frameCount: number) => {
    if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(frameCount) || frameCount < 0) throw new Error("Invalid PCM range");
    const samples = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      const frame = startFrame + i;
      if (frame >= 0) samples[i] = 0.01 * (Math.sin(2 * Math.PI * 220 * frame / sampleRate) + Math.sin(2 * Math.PI * 337 * frame / sampleRate));
    }
    for (let index = Math.max(0, Math.floor(startFrame / intervalFrames)); index * intervalFrames < startFrame + frameCount; index++) {
      const value = marker(index);
      for (let i = Math.max(0, startFrame - value.startFrame); i < markerFrames && value.startFrame + i < startFrame + frameCount; i++) samples[value.startFrame + i - startFrame]! += value.samples[i]!;
    }
    return samples;
  };
  return { sampleRate, seed, chipFrames, markerFrames, intervalFrames, marker, render };
}

export type Distribution = { count: number; min: number | null; p50: number | null; p95: number | null; p99: number | null; max: number | null; mean: number | null; quantileResolutionMs: number };
const distribution = () => {
  const bins = new Map<number, number>();
  let count = 0, sum = 0, min = Infinity, max = -Infinity;
  return {
    add(value: number) { const bin = Math.round(value * 10); bins.set(bin, (bins.get(bin) ?? 0) + 1); count++; sum += value; min = Math.min(min, value); max = Math.max(max, value); },
    result(): Distribution {
      const sorted = [...bins].sort(([a], [b]) => a - b);
      const quantile = (fraction: number) => { let seen = 0; for (const [bin, frequency] of sorted) { seen += frequency; if (seen >= Math.ceil(count * fraction)) return bin / 10; } return null; };
      return { count, min: count ? min : null, p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: count ? max : null, mean: count ? sum / count : null, quantileResolutionMs: 0.1 };
    },
  };
};

export type PcmChunk = { startFrame: number; samples: Float32Array };
export type MarkerObservation = { index: number; id: string; referenceFrame: number | null; outputs: Record<string, number | null> };
export type PcmAnalyzerOptions = {
  sampleRate: number;
  seed: number;
  receiverIds: string[];
  durationFrames: number;
  maxDelayMs: number;
  /** Bound on relative clock mapping error, independent of sample detection. */
  clockUncertaintyMs: number;
  warmupFrames?: number;
  intervalMs?: number;
  /** Streams raw observations to a bounded artifact writer owned by the caller. */
  onMarker?: (observation: MarkerObservation) => void;
};

export function createPcmAnalyzer(options: PcmAnalyzerOptions) {
  const { sampleRate, seed, receiverIds, durationFrames, maxDelayMs, clockUncertaintyMs, warmupFrames = 0 } = options;
  const signal = createMarkerSignal(options);
  if (!Number.isSafeInteger(durationFrames) || durationFrames < signal.markerFrames || !Number.isSafeInteger(warmupFrames) || warmupFrames < 0 || warmupFrames >= durationFrames) throw new Error("Invalid duration or fixed warmup");
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > 30_000 || !Number.isFinite(clockUncertaintyMs) || clockUncertaintyMs < 0) throw new Error("Invalid delay or clock uncertainty");
  if (!receiverIds.length || new Set(receiverIds).size !== receiverIds.length || receiverIds.some(id => !id || id === "reference")) throw new Error("Receiver identities must be unique");
  const delayFrames = Math.ceil(maxDelayMs * sampleRate / 1_000);
  const firstIndex = Math.ceil(warmupFrames / signal.intervalFrames);
  const endIndex = Math.floor((durationFrames - signal.markerFrames) / signal.intervalFrames) + 1;
  if (firstIndex >= endIndex) throw new Error("No markers after warmup");
  const expected = endIndex - firstIndex;
  const pendingLimit = Math.ceil(2 * delayFrames / signal.intervalFrames) + 8;
  const pending = new Map<number, Map<string, number[]>>();
  const issues = new Set<string>();
  const failurePcm: { trackId: string; markerId: string; startFrame: number; samples: number[] }[] = [];
  const skew = distribution();
  const sampleUncertaintyMs = 2_000 / sampleRate; // One sample per endpoint.
  const uncertaintyMs = sampleUncertaintyMs + clockUncertaintyMs;
  // Dedicated fixture: its tone bed peaks at 0.02, codes at 0.25. This detects
  // unexplained fixture-level activity, not arbitrarily quiet/overlaid replay.
  const activityThreshold = 0.05;
  let finished = false, lastJoined = firstIndex - 1, peakRetainedPcmFrames = 0;
  const tracks = new Map(["reference", ...receiverIds].map(id => [id, {
    id, start: 0, end: null as number | null, pcm: new Float32Array(0), covered: new Uint8Array(0), next: 0,
    detected: 0, missing: 0, duplicated: 0, outOfOrder: 0, previousFrame: -Infinity, gaps: 0, clippedSamples: 0,
    unmatchedActivityFrames: 0, unmatchedActivityBursts: 0, unmatchedActivityFirstFrame: null as number | null, inUnmatchedActivity: false,
    latency: distribution(),
  }]));

  const join = (index: number, matches: Map<string, number[]>) => {
    const referenceFrame = matches.get("reference")?.[0] ?? null;
    const outputs: Record<string, number | null> = Object.create(null);
    const outputFrames: number[] = [];
    for (const id of receiverIds) {
      const frame = matches.get(id)?.[0] ?? null;
      outputs[id] = frame;
      if (frame !== null && referenceFrame !== null) tracks.get(id)!.latency.add((frame - referenceFrame) * 1_000 / sampleRate);
      if (frame !== null) outputFrames.push(frame);
    }
    if (outputFrames.length === receiverIds.length && outputFrames.length > 1) skew.add((Math.max(...outputFrames) - Math.min(...outputFrames)) * 1_000 / sampleRate);
    options.onMarker?.({ index, id: `${seed}:${index}`, referenceFrame, outputs });
    lastJoined = index;
    pending.delete(index);
  };
  const submit = (index: number, id: string, positions: number[]) => {
    if (index <= lastJoined) return;
    let matches = pending.get(index);
    if (!matches) { matches = new Map(); pending.set(index, matches); }
    matches.set(id, positions);
    while (pending.get(lastJoined + 1)?.size === tracks.size) join(lastJoined + 1, pending.get(lastJoined + 1)!);
    if (pending.size > pendingLimit) {
      issues.add("Tracks exceeded the bounded common-timeline join window");
      join(lastJoined + 1, pending.get(lastJoined + 1) ?? new Map());
    }
  };
  const detect = (track: typeof tracks extends Map<string, infer T> ? T : never, index: number) => {
    const marker = signal.marker(index);
    const lower = Math.max(track.start, marker.startFrame - delayFrames);
    const upper = Math.min(track.start + track.pcm.length - signal.markerFrames, marker.startFrame + delayFrames);
    const stride = signal.chipFrames;
    const checkpoints = [48, 64, 128];
    const score = (frame: number) => {
      let dot = 0, energy = 0, offset = Math.floor(stride / 2);
      for (const chips of checkpoints) {
        for (; offset < chips * stride; offset += stride) {
          const value = track.pcm[frame - track.start + offset]!;
          dot += value * marker.samples[offset]!;
          energy += value * value;
        }
        if (chips < 128) {
          // Cauchy-Schwarz bounds the best possible normalized correlation
          // over ALL remaining samples. Reject only if even that is below
          // 0.8; surviving candidates keep the original full score/refinement.
          const positive = Math.max(0, dot);
          const possible = (energy ? positive * positive / energy : 0) + (128 - chips) * 0.0625;
          if (possible < 0.8 ** 2 * 128 * 0.0625 - 1e-12) return 0;
        }
      }
      return energy > 0.0001 ? dot / Math.sqrt(energy * 128 * 0.0625) : 0;
    };
    const peaks: { frame: number; score: number }[] = [];
    for (let frame = lower; frame <= upper; frame += stride) {
      const value = score(frame);
      if (value < 0.8) continue;
      const previous = peaks.at(-1);
      if (previous && frame - previous.frame < signal.markerFrames / 2) { if (value > previous.score) { previous.frame = frame; previous.score = value; } }
      else peaks.push({ frame, score: value });
    }
    // Refine using every sample, not chip decimation, to recover sub-chip timing.
    for (const peak of peaks) {
      let best = -Infinity;
      for (let frame = Math.max(lower, peak.frame - stride); frame <= Math.min(upper, peak.frame + stride); frame++) {
        let dot = 0, energy = 0;
        for (let offset = 0; offset < signal.markerFrames; offset++) { const value = track.pcm[frame - track.start + offset]!; dot += value * marker.samples[offset]!; energy += value * value; }
        const value = energy ? dot / Math.sqrt(energy * signal.markerFrames * 0.0625) : 0;
        if (value > best) { best = value; peak.score = value; peak.frame = frame; }
      }
    }
    const positions = peaks.filter(peak => peak.score >= 0.8).map(peak => peak.frame);
    for (const frame of positions) track.covered.fill(1, frame - track.start, frame - track.start + signal.markerFrames);
    // Warmup markers can arrive after the warmup boundary; match them for
    // activity coverage without including them in steady-state statistics.
    if (index < firstIndex) return;
    if (positions.length) {
      track.detected++;
      track.duplicated += positions.length - 1;
      if (positions[0]! <= track.previousFrame) track.outOfOrder++;
      track.previousFrame = Math.max(track.previousFrame, positions[0]!);
    } else track.missing++;
    if ((!positions.length || positions.length > 1 || track.outOfOrder) && failurePcm.length < 8) {
      const startFrame = Math.max(track.start, Math.min(marker.startFrame, track.start + track.pcm.length));
      failurePcm.push({ trackId: track.id, markerId: marker.id, startFrame, samples: Array.from(track.pcm.subarray(startFrame - track.start, startFrame - track.start + 256)) });
    }
    submit(index, track.id, positions);
  };
  const scanActivity = (track: typeof tracks extends Map<string, infer T> ? T : never, count: number) => {
    for (let offset = 0; offset < count; offset++) {
      const unmatched = track.start + offset >= warmupFrames && !track.covered[offset] && Math.abs(track.pcm[offset]!) > activityThreshold;
      if (unmatched) {
        track.unmatchedActivityFrames++;
        track.unmatchedActivityFirstFrame ??= track.start + offset;
        if (!track.inUnmatchedActivity) {
          track.unmatchedActivityBursts++;
          if (failurePcm.length < 8) failurePcm.push({ trackId: track.id, markerId: "unmatched-activity", startFrame: track.start + offset, samples: Array.from(track.pcm.subarray(offset, offset + 256)) });
        }
      }
      track.inUnmatchedActivity = unmatched;
    }
  };
  const process = (track: typeof tracks extends Map<string, infer T> ? T : never, flush = false) => {
    while (track.next < endIndex && (flush || track.start + track.pcm.length >= track.next * signal.intervalFrames + delayFrames + signal.markerFrames)) detect(track, track.next++);
    const keepFrom = track.next >= endIndex ? track.start + track.pcm.length : Math.max(track.start, track.next * signal.intervalFrames - delayFrames);
    const discard = Math.min(track.pcm.length, keepFrom - track.start);
    // All markers that could cover this prefix have now been searched. Scan
    // it once before eviction, including tail PCM after the final marker.
    scanActivity(track, discard);
    track.pcm = track.pcm.slice(discard);
    track.covered = track.covered.slice(discard);
    track.start += discard;
  };
  return {
    push(trackId: string, chunk: PcmChunk) {
      if (finished) throw new Error("PCM analyzer is already finished");
      const track = tracks.get(trackId);
      if (!track || !Number.isSafeInteger(chunk.startFrame)) throw new Error("Invalid PCM track or frame");
      if (!chunk.samples.length) return;
      if (track.end !== null && chunk.startFrame !== track.end) { track.gaps++; issues.add(`Non-contiguous PCM on ${trackId}`); track.pcm = new Float32Array(0); track.covered = new Uint8Array(0); }
      if (!track.pcm.length) track.start = chunk.startFrame;
      track.end = chunk.startFrame + chunk.samples.length;
      for (let offset = 0; offset < chunk.samples.length; offset += 1_024) {
        const samples = chunk.samples.subarray(offset, offset + 1_024);
        const appended = new Float32Array(track.pcm.length + samples.length);
        appended.set(track.pcm); appended.set(samples, track.pcm.length);
        for (let i = track.pcm.length; i < appended.length; i++) {
          if (!Number.isFinite(appended[i])) { issues.add(`Non-finite PCM on ${trackId}`); appended[i] = 0; }
          else if (Math.abs(appended[i]!) >= 1) track.clippedSamples++;
        }
        const covered = new Uint8Array(appended.length);
        covered.set(track.covered);
        track.covered = covered;
        track.pcm = appended;
        peakRetainedPcmFrames = Math.max(peakRetainedPcmFrames, [...tracks.values()].reduce((sum, value) => sum + value.pcm.length, 0));
        process(track);
      }
    },
    finish() {
      if (finished) throw new Error("PCM analyzer is already finished");
      // Flush by marker index across tracks, so a missing track cannot expand
      // the join map or turn absent markers into discarded latency samples.
      for (let index = Math.min(...[...tracks.values()].map(track => track.next)); index < endIndex; index++) {
        for (const track of tracks.values()) if (track.next === index) detect(track, track.next++);
      }
      for (const track of tracks.values()) scanActivity(track, track.pcm.length);
      finished = true;
      const stats = (track: typeof tracks extends Map<string, infer T> ? T : never) => {
        const latencyMs = track.latency.result();
        return { id: track.id, expected, detected: track.detected, missing: track.missing, duplicated: track.duplicated, outOfOrder: track.outOfOrder, gaps: track.gaps, clippedSamples: track.clippedSamples, unmatchedActivityFrames: track.unmatchedActivityFrames, unmatchedActivityBursts: track.unmatchedActivityBursts, unmatchedActivityFirstFrame: track.unmatchedActivityFirstFrame, latencyMs, latencyUpperBoundMs: latencyMs.max === null ? null : latencyMs.max + uncertaintyMs };
      };
      const skewMs = skew.result();
      return {
        fixtureActivity: { peakThreshold: activityThreshold, scope: "Recorded samples outside matched marker spans; quiet or overlaid replay remains unmeasured" },
        sampleRate, seed, durationFrames, warmupFrames, warmupMarkers: firstIndex, expectedMarkers: expected,
        sampleUncertaintyMs, clockUncertaintyMs, uncertaintyMs, maxSearchDelayMs: maxDelayMs,
        measurementValid: issues.size === 0, measurementIssues: [...issues],
        reference: stats(tracks.get("reference")!), receivers: receiverIds.map(id => stats(tracks.get(id)!)),
        skewMs, skewUpperBoundMs: skewMs.max === null ? null : skewMs.max + uncertaintyMs,
        failurePcm, peakRetainedPcmFrames,
      };
    },
  };
}

export type PcmAnalysis = ReturnType<ReturnType<typeof createPcmAnalyzer>["finish"]>;
