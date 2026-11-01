import type Hls from "hls.js";
import type Mpegts from "mpegts.js";
import type { Follow, MediaTrack, PlaybackCommand, PlayerState } from "../../shared/protocol";
import { soundClock } from "./sendspin";
import { localDeviceName } from "./device-id";
import { bufferedEnd, setBuffered } from "./buffered";
import { createCompressor } from "./compressor";
import { setPictureMapping } from "./picture-mapping";
import type { CompressorSettings } from "../../shared/compressor";

// Every Device plays what its Core sends it (#644 ticket 6): the Device fetches the source
// itself. URLs play in <video>; YouTube's separate audio in an <audio> that follows the
// video; Couch-hosted HLS through hls.js where supported, with native HLS as the fallback;
// cross-origin HLS stays native first because its segments may not allow CORS;
// raw MPEG-TS through mpegts.js (#644 ticket 1). A picture of a synced Playback plays muted and
// follows the Sendspin clock instead of Core's transport commands (ticket 11).
const createVideo = () => {
  const element = document.createElement("video");
  element.playsInline = true;
  element.style.cssText = "width: 100%; height: 100%; object-fit: contain";
  return element;
};
let video = createVideo();
let audio = document.createElement("audio");
let processing: { context: AudioContext; graph: ReturnType<typeof createCompressor>; source: MediaElementAudioSourceNode } | null = null;
const holder = document.createElement("div");
holder.hidden = true;
holder.append(video, audio);

let playbackId: string | null = null;
let generation = 0;
let decoderGeneration = 0;
let followGeneration = 0;
let loading: Extract<PlaybackCommand, { type: "load" }> | null = null;
let mediaStream: MediaStream | null = null;
let hls: Hls | null = null;
let mpegts: Mpegts.Player | null = null;
let engine: "native" | "hls-pending" | "hls" | "mpegts" = "native";
let ready = false;
let stalled = false;
let failure: string | null = null;
let volume = 1;
let audioDelay = 0;
let subtitleDelay = 0;
let blocked = false;
let following: Follow | null = null;
let unfollow: (() => void) | null = null;
// Where the source's timestamps start on this video's timeline (hls.js), to map a live clock.
let ptsOffset: number | undefined;
let report: ((state: PlayerState) => void) | undefined;
let reportedAt = 0;
let reported = "";
const blockedListeners = new Set<(blocked: boolean) => void>();

// Chromium plays YouTube's VP9 (#644 ticket 1); other engines get H.264.
export const playsVp9 = /Chrome\//.test(navigator.userAgent) && video.canPlayType('video/webm; codecs="vp9"') === "probably";

const split = () => audio.hasAttribute("src");
const waiting = () => stalled && !video.paused;
const external = () => Array.from(video.textTracks).filter(track => track.kind === "subtitles" && !hls?.subtitleTracks.some(item => item.name === track.label && item.lang === track.language));
const matchesLanguage = (language = "", wanted = "") => !!wanted && language.toLowerCase().startsWith(wanted.toLowerCase().slice(0, 2));
const preferredSubtitle = (command: NonNullable<typeof loading>) => command.subtitleTrack ?? (command.preferences?.subtitles === "off" ? -1
  : [...(hls?.subtitleTracks.map(track => track.lang) ?? []), ...external().map(track => track.language)].findIndex(language => matchesLanguage(language, command.preferences?.subtitleLanguage)));
const tracks = (): MediaTrack[] => {
  if (!playbackId || !ready) return [];
  const captured = mediaStream?.getTracks().map((track, index): MediaTrack => ({ id: track.id || `${track.kind}-${index}`, index, kind: track.kind as "audio" | "video", label: track.label || (track.kind === "audio" ? "Audio" : "Video"), language: "", selected: true }));
  const picture: MediaTrack[] = video.videoWidth && loading?.output?.picture !== false ? [{ id: "video", index: 0, kind: "video", label: "Video", language: "", selected: true }] : [];
  const sound: MediaTrack[] = loading?.output?.sound === false || following ? [] : hls?.audioTracks.length ? hls.audioTracks.map((track, index) => ({ id: `audio-${index}`, index, kind: "audio", label: track.name, language: track.lang ?? "", selected: index === hls!.audioTrack }))
    : [{ id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }];
  const embedded = hls?.subtitleTracks ?? [];
  const subtitles: MediaTrack[] = [
    ...embedded.map((track, index): MediaTrack => ({ id: `subtitle-${index}`, index, kind: "subtitle", label: track.name, language: track.lang ?? "", selected: index === hls!.subtitleTrack })),
    ...external().map((track, index): MediaTrack => ({ id: `external-${index}`, index: embedded.length + index, kind: "subtitle", label: track.label, language: track.language, selected: track.mode === "showing" })),
  ];
  return [...(captured ?? [...picture, ...sound]), ...subtitles];
};
const state = (): PlayerState => ({
  playbackId,
  status: !playbackId ? "idle" : failure ? "error" : video.ended ? "ended" : !ready || waiting() ? "loading" : video.paused ? "paused" : "playing",
  buffering: waiting(),
  position: video.currentTime,
  duration: Number.isFinite(video.duration) && !loading?.radio && !mpegts && !mediaStream ? video.duration : null,
  volume: Math.round(volume * 100),
  seekable: Number.isFinite(video.duration) && !mpegts && !mediaStream,
  error: failure,
  // Clock corrections are renderer work, never a new programme speed.
  speed: mediaStream ? 1 : video.defaultPlaybackRate,
  tracks: tracks(),
  // Content delay is implemented by the separate audio element only.
  audioDelay: split() && !following && !mediaStream ? audioDelay : undefined,
  subtitleDelay,
  ...following ? { timeline: !canMapClock() ? { mapping: "unavailable" as const, error: "This browser cannot align this picture with the shared sound. Try another browser or device." }
    : sourcePts() && ptsOffset === undefined ? undefined : { mapping: sourcePts() ? "hls" as const : "media" as const } } : {},
});
const send = (positionChanged = false) => {
  if (!report) return;
  const current = state(), next = JSON.stringify({ ...current, position: undefined });
  // Chromium queues each subtitle mode change. Position alone reports on ticks and seeks.
  if (next === reported && !positionChanged) return;
  reported = next;
  reportedAt = performance.now();
  report(current);
};
// Synced sound's player waits for a tap too (#644 ticket 10); this unlocks it.
let unlockSound: (() => void) | null = null;
const notify = () => { for (const listener of blockedListeners) listener(blocked || !!unlockSound); };
const setBlocked = (value: boolean) => {
  if (blocked === value) return;
  blocked = value;
  notify();
};
export function waitForTap(unlock: (() => void) | null) {
  unlockSound = unlock;
  notify();
}
// A browser that wants a gesture before sound plays the picture muted and asks for a tap.
const start = (element: HTMLMediaElement) => {
  const current = generation;
  resumeCompression();
  return element.play().catch((error: unknown) => {
    if (generation !== current || !(error instanceof DOMException) || error.name !== "NotAllowedError" || !playbackId) return;
    setBlocked(true);
    if (element === video && !video.muted) { video.muted = true; void video.play().catch(() => {}); }
  });
};

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
// Every window shows the error, so it names this Device.
const unsupported = () => fail(`${localDeviceName() ?? "This device"} can't play this format. Play it on another device.`);
// SRC_NOT_SUPPORTED also covers HTTP/DNS failures before any media was read.
const unavailable = "This media couldn't load. The source may be unavailable or unsupported.";
const sourceFailed = () => fail(video.error?.message || unavailable);
// Pass-through says whether a source is HLS; without it, the path does.
const isPlaylist = (command: NonNullable<typeof loading>) => !!command.hls || /\.m3u8$/i.test(new URL(command.source, location.href).pathname);
// The timeline's loaded segment, only for media that seeks: not a capture, raw MPEG-TS or a live stream.
const buffered = () => { const end = playbackId && Number.isFinite(video.duration) && !mpegts && !mediaStream ? bufferedEnd(video.buffered, video.currentTime) : null; setBuffered(end === null ? null : { playbackId: playbackId!, end }); };
let mediaEvents = new AbortController();
const observeElements = () => {
  const on = (element: EventTarget, event: string, listener: () => void) => element.addEventListener(event, listener, { signal: mediaEvents.signal });
  for (const event of ["loadedmetadata", "durationchange", "pause", "playing", "waiting", "seeked", "ended", "ratechange", "resize"]) {
    on(video, event, () => {
      // Following the clock nudges the rate many times a second; Core doesn't need to hear each one.
      if (event === "ratechange" && following) return;
      if (event === "waiting" || event === "playing") stalled = event === "waiting";
      if (event === "pause" || event === "ended") suspendCompression();
      else if (event === "playing") resumeCompression();
      if (event !== "durationchange" && event !== "resize") follow(event !== "ratechange");
      send(event === "seeked");
    });
  }
  on(video, "canplay", () => { ready = true; send(); });
  for (const event of ["progress", "timeupdate", "seeking", "seeked", "emptied"]) on(video, event, buffered);
  on(video, "timeupdate", () => { follow(false); shiftCues(); if (performance.now() - reportedAt > 1000) send(true); });
  on(video, "error", () => {
    if (video.error?.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || !loading || hls || mpegts) fail(video.error?.message || "This media couldn't play here.");
    else if (isPlaylist(loading)) void playlist(loading, false);
    else sourceFailed();
  });
  on(audio, "error", () => fail(audio.error?.message || "This media couldn't play here."));
  on(video.textTracks, "change", () => send());
};
observeElements();

// iOS ignores a media element's volume (it always reads 1), so there 0 mutes it.
const fixedVolume = (() => { video.volume = 0.5; const fixed = video.volume !== 0.5; video.volume = 1; return fixed; })();
const apply = () => {
  const silent = fixedVolume && volume === 0;
  video.muted = split() || blocked || !!following || loading?.output?.sound === false || silent;
  audio.muted = blocked || !!following || loading?.output?.sound === false || silent;
  video.volume = audio.volume = processing ? 1 : volume;
  processing?.graph.volume(blocked || following ? 0 : volume);
};
// Creating a graph is opt-in; disabled playback retains the ordinary decoder/output path.
const resumeCompression = () => {
  const current = processing;
  if (!current || following || current.context.state === "running") return;
  void current.context.resume().then(() => {
    if (processing !== current) return;
    setBlocked(false); apply(); follow();
  }, () => { if (processing === current) setBlocked(true); });
  setTimeout(() => { if (processing === current && current.context.state === "suspended" && !following && !video.paused) setBlocked(true); }, 500);
};
const suspendCompression = () => {
  const current = processing;
  if (!current) return;
  void current.context.suspend().then(() => {
    // Resume can arrive before suspension finishes.
    if (processing === current && !following && !video.paused && !video.ended) resumeCompression();
  }, () => {});
};
const prepareCompression = (settings: CompressorSettings) => {
  if (mediaStream || loading?.liveSourceId || following) return;
  if (!processing && settings.enabled) {
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      const graph = createCompressor(context, settings);
      const source = context.createMediaElementSource(split() ? audio : video);
      source.connect(graph.input); graph.output.connect(context.destination);
      processing = { context, graph, source };
    } catch { void context?.close().catch(() => {}); fail("This browser couldn't start the compressor. Turn it off and try again."); return; }
  }
  processing?.graph.set(settings);
  if (!video.paused) resumeCompression();
  else if (ready || loading?.paused) suspendCompression();
};
// Source timestamps need a real mapping. Native HLS and MPEG-TS do not expose one;
// an offset guessed from when the receiver joined would misrepresent synchronization.
const clock = () => {
  const sample = following && soundClock(following.group);
  if (!sample || !following) return null;
  if (!canMapClock()) return { speed: sample.speed };
  if (!sourcePts()) return sample;
  return ptsOffset === undefined ? null : { ...sample, position: sample.position - ptsOffset };
};
const setFollow = (follow: Follow | null) => {
  followGeneration++;
  unfollow?.();
  unfollow = null;
  // The measured offset belongs to the loaded stream: keep it when a Direct picture starts following its own group.
  if (follow?.timeline && follow.timeline.generation !== playbackId) ptsOffset = undefined;
  following = follow;
  if (follow) suspendCompression();
  else if (loading?.compressor) prepareCompression(loading.compressor);
  apply();
  if (!follow) { video.playbackRate = video.defaultPlaybackRate; return; }
  const current = generation, revision = ++followGeneration;
  void import("./picture-clock").then(({ followClock }) => {
    if (following === follow && generation === current && revision === followGeneration) unfollow = followClock(video, clock, () => { void start(video); });
  });
};
// Only hls.js tells where the source's timestamps start; engines without MSE keep native HLS.
const mapsTimestamps = (command: NonNullable<typeof loading>) => (command.follow?.timeline?.kind === "source-pts" || !!command.follow?.pts) && !command.mpegts && ("MediaSource" in window || "ManagedMediaSource" in window);
const sourcePts = () => (following?.timeline?.kind ?? (following?.pts ? "source-pts" : "position")) === "source-pts";
// Pending hls.js support is distinct from an actually selected native fallback.
const canMapClock = () => !following || following.timeline?.mapping !== "unavailable" && engine !== "mpegts"
  && (!sourcePts() || engine === "hls-pending" || engine === "hls");
const updateMapping = () => setPictureMapping(playbackId && following ? { playbackId, unavailable: !canMapClock() } : null);
// An HLS EVENT playlist starts at its first segment; hls.js would start it at the live edge.
const begin = (command: NonNullable<typeof loading>) => command.startPosition ?? (command.eventStart ? 0 : undefined);
// Prefer the same HLS engine and live timeline even when a browser also advertises native HLS.
const playlist = async (command: NonNullable<typeof loading>, nativeFallback = true) => {
  const current = generation, attempt = ++decoderGeneration;
  engine = "hls-pending";
  try {
  const { default: Hls } = await import("hls.js");
  if (command !== loading || current !== generation || attempt !== decoderGeneration) return;
  if (!Hls.isSupported()) {
    if (!nativeFallback) return sourceFailed();
    if (!video.canPlayType("application/vnd.apple.mpegurl")) return unsupported();
    engine = "native";
    ptsOffset = undefined;
    updateMapping();
    video.src = command.source;
    const at = begin(command);
    if (at !== undefined) video.currentTime = at;
    if (!command.paused && !following) void start(video);
    send();
    return;
  }
  engine = "hls";
  updateMapping();
  // A sliding live window is not a finite, zero-based movie timeline.
  const decoder = hls = new Hls({ startPosition: begin(command) ?? -1, liveDurationInfinity: true, enableCEA708Captions: !command.subtitles?.length,
    ...following ? { maxLiveSyncPlaybackRate: 1 } : {} });
  const active = () => current === generation && attempt === decoderGeneration && hls === decoder;
  const codecs: string[] = [Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR, Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR, Hls.ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR];
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!active() || !data.fatal) return;
    const status = data.response?.code ?? 0;
    if (codecs.includes(data.details)) unsupported();
    else if (status >= 400) fail(`The media server refused this stream (HTTP ${status}).`);
    // A cross-origin refusal without CORS headers hides its status from the page.
    else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) fail(unavailable);
    else fail(`The stream failed (${data.details}).`);
  });
  hls.on(Hls.Events.INIT_PTS_FOUND, (_event, data) => {
    if (active() && data.id === "main" && Number.isFinite(data.initPTS) && data.timescale > 0) { ptsOffset = data.initPTS / data.timescale; updateMapping(); send(); }
  });
  for (const event of [Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED, Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH]) hls.on(event, () => { if (active()) send(); });
  // Tracks follow the profile's language preferences.
  const { audioLanguage = "" } = command.preferences ?? {};
  // Tracks chosen on another Device come with the item (#644 ticket 9). hls.js lists a
  // level's audio and subtitle tracks only once it starts loading that level.
  hls.once(Hls.Events.LEVEL_LOADED, () => {
    if (!active()) return;
    const audioTrack = command.audioTrack ?? decoder.audioTracks.findIndex(track => matchesLanguage(track.lang, audioLanguage));
    if (audioTrack >= 0 && audioTrack < decoder.audioTracks.length) decoder.audioTrack = audioTrack;
    selectSubtitle(preferredSubtitle(command));
  });
  hls.subtitleTrack = -1;
  hls.loadSource(command.source);
  hls.attachMedia(video);
  if (!command.paused && !following) void start(video);
  } catch (error) { if (current === generation && attempt === decoderGeneration) fail(error instanceof Error ? error.message : "This stream could not start. Try another device."); }
};
const transportStream = async (command: NonNullable<typeof loading>) => {
  const current = generation, attempt = ++decoderGeneration;
  engine = "mpegts";
  try {
  const { default: Mpegts } = await import("mpegts.js");
  if (command !== loading || current !== generation || attempt !== decoderGeneration) return;
  if (!Mpegts.getFeatureList().mseLivePlayback) return fail("This browser can't play MPEG-TS channels.");
  const decoder = mpegts = Mpegts.createPlayer({ type: "mpegts", isLive: true, url: command.source }, { enableStashBuffer: false, liveBufferLatencyChasing: !following });
  mpegts.on(Mpegts.Events.ERROR, (type: string, detail: string) => { if (current !== generation || attempt !== decoderGeneration || mpegts !== decoder) return; if (type === Mpegts.ErrorTypes.MEDIA_ERROR) unsupported(); else fail(`The channel failed (${detail}).`); });
  mpegts.attachMediaElement(video);
  mpegts.load();
  if (!command.paused && !following) void start(video);
  } catch (error) { if (current === generation && attempt === decoderGeneration) fail(error instanceof Error ? error.message : "This channel could not start. Try another device."); }
};
const reset = () => {
  generation++;
  decoderGeneration++;
  // With hls.js attached, Chromium keeps drawing a cue whose track is removed while showing.
  for (const track of Array.from(video.textTracks)) track.mode = "disabled";
  playbackId = null;
  loading = null;
  mediaStream = null;
  setFollow(null);
  ptsOffset = undefined;
  hls?.destroy();
  hls = null;
  mpegts?.destroy();
  mpegts = null;
  engine = "native";
  ready = false;
  stalled = false;
  failure = null;
  subtitleDelay = 0;
  audioDelay = 0;
  setBuffered(null);
  setPictureMapping(null);
  setBlocked(false);
  if (processing) mediaEvents.abort();
  for (const track of video.querySelectorAll("track")) track.remove();
  for (const element of [video, audio]) { element.pause(); element.srcObject = null; element.removeAttribute("src"); element.crossOrigin = null; element.load(); }
  if (processing) {
    processing.source.disconnect();
    processing.graph.close();
    void processing.context.close().catch(() => {});
    processing = null;
    // A media-element source cannot be detached back to native output. Replace the elements so
    // the next Direct load, especially WebRTC, has no Web Audio graph or CORS requirement.
    const nextVideo = createVideo(), nextAudio = document.createElement("audio");
    video.replaceWith(nextVideo); audio.replaceWith(nextAudio);
    video = nextVideo; audio = nextAudio;
    mediaEvents = new AbortController();
    observeElements();
  }
  apply();
};

// Direct capture uses the same element, controls and PlayerState as URL playback.
// The session owns the tracks; replacing this renderer must not stop its capture.
export function attachStream(command: Extract<PlaybackCommand, { type: "load" }>, stream: MediaStream) {
  reset();
  playbackId = command.playbackId;
  loading = { ...command, output: command.output ?? command.liveOutput };
  mediaStream = stream;
  volume = (command.liveOutput?.volume ?? volume * 100) / 100;
  video.defaultPlaybackRate = video.playbackRate = 1;
  video.srcObject = stream;
  for (const subtitle of command.subtitles ?? []) addTrack(subtitle.source, subtitle.title, subtitle.language);
  selectSubtitle(preferredSubtitle(command));
  subtitleDelay = command.subtitleDelay ?? 0;
  apply();
  if (!command.paused) void start(video);
  send();
}

export function streamChanged(id: string, stream: MediaStream, error?: string) {
  if (playbackId !== id || mediaStream !== stream) return;
  if (error) { fail(error); return; }
  // Chromium never plays tracks added to a stream it was given empty: bind it again with them.
  const playing = !video.paused;
  video.srcObject = stream;
  if (playing) void start(video);
  send();
}

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
  // A file loads once it's chosen: a source can list many, and YouTube refuses a burst of them (429).
  for (const element of video.querySelectorAll("track")) if (element.track.mode === "showing" && !element.src) element.src = element.dataset.src!;
};

export function play(command: PlaybackCommand) {
  if ("playbackId" in command && command.type !== "load" && command.playbackId !== playbackId) return;
  switch (command.type) {
    case "load":
      reset();
      playbackId = command.playbackId;
      if (command.output && !command.output.picture && !command.output.sound) break;
      // The primary element can render audio. Selecting the separate rendition here
      // avoids even opening the video's URL for sound-only playback.
      command = { ...command,
        ...command.output?.picture === false && command.output.sound && command.audioSource ? { source: command.audioSource, audioSource: undefined, hls: /\.m3u8(?:\?|$)/i.test(command.audioSource), mpegts: false } : {},
        ...command.follow || command.output?.sound === false ? { audioSource: undefined } : {},
      };
      loading = command;
      if (command.follow) setFollow(command.follow);
      apply();
      // hls.js attaches once it has loaded; the subtitles, delays and speed below apply to it too.
      const useHls = !command.mpegts && (mapsTimestamps(command) || isPlaylist(command) && new URL(command.source, location.href).origin === location.origin);
      if (useHls) void playlist(command);
      if (command.mpegts) void transportStream(command);
      for (const [element, source] of [[video, command.source], [audio, command.audioSource]] as const) {
        if (!source) continue;
        // The app allows googlevideo in CORS mode (app/main.ts); browsers fetch it without CORS.
        element.crossOrigin = command.compressor?.enabled && !command.liveSourceId || window.couchApp && new URL(source).hostname.endsWith(".googlevideo.com") ? "anonymous" : null;
        if (element !== video || !useHls && !command.mpegts) element.src = source;
      }
      if (command.compressor && !command.follow && !command.liveSourceId) prepareCompression(command.compressor);
      apply();
      for (const subtitle of command.subtitles ?? []) addTrack(subtitle.source, subtitle.title, subtitle.language);
      selectSubtitle(preferredSubtitle(command));
      subtitleDelay = command.subtitleDelay ?? 0;
      const at = begin(command);
      if (at !== undefined) video.currentTime = at;
      // Attaching hls.js or mpegts.js resets the rate to the default one, so set both.
      video.defaultPlaybackRate = video.playbackRate = command.preferences?.speed ?? 1;
      audioDelay = command.preferences?.audioDelay ?? 0;
      updateMapping();
      if (!useHls && !command.mpegts && !command.paused && !following) void start(video);
      break;
    case "follow":
      if (loading && command.compressor) loading.compressor = command.compressor;
      setFollow(command.follow);
      // Scheduled audio owns all sound while this element follows picture.
      if (command.follow) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
      // A live clock needs hls.js's timestamps; a picture playing natively switches to it.
      if (loading && !hls && !mpegts && mapsTimestamps({ ...loading, follow: command.follow ?? undefined })) {
        for (const element of [video, audio]) { element.removeAttribute("src"); element.load(); }
        ready = false;
        void playlist(loading);
      }
      updateMapping();
      break;
    case "compressor":
      if (!mediaStream && loading && !loading.liveSourceId) {
        loading.compressor = command.settings;
        prepareCompression(command.settings);
        apply();
      }
      break;
    case "addSubtitle": addTrack(command.source, command.title, command.language, true); break;
    case "pause": if (command.paused) video.pause(); else void start(video); break;
    case "audioPause": video.pause(); break;
    case "seek": if (!mediaStream) video.currentTime = command.position; break;
    case "speed": if (!mediaStream) video.defaultPlaybackRate = video.playbackRate = command.speed; break;
    case "volume": volume = command.volume / 100; apply(); break;
    case "track":
      if (command.kind === "audio" && hls?.audioTracks[command.index]) hls.audioTrack = command.index;
      if (command.kind === "subtitle") selectSubtitle(command.index);
      break;
    case "audioDelay": audioDelay = command.delay; follow(); break;
    case "subtitleDelay": subtitleDelay = command.delay; shiftCues(); break;
    case "stop": reset(); break;
  }
  send(command.type === "seek");
}

function addTrack(source: string, label: string, language = "", show = false) {
  const track = document.createElement("track");
  Object.assign(track, { kind: "subtitles", label, srclang: language });
  track.dataset.src = source;
  video.append(track);
  if (show) selectSubtitle((hls?.subtitleTracks.length ?? 0) + external().length - 1);
}

// Reports go to Core while connected. Core listens only to the tab it chose to play.
export function connectRenderer(listener: (state: PlayerState) => void) {
  if (!holder.isConnected) document.body.append(holder);
  report = listener;
  reported = "";
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
  listener(blocked || !!unlockSound);
  return () => { blockedListeners.delete(listener); };
}
export function hear() {
  resumeCompression();
  unlockSound?.();
  unlockSound = null;
  setBlocked(false);
  notify();
  apply();
  void start(video);
  if (split()) void start(audio);
}

// iOS lets a media element play by itself only after a gesture has touched it once.
const unlock = () => { for (const element of [video, audio]) if (!element.hasAttribute("src") && !element.srcObject) element.load(); };
addEventListener("pointerdown", unlock, { capture: true, once: true });
