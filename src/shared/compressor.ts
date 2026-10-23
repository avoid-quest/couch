// One Playback's dynamics, before device volume. Units match the controls; engines convert at their edge.
export const compressorParameters = {
  threshold: { label: "Threshold", unit: "dB", min: -60, max: 0, step: 1 },
  ratio: { label: "Ratio", unit: ":1", min: 1, max: 20, step: 0.1 },
  attack: { label: "Attack", unit: "ms", min: 0.1, max: 1000, step: 0.1 },
  release: { label: "Release", unit: "ms", min: 1, max: 1000, step: 1 },
  knee: { label: "Knee", unit: "dB", min: 0, max: 18, step: 1 },
  gain: { label: "Output gain", unit: "dB", min: -12, max: 12, step: 0.5 },
} as const;
export type CompressorParameter = keyof typeof compressorParameters;
export type CompressorSettings = { enabled: boolean } & Record<CompressorParameter, number>;
export const defaultCompressor: Readonly<CompressorSettings> = Object.freeze({ enabled: false, threshold: -18, ratio: 3, attack: 10, release: 250, knee: 9, gain: 0 });

export function isCompressorPatch(value: unknown): value is Partial<CompressorSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, value]) => {
    if (key === "enabled") return typeof value === "boolean";
    if (!Object.hasOwn(compressorParameters, key)) return false;
    const { min, max } = compressorParameters[key as CompressorParameter];
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  });
}

// FFmpeg and mpv share libavfilter. No lookahead/normalizer or additional process is needed.
export function compressorFilter(settings: CompressorSettings): string {
  return `acompressor=threshold=${10 ** (settings.threshold / 20)}:ratio=${settings.ratio}:attack=${settings.attack}:release=${settings.release}:knee=${10 ** (settings.knee / 20)}:link=maximum:makeup=1,volume=${settings.gain}dB`;
}
