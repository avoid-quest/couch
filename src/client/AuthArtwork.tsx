import { useEffect, useState } from "react";
import { Film, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function AuthArtwork({ origin, token, id, className, video = false }: { origin: string; token: string; id: string | null | undefined; className?: string; video?: boolean }) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    setImage(null);
    if (!id) return;
    const controller = new AbortController();
    let url: string | undefined;
    void fetch(`${origin}/api/library/artwork/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) return;
      const blob = await response.blob();
      if (controller.signal.aborted || !blob.size) return;
      url = URL.createObjectURL(blob);
      setImage({ id, url });
    }).catch(() => {});
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [origin, token, id]);

  return <span className={cn("music-artwork grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-primary", className)} aria-hidden="true">
    {image && image.id === id ? <img src={image.url} alt="" className="size-full object-cover" onError={() => setImage(null)} /> : video ? <Film className="size-6" /> : <Music2 className="size-6" />}
  </span>;
}
