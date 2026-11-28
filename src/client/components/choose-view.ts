import { useSyncExternalStore } from "react";
import type { PlayOn } from "../../shared/protocol";

/**
 * What Choose where it plays chooses for, opened from Play on's last line ("Picture and sound separately…"): the item,
 * its Play's word, and what plays it once chosen. It shows in the player's column (ChooseWherePlays.tsx), one at a
 * time; `from` takes the focus back as it closes.
 */
export type ChooseRequest = {
  title: string;
  detail?: string;
  thumbnail?: string;
  verb?: string;
  audioOnly?: boolean;
  /** Plays it there; a promise it returns settles once Core took the play (false: it failed). */
  onPlay: (on: PlayOn) => unknown;
  from?: HTMLElement | null;
};

let request: ChooseRequest | null = null;
const listeners = new Set<() => void>();
const set = (next: ChooseRequest | null) => {
  request = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const openChoose = (next: ChooseRequest) => set(next);
export const closeChoose = () => {
  const from = request?.from;
  set(null);
  requestAnimationFrame(() => {
    if (from?.isConnected && document.activeElement === document.body) from.focus();
  });
};
export const useChooseRequest = () => useSyncExternalStore(subscribe, () => request);
