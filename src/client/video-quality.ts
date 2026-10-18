import { useCallback, useEffect, useMemo, useState } from "react";
import type { VideoQuality } from "../shared/providers";
export { supportsWebVideoQuality, supportsCurrentVideoQuality } from "../shared/video-quality";

// The only labels for video quality. Settings, the player and Search all use these.
export const videoQualityLabels: Record<VideoQuality, string> = { auto: "Auto (1080p)", best: "Best", "1080p": "1080p", "720p": "720p", "480p": "480p" };
export const videoQualityOptions = (Object.entries(videoQualityLabels) as [VideoQuality, string][]).map(([value, label]) => ({ value, label }));
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
    catch { setError("Couldn't save. Allow site storage."); }
  }, []);
  return useMemo(() => ({ quality, save, error }), [quality, save, error]);
}

// A one-off choice that lapses when the preference changes underneath it.
export function useEnqueueVideoQuality(defaultQuality: VideoQuality) {
  const [override, setOverride] = useState<{ base: VideoQuality; quality: VideoQuality } | null>(null);
  const quality = override?.base === defaultQuality ? override.quality : defaultQuality;
  return [quality, (value: VideoQuality) => setOverride({ base: defaultQuality, quality: value }), () => setOverride(null)] as const;
}
