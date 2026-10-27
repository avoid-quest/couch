import { useSyncExternalStore } from "react";

// Local renderer capability, not a measured display synchronization guarantee.
let mapping: { playbackId: string; unavailable: boolean } | null = null;
const listeners = new Set<() => void>();
export function setPictureMapping(next: typeof mapping) {
  if (next?.playbackId === mapping?.playbackId && next?.unavailable === mapping?.unavailable) return;
  mapping = next;
  for (const listener of listeners) listener();
}
export function usePictureMapping(playbackId: string | null | undefined) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => !!playbackId && mapping?.playbackId === playbackId && mapping.unavailable, () => false);
}
