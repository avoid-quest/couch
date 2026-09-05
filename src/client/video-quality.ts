import { useEffect, useState } from "react";
import type { VideoQuality } from "../shared/providers";
import { audioExtensions } from "../shared/media";

export const videoQualityLabels: Record<VideoQuality, string> = { best: "Best available", "1080p": "Up to 1080p", "720p": "Up to 720p", "480p": "Up to 480p" };
const storageKey = "couch.online-video-quality";

export function readVideoQuality(storage?: Pick<Storage, "getItem">): VideoQuality {
  try {
    const value = (storage ?? localStorage).getItem(storageKey);
    return value && Object.hasOwn(videoQualityLabels, value) ? value as VideoQuality : "best";
  } catch { return "best"; }
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
  const save = (value: VideoQuality) => {
    try { saveVideoQuality(value); setQuality(value); setError(null); }
    catch { setError("Could not save this browser's preference. Allow site storage and try again."); }
  };
  return { quality, save, error };
}

export function useEnqueueVideoQuality(defaultQuality: VideoQuality) {
  const [override, setOverride] = useState<VideoQuality | null>(null);
  useEffect(() => setOverride(null), [defaultQuality]);
  return [override ?? defaultQuality, setOverride, () => setOverride(null)] as const;
}

export function supportsWebVideoQuality(source: string) {
  try {
    const url = new URL(source.trim());
    const extension = decodeURIComponent(url.pathname).split(".").at(-1)!.toLowerCase();
    return url.hostname !== "bandcamp.com" && !url.hostname.endsWith(".bandcamp.com") && !audioExtensions.has(extension) && !["oga", "mka"].includes(extension);
  } catch { return true; }
}
