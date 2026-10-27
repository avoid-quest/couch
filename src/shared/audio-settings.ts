export type LiveAudioSettings = { codec: "auto" | "pcm" | "opus"; minBufferMs: number };
export const defaultLiveAudioSettings: LiveAudioSettings = { codec: "auto", minBufferMs: 200 };
export const isLiveAudioSettings = (value: unknown): value is LiveAudioSettings => {
  const v = value as LiveAudioSettings;
  return !!v && ["auto", "pcm", "opus"].includes(v.codec) && Number.isInteger(v.minBufferMs) && v.minBufferMs >= 0 && v.minBufferMs <= 5000;
};

export const nativeInputBufferOptions = ["128", "256", "512", "1024"] as const;
export type NativeInputBufferPreference = typeof nativeInputBufferOptions[number];
export const defaultNativeInputBuffer: NativeInputBufferPreference = "128";
export const isNativeInputBufferPreference = (value: unknown): value is NativeInputBufferPreference => typeof value === "string" && nativeInputBufferOptions.includes(value as NativeInputBufferPreference);
export const nativeInputBufferFrames = (value: NativeInputBufferPreference) => Number(value) as 128 | 256 | 512 | 1024;

export const captureRateOptions = ["auto", "44100", "48000"] as const;
export type CaptureRatePreference = typeof captureRateOptions[number];
export const isCaptureRatePreference = (value: unknown): value is CaptureRatePreference => typeof value === "string" && captureRateOptions.includes(value as CaptureRatePreference);
export const captureSampleRate = (value: CaptureRatePreference): 44100 | 48000 | undefined => value === "auto" ? undefined : Number(value) as 44100 | 48000;
export const liveCaptureConstraints = (sampleRate?: 44100 | 48000): MediaTrackConstraints => ({
  channelCount: { ideal: 2 }, sampleRate: sampleRate ? { exact: sampleRate } : { ideal: 48000 },
  echoCancellation: false, noiseSuppression: false, autoGainControl: false,
});
