import type { CaptureKind } from "./capture";

// Publications belong to the capturing connection and disappear when it closes. An AirPlay
// sender's belongs to Core, under AIRPLAY_PUBLISHER, which is never a Device.
export const AIRPLAY_PUBLISHER = "airplay";
export type LiveSource = { id: string; deviceId: string; name: string; kind: CaptureKind | "airplay"; audio: boolean; video: boolean; intent?: "relaxed" | "live"; audioDelivery?: "pcm" };
export type LiveVideoQuality = "720p" | "1080p" | "original";
// surface: the browser picker's first offer (a screen or a window).
export type LiveSelection = { kind: CaptureKind; sourceId?: string; audioDeviceId?: string; videoQuality?: LiveVideoQuality; includeAudio?: boolean; surface?: "monitor" | "window"; intent?: "relaxed" | "live" };

export type LivePeer = { peerId: string; deviceId: string; picture: boolean; sound: boolean };
export type LiveSignal = { description?: { type: "offer" | "answer"; sdp: string }; candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null };
export type LiveSignalMessage = { type: "liveSignal"; peerId: string; signal: LiveSignal };
// Either end of a peer that can't connect directly tells Core, which plays the source through its own stream.
export type LiveFailedMessage = { type: "liveFailed"; peerId: string; error: string };
// The publisher echoes Core's uploadId to fail this request even before a recorder or media socket exists.
export type LiveUploadFailedMessage = { type: "liveUploadFailed"; sourceId: string; uploadId: string; error: string };
