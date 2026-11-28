import { useSyncExternalStore } from "react";
import type { CaptureKind } from "../../../shared/capture";
import type { LiveSelection } from "../../../shared/live-input";
import { shareKindOf } from "./share";

/**
 * Whether this window's player shows its own share, and at what size, kept outside React so the header's pill, the
 * player and the shell agree. The player follows a share as it starts and whenever its pill is pressed; choosing
 * another Playback shows that one instead. `ask` opens the Share panel, on a kind when given (Share again).
 */
type View = { shown: boolean; full: boolean; ask: { kind?: string; at: number } | null };
let view: View = { shown: false, full: false, ask: null };
const listeners = new Set<() => void>();
const set = (change: Partial<View>) => {
  view = { ...view, ...change };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useShareView = () => useSyncExternalStore(subscribe, () => view);
export const showShare = (shown: boolean) => set(shown ? { shown } : { shown, full: false });
export const openShareFull = (full: boolean) => set(full ? { shown: true, full } : { full });
const askToShare = (kind?: string) => set({ ask: { kind, at: Date.now() } });
export const answeredShare = () => set({ ask: null });

// The session's message that the capture ended asks for Share again with what was shared.
if (typeof window !== "undefined")
  addEventListener("couch-share-again", (event) => {
    const { capture, surface, intent } = (event as CustomEvent).detail as {
      capture: CaptureKind | "airplay";
      surface?: LiveSelection["surface"];
      intent?: "relaxed" | "live";
    };
    askToShare(shareKindOf(capture === "airplay" ? "screen" : capture, surface, intent).id);
  });
