type Samples = Float32Array | Float64Array;

function correlation(reference: Samples, captured: Samples, start: number, offset: number, length: number, stride: number) {
  let dot = 0, referencePower = 0, capturePower = 0;
  for (let sample = 0; sample < length; sample += stride) {
    const x = reference[start + sample]!, y = captured[offset + sample]!;
    dot += x * y; referencePower += x * x; capturePower += y * y;
  }
  return dot / Math.sqrt(referencePower * capturePower) || 0;
}

export function analyzeReplayGain(reference: Samples, captured: Samples, sampleRate: number) {
  const start = sampleRate, length = Math.floor(sampleRate / 2);
  if (reference.length < start + length || captured.length < length) throw new Error("ReplayGain measurement needs a reference and at least half a second of captured audio.");
  const candidates: { offset: number; correlation: number }[] = [];
  for (let offset = 0; offset <= captured.length - length; offset++) {
    const score = correlation(reference, captured, start, offset, length, 16);
    if (candidates.length < 8 || score > candidates.at(-1)!.correlation) {
      candidates.push({ offset, correlation: score });
      candidates.sort((a, b) => b.correlation - a.correlation);
      if (candidates.length > 8) candidates.pop();
    }
  }
  let best = { offset: 0, correlation: -1 };
  for (const candidate of candidates) {
    for (let offset = Math.max(0, candidate.offset - 8); offset <= Math.min(captured.length - length, candidate.offset + 8); offset++) {
      const score = correlation(reference, captured, start, offset, length, 1);
      if (score > best.correlation) best = { offset, correlation: score };
    }
  }
  if (best.correlation < 0.9) throw new Error(`Captured audio does not match the ReplayGain reference: ${best.correlation}`);
  let dot = 0, power = 0, referencePower = 0, capturePower = 0, peak = 0, nearFullScale = 0, aboveFullScale = 0, fittedSamples = 0;
  for (let sample = 0; sample < length; sample++) {
    const x = reference[start + sample]!, y = captured[best.offset + sample]!;
    referencePower += x * x; capturePower += y * y; peak = Math.max(peak, Math.abs(y));
    if (Math.abs(y) >= 0.999) nearFullScale++;
    if (Math.abs(y) > 1) aboveFullScale++;
    // Exclude saturated samples from the slope, but retain them in RMS/peak counts.
    if (Math.abs(y) < 0.98 && Math.abs(x) > 0.01) { dot += x * y; power += x * x; fittedSamples++; }
  }
  if (fittedSamples < length / 10 || power === 0) throw new Error("Too little unsaturated reference audio to measure ReplayGain.");
  const gain = dot / power;
  if (!(gain > 0)) throw new Error("ReplayGain capture has no positive signal gain.");
  let residual = 0;
  for (let sample = 0; sample < length; sample++) residual += (captured[best.offset + sample]! - reference[start + sample]! * gain) ** 2;
  return {
    sampleRate, referenceSample: start, captureSample: best.offset, samples: length, correlation: best.correlation,
    gainDb: 20 * Math.log10(gain), rmsGainDb: 10 * Math.log10(capturePower / referencePower),
    peak, nearFullScaleSamples: nearFullScale, aboveFullScaleSamples: aboveFullScale, fittedSamples,
    residualRms: Math.sqrt(residual / length),
    method: "Matched half-second chirp window, fitted gain from unsaturated samples, whole-window RMS and peak counts. Float capture preserves samples above nominal full scale. Digital signal evidence only; no physical-output or true-peak qualification.",
  };
}
