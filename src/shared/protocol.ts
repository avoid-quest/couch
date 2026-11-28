import type { LiveAudioSettings } from "./audio-settings";
import type { RadioProgrammeDetails } from "./radio";
import type { CollectionLink, MediaCollection, MediaShape } from "./media";
import type { ProviderId, VideoQuality } from "./providers";
import type { WatchingProfile } from "./viewing";
import type { TvAppearance } from "./appearance";
import type { DeviceSharing } from "./device-sharing";
import type { LiveMetadata, LivePeer, LiveSignalMessage, LiveSource } from "./live-input";
import type { CaptureKind } from "./capture";
import type { CompressorSettings } from "./compressor";
import type { RemoteTextField } from "./remote";
import type { SetupStep } from "./setup";
import type { SoundRouteState } from "./sound";
import type { UpdateAction, UpdateState } from "./app-bridge";
import type { DisplayAction, DisplayState } from "./display";
import type { GroupMember, MixerGroup } from "./mixer-groups";
export type { VideoQuality } from "./providers";

export type PlaybackActor = { deviceId: string; name: string };
export type PlaybackCollection = MediaCollection;
export type QueueEntry = {
  creator?: CollectionLink;
  subtitle?: string;
  description?: string;
  id: string;
  title: string;
  source: string;
  thumbnail?: string;
  duration?: number;
  // An item with no end: a radio station, a Live TV channel, a stream or a shared capture.
  endless?: boolean;
  // A radio station or Live TV channel in Couch's catalog; its programme is the Playback's radioProgramme.
  station?: { id: string; name: string };
  liveSourceId?: string;
  quality?: VideoQuality;
  automaticTitle?: boolean;
  kind?: "radio";
  addedBy?: PlaybackActor;
  collection?: PlaybackCollection;
};
export type MediaTrack = {
  id: string;
  index: number;
  kind: "video" | "audio" | "subtitle";
  label: string;
  language: string;
  selected: boolean;
};
// Runtime selection intent carried between renderers and the scheduled decoder.
export type AudioSelection = Pick<MediaTrack, "index" | "language" | "label">;
type Chapter = { title: string; position: number };
export type ProfilePlaybackPreferences = {
  audioLanguage: string;
  subtitleLanguage: string;
  subtitles: "auto" | "off";
  speed: number;
  autoplay?: boolean;
};
export type PlaybackPreferences = {
  profile: ProfilePlaybackPreferences;
  device: { audioDelay: number };
};
export type ExternalSubtitle = { source: string; title: string; language?: string };
type NowPlaying = { title: string; artist?: string };
export type RadioProgramme = RadioProgrammeDetails & { playbackId: string };
export type RadioRetry = { attempt: number; maximum: number; retryAt: number | null };
export type Domain =
  | "progress"
  | "radio"
  | "iptv"
  | "providers"
  | "playlists"
  | "for-later"
  | "hidden"
  | "devices"
  | "settings"
  | "sound"
  | "bluetooth"
  | "display";
// "menu" is OK held, which opens a focused item's menu.
export type NavigationKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "menu"
  | "back"
  | "home"
  | "info";

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
  timeline?: { mapping: "hls" | "media" | "unavailable"; error?: string };
};

// What a receiver is doing in its Playback, from its own reports and Core's checks. behind: its picture
// waits for data, or its speaker keeps losing sound to chunks that arrive late. stalled: Core couldn't
// send its speaker sound for most of the last few seconds. relayed: it gets the media through Couch
// because it couldn't fetch or connect on its own. cant-play: error says why.
export type ReceiverState = "joining" | "playing" | "behind" | "stalled" | "relayed" | "cant-play";
// A Device's picture and sound in one Playback (#644 ticket 9); the sound plays at the Device's own
// volume attenuated by the Playback's mixTrim. delay is the speaker's own Sendspin delay in milliseconds as it
// last reported it (ticket 10); delayActive while its sound plays in sync with other devices, when delay applies.
// state: its receiver state, while its Playback plays; error: why it can't play.
export type Output = {
  deviceId: string;
  picture: boolean;
  sound: boolean;
  delay?: number;
  delayActive?: boolean;
  local?: boolean;
  state?: ReceiverState;
  error?: string;
};
// mode: Direct (one device plays it), Relaxed (several devices in step) or Live. plays: what it plays,
// media from the queue or a capture: a sound, a screen or AirPlay.
// hostOnly: it plays in mpv, so only on the Device that runs Core. audioOnly: its item has no picture.
// choosing: a shared request to open Where it plays, sent only with askEveryDevice enabled; counts up per request.
// held: its publisher's output, left out while its own capture plays and returning after it.
// inSync: its live inputs play buffered in sync on its devices rather than directly on each (docs/adr/0001).
export type PlaybackSummary = {
  id: string;
  title?: string | null;
  thumbnail?: string;
  running?: true;
  // This window may not control this Playback, so its title, artwork and source are left out.
  private?: true;
  status: PlayerState["status"];
  outputs: Output[];
  hostOnly?: boolean;
  audioOnly?: boolean;
  liveSourceId?: string;
  choosing?: number;
  held?: Output;
  inSync?: boolean;
  mode: "direct" | "relaxed" | "live";
  plays: "media" | "sound" | "screen" | "airplay";
  delivery?: "direct" | "scheduled" | "webrtc" | "mpv";
};
export type PlaybackControls = {
  programme: boolean;
  queue: boolean;
  seek: boolean;
  speed: boolean;
  audioDelay: boolean;
  subtitleDelay: boolean;
  leave: boolean;
};
// Every Device has one volume and mute; on the TV with system audio they are the system's.
export type DeviceSummary = {
  id: string;
  name: string;
  online: boolean;
  updates?: boolean;
  tv?: boolean;
  sharing?: DeviceSharing;
  volume: number;
  muted: boolean;
};

// The Playback this window looks at, with what every window shares: Devices, Playbacks and settings.
// controlling: this server's selected output Device (the server's own by default), whose Playback is in view.
export type SessionState = {
  // Core's wall time (ms) when the Playback was at player.position: the anchor of its clock messages.
  positionAt?: number;
  controls?: PlaybackControls;
  controlling?: string;
  textField?: RemoteTextField | null;
  queue: QueueEntry[];
  // upcoming: the first entries Autoplay will play after Up next, in order, of total; GET /api/autoplay
  // pages through the rest.
  autoplay?: {
    enabled: boolean;
    contextTitle: string | null;
    upcoming: QueueEntry[];
    total?: number;
    pending?: boolean;
  };
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
  compressor?: CompressorSettings;
  outputs?: Output[];
  playbacks?: PlaybackSummary[];
  devices?: DeviceSummary[];
  liveSources?: LiveSource[];
  // target: the one Device a listener-removed notice is for.
  activity?: {
    id: string;
    actor: PlaybackActor;
    text: string;
    kind?: "sharing-stopped" | "listener-removed";
    target?: string;
  };
  queueCursorEntryId?: string | null;
  queueError?: string | null;
  player: PlayerState;
  activeProfile: WatchingProfile;
  preferences?: PlaybackPreferences;
  progressError?: string | null;
  // Revision per client query-key root. A bump tells controllers to refetch that domain.
  versions?: Partial<Record<Domain, number>>;
  installationName?: string;
  setupStep?: SetupStep;
  appearance?: TvAppearance;
  // Couch-wide, admin-managed opt-in for shared live-source chooser requests. Defaults to false.
  askEveryDevice?: boolean;
  // The Couch's Groups, which everyone sees and applies; the host and admins save them.
  groups?: MixerGroup[];
  administratorClaimed?: boolean;
  radioRetry?: RadioRetry | null;
  radioProgramme?: RadioProgramme | null;
  webRetry?: { paused: boolean } | null;
  systemAudio?: SoundRouteState;
};

// The Couch as this window sees it, whichever Playback it looks at.
type CouchState = Pick<
  SessionState,
  | "versions"
  | "installationName"
  | "setupStep"
  | "appearance"
  | "askEveryDevice"
  | "groups"
  | "administratorClaimed"
  | "activeProfile"
  | "preferences"
  | "systemAudio"
  | "playbacks"
  | "devices"
  | "liveSources"
>;

export type Action =
  | {
      type: "publishLive";
      sourceId: string;
      uploadToken: string;
      kind: CaptureKind;
      audio: boolean;
      video: boolean;
      name?: string;
      intent?: "relaxed" | "live";
      audioDelivery?: "pcm";
      metadata?: LiveMetadata;
    }
  | { type: "updateLiveMetadata"; sourceId: string; metadata: LiveMetadata }
  | { type: "endLive"; sourceId: string }
  | { type: "leave"; playbackId: string }
  // The host or an administrator removes a Live audio listener from a Playback (its PlaybackSummary id).
  | { type: "removeLiveListener"; playbackId: string; deviceId: string }
  | {
      type: "playLive";
      sourceId: string;
      deviceId?: string;
      playNow?: boolean;
      placement?: "next";
      picture?: boolean;
      sound?: boolean;
    }
  // The controlled Playback's live inputs play in sync on its devices, buffered, or directly on each.
  | { type: "inSync"; inSync: boolean }
  | { type: "compressor"; playbackId: string; settings: Partial<CompressorSettings> }
  | { type: "sharing"; sharing: DeviceSharing }
  | { type: "askEveryDevice"; enabled: boolean }
  // The host or an admin saves a Group (a new one without id) or deletes one. Neither changes what plays.
  | { type: "saveGroup"; group: { id?: string; name: string; members: GroupMember[] } }
  | { type: "deleteGroup"; id: string }
  | { type: "control"; deviceId: string | null }
  // The PlaybackSummary id stays with the queue when its playing item changes.
  | { type: "selectPlayback"; playbackId: string }
  | { type: "navigate"; key: NavigationKey; deviceId?: string }
  | { type: "text"; deviceId: string; token: string; text: string; submit?: boolean }
  // With playNow, Play on (PlayOn) chooses where it plays.
  | ({ type: "enqueue"; entry: QueueEntry; playNow?: boolean; placement?: "next" } & PlayOn)
  | ({
      type: "enqueueProvider";
      provider: ProviderId;
      url: string;
      shape: MediaShape;
      title?: string;
      thumbnail?: string;
      playNow?: boolean;
      fromStart?: boolean;
      quality?: VideoQuality;
      placement?: "next";
      collection?: PlaybackCollection;
    } & PlayOn)
  | ({
      type: "enqueueRadio";
      stationId: string;
      entryId: string;
      playNow?: boolean;
      placement?: "next";
    } & PlayOn)
  | ({
      type: "enqueueWeb";
      entryId: string;
      url: string;
      title?: string;
      thumbnail?: string;
      quality?: VideoQuality;
      playNow?: boolean;
      fromStart?: boolean;
      placement?: "next";
    } & PlayOn)
  | { type: "remove"; entryId: string }
  | { type: "restoreRemoved"; token: string }
  | { type: "move"; entryId: string; beforeEntryId: string | null }
  | { type: "play"; entryId: string; fromStart?: boolean }
  | { type: "videoQuality"; playbackId: string; quality: VideoQuality }
  | { type: "pause"; playbackId: string; paused: boolean }
  | { type: "seek"; playbackId: string; position: number; relative?: boolean }
  // A Device's volume or mute. Without deviceId, the one Volume: every Device in the controlled Playback's sound
  // you may control, scaled so the loudest plays at `volume` with any trim folded in, or the controlled Device when none is.
  | { type: "mute"; muted: boolean; deviceId?: string }
  | { type: "volume"; volume: number; deviceId?: string }
  | { type: "preferences"; profileId: string; preferences: Partial<ProfilePlaybackPreferences> }
  | {
      type: "savePlaybackDefault";
      profileId: string;
      playbackId: string;
      setting: "audio" | "subtitles" | "speed";
    }
  | { type: "track"; playbackId: string; kind: "audio" | "subtitle"; index: number }
  | { type: "speed"; playbackId: string; speed: number }
  | { type: "holdSpeed"; playbackId: string; held: boolean }
  | { type: "audioDelay"; playbackId: string; delay: number }
  | { type: "subtitleDelay"; playbackId: string; delay: number }
  | { type: "next"; playbackId: string }
  | { type: "stop"; playbackId?: string }
  | { type: "undoStop"; stoppedId: string }
  // Solo: only that Device keeps the controlled Playback, with its picture (when it shows one) and
  // sound. allSpeakers (All, which only older clients offer) trims the Playback's existing sound from 0 to 100,
  // preserving its outputs and every Device's volume and mute.
  | { type: "solo"; deviceId: string }
  | { type: "allSpeakers"; level: number }
  // A Device's picture and sound in the controlled Playback. level is the fader: 0 takes the
  // Device's sound out, more sets its volume and puts its sound in. With playbackId, only while that item plays there.
  | {
      type: "output";
      deviceId: string;
      picture?: boolean;
      level?: number;
      delay?: number;
      playbackId?: string;
    };

/**
 * Play on: deviceId plays it with what that Device lends, and this window then controls it. With outputs it starts
 * there instead, deviceId among them, each Device with the picture and sound chosen for it.
 */
export type PlayOn = {
  deviceId?: string;
  outputs?: Pick<Output, "deviceId" | "picture" | "sound">[];
};

export type ClientMessage = {
  type: "command";
  requestId: string;
  action: Action;
  targetDeviceId?: string;
};
// Every Device plays what Core sends it and reports back; Core listens only to the one it chose (#644 ticket 6).
export type PlayerMessage = { type: "player"; state: PlayerState };
// A receiver that can't keep up says so: its picture waits for data, or its speaker keeps losing late chunks.
export type BehindMessage = { type: "behind"; picture: boolean; sound: boolean };
// Where the Playback is, as an anchor: position at Core's wall time `at` (ms), moving `rate` seconds per
// second (0 while paused or waiting). Core sends a new one only when it changes; clients move on their own.
export type PlaybackClock = Pick<PlayerState, "playbackId" | "position" | "duration"> & {
  at: number;
  rate: number;
};
export type ServerMessage =
  | { type: "liveIceServers"; iceServers: RTCIceServer[] }
  | LiveSignalMessage
  // upload: Core needs the publisher's encoded capture, for a playback in sync or a receiver it relays to.
  // uploadId identifies this request so delayed recorder errors cannot fail a later retry of the same source.
  | { type: "livePeers"; sourceId: string; peers: LivePeer[]; upload: boolean; uploadId?: string }
  | { type: "updates"; requestId: string; action: UpdateAction }
  | ({ type: "clock" } & PlaybackClock)
  // Core's Unix time in milliseconds, once per connection: elapsed Live times count on it.
  | { type: "time"; now: number }
  // What a window sees, in three parts sent as each changes (session-parts.ts).
  | { type: "couch"; couch: CouchState }
  | { type: "playback"; playback: Omit<SessionState, keyof CouchState | "outputs"> }
  | { type: "outputs"; outputs: Output[] }
  | { type: "navigation"; key: NavigationKey }
  | { type: "text"; requestId: string; token: string; text: string; submit: boolean }
  | { type: "player"; command: PlaybackCommand }
  // This tab plays its Device's sound in a synced Playback over Sendspin (#644 ticket 10), or
  // shows its picture and needs only the Sendspin clock (ticket 11).
  | {
      type: "sendspin";
      listen: boolean;
      watch: boolean;
      live?: LiveAudioSettings & { sourceId: string };
    }
  | { type: "result"; requestId: string; ok: boolean; error?: string };

// A muted picture follows the Sendspin clock of its Playback's group (#644 ticket 11). pts: the
// clock is the source's own timestamps (live), else the item's position.
export type Follow = {
  group: string;
  pts: boolean;
  timeline?: {
    kind: "position" | "source-pts";
    generation: string;
    mapping: "hls" | "media" | "unavailable";
  };
};
export type PlaybackCommand =
  | { type: "audioPause" }
  // eventStart: an HLS EVENT playlist starts at its first segment instead of the live edge.
  // mpegts: raw MPEG-TS for mpegts.js. mpv: Chromium can't decode it, so Core's own mpv plays it (#644 ticket 1).
  // hls: Pass-through found an HLS playlist, which hls.js plays where the engine can't.
  // audioTrack, subtitleTrack and subtitleDelay carry the chosen tracks when playback moves to another Device (#644 ticket 9).
  | {
      type: "load";
      playbackId: string;
      source: string;
      audioSource?: string;
      startPosition?: number;
      paused?: boolean;
      preferences?: ProfilePlaybackPreferences & { audioDelay: number };
      subtitles?: ExternalSubtitle[];
      radio?: boolean;
      eventStart?: boolean;
      mpegts?: boolean;
      mpv?: boolean;
      hls?: boolean;
      audioTrack?: number;
      subtitleTrack?: number;
      subtitleDelay?: number;
      follow?: Follow;
      liveSourceId?: string;
      livePeerId?: string;
      liveOutput?: { picture: boolean; sound: boolean; volume: number };
      output?: { picture: boolean; sound: boolean };
      compressor?: CompressorSettings;
    }
  | { type: "follow"; playbackId: string; follow: Follow | null; compressor?: CompressorSettings }
  | { type: "compressor"; playbackId: string; settings: CompressorSettings }
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
export type AppMessage =
  | { type: "errorReporting"; enabled: boolean }
  | { type: "display"; requestId: string; state?: DisplayState; error?: string }
  | { type: "updates"; requestId: string; state?: UpdateState; error?: string }
  | { type: "tvMode"; requestId: string; error?: string }
  | { type: "renamed" }
  | { type: "shutdown" };
export type CoreMessage =
  | { type: "ready"; origin: string; urls: string[]; pairingCode: string }
  | { type: "addresses"; urls: string[] }
  | { type: "display"; requestId: string; action: DisplayAction }
  | { type: "updates"; requestId: string; action: UpdateAction }
  | { type: "tvMode"; requestId: string; enabled: boolean };
