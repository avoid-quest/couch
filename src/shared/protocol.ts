import type { RadioProgrammeDetails } from "./radio";
import type { MediaCollection, MediaShape } from "./media";
import type { ProviderId, VideoQuality } from "./providers";
import type { WatchingProfile } from "./viewing";
import type { TvAppearance } from "./appearance";
import type { DeviceSharing } from "./device-sharing";
import type { LivePeer, LiveSignalMessage, LiveSource } from "./live-input";
export type { VideoQuality } from "./providers";

export type PlaybackActor = { deviceId: string; name: string };
export type PlaybackCollection = MediaCollection;
export type QueueEntry = { subtitle?: string; description?: string; id: string; title: string; source: string; thumbnail?: string; duration?: number; live?: boolean; liveSourceId?: string; quality?: VideoQuality; automaticTitle?: boolean; kind?: "radio"; addedBy?: PlaybackActor; collection?: PlaybackCollection };
export type MediaTrack = { id: string; index: number; kind: "video" | "audio" | "subtitle"; label: string; language: string; selected: boolean };
export type Chapter = { title: string; position: number };
export type ProfilePlaybackPreferences = { audioLanguage: string; subtitleLanguage: string; subtitles: "auto" | "off"; speed: number; autoplay?: boolean };
export type PlaybackPreferences = { profile: ProfilePlaybackPreferences; device: { audioDelay: number } };
export type ExternalSubtitle = { source: string; title: string; language?: string };
export type NowPlaying = { title: string; artist?: string };
export type RadioProgramme = RadioProgrammeDetails & { playbackId: string };
export type RadioRetry = { attempt: number; maximum: number; retryAt: number | null };
export type Domain = "progress" | "radio" | "iptv" | "providers" | "playlists" | "for-later" | "devices" | "settings" | "sound" | "bluetooth" | "display";
export type NavigationKey ="up" | "down" | "left" | "right" | "select" | "back" | "home" | "info";

export type PlayerState = {
  playbackId: string | null;
  status: "unavailable" | "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  buffering?: boolean;
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
  subtitleError?: string | null;
  nowPlaying?: NowPlaying | null;
};

// A Device's picture and sound in one Playback (#644 ticket 9); the sound plays at the Device's own
// volume attenuated by the Playback's mixTrim. delay is the speaker's own Sendspin delay in milliseconds as it
// last reported it (ticket 10); delayActive while its sound plays in sync with other devices, when delay applies.
// buffered: a live input reaches it through Couch's buffered stream because it couldn't connect directly.
// error: that buffered stream failed, so the live input doesn't reach it this item.
export type Output = { deviceId: string; picture: boolean; sound: boolean; delay?: number; delayActive?: boolean; local?: boolean; buffered?: boolean; error?: string };
// hostOnly: it plays in mpv, so only on the Device that runs Core. audioOnly: its item has no picture.
// choosing: its shared source waits for Where it plays; it counts up with each request to choose.
// held: its publisher's output, left out while its own capture plays and returning after it.
// inSync: its live inputs play buffered in sync on its devices rather than directly on each (docs/adr/0001).
export type PlaybackSummary = { id: string; title: string | null; status: PlayerState["status"]; outputs: Output[]; hostOnly?: boolean; audioOnly?: boolean; liveSourceId?: string; choosing?: number; held?: Output; inSync?: boolean };
// Every Device has one volume and mute; on the TV with system audio they are the system's.
export type DeviceSummary = { id: string; name: string; online: boolean; updates?: boolean; tv?: boolean; sharing?: DeviceSharing; volume: number; muted: boolean };

// The Playback this window looks at, with what every window shares: Devices, Playbacks and settings.
// controlling: this server's selected output Device (the server's own by default), whose Playback is in view.
export type SessionState = {
  controlling?: string;
  textField?: import("./remote").RemoteTextField | null;
  queue: QueueEntry[];
  autoplay?: { enabled: boolean; contextTitle: string | null; next: QueueEntry | null; pending?: boolean };
  queueRemoval?: { entryId: string; token: string };
  currentEntryId: string | null;
  // An explicit Play's picture intent; stable across quality/transport reloads, null on Next/retry.
  presentationId?: string | null;
  playedBy?: PlaybackActor;
  // The looked-at Playback, its outputs, and every Playback and Device (#644 ticket 9).
  playback?: string | null;
  // All's attenuation of this Playback's selected sound: 100 preserves Device levels, 0 silences them. Only older
  // clients still set it; the one Volume folds it into Device levels.
  mixTrim?: number;
  outputs?: Output[];
  playbacks?: PlaybackSummary[];
  devices?: DeviceSummary[];
  liveSources?: LiveSource[];
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
  | { type: "publishLive"; sourceId: string; uploadToken: string; kind: LiveSource["kind"]; audio: boolean; video: boolean; name?: string }
  | { type: "endLive"; sourceId: string }
  | { type: "playLive"; sourceId: string; deviceId?: string; playNow?: boolean; placement?: "next" }
  // The controlled Playback's live inputs play in sync on its devices, buffered, or directly on each.
  | { type: "inSync"; inSync: boolean }
  | { type: "sharing"; sharing: DeviceSharing }
  | { type: "control"; deviceId: string }
  | { type: "navigate"; key: NavigationKey; deviceId?: string }
  | { type: "text"; deviceId: string; token: string; text: string; submit?: boolean }
  // With playNow, deviceId plays on that Device, which this window then controls.
  | { type: "enqueue"; entry: QueueEntry; playNow?: boolean; placement?: "next"; deviceId?: string }
  | { type: "enqueueProvider"; provider: ProviderId; url: string; shape: MediaShape; title?: string; thumbnail?: string; playNow?: boolean; quality?: VideoQuality; placement?: "next"; collection?: PlaybackCollection; deviceId?: string }
  | { type: "enqueueRadio"; stationId: string; entryId: string; playNow?: boolean; placement?: "next"; deviceId?: string }
  | { type: "enqueueWeb"; entryId: string; url: string; title?: string; thumbnail?: string; quality?: VideoQuality; playNow?: boolean; fromStart?: boolean; placement?: "next"; deviceId?: string }
  | { type: "remove"; entryId: string }
  | { type: "restoreRemoved"; token: string }
  | { type: "move"; entryId: string; beforeEntryId: string | null }
  | { type: "play"; entryId: string; fromStart?: boolean }
  | { type: "videoQuality"; playbackId: string; quality: VideoQuality }
  | { type: "pause"; playbackId: string; paused: boolean }
  | { type: "seek"; playbackId: string; position: number }
  // A Device's volume or mute. Without deviceId, the one Volume: every Device in the controlled Playback's sound
  // you may control, scaled so the loudest plays at `volume` with any trim folded in, or the controlled Device when none is.
  | { type: "mute"; muted: boolean; deviceId?: string }
  | { type: "volume"; volume: number; deviceId?: string }
  | { type: "preferences"; profileId: string; preferences: Partial<ProfilePlaybackPreferences> }
  | { type: "savePlaybackDefault"; profileId: string; playbackId: string; setting: "audio" | "subtitles" | "speed" }
  | { type: "track"; playbackId: string; kind: "audio" | "subtitle"; index: number }
  | { type: "speed"; playbackId: string; speed: number }
  | { type: "audioDelay"; playbackId: string; delay: number }
  | { type: "subtitleDelay"; playbackId: string; delay: number }
  | { type: "next"; playbackId: string }
  | { type: "stop"; playbackId?: string }
  // Solo: only that Device keeps the controlled Playback, with its picture (when it shows one) and
  // sound. allSpeakers (All, which only older clients offer) trims the Playback's existing sound from 0 to 100,
  // preserving its outputs and every Device's volume and mute.
  | { type: "solo"; deviceId: string }
  | { type: "allSpeakers"; level: number }
  // A Device's picture and sound in the controlled Playback. level is the fader: 0 takes the
  // Device's sound out, more sets its volume and puts its sound in.
  | { type: "output"; deviceId: string; picture?: boolean; level?: number; delay?: number };

export type ClientMessage = { type: "command"; requestId: string; action: Action; targetDeviceId?: string };
// Every Device plays what Core sends it and reports back; Core listens only to the one it chose (#644 ticket 6).
export type PlayerMessage = { type: "player"; state: PlayerState };
export type UpdateReply = { type: "updates"; requestId: string; state?: import("./app-bridge").UpdateState; error?: string };
export type PlaybackClock = Pick<PlayerState, "playbackId" | "position" | "duration">;
export type ServerMessage =
  | { type: "liveIceServers"; iceServers: RTCIceServer[] }
  | LiveSignalMessage
  // upload: Core needs the publisher's encoded capture, for a playback in sync or a receiver it relays to.
  // uploadId identifies this request so delayed recorder errors cannot fail a later retry of the same source.
  | { type: "livePeers"; sourceId: string; peers: LivePeer[]; upload: boolean; uploadId?: string }
  | { type: "updates"; requestId: string; action: import("./app-bridge").UpdateAction }
  | ({ type: "clock" } & PlaybackClock)
  | { type: "state"; state: SessionState }
  | { type: "navigation"; key: NavigationKey }
  | { type: "text"; requestId: string; token: string; text: string; submit: boolean }
  | { type: "player"; command: PlaybackCommand }
  // This tab plays its Device's sound in a synced Playback over Sendspin (#644 ticket 10), or
  // shows its picture and needs only the Sendspin clock (ticket 11).
  | { type: "sendspin"; listen: boolean; watch: boolean }
  | { type: "result"; requestId: string; ok: boolean; error?: string };

// A muted picture follows the Sendspin clock of its Playback's group (#644 ticket 11). pts: the
// clock is the source's own timestamps (live), else the item's position.
export type Follow = { group: string; pts: boolean };
export type PlaybackCommand =
  | { type: "audioPause" }
  // eventStart: an HLS EVENT playlist starts at its first segment instead of the live edge.
  // mpegts: raw MPEG-TS for mpegts.js. mpv: Chromium can't decode it, so Core's own mpv plays it (#644 ticket 1).
  // hls: Pass-through found an HLS playlist, which hls.js plays where the engine can't.
  // audioTrack, subtitleTrack and subtitleDelay carry the chosen tracks when playback moves to another Device (#644 ticket 9).
  | { type: "load"; playbackId: string; source: string; audioSource?: string; startPosition?: number; paused?: boolean; preferences?: ProfilePlaybackPreferences & { audioDelay: number }; subtitles?: ExternalSubtitle[]; radio?: boolean; eventStart?: boolean; mpegts?: boolean; mpv?: boolean; hls?: boolean; audioTrack?: number; subtitleTrack?: number; subtitleDelay?: number; follow?: Follow; liveSourceId?: string; livePeerId?: string; liveOutput?: { picture: boolean; sound: boolean; volume: number } }
  | { type: "follow"; playbackId: string; follow: Follow | null }
  | ({ type: "addSubtitle"; playbackId: string } & ExternalSubtitle)
  | { type: "pause"; playbackId: string; paused: boolean }
  | { type: "seek"; playbackId: string; position: number }
  | { type: "volume"; volume: number }
  | { type: "track"; playbackId: string; kind: "audio" | "subtitle"; index: number }
  | { type: "speed"; playbackId: string; speed: number }
  | { type: "audioDelay"; playbackId: string; delay: number }
  | { type: "subtitleDelay"; playbackId: string; delay: number }
  | { type: "stop" };

export type ConnectionInfo = {
  origin: string;
  token: string;
  pairingCode: string;
  urls: string[];
};

// Main and Core talk over the utilityProcess parent port (app/main.ts, src/main.ts).
export type AppMessage = { type: "display"; requestId: string; state?: import("./display").DisplayState; error?: string }
  | { type: "updates"; requestId: string; state?: import("./app-bridge").UpdateState; error?: string } | { type: "tvMode"; requestId: string; error?: string } | { type: "renamed" } | { type: "shutdown" };
export type CoreMessage =
  | { type: "ready"; origin: string; urls: string[]; pairingCode: string }
  | { type: "addresses"; urls: string[] }
  | { type: "display"; requestId: string; action: import("./display").DisplayAction }
  | { type: "updates"; requestId: string; action: import("./app-bridge").UpdateAction }
  | { type: "tvMode"; requestId: string; enabled: boolean };
