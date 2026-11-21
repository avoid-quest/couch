import type { NativeBufferFrames, NativeChannelMap } from "./capture";
export type LiveAudioSettings = { codec: "auto" | "pcm" | "opus" };
// Live has no room delay: each listener plays as soon as its own measured need allows, and
// listeners whose needs round up to the same step play together. Settings saved with the old
// floor (minBufferMs) still read; the floor is ignored.
export const defaultLiveAudioSettings: LiveAudioSettings = { codec: "auto" };
export const isLiveAudioSettings = (value: unknown): value is LiveAudioSettings =>
  !!value && ["auto", "pcm", "opus"].includes((value as LiveAudioSettings).codec);

export const nativeInputBufferOptions = ["128", "256", "512", "1024"] as const;
export type NativeInputBufferPreference = (typeof nativeInputBufferOptions)[number];
export const defaultNativeInputBuffer: NativeInputBufferPreference = "128";
export const isNativeInputBufferPreference = (
  value: unknown,
): value is NativeInputBufferPreference =>
  typeof value === "string" &&
  nativeInputBufferOptions.includes(value as NativeInputBufferPreference);
export const nativeInputBufferFrames = (value: NativeInputBufferPreference) =>
  Number(value) as NativeBufferFrames;

export function isNativeChannelMap(value: unknown, channels: number): value is NativeChannelMap {
  return (
    Array.isArray(value) &&
    (value.length === 1 || value.length === 2) &&
    [...value].every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel < channels,
    ) &&
    (value.length === 1 ? channels > 2 : value[0] % 2 === 0 && value[1] === value[0] + 1) &&
    (channels > 2 || (value.length === 2 && value[0] === 0))
  );
}
export const nativeInputChannelMap = (value: string) =>
  value.split("/").map((channel) => Number(channel) - 1) as NativeChannelMap;
export const isNativeInputChannelPreference = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9]\d{0,4}(\/[1-9]\d{0,4})?$/.test(value) &&
  isNativeChannelMap(nativeInputChannelMap(value), 100_000);
export const nativeInputChannelOptions = (channels: number) => [
  ...Array.from({ length: Math.floor(channels / 2) }, (_, i) => `${i * 2 + 1}/${i * 2 + 2}`),
  ...Array.from({ length: channels }, (_, i) => String(i + 1)),
];
export const nativeInputChannelPreference = (value: string, channels: number) =>
  isNativeChannelMap(nativeInputChannelMap(value), channels) ? value : "1/2";

export const captureRateOptions = ["auto", "44100", "48000"] as const;
export type CaptureRatePreference = (typeof captureRateOptions)[number];
export const isCaptureRatePreference = (value: unknown): value is CaptureRatePreference =>
  typeof value === "string" && captureRateOptions.includes(value as CaptureRatePreference);
export const captureSampleRate = (value: CaptureRatePreference): 44100 | 48000 | undefined =>
  value === "auto" ? undefined : (Number(value) as 44100 | 48000);
export const liveCaptureConstraints = (sampleRate?: 44100 | 48000): MediaTrackConstraints => ({
  channelCount: { ideal: 2 },
  sampleRate: sampleRate ? { exact: sampleRate } : { ideal: 48000 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
});
