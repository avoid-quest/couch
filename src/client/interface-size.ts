import { useLayoutEffect, useSyncExternalStore } from "react";
import { isInterfaceSize, type InterfaceSize } from "../shared/appearance";

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

export function useInterfaceSize(native: boolean) {
  const remote = useRemoteInterfaceSize();
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--interface-scale", String(native ? 1 : remote));
  }, [native, remote]);
}
