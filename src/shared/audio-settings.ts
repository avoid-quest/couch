export type LiveAudioSettings = { codec: "auto" | "pcm" | "opus"; minBufferMs: number };
export const defaultLiveAudioSettings: LiveAudioSettings = { codec: "auto", minBufferMs: 150 };
export const isLiveAudioSettings = (value: unknown): value is LiveAudioSettings => {
  const v = value as LiveAudioSettings;
  return !!v && ["auto", "pcm", "opus"].includes(v.codec) && Number.isInteger(v.minBufferMs) && v.minBufferMs >= 0 && v.minBufferMs <= 5000;
};

export const nativeInputBufferOptions = ["128", "256", "512", "1024"] as const;
export type NativeInputBufferPreference = typeof nativeInputBufferOptions[number];
export const defaultNativeInputBuffer: NativeInputBufferPreference = "128";
export const isNativeInputBufferPreference = (value: unknown): value is NativeInputBufferPreference => typeof value === "string" && nativeInputBufferOptions.includes(value as NativeInputBufferPreference);
export const nativeInputBufferFrames = (value: NativeInputBufferPreference) => Number(value) as import("./capture").NativeBufferFrames;

export function isNativeChannelMap(value: unknown, channels: number): value is import("./capture").NativeChannelMap {
  return Array.isArray(value) && (value.length === 1 || value.length === 2) &&
    [...value].every(channel => Number.isInteger(channel) && channel >= 0 && channel < channels) &&
    (value.length === 1 ? channels > 2 : value[0] % 2 === 0 && value[1] === value[0] + 1) &&
    (channels > 2 || value.length === 2 && value[0] === 0);
}
export const nativeInputChannelMap = (value: string) => value.split("/").map(channel => Number(channel) - 1) as import("./capture").NativeChannelMap;
export const isNativeInputChannelPreference = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,4}(\/[1-9]\d{0,4})?$/.test(value) && isNativeChannelMap(nativeInputChannelMap(value), 100_000);
export const nativeInputChannelOptions = (channels: number) => [
  ...Array.from({ length: Math.floor(channels / 2) }, (_, i) => `${i * 2 + 1}/${i * 2 + 2}`),
  ...Array.from({ length: channels }, (_, i) => String(i + 1)),
];
export const nativeInputChannelPreference = (value: string, channels: number) => isNativeChannelMap(nativeInputChannelMap(value), channels) ? value : "1/2";

export const captureRateOptions = ["auto", "44100", "48000"] as const;
export type CaptureRatePreference = typeof captureRateOptions[number];
export const isCaptureRatePreference = (value: unknown): value is CaptureRatePreference => typeof value === "string" && captureRateOptions.includes(value as CaptureRatePreference);
export const captureSampleRate = (value: CaptureRatePreference): 44100 | 48000 | undefined => value === "auto" ? undefined : Number(value) as 44100 | 48000;
export const liveCaptureConstraints = (sampleRate?: 44100 | 48000): MediaTrackConstraints => ({
  channelCount: { ideal: 2 }, sampleRate: sampleRate ? { exact: sampleRate } : { ideal: 48000 },
  echoCancellation: false, noiseSuppression: false, autoGainControl: false,
});
