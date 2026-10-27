import type { LiveAudioSettings } from "./protocol";

// Scheduling lead is not a physical input-to-output latency measurement.
export const liveAudioLeadOptions = [45, 50, 55, 75, 95, 100, 150, 250] as const;
export const defaultLiveAudioLeadMs = 100;
export const isLiveAudioLead = (value: unknown): value is number => typeof value === "number" && liveAudioLeadOptions.includes(value as typeof liveAudioLeadOptions[number]);

// Live audio's own stream (docs/live-audio.md). Leads are whole milliseconds up to a second.
export const defaultLiveAudioSettings: LiveAudioSettings = { codec: "pcm", opusBitrate: 192000, lead: "automatic", leadMs: 100, minLeadMs: 0, maxLeadMs: 100, raiseForSlowest: true };
const leadValue = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
export const isLiveAudioSettings = (value: unknown): value is LiveAudioSettings => {
  const v = value as LiveAudioSettings;
  return typeof v === "object" && v !== null && ["pcm", "opus"].includes(v.codec) && [128000, 192000, 320000].includes(v.opusBitrate) && ["automatic", "fixed"].includes(v.lead)
    && leadValue(v.leadMs) && leadValue(v.minLeadMs) && leadValue(v.maxLeadMs) && v.minLeadMs <= v.maxLeadMs && typeof v.raiseForSlowest === "boolean";
};

// AudioContext accepts a latency preference, not an exact hardware frame count.
export const outputBufferOptions = ["auto", "128", "256", "512", "1024"] as const;
export type OutputBufferPreference = typeof outputBufferOptions[number];
export const isOutputBufferPreference = (value: unknown): value is OutputBufferPreference => typeof value === "string" && outputBufferOptions.includes(value as OutputBufferPreference);
export const outputLatencyHint = (value: OutputBufferPreference): number | undefined => value === "auto" ? undefined : Number(value) / 48_000;

export const nativeInputBufferOptions = ["128", "256", "512", "1024"] as const;
export type NativeInputBufferPreference = typeof nativeInputBufferOptions[number];
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
