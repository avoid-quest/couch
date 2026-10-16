import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { couchApp } from "./session/native-context";
import { isTvPresentation } from "./session/presentation";
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
let subscribers = 0;
let nativeRequest = 0;
const refreshNative = () => {
  if (!couchApp) return;
  const request = ++nativeRequest;
  void couchApp.interfaceSize().then(value => {
    if (request === nativeRequest && isInterfaceSize(value) && current !== value) {
      current = value;
      window.dispatchEvent(new Event(changed));
    }
  }).catch(() => {});
};
const subscribe = (listener: () => void) => {
  const native = !!couchApp;
  if (native && subscribers++ === 0) {
    refreshNative();
    window.addEventListener("focus", refreshNative);
  }
  const storage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(changed, listener);
    if (native && --subscribers === 0) window.removeEventListener("focus", refreshNative);
  };
};

export async function saveRemoteInterfaceSize(value: InterfaceSize) {
  nativeRequest++;
  current = value;
  let saved = true;
  try {
    if (couchApp) await couchApp.interfaceSize(value);
    else localStorage.setItem(key, String(value));
  } catch { saved = false; }
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

export function useInterfaceSize(appearance = defaultTvAppearance) {
  const remote = useRemoteInterfaceSize();
  const seconds = usePreviewSeconds(appearance);
  const size = isTvPresentation() ? appearance.preview && !seconds ? appearance.confirmedSize : appearance.size : remote;
  // Keep persisted choices and remote scaling. The old wider TV steps
  // (1.35/1.75) predate the deduplicated scaling and read as bloat now.
  const scale = size;
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--interface-scale", String(scale));
    window.dispatchEvent(new Event("couch-interface-size-applied"));
  }, [scale]);
}
