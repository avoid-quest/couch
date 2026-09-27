import type shaka from "shaka-player";
import type { MediaTrack } from "../../shared/protocol";

// The adapter is imported only for a selected public HTTP(S) manifest.
export const isAdaptiveSource = (source: string, sourceType?: "hls" | "dash") => {
  if (sourceType) return true;
  try { const url = new URL(source); return /^https?:$/.test(url.protocol) && /\.(mpd|m3u8)$/i.test(url.pathname); } catch { return false; }
};

type AudioTrack = shaka.extern.AudioTrack;
type TextTrack = shaka.extern.TextTrack;
export interface DashPlayer {
  attach(video: HTMLMediaElement): Promise<unknown>;
  load(source: string, startTime?: number, mimeType?: string): Promise<unknown>;
  configure(config: Record<string, unknown>): unknown;
  addEventListener(type: string, listener: (event: any) => void): void;
  trickPlay(rate: number, useTrickPlayTrack?: boolean): void;
  getAudioTracks(): AudioTrack[];
  getTextTracks(): TextTrack[];
  selectAudioTrack(track: AudioTrack): void;
  selectTextTrack(track: TextTrack | null): void;
  seekRange(): { start: number; end: number };
  isLive(): boolean;
  isInProgress(): boolean;
  destroy(): Promise<unknown>;
}
export interface DashLibrary {
  polyfill: { installAll(): void };
  Player: { new(): DashPlayer; isBrowserSupported(): boolean };
}
export const loadDashLibrary = async (): Promise<DashLibrary> => (await import("shaka-player")).default;

// Shaka audio choices group adaptive variants by metadata, not a rendition ID.
// Keep command indices stable when manifest updates reorder or remove choices.
export function manifestTracks(player: DashPlayer) {
  const indices = new Map<string, number>();
  const key = (kind: "audio" | "subtitle", track: AudioTrack | TextTrack) => {
    if (track.id !== undefined) return `${kind}:${track.id}`;
    const audio = track as AudioTrack;
    return `audio:${JSON.stringify([audio.language, audio.originalLanguage, audio.label ?? "", audio.roles, audio.channelsCount, audio.spatialAudio, audio.codecs, audio.accessibilityPurpose])}`;
  };
  const choices = () => [
    ...player.getAudioTracks().map(track => ({ kind: "audio" as const, track })),
    ...player.getTextTracks().map(track => ({ kind: "subtitle" as const, track })),
  ].map(choice => {
    const id = key(choice.kind, choice.track);
    if (!indices.has(id)) indices.set(id, indices.size);
    return { ...choice, id, index: indices.get(id)! };
  });
  return {
    read: (): MediaTrack[] => choices().map(({ kind, track, index }) => ({ kind, id: `${kind}-${index}`, index, label: track.label || track.language || (kind === "audio" ? "Audio" : "Subtitles"), language: track.language, selected: track.active })),
    select(kind: "audio" | "subtitle" | "video", index: number) {
      if (kind === "subtitle" && index === -1) { player.selectTextTrack(null); return; }
      const choice = choices().find(choice => choice.kind === kind && choice.index === index);
      if (!choice) return;
      if (choice.kind === "audio") player.selectAudioTrack(choice.track);
      else player.selectTextTrack(choice.track as TextTrack);
    },
  };
}
