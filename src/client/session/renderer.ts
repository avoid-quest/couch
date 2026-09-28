import type Hls from "hls.js";
import type { PlaybackCommand, PlayerState } from "../../shared/protocol";

// The Full-mode app window plays what its Core sends it (#644 ticket 4); ticket 6
// makes every Device a renderer. YouTube's separate audio stream plays in a second
// element that follows the video. Playlists Chromium can't open itself (e.g.
// StreamingCommunity's) go through hls.js, as #644 ticket 1 measured.
const video = document.createElement("video");
const audio = document.createElement("audio");
video.style.cssText = "width: 100%; height: 100%; object-fit: contain";
const holder = document.createElement("div");
holder.hidden = true;
holder.append(video, audio);

let playbackId: string | null = null;
let loading: Extract<PlaybackCommand, { type: "load" }> | null = null;
let hls: Hls | null = null;
let ready = false;
let stalled = false;
let failure: string | null = null;
let volume = 1;
let report: ((state: PlayerState) => void) | undefined;
let reportedAt = 0;

const split = () => audio.hasAttribute("src");
const waiting = () => stalled && !video.paused;
const state = (): PlayerState => ({
  playbackId,
  status: !playbackId ? "idle" : failure ? "error" : video.ended ? "ended" : !ready || waiting() ? "loading" : video.paused ? "paused" : "playing",
  buffering: waiting(),
  position: video.currentTime,
  duration: Number.isFinite(video.duration) ? video.duration : null,
  volume: Math.round(volume * 100),
  seekable: Number.isFinite(video.duration),
  error: failure,
  speed: video.playbackRate,
});
const send = () => { reportedAt = performance.now(); report?.(state()); };

const follow = (resync = true) => {
  if (!split()) return;
  // Small drift is corrected by playing the audio 5% faster or slower, large drift by seeking.
  const drift = video.currentTime - audio.currentTime;
  if (Math.abs(drift) > (resync ? 0.1 : 0.5)) audio.currentTime = video.currentTime;
  audio.playbackRate = video.playbackRate * (Math.abs(drift) > 0.03 ? 1 + Math.sign(drift) * 0.05 : 1);
  if (video.paused || !ready || waiting()) audio.pause(); else void audio.play().catch(() => {});
};
const fail = (element: HTMLMediaElement) => {
  if (!playbackId || !element.error) return;
  failure = element.error.message || "This media couldn't play here.";
  send();
};
for (const event of ["loadedmetadata", "durationchange", "pause", "playing", "waiting", "seeked", "ended", "ratechange"]) {
  video.addEventListener(event, () => {
    if (event === "waiting" || event === "playing") stalled = event === "waiting";
    if (event !== "durationchange") follow(event !== "ratechange");
    send();
  });
}
video.addEventListener("canplay", () => { ready = true; send(); });
video.addEventListener("timeupdate", () => { follow(false); if (performance.now() - reportedAt > 1000) send(); });
video.addEventListener("error", () => {
  if (video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && loading && !hls) void playlist(loading);
  else fail(video);
});
audio.addEventListener("error", () => fail(audio));

const apply = () => {
  video.muted = split();
  video.volume = audio.volume = volume;
};
const playlist = async (command: NonNullable<typeof loading>) => {
  const { default: Hls } = await import("hls.js");
  if (command !== loading || !Hls.isSupported()) return fail(video);
  hls = new Hls({ startPosition: command.startPosition ?? -1 });
  hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) { failure = `The stream failed (${data.details}).`; send(); } });
  hls.loadSource(command.source);
  hls.attachMedia(video);
  if (!command.paused) void video.play().catch(() => {});
};
const reset = () => {
  playbackId = null;
  loading = null;
  hls?.destroy();
  hls = null;
  ready = false;
  stalled = false;
  failure = null;
  for (const element of [video, audio]) { element.removeAttribute("src"); element.load(); }
  apply();
};

export function play(command: PlaybackCommand) {
  if ("playbackId" in command && command.type !== "load" && command.playbackId !== playbackId) return;
  switch (command.type) {
    case "load":
      reset();
      playbackId = command.playbackId;
      loading = command;
      // The app allows googlevideo in CORS mode (app/main.ts).
      for (const [element, source] of [[video, command.source], [audio, command.audioSource]] as const) {
        if (!source) continue;
        element.crossOrigin = new URL(source).hostname.endsWith(".googlevideo.com") ? "anonymous" : null;
        element.src = source;
      }
      apply();
      if (command.startPosition) video.currentTime = command.startPosition;
      if (command.preferences?.speed) video.playbackRate = command.preferences.speed;
      if (!command.paused) void video.play().catch(() => {});
      break;
    case "pause": if (command.paused) video.pause(); else void video.play().catch(() => {}); break;
    case "audioPause": video.pause(); break;
    case "seek": video.currentTime = command.position; break;
    case "speed": video.playbackRate = command.speed; break;
    case "volume": volume = command.volume / 100; apply(); break;
    case "stop": reset(); break;
    // Tracks, delays, subtitles and gapless preparation arrive with ticket 6.
  }
  send();
}

// Reports go to Core while connected; a lost connection stops playback, because Core forgets it.
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
