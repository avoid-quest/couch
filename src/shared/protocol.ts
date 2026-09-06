import type { VideoQuality } from "./providers";
import type { WatchingProfile } from "./library";
import type { TvAppearance } from "./appearance";
export type { VideoQuality } from "./providers";

export type QueueEntry = { id: string; title: string; source: string; thumbnail?: string; artworkId?: string; duration?: number; live?: boolean; quality?: VideoQuality; automaticTitle?: boolean; kind?: "radio" };
export type MediaTrack = { id: string; index: number; kind: "video" | "audio" | "subtitle"; label: string; language: string; selected: boolean };
export type Chapter = { title: string; position: number };
export type ReplayGainMode = "off" | "track" | "album";
export type ProfilePlaybackPreferences = { audioLanguage: string; subtitleLanguage: string; subtitles: "auto" | "off"; speed: number; replayGain: ReplayGainMode };
export type PlaybackPreferences = { profile: ProfilePlaybackPreferences; device: { audioDelay: number } };
export type ExternalSubtitle = { source: string; title: string; language?: string };
export type NowPlaying = { title: string; artist?: string };
export type RadioRetry = { attempt: number; maximum: number; retryAt: number | null };
export type NavigationKey = "up" | "down" | "left" | "right" | "select" | "back" | "home" | "info";

export type PlayerState = {
  playbackId: string | null;
  status: "unavailable" | "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  position: number;
  duration: number | null;
  volume: number;
  seekable: boolean;
  error: string | null;
  tracks?: MediaTrack[];
  chapters?: Chapter[];
  speed?: number;
  audioDelay?: number;
  subtitleDelay?: number;
  replayGain?: ReplayGainMode;
  subtitleError?: string | null;
  nowPlaying?: NowPlaying | null;
};

export type SessionState = {
  queue: QueueEntry[];
  currentEntryId: string | null;
  player: PlayerState;
  activeProfile: WatchingProfile;
  preferences?: PlaybackPreferences;
  progressError?: string | null;
  libraryVersion?: number;
  radioVersion?: number;
  providerVersion?: number;
  jellyfinVersion?: number;
  playlistVersion?: number;
  controllerVersion?: number;
  installationName?: string;
  appearance?: TvAppearance;
  administratorClaimed?: boolean;
  radioRetry?: RadioRetry | null;
};

export type Action =
  | { type: "navigate"; key: NavigationKey }
  | { type: "enqueue"; entry: QueueEntry; playNow?: boolean }
  | { type: "enqueueLibrary"; itemId: string; entryId: string; playNow?: boolean; fromStart?: boolean }
  | { type: "enqueueAlbum"; albumId: string; playNow?: boolean }
  | { type: "enqueueProviderAlbum"; provider: "bandcamp"; url: string; playNow?: boolean }
  | { type: "enqueueJellyfin"; itemId: string; entryId: string; playNow?: boolean; fromStart?: boolean }
  | { type: "enqueueRadio"; stationId: string; entryId: string; playNow?: boolean }
  | { type: "enqueueWeb"; entryId: string; url: string; title?: string; thumbnail?: string; quality?: VideoQuality; playNow?: boolean; fromStart?: boolean }
  | { type: "remove"; entryId: string }
  | { type: "move"; entryId: string; beforeEntryId: string | null }
  | { type: "play"; entryId: string; fromStart?: boolean }
  | { type: "pause"; playbackId: string; paused: boolean }
  | { type: "seek"; playbackId: string; position: number }
  | { type: "volume"; volume: number }
  | { type: "preferences"; profileId: string; preferences: Partial<ProfilePlaybackPreferences> }
  | { type: "savePlaybackDefault"; profileId: string; playbackId: string; setting: "audio" | "subtitles" | "speed" | "replayGain" }
  | { type: "track"; playbackId: string; kind: "audio" | "subtitle"; index: number }
  | { type: "speed"; playbackId: string; speed: number }
  | { type: "replayGain"; playbackId: string; mode: ReplayGainMode }
  | { type: "audioDelay"; playbackId: string; delay: number }
  | { type: "subtitleDelay"; playbackId: string; delay: number }
  | { type: "next"; playbackId: string }
  | { type: "stop" };

export type ClientMessage = { type: "command"; requestId: string; action: Action };
export type ServerMessage =
  | { type: "state"; state: SessionState }
  | { type: "navigation"; key: NavigationKey }
  | { type: "result"; requestId: string; ok: boolean; error?: string };

export type PlaybackCommand =
  | { type: "load"; playbackId: string; source: string; headers?: Record<string, string>; audioSource?: string; maxVideoHeight?: number; startPosition?: number; preferences?: ProfilePlaybackPreferences & { audioDelay: number }; subtitles?: ExternalSubtitle[]; radio?: boolean }
  | ({ type: "addSubtitle"; playbackId: string } & ExternalSubtitle)
  | { type: "pause"; playbackId: string; paused: boolean }
  | { type: "seek"; playbackId: string; position: number }
  | { type: "volume"; volume: number }
  | { type: "track"; playbackId: string; kind: "audio" | "subtitle"; index: number }
  | { type: "speed"; playbackId: string; speed: number }
  | { type: "replayGain"; playbackId: string; mode: ReplayGainMode }
  | { type: "audioDelay"; playbackId: string; delay: number }
  | { type: "subtitleDelay"; playbackId: string; delay: number }
  | { type: "stop" };

export type ConnectionInfo = {
  origin: string;
  token: string;
  pairingCode: string;
  urls: string[];
};

export type HostMessage = { type: "player"; state: PlayerState } | { type: "shutdown" };
export type SidecarMessage =
  | ({ type: "ready" } & ConnectionInfo)
  | { type: "playback"; command: PlaybackCommand };
