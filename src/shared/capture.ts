export type CaptureKind = "system-audio" | "screen" | "microphone";
// thumbnail: a small picture of it (a data URL), only for this computer's own Couch.
export type CaptureSource = { id: string; name: string; kind: "screen" | "window"; thumbnail?: string };
// `audio` asks for this computer's audio with a screen or window; system audio always includes it.
export type CaptureSelection = { kind: CaptureKind; sourceId?: string; audio?: boolean };
