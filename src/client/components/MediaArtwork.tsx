import { useLayoutEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Contained artwork. Without any, the frame keeps its shape as a hairline on the page's ground and sets the title in
 * type, sized to the frame (a container query), so a missing cover keeps the shelf's rhythm without reading as a
 * picture; a collection shows a folder. Its ink is muted by value, not by .text-muted-foreground, which a focused
 * control darkens for its inverted ground (index.css) while artwork keeps its own.
 */
export function MediaArtwork({ thumbnail, title, collection = false, className = "" }: { thumbnail?: string; title: string; collection?: boolean; className?: string }) {
  const [failedSrc, setFailedSrc] = useState("");
  // Artwork fades in once it has loaded, rather than popping in over its frame.
  const [loadedSrc, setLoadedSrc] = useState("");
  let src = "";
  try {
    const url = new URL(thumbnail ?? "");
    if (["https:", "http:", "blob:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
  } catch { /* Missing artwork sets the title in type. */ }
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    // A decoded browser-cache hit must not fade from transparent on every route revisit.
    if (image.current?.complete && image.current.naturalWidth) setLoadedSrc(src);
  }, [src]);
  return src && src !== failedSrc
    ? <img ref={image} className={cn("media-artwork block w-full aspect-video object-cover bg-muted motion-safe:transition-opacity motion-safe:duration-200 motion-safe:not-data-loaded:opacity-0", className)} data-loaded={src === loadedSrc || undefined} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)} />
    : <span className={cn("media-artwork @container flex w-full aspect-video overflow-hidden border bg-background text-(--muted-foreground)", className)} aria-hidden="true">
      {collection ? <Folder className="m-auto size-6" /> : <span className="m-[7cqi] line-clamp-4 h-fit text-[clamp(.625rem,8cqi,1.25rem)] leading-tight font-medium tracking-tight break-words">{title}</span>}
    </span>;
}
