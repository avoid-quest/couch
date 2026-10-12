export type CaptureKind = "system-audio" | "screen" | "microphone";
export type CaptureSource = { id: string; name: string; kind: "screen" | "window" };
export type CaptureSelection = { kind: CaptureKind; sourceId?: string };
