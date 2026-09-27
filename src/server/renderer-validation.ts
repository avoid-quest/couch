import type { PlayerState, RendererMessage } from "../shared/protocol";

// Browser observations are untrusted, even on an authenticated controller socket.
export function parseRendererMessage(value: unknown): RendererMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<RendererMessage>;
  if (message.type === "registerRenderer") {
    const capabilities = message.capabilities;
    if (capabilities !== undefined && (!capabilities || typeof capabilities !== "object" || typeof capabilities.mp4H264Aac !== "boolean" || typeof capabilities.mp3 !== "boolean")) throw new Error("Invalid browser capabilities.");
    return { type: "registerRenderer", ...(capabilities ? { capabilities: { mp4H264Aac: capabilities.mp4H264Aac, mp3: capabilities.mp3 } } : {}) };
  }
  if (message.type !== "rendererObservation") return null;
  const state = message.state as PlayerState | undefined;
  if (typeof message.sessionId !== "string" || !state || typeof state !== "object"
    || !(state.playbackId === null || typeof state.playbackId === "string" && /^[\w-]{1,80}$/.test(state.playbackId))
    || !["idle", "loading", "playing", "paused", "ended", "error"].includes(state.status)
    || !Number.isFinite(state.position) || state.position < 0
    || !(state.duration === null || Number.isFinite(state.duration) && state.duration >= 0)
    || !Number.isFinite(state.volume) || state.volume < 0 || state.volume > 100
    || typeof state.seekable !== "boolean" || !(state.error === null || typeof state.error === "string" && state.error.length <= 500)
    || state.speed !== undefined && (!Number.isFinite(state.speed) || state.speed < 0.25 || state.speed > 4)
    || state.tracks !== undefined && (!Array.isArray(state.tracks) || state.tracks.length > 50 || state.tracks.some(track => !track
      || typeof track.id !== "string" || track.id.length > 100 || !Number.isInteger(track.index) || track.index < 0
      || !["video", "audio", "subtitle"].includes(track.kind) || typeof track.selected !== "boolean"
      || typeof track.label !== "string" || track.label.length > 200 || typeof track.language !== "string" || track.language.length > 50))) throw new Error("Invalid renderer observation.");
  return { type: "rendererObservation", sessionId: message.sessionId, state: { playbackId: state.playbackId, status: state.status,
    position: state.position, duration: state.duration, volume: state.volume, seekable: state.seekable, error: state.error,
    speed: state.speed, tracks: state.tracks, audioTracksKnown: typeof state.audioTracksKnown === "boolean" ? state.audioTracksKnown : undefined, buffering: state.buffering === true, requiresGesture: state.requiresGesture === true } };
}
