import { useSyncExternalStore } from "react";
import { useSessionGate } from "@/session/session-context";

// Whether the header shows Share, saved per device (docs/design/share.md). Until it is chosen, a TV hides it and every
// other device shows it.
const storageKey = "couch.show-share";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(storageKey); } catch { return null; } };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
};

export function useShowShare() {
  const { tvPresentation } = useSessionGate();
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const shown = stored === null ? !tvPresentation : stored === "true";
  const save = (value: boolean) => {
    try { localStorage.setItem(storageKey, String(value)); } catch { return; }
    listeners.forEach(listener => listener());
  };
  return { shown, save };
}
