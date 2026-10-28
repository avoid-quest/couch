import { Thumbnail, type ThumbnailImage } from "@videojs/react";
import { useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, apiJson } from "@/api/client";
import { SessionGateContext } from "@/session/gate-context";
import { previewSheet, type PlaybackPreview } from "../../shared/playback-preview";

// Mounted for one playback identity. Four on-demand sheets at most; leaving the
// source releases their object URLs. Failed sheets keep the timestamp fallback.
export function PlaybackThumbnail({ playbackId, time }: { playbackId: string; time: number | null }) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const path = `/api/playback-preview?playbackId=${encodeURIComponent(playbackId)}`;
  const { data: preview } = useQuery({
    queryKey: ["playback-preview", playbackId],
    queryFn: ({ signal }) => apiJson<PlaybackPreview | undefined>(credentials!, path, { signal }).then(value => value ?? null),
    enabled: !!credentials && time !== null,
    staleTime: Infinity, gcTime: 0, retry: false,
  });
  const [images] = useState(() => new Map<number, string | null>());
  const [image, setImage] = useState<{ sheet: number; url: string } | null>(null);
  const sheet = preview && time !== null ? previewSheet(preview, time) : null;
  useEffect(() => () => { for (const url of images.values()) if (url) URL.revokeObjectURL(url); images.clear(); }, [images]);
  useEffect(() => {
    if (!credentials || sheet === null) return;
    const controller = new AbortController();
    const keep = (url: string | null) => {
      images.delete(sheet); images.set(sheet, url);
      for (const [oldest, kept] of images) {
        if (images.size <= 4) break;
        images.delete(oldest); if (kept) URL.revokeObjectURL(kept);
      }
    };
    const load = async () => {
      let url = images.get(sheet);
      if (url === undefined) {
        const response = await apiFetch(credentials, `${path}&sheet=${sheet}`, { signal: controller.signal });
        const blob = response.status === 204 ? null : await response.blob();
        controller.signal.throwIfAborted();
        url = blob?.size ? URL.createObjectURL(blob) : null;
      }
      keep(url);
      setImage(url ? { sheet, url } : null);
    };
    void load().catch(() => { if (!controller.signal.aborted) { keep(null); setImage(null); } });
    return () => controller.abort();
  }, [credentials, images, path, sheet]);
  const thumbnails = useMemo<ThumbnailImage[]>(() => {
    if (!preview || !image || image.sheet !== sheet) return [];
    const { width, height, columns, rows, interval, duration } = preview;
    return Array.from({ length: columns * rows }, (_, index) => {
      const startTime = (image.sheet * columns * rows + index) * interval;
      return { url: image.url, startTime, endTime: Math.min(duration, startTime + interval), width, height, coords: { x: index % columns * width, y: Math.floor(index / columns) * height } };
    }).filter(thumbnail => thumbnail.startTime < duration);
  }, [preview, image, sheet]);
  if (time === null || !thumbnails.length) return null;
  return <Thumbnail.Root data-preview-thumbnail time={Math.min(time, preview!.duration - .001)} thumbnails={thumbnails}
    className="mx-auto max-w-40 overflow-hidden rounded-sm data-[loading]:hidden data-[error]:hidden data-[hidden]:hidden">
    <Thumbnail.Image alt="" loading="eager" fetchPriority="low" />
  </Thumbnail.Root>;
}
