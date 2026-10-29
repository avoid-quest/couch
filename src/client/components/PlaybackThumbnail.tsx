import { Thumbnail, type ThumbnailImage } from "@videojs/react";
import { memo, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch, apiJson } from "@/api/client";
import { SessionGateContext } from "@/session/gate-context";
import { previewAt, type PlaybackPreview } from "../../shared/playback-preview";

type LoadedImage = { index: number; url: string; onLoad: () => void; onError: () => void };

// Mounted for one playback identity within SessionGate's authenticated lifetime.
// Keep four successfully decoded images; cancel pending work when no longer used.
export function PlaybackThumbnail({ playbackId, time }: { playbackId: string; time: number | null }) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const path = `/api/playback-preview?playbackId=${encodeURIComponent(playbackId)}`;
  const active = time !== null;
  const { data: preview } = useQuery({
    queryKey: ["playback-preview", playbackId],
    queryFn: ({ signal }) => apiJson<PlaybackPreview | undefined>(credentials!, path, { signal }).then(value => value ?? null),
    enabled: !!credentials && active,
    staleTime: query => query.state.data === null ? 30_000 : Infinity, gcTime: 0, retry: false,
  });
  const [images] = useState(() => new Map<number, string>());
  const [image, setImage] = useState<LoadedImage | null>(null);
  const frame = preview && time !== null ? previewAt(preview, time) : null;
  const index = frame?.image ?? null;
  useEffect(() => () => { for (const url of images.values()) URL.revokeObjectURL(url); images.clear(); }, [images]);
  useEffect(() => {
    if (!credentials || index === null || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, pending: string | undefined;
    const keep = (url: string) => {
      images.delete(index); images.set(index, url);
      for (const [oldest, kept] of images) {
        if (images.size <= 4) break;
        images.delete(oldest); URL.revokeObjectURL(kept);
      }
    };
    const load = async (attempt = 0) => {
      const failed = (error?: unknown) => {
        if (controller.signal.aborted) return;
        setImage(null);
        if (attempt < 2 && (!(error instanceof ApiError) || error.status === 503)) timer = setTimeout(() => { void load(attempt + 1); }, 1000 * (attempt + 1));
      };
      try {
        let url = images.get(index);
        if (url === undefined) {
          const response = await apiFetch(credentials, `${path}&image=${index}`, { signal: controller.signal });
          const blob = response.status === 204 ? null : await response.blob();
          controller.signal.throwIfAborted();
          if (!blob?.size) { setImage(null); return; }
          url = pending = URL.createObjectURL(blob);
        }
        const selected = url;
        setImage({ index, url, onLoad: () => {
          if (controller.signal.aborted) return;
          pending = undefined; keep(selected);
        }, onError: () => {
          if (controller.signal.aborted) return;
          images.delete(index); pending = undefined; URL.revokeObjectURL(selected); failed();
        } });
      } catch (error) { failed(error); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); if (pending) URL.revokeObjectURL(pending); };
  }, [credentials, images, path, index, active]);
  const startTime = frame?.startTime, endTime = frame?.endTime, width = frame?.width, height = frame?.height;
  const x = frame?.coords?.x, y = frame?.coords?.y;
  const thumbnail = useMemo<ThumbnailImage | null>(() => {
    if (!image || image.index !== index || startTime === undefined) return null;
    return { url: image.url, startTime, endTime, width, height, coords: x === undefined || y === undefined ? undefined : { x, y } };
  }, [image, index, startTime, endTime, width, height, x, y]);
  return thumbnail && image ? <Scene thumbnail={thumbnail} onLoad={image.onLoad} onError={image.onError} /> : null;
}

// Pointer motion within one provider interval changes the timestamp, not sprite
// selection, sizing or decoding. Video.js owns cropping the selected frame.
const Scene = memo(function Scene({ thumbnail, onLoad, onError }: { thumbnail: ThumbnailImage; onLoad: () => void; onError: () => void }) {
  const thumbnails = useMemo(() => [thumbnail], [thumbnail]);
  const [, resize] = useReducer(value => value + 1, 0);
  useEffect(() => {
    // A larger rem maximum doesn't resize Video.js's existing inline width, so
    // its own ResizeObserver cannot discover the newly available space.
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return <Thumbnail.Root data-preview-thumbnail time={thumbnail.startTime} thumbnails={thumbnails}
    className="mx-auto max-w-40 overflow-hidden rounded-sm data-[loading]:hidden data-[error]:hidden data-[hidden]:hidden">
    <Thumbnail.Image alt="" loading="eager" fetchPriority="low" onLoad={onLoad} onError={onError} />
  </Thumbnail.Root>;
});
