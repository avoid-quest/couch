export type CaptureKind = "system-audio" | "screen" | "microphone";
export type CaptureSource = { id: string; name: string; kind: "screen" | "window" };
// `audio` asks for this computer's audio with a screen or window; system audio always includes it.
export type CaptureSelection = { kind: CaptureKind; sourceId?: string; audio?: boolean };
