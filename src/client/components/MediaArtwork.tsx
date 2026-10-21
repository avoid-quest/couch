import { useLayoutEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Contained artwork. Without any, the frame is a cover set in type: the muted fill with the title large at its top left,
 * sized to the frame (a container query), so it keeps the shelf's rhythm and reads as the item's own cover. A frame too
 * small for words (a row's or the bar's thumbnail) holds the title's first letter instead, and a collection a folder.
 * Its fill and ink are set by value, not by .bg-muted or .text-muted-foreground, which a focused control changes for its
 * inverted ground (index.css) while artwork keeps its own, and on an inner layer so a caller's ground for the picture
 * doesn't cover it.
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
    : <span className={cn("media-artwork @container relative flex w-full aspect-video overflow-hidden", className)} aria-hidden="true">
      <span className="absolute inset-0 flex bg-(--muted) text-(--foreground)">
        {collection ? <Folder className="m-auto size-[max(1rem,20cqi)] text-(--muted-foreground)" />
          : <>
            <span className="m-[6cqi] line-clamp-4 h-fit text-[max(.75rem,10cqi)] leading-[1.05] font-semibold tracking-tight text-balance break-words @max-[8rem]:hidden">{title}</span>
            <span className="m-auto hidden text-[45cqi] leading-none font-semibold @max-[8rem]:block">{title.match(/[\p{L}\p{N}]/u)?.[0]?.toLocaleUpperCase()}</span>
          </>}
      </span>
    </span>;
}
