import { useContext, useEffect, useEffectEvent } from "react";
import type { Action } from "../../shared/protocol";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { useRadioClock } from "@/radio-clock";
import { isRadio, freshRadioProgramme } from "../../shared/radio";
import { useSessionGate } from "./session-context";
import { PlaybackClockContext, positionAt } from "./playback-clock";
import { livePlayback } from "./playback-controls";
import { liveTitle } from "../../shared/live-input";
import { deviceId } from "./device-id";
import { couchApp } from "./native-context";

const actions = [
  "play",
  "pause",
  "stop",
  "nexttrack",
  "seekto",
  "seekbackward",
  "seekforward",
] as const;

// Chromium shows a page in the system's Now Playing (macOS Now Playing, Windows media controls, Linux MPRIS), and
// sends it the media keys, only while one of its media elements holds sound. Synced sound and Live play through Web
// Audio, which leaves Now Playing as soon as it pauses, and a device that only controls plays nothing, so a silent
// element holds the page's place and follows Play and Pause.
const silentWav = () => {
  // 16-bit mono at 8 kHz for 10 s: Chromium takes a sound of 5 s or less as a short effect, not as media.
  const rate = 8000,
    bytes = rate * 2 * 10;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(at + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  return URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
};
let silence: HTMLAudioElement | undefined;
let silentSource: string | undefined;
const holdNowPlaying = (hold: "playing" | "paused" | null) => {
  if (typeof Audio === "undefined") return;
  if (!hold) {
    // Without a source the element leaves the page's media, and Now Playing with it.
    if (silence?.src) {
      silence.pause();
      silence.removeAttribute("src");
      silence.load();
    }
    return;
  }
  // At volume 0, unmuted, Chromium still counts the element as media for Now Playing but opens no audio stream, so
  // the computer can still sleep while a controller window holds it.
  silence ??= Object.assign(new Audio(), { loop: true, volume: 0 });
  silence.src ||= silentSource ??= silentWav();
  if (hold === "playing") void silence.play().catch(() => {});
  else silence.pause();
};

// Media Session feeds the system's media keys and Now Playing with the Playback this page plays or, in the desktop
// app, controls.
export function useMediaSession() {
  const { state, connected, run } = useSessionGate();
  // Core's anchor, not a position that ticks: the browser moves the position on at its rate itself, so
  // it's set again only when the anchor changes. Set every second, it made Android update its media
  // notification every second; on the rig a phone in a relaxed group lost sound once a second then.
  const clock = useContext(PlaybackClockContext);
  const player = state?.player;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  // A joined Live Source owns system controls, independently of the ordinary queue.
  const listening = livePlayback(state) && !!state?.controls?.leave;
  const source = listening
    ? state?.liveSources?.find(
        (source) =>
          source.id ===
          state.playbacks?.find((playback) => playback.id === state.playback)?.liveSourceId,
      )
    : undefined;
  // Disconnected, Couch can't run a command or know what plays, so Now Playing lets go until it reconnects.
  const playbackId =
    connected &&
    player?.playbackId &&
    (listening || (current && ["playing", "paused", "loading"].includes(player.status)))
      ? player.playbackId
      : null;
  // Core sends the station's or channel's programme, from its guide, with the Playback.
  const now = useRadioClock([], state?.radioProgramme);
  const programme =
    state?.radioProgramme?.playbackId === playbackId
      ? freshRadioProgramme(state?.radioProgramme, now)
      : null;
  const title = listening
    ? source
      ? liveTitle(source)
      : "Couch Live"
    : (programme?.title ?? player?.nowPlaying?.title ?? current?.title ?? "");
  const artist = listening
    ? (source?.metadata?.description ?? "")
    : (programme?.artist ??
      player?.nowPlaying?.artist ??
      current?.subtitle ??
      current?.creator?.title ??
      "");
  const station = current?.station?.name;
  // A station's show or song names the station as its album; an episode names its series.
  const album = listening
    ? ""
    : (programme?.album ??
      (station && station !== title
        ? station
        : (current?.collection?.parent?.title ?? current?.collection?.title ?? "")));
  const artwork = listening ? null : (programme?.artworkUrl ?? current?.thumbnail ?? null);
  const live = listening || !!current?.endless || isRadio(current);
  const duration = live
    ? null
    : clock.playbackId === playbackId
      ? (clock.duration ?? current?.duration ?? null)
      : (current?.duration ?? null);
  const { playing, transportReady, pausable, seekable, nextReady, hasNext, stoppable } =
    playbackCapabilities(state, connected);
  // Unhandled, Play, Pause and Stop would pause or play this page's elements behind Core's back (on Android the SDK's
  // silent keep-alive element) while the sound plays on, so those a Live listener or a station can't use do nothing.
  const inert = playbackId
    ? new Set<MediaSessionAction>(["play", "pause", "stop"])
    : new Set<MediaSessionAction>();
  const allowed = listening
    ? {
        play: false,
        pause: false,
        stop: false,
        nexttrack: false,
        seekto: false,
        seekbackward: false,
        seekforward: false,
      }
    : {
        play: transportReady && pausable,
        pause: transportReady && pausable,
        stop: stoppable,
        nexttrack: nextReady && hasNext,
        seekto: transportReady && seekable,
        seekbackward: transportReady && seekable,
        seekforward: transportReady && seekable,
      };

  const act = useEffectEvent((action: MediaSessionAction, details: MediaSessionActionDetails) => {
    if (!playbackId || !allowed[action as keyof typeof allowed]) return;
    const seek = (to: number) =>
      ({
        type: "seek",
        playbackId,
        position: Math.max(0, Math.min(duration ?? Infinity, to)),
      }) satisfies Action;
    const command: Action | null =
      action === "play" || action === "pause"
        ? { type: "pause", playbackId, paused: action === "pause" }
        : action === "stop"
          ? { type: "stop", playbackId }
          : action === "nexttrack"
            ? { type: "next", playbackId }
            : action === "seekto" && Number.isFinite(details.seekTime)
              ? seek(details.seekTime!)
              : action === "seekbackward" || action === "seekforward"
                ? {
                    type: "seek",
                    playbackId,
                    position: (action === "seekbackward" ? -1 : 1) * (details.seekOffset ?? 10),
                    relative: true,
                  }
                : null;
    if (command) void run(command);
  });
  const handlers = actions
    .map((action) => allowed[action] || (inert.has(action) && "inert"))
    .join();
  // This device plays the Playback, or it is the desktop app: one person's computer, where Now Playing and the media
  // keys follow the Playback its window controls wherever it plays. A phone or a browser tab that only controls doesn't
  // claim them: on a phone that takes the system's audio from the person's own music.
  const here =
    listening ||
    !!state?.outputs?.some(
      (output) => output.deviceId === deviceId() && (output.picture || output.sound),
    );
  const hold = !playbackId
    ? null
    : !here && (!couchApp || couchApp.tvPresentation)
      ? null
      : listening || playing
        ? "playing"
        : "paused";
  useEffect(() => holdNowPlaying(hold), [hold]);
  useEffect(() => () => holdNowPlaying(null), []);
  useEffect(() => {
    for (const action of actions)
      navigator.mediaSession?.setActionHandler(
        action,
        allowed[action] ? (details) => act(action, details) : inert.has(action) ? () => {} : null,
      );
    return () => {
      for (const action of actions) navigator.mediaSession?.setActionHandler(action, null);
    };
  }, [handlers]);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.metadata = playbackId
      ? new MediaMetadata({ title, artist, album, artwork: artwork ? [{ src: artwork }] : [] })
      : null;
  }, [playbackId, title, artist, album, artwork]);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.playbackState = !playbackId
      ? "none"
      : listening || playing
        ? "playing"
        : "paused";
    if (playbackId && duration && Number.isFinite(duration))
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(clock.playbackId === playbackId ? positionAt(clock) : 0, duration),
        playbackRate: player?.speed || 1,
      });
    // A station or a share has no position. Zero length is what Chromium tells the system when it knows none; with
    // none from the page, it would show the silent element's 10 s.
    else if (playbackId) navigator.mediaSession.setPositionState({ duration: 0, position: 0 });
    else navigator.mediaSession.setPositionState();
  }, [
    playbackId,
    listening,
    playing,
    player?.speed,
    clock.playbackId,
    clock.position,
    clock.at,
    clock.rate,
    duration,
  ]);
}
