import type { CaptureKind } from "./capture";

// Publications belong to the capturing connection and disappear when it closes.
export type LiveSource = { id: string; deviceId: string; name: string; kind: CaptureKind; audio: boolean; video: boolean };
export type LivePeer = { peerId: string; deviceId: string; picture: boolean; sound: boolean };
export type LiveSignal = { description?: { type: "offer" | "answer"; sdp: string }; candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null };
export type LiveSelection = { kind: CaptureKind; sourceId?: string; audioDeviceId?: string };
export type LiveSignalMessage = { type: "liveSignal"; peerId: string; signal: LiveSignal };
