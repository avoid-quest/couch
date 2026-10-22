import { useSyncExternalStore } from "react";

// How far this Device's own media element has loaded ahead of the playhead. The renderer reports it;
// it stays on this Device (Core and other Devices never hear it), so a Playback elsewhere has none.
let loaded: { playbackId: string; end: number } | null = null;
const listeners = new Set<() => void>();

// The end of the buffered range holding `time`; null in a gap or with nothing loaded.
export function bufferedEnd(ranges: Pick<TimeRanges, "length" | "start" | "end">, time: number) {
  for (let index = 0; index < ranges.length; index++) if (ranges.start(index) <= time && time <= ranges.end(index)) return ranges.end(index);
  return null;
}

// In whole seconds: the media element reports it on every progress and timeupdate, and each change renders the timeline.
export function setBuffered(next: typeof loaded) {
  if (next) next = { ...next, end: Math.floor(next.end) };
  if (next?.playbackId === loaded?.playbackId && next?.end === loaded?.end) return;
  loaded = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useBufferedEnd = (playbackId: string | null | undefined) =>
  useSyncExternalStore(subscribe, () => playbackId && loaded?.playbackId === playbackId ? loaded.end : null, () => null);
