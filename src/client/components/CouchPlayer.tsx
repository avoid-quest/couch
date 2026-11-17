import {
  bufferFeature,
  createPlayer,
  liveFeature,
  playbackFeature,
  playbackRateFeature,
  streamTypeFeature,
  textTrackFeature,
  timeFeature,
  useMediaAttach,
  volumeFeature,
} from "@videojs/react";
import { useContext, useLayoutEffect, useState, type ReactNode } from "react";
import type { Action } from "../../shared/protocol";
import { playbackSpeeds } from "../../shared/playback-default";
import { isRadio } from "../../shared/radio";
import { CouchMedia, type CouchMediaSource } from "@/session/couch-media";
import { PlaybackClockContext, type PlaybackClock } from "@/session/playback-clock";
import { localMedia, useBufferedEnd } from "@/session/buffered";
import { livePlayback, playbackControls } from "@/session/playback-controls";
import type { ClientSessionState } from "@/session/session";
import { muted } from "./PlaybackTransport";

const { Player } = createPlayer({
  features: [
    playbackFeature,
    playbackRateFeature,
    volumeFeature,
    timeFeature,
    bufferFeature,
    textTrackFeature,
    streamTypeFeature,
    liveFeature,
  ],
});

type Props = {
  state: ClientSessionState | null;
  run: (action: Action) => Promise<boolean>;
};

/** Video.js's player around Couch's controls: its controls drive one CouchMedia, which sends every action to Core. */
export function CouchPlayer({ children, ...props }: Props & { children: ReactNode }) {
  return (
    <Player defaultPlaybackRates={playbackSpeeds}>
      <AttachCouchMedia {...props} />
      {children}
    </Player>
  );
}

/**
 * `useMediaAttach()` is Video.js's internal hook (`@internal` in `@videojs/react` 10.4.0): no public API attaches a
 * media that isn't one of its packaged components. This is the only place Couch uses it; check it at every Video.js
 * upgrade, which is why `@videojs/react` is pinned to an exact version.
 */
function AttachCouchMedia({ state, run }: Props) {
  const attach = useMediaAttach();
  const clock = useContext(PlaybackClockContext);
  const loaded = useBufferedEnd(state?.player.playbackId);
  const source = couchMediaSource(state, clock, loaded);
  const [media] = useState(() => new CouchMedia(source, run));
  // Live shows no timeline or Play button (PlaybackTransport), so nothing reads Video.js's state there. Attached, its
  // time feature reads the time every animation frame while it plays: a frame each, on the thread Live is heard from.
  const live = livePlayback(state);
  useLayoutEffect(() => media.update(source, run));
  useLayoutEffect(() => {
    if (live) return;
    attach?.(media);
    return () => attach?.(null);
  }, [attach, media, live]);
  return null;
}

function couchMediaSource(
  state: ClientSessionState | null,
  clock: PlaybackClock,
  loaded: number | null,
): CouchMediaSource {
  const player = state?.player;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const playbackId = player?.playbackId ?? null;
  return {
    playbackId,
    entryId: current?.id ?? null,
    status: player?.status ?? "idle",
    buffering: player?.buffering === true,
    failed:
      player?.status === "error" ||
      (player?.status === "loading" && state?.radioRetry?.retryAt != null),
    clock,
    length: current?.duration ?? null,
    seekable: !!player?.seekable && playbackControls(state).seek,
    endless: !!current?.endless || isRadio(current),
    speed: player?.speed || 1,
    volume: player?.volume ?? 0,
    muted: muted(state),
    subtitles: player?.tracks ?? [],
    loaded,
    local: localMedia(playbackId),
  };
}
