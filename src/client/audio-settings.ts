import { useState, useSyncExternalStore } from "react";
import { defaultNativeInputBuffer, isCaptureRatePreference, isNativeInputBufferPreference, isOutputBufferPreference } from "../shared/audio-settings";

function storedPreference<T extends string>(key: string, valid: (value: unknown) => value is T, fallback: T) {
  const listeners = new Set<() => void>();
  const read = (): T => {
    try { const value = localStorage.getItem(key); return valid(value) ? value : fallback; }
    catch { return fallback; }
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener); window.addEventListener("storage", listener);
    return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
  };
  function usePreference() {
    const value = useSyncExternalStore(subscribe, read, () => fallback);
    const [error, setError] = useState<string>();
    const save = (next: string) => {
      if (!valid(next)) return;
      try { localStorage.setItem(key, next); setError(undefined); listeners.forEach(listener => listener()); }
      catch { setError("Couldn’t save this device’s audio preference. Allow local storage and try again."); }
    };
    return { value, save, error };
  }
  return { read, usePreference };
}
const output = storedPreference("couch.live-output-buffer", isOutputBufferPreference, "auto");
const capture = storedPreference("couch.live-capture-rate", isCaptureRatePreference, "auto");
const nativeBuffer = storedPreference("couch.live-native-input-buffer", isNativeInputBufferPreference, defaultNativeInputBuffer);
export const readNativeInputBufferPreference = nativeBuffer.read;
export const useNativeInputBufferPreference = nativeBuffer.usePreference;
export const readOutputBufferPreference = output.read;
export const useOutputBufferPreference = output.usePreference;
export const readCaptureRatePreference = capture.read;
export const useCaptureRatePreference = capture.usePreference;
