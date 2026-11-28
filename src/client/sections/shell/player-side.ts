import { useSyncExternalStore } from "react";

/** Which edge of the window the side player stands at on this device (Settings → This device → Player side). */
export type PlayerSide = "left" | "right";

// Saved per device. The right by default, clear of the macOS window controls at the top left.
const storageKey = "couch.player-side";
const listeners = new Set<() => void>();
const read = (): PlayerSide => {
  try {
    return localStorage.getItem(storageKey) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

export function usePlayerSide() {
  const side = useSyncExternalStore(subscribe, read, () => "right" as const);
  const save = (value: PlayerSide) => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      return;
    }
    listeners.forEach((listener) => listener());
  };
  return { side, save };
}
