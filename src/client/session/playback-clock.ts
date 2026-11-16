import { createContext, useContext, useEffect, useState } from "react";
import type { PlaybackClock } from "../../shared/protocol";
import { coreNow } from "../core-clock";

export type { PlaybackClock } from "../../shared/protocol";
export const emptyPlaybackClock: PlaybackClock = {
  playbackId: null,
  position: 0,
  duration: null,
  at: 0,
  rate: 0,
};
export const PlaybackClockContext = createContext<PlaybackClock>(emptyPlaybackClock);

/** Where the anchor says the Playback is now, never past its end. */
const positionAt = (clock: PlaybackClock, now = coreNow()) =>
  Math.min(
    clock.duration ?? Infinity,
    clock.position + (Math.max(0, now - clock.at) / 1000) * clock.rate,
  );

/**
 * The Playback's position, moved on from Core's last anchor: once a second, or every frame for a
 * `smooth` slider. Only the component that asks re-renders.
 */
export function usePlaybackClock(smooth = false) {
  const clock = useContext(PlaybackClockContext);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!clock.rate) return;
    if (!smooth) {
      const timer = setInterval(() => tick((count) => count + 1), 1000 / clock.rate);
      return () => clearInterval(timer);
    }
    let frame = requestAnimationFrame(function next() {
      tick((count) => count + 1);
      frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [clock, smooth]);
  return { playbackId: clock.playbackId, duration: clock.duration, position: positionAt(clock) };
}
