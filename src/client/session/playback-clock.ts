import { createContext, useContext } from "react";
import type { PlaybackClock } from "../../shared/protocol";

export type { PlaybackClock } from "../../shared/protocol";
export const emptyPlaybackClock: PlaybackClock = { playbackId: null, position: 0, duration: null };
export const PlaybackClockContext = createContext<PlaybackClock>(emptyPlaybackClock);
export const usePlaybackClock = () => useContext(PlaybackClockContext);
