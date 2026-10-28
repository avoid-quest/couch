export type CaptureKind = "system-audio" | "screen" | "microphone";
// thumbnail: a small picture of it (a data URL), only for this computer's own Couch.
export type CaptureSource = { id: string; name: string; kind: "screen" | "window"; thumbnail?: string };
// `audio` asks for this computer's audio with a screen or window; system audio always includes it.
export type CaptureSelection = { kind: CaptureKind; sourceId?: string; audio?: boolean };

/** A native input's callback size. */
export type NativeBufferFrames = 128 | 256 | 512 | 1024;
/** Zero-based device channels: one mono channel or an adjacent stereo pair. */
export type NativeChannelMap = [number] | [number, number];

/** One desktop Live microphone publication; stale publication/upload commands are harmless. */
export type LiveAudioAction = { id: string } & (
  | { op: "prepare"; deviceId: string; sampleRate?: 44100 | 48000; bufferFrames?: NativeBufferFrames; channelMap?: NativeChannelMap }
  | { op: "upload"; uploadId: string; url: string }
  | { op: "stop-upload"; uploadId: string }
  | { op: "mute"; muted: boolean }
  // Restarts a native input with a new callback buffer; its upload continues with a new sample generation.
  | { op: "buffer"; bufferFrames: NativeBufferFrames }
  | { op: "channels"; channelMap: NativeChannelMap }
  | { op: "stop" }
);
export type LiveAudioError = { id: string; uploadId?: string; error: string };

/** Delivered capture format, not the sound card’s hardware allocation. */
// inputLatencyMs: the input latency the native helper's audio API reports.
export type AudioCaptureFormat = { sampleRate: number; channels: number; native?: { requestedFrames: number; reportedFrames: number; inputLatencyMs?: number; inputChannels?: number; channelMap?: NativeChannelMap } };
export type NativeAudioInput = { uid: string; name: string; channels: number; nominalRate: 44100 | 48000; ownerHalBufferFrames: number };
export type AudioInput = { deviceId: string; label: string; nativeChannels?: number };
