import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Contained artwork. Without any, the frame is a cover set in type: a deep tone of its own, hashed from the title (so
 * a shelf of missing artwork isn't a row of grey squares, and an item keeps its tone everywhere), with the title large
 * at its bottom left, sized to the frame (a container query), so it keeps the shelf's rhythm and reads as the item's
 * own cover. The tone is dark enough (OKLCH lightness .3) that white ink over it keeps 7:1. A frame too
 * small for words (a row's or the bar's thumbnail) holds the title's first letter instead, and a collection a folder. An
 * address breaks after its slashes rather than inside a word. A `bare` picture (the Stage's, beside a title already set
 * large) has no cover: without artwork it is nothing.
 * Its fill and ink are set by value, not by .bg-muted or .text-muted-foreground, which a focused control changes for its
 * inverted ground (index.css) while artwork keeps its own, and on an inner layer so a caller's ground for the picture
 * doesn't cover it.
 */
// Loaded artwork keeps its proportions as well as its fade state across route mounts.
const shown = new Map<string, number | undefined>();
/** The cover's hue, from its title. */
const hue = (title: string) => { let hash = 7; for (const char of title) hash = (hash * 31 + char.codePointAt(0)!) >>> 0; return hash % 360; };

export function MediaArtwork({ thumbnail, title, collection = false, bare = false, priority = false, className = "" }: {
  thumbnail?: string; title: string; collection?: boolean; bare?: boolean;
  /** The page's largest picture (a Stage's): fetched first, never lazily. */
  priority?: boolean;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState("");
  let src = "";
  try {
    const url = new URL(thumbnail ?? "");
    if (["https:", "http:", "blob:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
  } catch { /* Missing artwork sets the title in type. */ }
  // Artwork fades in once it has loaded, rather than popping in over its frame; art this page already showed (another
  // tab, a revisit) is there at once.
  const [loadedSrc, setLoadedSrc] = useState(() => shown.has(src) ? src : "");
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    // A decoded browser-cache hit must not fade from transparent on every route revisit.
    if (src !== loadedSrc && image.current?.complete && image.current.naturalWidth && image.current.naturalHeight) {
      shown.set(src, image.current.naturalWidth / image.current.naturalHeight);
      setLoadedSrc(src);
    }
  }, [src, loadedSrc]);
  return src && src !== failedSrc
    ? <img ref={image} className={cn("media-artwork block w-full aspect-video object-cover bg-muted motion-safe:transition-opacity motion-safe:duration-200 motion-safe:not-data-loaded:opacity-0", className)} data-loaded={src === loadedSrc || shown.has(src) || undefined} src={src} alt="" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" referrerPolicy="no-referrer" onLoad={event => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      shown.set(src, naturalWidth && naturalHeight ? naturalWidth / naturalHeight : undefined);
      setLoadedSrc(src);
    }} onError={() => setFailedSrc(src)} />
    : bare ? null : <span className={cn("media-artwork @container relative flex w-full aspect-video overflow-hidden", className)} aria-hidden="true">
      <span className="absolute inset-0 flex text-white" style={{ background: `oklch(.3 .05 ${hue(title)})` }}>
        {collection ? <Folder className="m-auto size-[max(1rem,20cqi)] text-white/70" />
          : <>
            <span className="mt-auto m-[7cqi] line-clamp-4 h-fit text-[max(.75rem,12cqi)] leading-[.98] font-semibold tracking-[-.03em] text-balance break-words @max-[5rem]:hidden in-[.rounded-full]:hidden">{title.replace(/([/?&])/g, "$1\u200b")}</span>
            <span className="m-auto hidden text-[45cqi] leading-none font-semibold @max-[5rem]:block in-[.rounded-full]:block">{title.match(/[\p{L}\p{N}]/u)?.[0]?.toLocaleUpperCase()}</span>
          </>}
      </span>
    </span>;
}

const href = (src: string | undefined) => { try { return new URL(src ?? "").href; } catch { return ""; } };
/**
 * The picture's own proportions (width over height), read from the image inside the element once it has loaded, so
 * the Stage and the player size it whole at its true shape; `fallback` (its kind's shape) until then, or when the
 * picture tells none (a vector logo without a size).
 */
export function useArtRatio(src: string | undefined, fallback: number) {
  const [measured, setMeasured] = useState<{ src: string; ratio: number }>();
  const url = href(src);
  const natural = measured?.src === url ? measured.ratio : shown.get(url) ?? fallback;
  // YouTube's 4:3 thumbnails (hqdefault) are its 16:9 frame between black bars: a frame shows at 16:9, its bars cropped.
  const ratio = fallback === 16 / 9 && Math.abs(natural - 4 / 3) < .01 && /^https:\/\/i\d?\.ytimg\.com\//.test(url) ? fallback : natural;
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const read = () => {
      const image = element.querySelector("img");
      if (image?.src === url && image.complete && image.naturalWidth && image.naturalHeight && image.naturalWidth / image.naturalHeight !== natural) {
        setMeasured({ src: image.src, ratio: image.naturalWidth / image.naturalHeight });
      }
    };
    // A load doesn't bubble, but it passes the element on its way down.
    element.addEventListener("load", read, true);
    read();
    return () => element.removeEventListener("load", read, true);
  }, [url, natural]);
  return [ref, ratio] as const;
}
