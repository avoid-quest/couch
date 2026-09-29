import type Hls from "hls.js";
import type Mpegts from "mpegts.js";
import type { MediaTrack, PlaybackCommand, PlayerState } from "../../shared/protocol";

// Every Device plays what its Core sends it (#644 ticket 6): the Device fetches the source
// itself. URLs play in <video>; YouTube's separate audio in an <audio> that follows the
// video; HLS natively where the engine can (Safari, Android) and through hls.js elsewhere;
// raw MPEG-TS through mpegts.js (#644 ticket 1).
const video = document.createElement("video");
const audio = document.createElement("audio");
video.playsInline = true;
video.style.cssText = "width: 100%; height: 100%; object-fit: contain";
const holder = document.createElement("div");
holder.hidden = true;
holder.append(video, audio);

let playbackId: string | null = null;
let loading: Extract<PlaybackCommand, { type: "load" }> | null = null;
let hls: Hls | null = null;
let mpegts: Mpegts.Player | null = null;
let ready = false;
let stalled = false;
let failure: string | null = null;
let volume = 1;
let audioDelay = 0;
let subtitleDelay = 0;
let blocked = false;
let report: ((state: PlayerState) => void) | undefined;
let reportedAt = 0;
const blockedListeners = new Set<(blocked: boolean) => void>();

// Chromium plays YouTube's VP9 (#644 ticket 1); other engines get H.264.
export const playsVp9 = /Chrome\//.test(navigator.userAgent) && video.canPlayType('video/webm; codecs="vp9"') === "probably";

const split = () => audio.hasAttribute("src");
const waiting = () => stalled && !video.paused;
const external = () => Array.from(video.textTracks).filter(track => track.kind === "subtitles" && !hls?.subtitleTracks.some(item => item.name === track.label && item.lang === track.language));
const tracks = (): MediaTrack[] => {
  if (!playbackId || !ready) return [];
  const picture: MediaTrack[] = video.videoWidth ? [{ id: "video", index: 0, kind: "video", label: "Video", language: "", selected: true }] : [];
  const sound: MediaTrack[] = hls?.audioTracks.length ? hls.audioTracks.map((track, index) => ({ id: `audio-${index}`, index, kind: "audio", label: track.name, language: track.lang ?? "", selected: index === hls!.audioTrack }))
    : [{ id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }];
  const embedded = hls?.subtitleTracks ?? [];
  const subtitles: MediaTrack[] = [
    ...embedded.map((track, index): MediaTrack => ({ id: `subtitle-${index}`, index, kind: "subtitle", label: track.name, language: track.lang ?? "", selected: index === hls!.subtitleTrack })),
    ...external().map((track, index): MediaTrack => ({ id: `external-${index}`, index: embedded.length + index, kind: "subtitle", label: track.label, language: track.language, selected: track.mode === "showing" })),
  ];
  return [...picture, ...sound, ...subtitles];
};
const state = (): PlayerState => ({
  playbackId,
  status: !playbackId ? "idle" : failure ? "error" : video.ended ? "ended" : !ready || waiting() ? "loading" : video.paused ? "paused" : "playing",
  buffering: waiting(),
  position: video.currentTime,
  duration: Number.isFinite(video.duration) && !loading?.radio && !mpegts ? video.duration : null,
  volume: Math.round(volume * 100),
  seekable: Number.isFinite(video.duration) && !mpegts,
  error: failure,
  speed: video.playbackRate,
  tracks: tracks(),
  audioDelay,
  subtitleDelay,
});
const send = () => { reportedAt = performance.now(); report?.(state()); };
const setBlocked = (value: boolean) => {
  if (blocked === value) return;
  blocked = value;
  for (const listener of blockedListeners) listener(value);
};
// A browser that wants a gesture before sound plays the picture muted and asks for a tap.
const start = (element: HTMLMediaElement) => element.play().catch((error: unknown) => {
  if (!(error instanceof DOMException) || error.name !== "NotAllowedError" || !playbackId) return;
  setBlocked(true);
  if (element === video && !video.muted) { video.muted = true; void video.play().catch(() => {}); }
});

const follow = (resync = true) => {
  if (!split()) return;
  // Small drift is corrected by playing the audio 5% faster or slower, large drift by seeking.
  // A positive audio delay plays the sound later.
  const drift = video.currentTime - audioDelay - audio.currentTime;
  if (Math.abs(drift) > (resync ? 0.1 : 0.5)) audio.currentTime = Math.max(0, video.currentTime - audioDelay);
  audio.playbackRate = video.playbackRate * (Math.abs(drift) > 0.03 ? 1 + Math.sign(drift) * 0.05 : 1);
  if (video.paused || !ready || waiting()) audio.pause(); else if (audio.paused && !blocked) void start(audio);
};
const fail = (message: string) => {
  if (!playbackId) return;
  failure = message;
  send();
};
for (const event of ["loadedmetadata", "durationchange", "pause", "playing", "waiting", "seeked", "ended", "ratechange", "resize"]) {
  video.addEventListener(event, () => {
    if (event === "waiting" || event === "playing") stalled = event === "waiting";
    if (event !== "durationchange" && event !== "resize") follow(event !== "ratechange");
    send();
  });
}
video.addEventListener("canplay", () => { ready = true; send(); });
video.addEventListener("timeupdate", () => { follow(false); shiftCues(); if (performance.now() - reportedAt > 1000) send(); });
video.addEventListener("error", () => {
  if (video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && loading && !hls && !mpegts) void playlist(loading);
  else fail(video.error?.message || "This media couldn't play here.");
});
audio.addEventListener("error", () => fail(audio.error?.message || "This media couldn't play here."));
video.textTracks.addEventListener("change", send);

const apply = () => {
  video.muted = split() || blocked;
  video.volume = audio.volume = volume;
};
// An HLS EVENT playlist starts at its first segment; hls.js would start it at the live edge.
const begin = (command: NonNullable<typeof loading>) => command.startPosition || (command.eventStart ? 0 : undefined);
// Chromium without native HLS rejects the playlist; hls.js plays it (and not at all on engines without MSE).
const playlist = async (command: NonNullable<typeof loading>) => {
  const { default: Hls } = await import("hls.js");
  if (command !== loading || !Hls.isSupported()) return fail(video.error?.message || "This media couldn't play here.");
  hls = new Hls({ startPosition: begin(command) ?? -1 });
  hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(`The stream failed (${data.details}).`); });
  for (const event of [Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED, Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH]) hls.on(event, send);
  // Tracks follow the profile's language preferences.
  const { audioLanguage = "", subtitleLanguage = "", subtitles = "auto" } = command.preferences ?? {};
  const matches = (lang = "", wanted: string) => !!wanted && lang.toLowerCase().startsWith(wanted.toLowerCase().slice(0, 2));
  // Tracks chosen on another Device come with the item (#644 ticket 9).
  hls.once(Hls.Events.MANIFEST_PARSED, () => {
    const audioTrack = command.audioTrack ?? hls!.audioTracks.findIndex(track => matches(track.lang, audioLanguage));
    if (audioTrack >= 0 && audioTrack < hls!.audioTracks.length) hls!.audioTrack = audioTrack;
    selectSubtitle(command.subtitleTrack ?? (subtitles === "auto" ? hls!.subtitleTracks.findIndex(track => matches(track.lang, subtitleLanguage)) : -1));
  });
  hls.subtitleTrack = -1;
  hls.loadSource(command.source);
  hls.attachMedia(video);
  if (!command.paused) void start(video);
};
const transportStream = async (command: NonNullable<typeof loading>) => {
  const { default: Mpegts } = await import("mpegts.js");
  if (command !== loading) return;
  if (!Mpegts.getFeatureList().mseLivePlayback) return fail("This browser can't play MPEG-TS channels.");
  mpegts = Mpegts.createPlayer({ type: "mpegts", isLive: true, url: command.source }, { enableStashBuffer: false, liveBufferLatencyChasing: true });
  mpegts.on(Mpegts.Events.ERROR, (_type: string, detail: string) => fail(`The channel failed (${detail}).`));
  mpegts.attachMediaElement(video);
  mpegts.load();
  if (!command.paused) void start(video);
};
const reset = () => {
  // With hls.js attached, Chromium keeps drawing a cue whose track is removed while showing.
  for (const track of Array.from(video.textTracks)) track.mode = "disabled";
  playbackId = null;
  loading = null;
  hls?.destroy();
  hls = null;
  mpegts?.destroy();
  mpegts = null;
  ready = false;
  stalled = false;
  failure = null;
  subtitleDelay = 0;
  setBlocked(false);
  for (const track of video.querySelectorAll("track")) track.remove();
  for (const element of [video, audio]) { element.removeAttribute("src"); element.load(); }
  apply();
};
// Subtitle delay moves every cue, including those hls.js adds while it plays.
const shifted = new WeakMap<TextTrackCue, number>();
const shiftCues = () => {
  for (const track of Array.from(video.textTracks)) for (const cue of Array.from(track.cues ?? [])) {
    const offset = subtitleDelay - (shifted.get(cue) ?? 0);
    if (!offset) continue;
    cue.startTime += offset;
    cue.endTime += offset;
    shifted.set(cue, subtitleDelay);
  }
};
const selectSubtitle = (index: number) => {
  const embedded = hls?.subtitleTracks.length ?? 0;
  if (hls) hls.subtitleTrack = index < embedded ? index : -1;
  // Chromium's automatic selection would still show a track whose mode never changed, so each one changes.
  external().forEach((track, position) => { track.mode = "hidden"; track.mode = embedded + position === index ? "showing" : "disabled"; });
};

export function play(command: PlaybackCommand) {
  if ("playbackId" in command && command.type !== "load" && command.playbackId !== playbackId) return;
  switch (command.type) {
    case "load":
      reset();
      playbackId = command.playbackId;
      loading = command;
      apply();
      if (command.mpegts) { void transportStream(command); break; }
      for (const [element, source] of [[video, command.source], [audio, command.audioSource]] as const) {
        if (!source) continue;
        // The app allows googlevideo in CORS mode (app/main.ts); browsers fetch it without CORS.
        element.crossOrigin = window.couchApp && new URL(source).hostname.endsWith(".googlevideo.com") ? "anonymous" : null;
        element.src = source;
      }
      apply();
      for (const subtitle of command.subtitles ?? []) addTrack(subtitle.source, subtitle.title, subtitle.language);
      if (command.subtitleTrack !== undefined) selectSubtitle(command.subtitleTrack);
      subtitleDelay = command.subtitleDelay ?? 0;
      const at = begin(command);
      if (at !== undefined) video.currentTime = at;
      // Attaching hls.js or mpegts.js resets the rate to the default one, so set both.
      video.defaultPlaybackRate = video.playbackRate = command.preferences?.speed ?? 1;
      audioDelay = command.preferences?.audioDelay ?? 0;
      if (!command.paused) void start(video);
      break;
    case "addSubtitle": addTrack(command.source, command.title, command.language, true); break;
    case "pause": if (command.paused) video.pause(); else void start(video); break;
    case "audioPause": video.pause(); break;
    case "seek": video.currentTime = command.position; break;
    case "speed": video.defaultPlaybackRate = video.playbackRate = command.speed; break;
    case "volume": volume = command.volume / 100; apply(); break;
    case "track":
      if (command.kind === "audio" && hls?.audioTracks[command.index]) hls.audioTrack = command.index;
      if (command.kind === "subtitle") selectSubtitle(command.index);
      break;
    case "audioDelay": audioDelay = command.delay; follow(); break;
    case "subtitleDelay": subtitleDelay = command.delay; shiftCues(); break;
    case "stop": reset(); break;
  }
  send();
}

function addTrack(source: string, label: string, language = "", show = false) {
  const track = document.createElement("track");
  Object.assign(track, { kind: "subtitles", src: source, label, srclang: language });
  video.append(track);
  if (show) selectSubtitle((hls?.subtitleTracks.length ?? 0) + external().length - 1);
}

// Reports go to Core while connected. Core listens only to the tab it chose to play.
export function connectRenderer(listener: (state: PlayerState) => void) {
  if (!holder.isConnected) document.body.append(holder);
  report = listener;
  send();
  return () => { report = undefined; reset(); };
}

// Shows the picture inside `parent` (a React 19 ref callback). Moving the element within
// one task keeps it playing.
export function renderInto(parent: HTMLElement | null) {
  if (!parent) return;
  parent.append(video);
  return () => { holder.append(video); };
}

// "Tap to hear" (#644): whether this browser is waiting for a gesture before it plays sound.
export function onBlocked(listener: (blocked: boolean) => void) {
  blockedListeners.add(listener);
  return () => { blockedListeners.delete(listener); };
}
export function hear() {
  setBlocked(false);
  apply();
  void start(video);
  if (split()) void start(audio);
}

// iOS lets a media element play by itself only after a gesture has touched it once.
const unlock = () => { for (const element of [video, audio]) if (!element.hasAttribute("src")) element.load(); };
addEventListener("pointerdown", unlock, { capture: true, once: true });
