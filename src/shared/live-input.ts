import type { CaptureKind } from "./capture";

// Publications belong to the capturing connection and disappear when it closes.
export type LiveSource = { id: string; deviceId: string; name: string; kind: CaptureKind; audio: boolean; video: boolean };
export type LiveVideoQuality = "720p" | "1080p" | "original";
export type LiveSelection = { kind: CaptureKind; sourceId?: string; audioDeviceId?: string; videoQuality?: LiveVideoQuality; includeAudio?: boolean };
