import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film, Music2 } from "lucide-react";
import { artworkQuery } from "@/api/library";
import { cn } from "@/lib/utils";

export function AuthArtwork({ origin, token, id, className, video = false }: { origin: string; token: string; id: string | null | undefined; className?: string; video?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const [nearby, setNearby] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (nearby || !element.current) return;
    // Native img lazy-loading cannot defer the authenticated blob fetch.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [nearby]);
  const { data: blob } = useQuery({ ...artworkQuery({ origin, token }, id ?? ""), enabled: !!id && nearby });
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) { setImage(null); return; }
    const url = URL.createObjectURL(blob);
    setImage({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return <span ref={element} className={cn("music-artwork grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-primary", className)} aria-hidden="true">
    {id && image && image.blob === blob ? <img src={image.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setImage(null)} /> : video ? <Film className="size-6" /> : <Music2 className="size-6" />}
  </span>;
}
