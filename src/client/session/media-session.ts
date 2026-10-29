import { useEffect, useEffectEvent } from "react";
import type { Action } from "../../shared/protocol";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { useQuery } from "@tanstack/react-query";
import { radioProgrammesQuery } from "@/api/radio";
import { useRadioClock } from "@/radio-clock";
import { isRadio, freshRadioProgramme, radioNow } from "../../shared/radio";
import { useSessionGate } from "./session-context";
import { usePlaybackClock } from "./playback-clock";
import { livePlayback } from "./playback-controls";
import { liveTitle } from "../../shared/live-input";

const actions = ["play", "pause", "stop", "nexttrack", "seekto", "seekbackward", "seekforward"] as const;

// Media Session feeds the system's media keys and Now Playing (macOS Now
// Playing, Windows media controls, Linux MPRIS) while this page plays media.
export function useMediaSession() {
  const { state, connected, run, credentials } = useSessionGate();
  const clock = usePlaybackClock();
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  // A joined Live Source owns system controls, independently of the ordinary queue.
  const listening = livePlayback(state) && !!state?.controls?.leave;
  const source = listening ? state?.liveSources?.find(source => source.id === state.playbacks?.find(playback => playback.id === state.playback)?.liveSourceId) : undefined;
  const playbackId = player?.playbackId && (listening || current && ["playing", "paused", "loading"].includes(player.status)) ? player.playbackId : null;
  const stationId = current?.source.startsWith("radio:") ? current.source.slice(6) : "";
  const guides = useQuery({ ...radioProgrammesQuery(credentials ?? { origin: "", token: "" }), enabled: connected && !!credentials && !!stationId, refetchInterval: 60_000 });
  const now = useRadioClock(Object.values(guides.data ?? {}), state?.radioProgramme);
  const programme = (state?.radioProgramme?.playbackId === playbackId ? freshRadioProgramme(state?.radioProgramme, now) : null) ?? (stationId && playbackId ? radioNow(guides.data?.[stationId], stationId, now) : null);
  const title = listening ? source ? liveTitle(source) : "Couch Live" : programme?.title ?? player?.nowPlaying?.title ?? current?.title ?? "";
  const artist = listening ? source?.metadata?.description ?? "" : programme?.artist ?? player?.nowPlaying?.artist ?? current?.subtitle ?? "";
  const album = listening ? "" : programme?.album ?? current?.collection?.title ?? "";
  const artwork = listening ? null : programme?.artworkUrl ?? current?.thumbnail ?? null;
  const live = listening || !!current?.live || isRadio(current);
  const position = clock.playbackId === playbackId ? clock.position : 0;
  const duration = live ? null : clock.playbackId === playbackId ? clock.duration ?? current?.duration ?? null : current?.duration ?? null;
  const { transportReady, pausable, seekable, nextReady, hasNext, stoppable } = playbackCapabilities(state, connected);
  // Live can't pause, so Pause leaves too: unhandled, Android's notification pauses the SDK's silent
  // keep-alive element instead, while the sound plays on and Couch still reports Listening.
  const leave = connected && !!playbackId;
  const allowed = listening ? { play: false, pause: leave, stop: leave, nexttrack: false, seekto: false, seekbackward: false, seekforward: false }
    : { play: transportReady && pausable, pause: transportReady && pausable, stop: stoppable, nexttrack: nextReady && hasNext,
    seekto: transportReady && seekable, seekbackward: transportReady && seekable, seekforward: transportReady && seekable };

  const act = useEffectEvent((action: MediaSessionAction, details: MediaSessionActionDetails) => {
    if (!playbackId || !allowed[action as keyof typeof allowed]) return;
    const seek = (to: number) => ({ type: "seek", playbackId, position: Math.max(0, Math.min(duration ?? Infinity, to)) }) satisfies Action;
    const command: Action | null = listening ? { type: "leave", playbackId }
      : action === "play" || action === "pause" ? { type: "pause", playbackId, paused: action === "pause" }
      : action === "stop" ? { type: "stop", playbackId }
      : action === "nexttrack" ? { type: "next", playbackId }
      : action === "seekto" && Number.isFinite(details.seekTime) ? seek(details.seekTime!)
      : action === "seekbackward" ? seek(position - (details.seekOffset ?? 10))
      : action === "seekforward" ? seek(position + (details.seekOffset ?? 10)) : null;
    if (command) void run(command);
  });
  const handlers = actions.map(action => allowed[action]).join();
  useEffect(() => {
    for (const action of actions) navigator.mediaSession?.setActionHandler(action, allowed[action] ? details => act(action, details) : null);
    return () => { for (const action of actions) navigator.mediaSession?.setActionHandler(action, null); };
  }, [handlers]);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.metadata = playbackId ? new MediaMetadata({ title, artist, album, artwork: artwork ? [{ src: artwork }] : [] }) : null;
  }, [playbackId, title, artist, album, artwork]);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.playbackState = !playbackId ? "none" : listening || player?.status === "playing" ? "playing" : "paused";
    if (playbackId && duration && Number.isFinite(duration)) navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: player?.speed || 1 });
    else navigator.mediaSession.setPositionState();
  }, [playbackId, listening, player?.status, player?.speed, position, duration]);
}
