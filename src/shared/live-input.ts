import type { CaptureKind } from "./capture";

// Publications belong to the capturing connection and disappear when it closes.
export type LiveSource = { id: string; deviceId: string; name: string; kind: CaptureKind; audio: boolean; video: boolean };
export type LiveVideoQuality = "720p" | "1080p" | "original";
export type LiveSelection = { kind: CaptureKind; sourceId?: string; audioDeviceId?: string; videoQuality?: LiveVideoQuality; includeAudio?: boolean };

export type LivePeer = { peerId: string; deviceId: string; picture: boolean; sound: boolean };
export type LiveSignal = { description?: { type: "offer" | "answer"; sdp: string }; candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null };
export type LiveSignalMessage = { type: "liveSignal"; peerId: string; signal: LiveSignal };
// Either end of a peer that can't connect directly tells Core, which plays the source through its own stream.
export type LiveFailedMessage = { type: "liveFailed"; peerId: string; error: string };
