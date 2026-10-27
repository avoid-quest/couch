export type CaptureKind = "system-audio" | "screen" | "microphone";
// thumbnail: a small picture of it (a data URL), only for this computer's own Couch.
export type CaptureSource = { id: string; name: string; kind: "screen" | "window"; thumbnail?: string };
// `audio` asks for this computer's audio with a screen or window; system audio always includes it.
export type CaptureSelection = { kind: CaptureKind; sourceId?: string; audio?: boolean };

/** One desktop Live microphone publication; stale publication/upload commands are harmless. */
export type LiveAudioAction = { id: string } & (
  | { op: "prepare"; deviceId: string; sampleRate?: 44100 | 48000 }
  | { op: "upload"; uploadId: string; url: string }
  | { op: "stop-upload"; uploadId: string }
  | { op: "mute"; muted: boolean }
  | { op: "stop" }
);
export type LiveAudioError = { id: string; uploadId?: string; error: string };

/** Delivered capture format, not the sound card’s hardware allocation. */
export type AudioCaptureFormat = { sampleRate: number; channels: number; firstBlockFrames?: number };
export type AudioInput = { deviceId: string; label: string };
