import { useCallback, useEffect, useMemo, useState } from "react";
import type { VideoQuality } from "../shared/providers";
import type { VideoQualityLabels } from "../shared/protocol";
export { supportsWebVideoQuality } from "../shared/video-quality";

// The fixed labels for video quality, which Settings and Search use. Auto plays 1080p (Core), so the choices
// offer it once, as 1080p; an explicit "1080p" from an older Couch or a playlist shows as that choice.
const videoQualityLabels: Record<VideoQuality, string> = {
  auto: "1080p",
  best: "Best",
  "1080p": "1080p",
  "720p": "720p",
  "480p": "480p",
};
const videoQualityChoice = (value: VideoQuality): VideoQuality =>
  value === "1080p" ? "auto" : value;
export const videoQualityOptions = (["best", "auto", "720p", "480p"] as const).map((value) => ({
  value,
  label: videoQualityLabels[value],
}));
const choices = ["best", "1080p", "720p", "480p"] as const;
// The current item's choices, each named by what it plays (Core's videoQualities). Choices that play the same
// picture show once, as the strictest: it keeps that picture when a later copy of the item offers more.
export function videoQualityOffers(labels: VideoQualityLabels, quality: VideoQuality = "auto") {
  const options = choices.flatMap((value, index) => {
    const label = labels[value];
    return label && !choices.slice(index + 1).some((other) => labels[other] === label)
      ? [{ value, label }]
      : [];
  });
  const current = quality === "auto" ? "1080p" : quality;
  // A current choice Core couldn't name checks none of the others.
  const playing = labels[current] ?? "";
  return {
    options,
    value: options.find((option) => option.label === playing)?.value ?? current,
    label: playing,
  };
}
const storageKey = "couch.online-video-quality";

function readVideoQuality(storage?: Pick<Storage, "getItem">): VideoQuality {
  try {
    const value = (storage ?? localStorage).getItem(storageKey);
    return value && Object.hasOwn(videoQualityLabels, value)
      ? videoQualityChoice(value as VideoQuality)
      : "auto";
  } catch {
    return "auto";
  }
}

function saveVideoQuality(value: VideoQuality, storage?: Pick<Storage, "setItem">) {
  (storage ?? localStorage).setItem(storageKey, value);
}

export function useVideoQualityPreference() {
  const [quality, setQuality] = useState(() => readVideoQuality());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setQuality(readVideoQuality());
        setError(null);
      }
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const save = useCallback((value: VideoQuality) => {
    try {
      saveVideoQuality(value);
      setQuality(value);
      setError(null);
    } catch {
      setError("Couldn't save. Allow site storage.");
    }
  }, []);
  return useMemo(() => ({ quality, save, error }), [quality, save, error]);
}

// A one-off choice that lapses when the preference changes underneath it.
export function useEnqueueVideoQuality(defaultQuality: VideoQuality) {
  const [override, setOverride] = useState<{ base: VideoQuality; quality: VideoQuality } | null>(
    null,
  );
  const quality = override?.base === defaultQuality ? override.quality : defaultQuality;
  return [
    quality,
    (value: VideoQuality) => setOverride({ base: defaultQuality, quality: value }),
    () => setOverride(null),
  ] as const;
}
