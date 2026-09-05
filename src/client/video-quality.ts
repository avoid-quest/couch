import { useEffect, useState } from "react";
import type { VideoQuality } from "../shared/providers";

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
  const [quality, setQuality] = useState(defaultQuality);
  useEffect(() => setQuality(defaultQuality), [defaultQuality]);
  return [quality, setQuality, () => setQuality(defaultQuality)] as const;
}

export function supportsWebVideoQuality(source: string) {
  try {
    const url = new URL(source.trim());
    return url.hostname !== "bandcamp.com" && !url.hostname.endsWith(".bandcamp.com") && !/\.(mp3|m4a|aac|oga|opus|wav|flac|mka)$/i.test(url.pathname);
  } catch { return true; }
}
