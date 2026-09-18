import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { defaultTvAppearance, isInterfaceSize, type InterfaceSize, type TvAppearance } from "../shared/appearance";

const key = "couch.remote-interface-size";
const changed = "couch-interface-size";
const read = (): InterfaceSize => {
  try {
    const value = Number(localStorage.getItem(key));
    return isInterfaceSize(value) ? value : 1;
  } catch { return 1; }
};
let current = read();
const subscribe = (listener: () => void) => {
  const storage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(changed, listener); };
};

export function saveRemoteInterfaceSize(value: InterfaceSize) {
  current = value;
  let saved = true;
  try { localStorage.setItem(key, String(value)); } catch { saved = false; }
  window.dispatchEvent(new Event(changed));
  return saved;
}

export const useRemoteInterfaceSize = () => useSyncExternalStore<InterfaceSize>(subscribe, () => current, () => 1);

export function usePreviewSeconds(appearance: TvAppearance) {
  const [now, setNow] = useState(Date.now());
  const expiresAt = appearance.preview?.expiresAt;
  useEffect(() => {
    setNow(Date.now());
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
}

export function useInterfaceSize(native: boolean, appearance = defaultTvAppearance) {
  const remote = useRemoteInterfaceSize();
  const seconds = usePreviewSeconds(appearance);
  const size = native ? appearance.preview && !seconds ? appearance.confirmedSize : appearance.size : remote;
  // Keep persisted choices and remote scaling. The old wider TV steps
  // (1.35/1.75) predate the deduplicated scaling and read as bloat now.
  const scale = size;
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--interface-scale", String(scale));
    window.dispatchEvent(new Event("couch-interface-size-applied"));
  }, [scale]);
}
