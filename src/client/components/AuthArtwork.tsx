import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film, Music2 } from "lucide-react";
import { artworkQuery } from "@/api/library";
import { cn } from "@/lib/utils";

export function AuthArtwork({ origin, token, id, className, video = false }: { origin: string; token: string; id: string | null | undefined; className?: string; video?: boolean }) {
  const { data: blob } = useQuery({ ...artworkQuery({ origin, token }, id ?? ""), enabled: !!id });
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) { setImage(null); return; }
    const url = URL.createObjectURL(blob);
    setImage({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return <span className={cn("music-artwork grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-primary", className)} aria-hidden="true">
    {id && image && image.blob === blob ? <img src={image.url} alt="" className="size-full object-cover" onError={() => setImage(null)} /> : video ? <Film className="size-6" /> : <Music2 className="size-6" />}
  </span>;
}
