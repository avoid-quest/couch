import { useCallback, useEffect, useMemo, useState } from "react";
import type { VideoQuality } from "../shared/providers";
export { supportsWebVideoQuality, supportsCurrentVideoQuality } from "../shared/video-quality";

export const videoQualityLabels: Record<VideoQuality, string> = { auto: "1080p (recommended)", best: "Unrestricted quality", "1080p": "Up to 1080p", "720p": "Up to 720p", "480p": "Up to 480p" };
const storageKey = "couch.online-video-quality";

export function readVideoQuality(storage?: Pick<Storage, "getItem">): VideoQuality {
  try {
    const value = (storage ?? localStorage).getItem(storageKey);
    return value && Object.hasOwn(videoQualityLabels, value) ? value as VideoQuality : "auto";
  } catch { return "auto"; }
}

export function saveVideoQuality(value: VideoQuality, storage?: Pick<Storage, "setItem">) {
  (storage ?? localStorage).setItem(storageKey, value);
}

export function useVideoQualityPreference() {
  const [quality, setQuality] = useState(() => readVideoQuality());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) { setQuality(readVideoQuality()); setError(null); }
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const save = useCallback((value: VideoQuality) => {
    try { saveVideoQuality(value); setQuality(value); setError(null); }
    catch { setError("Could not save this browser's preference. Allow site storage and try again."); }
  }, []);
  return useMemo(() => ({ quality, save, error }), [quality, save, error]);
}

export function useEnqueueVideoQuality(defaultQuality: VideoQuality) {
  const [override, setOverride] = useState<VideoQuality | null>(null);
  useEffect(() => setOverride(null), [defaultQuality]);
  return [override ?? defaultQuality, setOverride, () => setOverride(null)] as const;
}
