import type { RadioProgrammeDetails } from "./radio";
import type { MediaShape } from "./media";
import type { ProviderId, VideoQuality } from "./providers";
import type { WatchingProfile } from "./library";
import type { TvAppearance } from "./appearance";
export type { VideoQuality } from "./providers";

export type PlaybackActor = { deviceId: string; name: string };
export type PlaybackCollection = { title: string; url: string; index?: number };
export type QueueEntry = { subtitle?: string; description?: string; id: string; title: string; source: string; thumbnail?: string; artworkId?: string; duration?: number; live?: boolean; quality?: VideoQuality; automaticTitle?: boolean; kind?: "radio"; addedBy?: PlaybackActor; collection?: PlaybackCollection };
export type MediaTrack = { id: string; index: number; kind: "video" | "audio" | "subtitle"; label: string; language: string; selected: boolean };
export type Chapter = { title: string; position: number };
export type ReplayGainMode = "off" | "track" | "album";
export type ProfilePlaybackPreferences = { audioLanguage: string; subtitleLanguage: string; subtitles: "auto" | "off"; speed: number; replayGain: ReplayGainMode; autoplay?: boolean };
export type PlaybackPreferences = { profile: ProfilePlaybackPreferences; device: { audioDelay: number } };
export type ExternalSubtitle = { source: string; title: string; language?: string };
export type NowPlaying = { title: string; artist?: string };
export type RadioProgramme = RadioProgrammeDetails & { playbackId: string };
export type RadioRetry = { attempt: number; maximum: number; retryAt: number | null };
export type Domain = "library" | "progress" | "radio" | "iptv" | "providers" | "jellyfin" | "playlists" | "for-later" | "controllers" | "settings" | "sound" | "bluetooth" | "display" | "updates" | "tools";
export type NavigationKey ="up" | "down" | "left" | "right" | "select" | "back" | "home" | "info";

export type PlayerState = {
  playbackId: string | null;
  status: "unavailable" | "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  buffering?: boolean;
  requiresGesture?: boolean;
  position: number;
  duration: number | null;
  volume: number;
  seekable: boolean;
  error: string | null;
  tracks?: MediaTrack[];
  audioTracksKnown?: boolean;
  chapters?: Chapter[];
  speed?: number;
  audioDelay?: number;
  subtitleDelay?: number;
  replayGain?: ReplayGainMode;
  subtitleError?: string | null;
  nowPlaying?: NowPlaying | null;
};

export type SessionState = {
  sessionId?: string;
  targetId?: string;
  targets?: PlaybackTarget[];
  handoff?: { targetId: string } | null;
  queue: QueueEntry[];
  autoplay?: { enabled: boolean; contextTitle: string | null; next: QueueEntry | null; pending?: boolean };
  queueRemoval?: { entryId: string; token: string };
  currentEntryId: string | null;
  presentationId?: string | null;
  playedBy?: PlaybackActor;
  activity?: { id: string; actor: PlaybackActor; text: string };
  queueCursorEntryId?: string | null;
  queueError?: string | null;
  player: PlayerState;
  activeProfile: WatchingProfile;
  preferences?: PlaybackPreferences;
  progressError?: string | null;
  // Revision per client query-key root. A bump tells controllers to refetch that domain.
  versions?: Partial<Record<Domain, number>>;
  installationName?: string;
  setupStep?: import("./setup").SetupStep;
  appearance?: TvAppearance;
  administratorClaimed?: boolean;
  radioRetry?: RadioRetry | null;
  radioProgramme?: RadioProgramme | null;
  webRetry?: { paused: boolean } | null;
  systemAudio?: import("./sound").SoundRouteState;
};

export type Action =
  | { type: "selectTarget"; targetId: string }
  | { type: "navigate"; key: NavigationKey }
  | { type: "enqueue"; entry: QueueEntry; playNow?: boolean; placement?: "next" }
  | { type: "enqueueLibrary"; itemId: string; entryId: string; playNow?: boolean; fromStart?: boolean; placement?: "next" }
  | { type: "enqueueAlbum"; albumId: string; playNow?: boolean; placement?: "next" }
  | { type: "enqueueProvider"; provider: ProviderId; url: string; shape: MediaShape; title?: string; thumbnail?: string; playNow?: boolean; quality?: VideoQuality; placement?: "next"; collection?: PlaybackCollection }
  | { type: "enqueueJellyfin"; itemId: string; entryId: string; playNow?: boolean; fromStart?: boolean; placement?: "next" }
  | { type: "enqueueRadio"; stationId: string; entryId: string; playNow?: boolean; placement?: "next" }
  | { type: "enqueueWeb"; entryId: string; url: string; title?: string; thumbnail?: string; quality?: VideoQuality; playNow?: boolean; fromStart?: boolean; placement?: "next" }
  | { type: "remove"; entryId: string }
  | { type: "restoreRemoved"; token: string }
  | { type: "move"; entryId: string; beforeEntryId: string | null }
  | { type: "play"; entryId: string; fromStart?: boolean }
  | { type: "videoQuality"; playbackId: string; quality: VideoQuality }
  | { type: "goLive"; playbackId: string }
  | { type: "pause"; playbackId: string; paused: boolean }
  | { type: "seek"; playbackId: string; position: number }
  | { type: "mute"; muted: boolean }
  | { type: "volume"; volume: number }
  | { type: "preferences"; profileId: string; preferences: Partial<ProfilePlaybackPreferences> }
  | { type: "savePlaybackDefault"; profileId: string; playbackId: string; setting: "audio" | "subtitles" | "speed" | "replayGain" }
  | { type: "track"; playbackId: string; kind: "audio" | "subtitle"; index: number }
  | { type: "speed"; playbackId: string; speed: number }
  | { type: "replayGain"; playbackId: string; mode: ReplayGainMode }
  | { type: "audioDelay"; playbackId: string; delay: number }
  | { type: "subtitleDelay"; playbackId: string; delay: number }
  | { type: "next"; playbackId: string }
  | { type: "stop"; playbackId?: string };

export type ClientMessage = { type: "command"; requestId: string; action: Action };
export type PlaybackClock = Pick<PlayerState, "playbackId" | "position" | "duration">;
export type ServerMessage =
  | { type: "rendererRegistered"; targetId: string; sessionId: string }
  | { type: "rendererCommand"; sessionId: string; command: PlaybackCommand }
  | ({ type: "clock" } & PlaybackClock)
  | { type: "state"; state: SessionState }
  | { type: "navigation"; key: NavigationKey }
  | { type: "result"; requestId: string; ok: boolean; error?: string };

export type PlaybackCommand =
  | { type: "audioPause" }
  | { type: "audioOutput"; output: string }
  | { type: "prepare"; playbackId: string; next?: { playbackId: string; source: string; headers?: Record<string, string>; preferences: ProfilePlaybackPreferences & { audioDelay: number } } }
  | { type: "load"; playbackId: string; source: string; headers?: Record<string, string>; audioSource?: string; maxVideoHeight?: number; startPosition?: number; paused?: boolean; segment?: { start: number; end: number }; preferences?: ProfilePlaybackPreferences & { audioDelay: number }; subtitles?: ExternalSubtitle[]; radio?: boolean; goLive?: boolean; eventStart?: boolean; audioOutput?: string }
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

// A backend-managed group has one timeline and one observation writer.
export type PlaybackTarget = { id: string; name: string; kind: "endpoint" | "group"; backend: "native" | "browser"; connected: boolean };
export type RendererMessage = { type: "registerRenderer" } | { type: "rendererObservation"; sessionId: string; state: PlayerState };

export type ConnectionInfo = {
  origin: string;
  token: string;
  pairingCode: string;
  urls: string[];
};

export type HostMessage = { type: "sound"; requestId: string; state?: unknown; error?: string } | { type: "bluetooth"; requestId: string; state?: import("./bluetooth").BluetoothState; error?: string } | { type: "appimageQuiesce"; restart?: boolean; nonce: string; confirmInterrupt: boolean; whenIdle: boolean } | { type: "appimageResume"; nonce: string } | ({ type: "appimageUpdate" } & import("./updates").AppImageUpdateReply) | ({ type: "debUpdate" } & import("./updates").DebUpdateReply) | { type: "display"; requestId: string; state?: import("./display").DisplayState; error?: string } | { type: "readiness"; nonce: string; ok: boolean; build: unknown } | { type: "diagnostics"; requestId: string; report: unknown } | { type: "player"; state: PlayerState } | { type: "shutdown" };
export type SidecarMessage =
  | { type: "addresses"; urls: string[] }
  | { type: "appimageQuiesced"; nonce: string; closed: boolean; error: string | null }
  | { type: "appimageResumed"; nonce: string; error: string | null }
  | { type: "appimageUpdate"; requestId: string; action: import("./updates").AppImageUpdateAction }
  | { type: "debUpdate"; requestId: string; action: import("./updates").DebUpdateAction }
  | { type: "bluetooth"; requestId: string; action: import("./bluetooth").BluetoothAction }
  | { type: "sound"; requestId: string; action: unknown }
  | { type: "display"; requestId: string; action: import("./display").DisplayAction }
  | ({ type: "ready" } & ConnectionInfo)
  | { type: "playback"; command: PlaybackCommand }
  | { type: "diagnostics"; requestId: string }
  | { type: "readiness"; nonce: string }
  | { type: "observe" };
