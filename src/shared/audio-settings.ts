import type { LiveAudioSettings } from "./protocol";

// Live audio's own stream (docs/live-audio.md). Leads are whole milliseconds up to a second.
// Listeners ask for 256 frames, looser than the prototype's 128 (.scratch PRODUCT.md); the browser picks the real buffer.
export const defaultLiveAudioSettings: LiveAudioSettings = { codec: "pcm", opusBitrate: 192000, lead: "automatic", leadMs: 100, minLeadMs: 0, maxLeadMs: 100, raiseForSlowest: true, listenerBufferFrames: 256 };
export const opusBitrates = [128000, 192000, 320000] as const;
export const bufferFrameOptions = [128, 256, 512, 1024] as const;
const leadValue = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
export const isLiveAudioSettings = (value: unknown): value is LiveAudioSettings => {
  const v = value as LiveAudioSettings;
  return typeof v === "object" && v !== null && ["pcm", "opus"].includes(v.codec) && opusBitrates.includes(v.opusBitrate) && ["automatic", "fixed"].includes(v.lead)
    && leadValue(v.leadMs) && leadValue(v.minLeadMs) && leadValue(v.maxLeadMs) && v.minLeadMs <= v.maxLeadMs && typeof v.raiseForSlowest === "boolean"
    && bufferFrameOptions.includes(v.listenerBufferFrames);
};

// AudioContext accepts a latency preference, not an exact hardware frame count.
export const outputBufferOptions = ["auto", "128", "256", "512", "1024"] as const;
export type OutputBufferPreference = typeof outputBufferOptions[number];
export const isOutputBufferPreference = (value: unknown): value is OutputBufferPreference => typeof value === "string" && outputBufferOptions.includes(value as OutputBufferPreference);
// A device's own choice wins; Automatic asks for the operator's listener buffer when the share has one.
export const outputLatencyHint = (value: OutputBufferPreference, operatorFrames?: number): number | undefined => value === "auto" ? operatorFrames && operatorFrames / 48_000 : Number(value) / 48_000;

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
