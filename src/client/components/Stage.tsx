import { useEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import type { ArtShape } from "@/art-shape";
import { cn } from "@/lib/utils";
import { MediaArtwork, useArtRatio } from "./MediaArtwork";
import { roomStyle, useArtwork } from "./AmbientLight";

// While a page with a stage is at its top, the header lies over the stage's picture; once the page scrolls, the
// copy would pass under it, so it is black again.
const stages = new Set<Element>();
const mark = () => document.documentElement.toggleAttribute("data-stage-under-header", stages.size > 0 && scrollY < 4);

/** Each kind's shape, as width over height, until the picture's own is known. */
export const shapeRatio: Record<ArtShape, number> = { video: 16 / 9, poster: 2 / 3, square: 1, round: 1 };
/** A picture this much wider than tall is a photograph's frame: it fills the stage as a backdrop. */
const frameRatio = 1.3;
const vector = (src: string | undefined) => /\.svg(\?|#|$)/i.test(src ?? "");

/**
 * How a picture stands on the Stage and in the player (docs/design.md, Stage): a wide photograph's `frame` fills the
 * stage as a backdrop; anything else (a square cover, a poster, an avatar, a logo on its own ground) is an `object`,
 * shown whole and crisp with a shadow in its room; a `mark` (a logo on nothing: a vector, see-through edges) stands
 * whole without the shadow, which would outline its box.
 */
export function artForm(ratio: number, { clear = false, contain = false, round = false, src }: { clear?: boolean; contain?: boolean; round?: boolean; src?: string }) {
  if (vector(src) || clear) return "mark";
  return !contain && !round && ratio >= frameRatio ? "frame" : "object";
}

/**
 * The top of Home and of every Details page (docs/design.md, Stage). It reaches up under the header and out to the
 * window's edges, in a room painted with the picture's own colours. A frame enters from the right and dissolves into
 * the room; an object or a mark stands whole at the right. The title and its verbs sit at the bottom left. `onPicture`
 * makes the picture a pointer target (Home's playing Stage opens the player), never a focus stop of its own.
 */
export function Stage({ thumbnail, shape, fit, title, size = "details", label, className, onPicture, children, ...props }: {
  thumbnail?: string; shape: ArtShape;
  /** Logos keep their margins: they stand whole, never bleed. */
  fit?: "contain";
  /** For the missing-artwork cover. */
  title: string;
  size?: "home" | "details";
  label?: string;
  className?: string;
  onPicture?: () => void;
  children: ReactNode;
} & Omit<ComponentProps<"section">, "title" | "children">) {
  const art = useArtwork(thumbnail);
  const [picture, ratio] = useArtRatio(thumbnail, shapeRatio[shape]);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    stages.add(element);
    mark();
    addEventListener("scroll", mark, { passive: true });
    return () => { removeEventListener("scroll", mark); stages.delete(element); mark(); };
  }, []);
  const form = artForm(ratio, { clear: art?.clear, contain: fit === "contain", round: shape === "round", src: thumbnail });
  // A Details page's stage is its header; Home's is a section of the board.
  const Tag = size === "details" ? "header" : "section";
  return <Tag ref={root as never} {...props} data-stage={size} data-form={thumbnail !== undefined ? form : undefined} aria-label={label} className={cn("stage", className)}
    style={{ ...roomStyle(art?.light), "--art-ratio": ratio } as CSSProperties}>
    {thumbnail !== undefined && <div aria-hidden="true" className="room" />}
    {thumbnail !== undefined && <div ref={picture} aria-hidden="true" data-stage-picture data-detail-art={size === "details" || undefined} data-shape={shape} onClick={onPicture} className={cn("stage-picture", onPicture && "cursor-pointer")}>
      {form === "frame"
        ? <div className="stage-frame"><MediaArtwork thumbnail={thumbnail} title={title} className="aspect-auto size-full object-cover" /></div>
        : <MediaArtwork thumbnail={thumbnail} title={title} className={cn("stage-object", shape === "round" && "rounded-full")} />}
    </div>}
    <div className="stage-copy">{children}</div>
  </Tag>;
}

/**
 * How long a title is, which sets its size and its width (index.css, .display-title): a short one runs wide and large,
 * a long one condenses and steps down, so a title of any length is set whole, never clipped.
 */
export const titleLength = (title: string) => title.length > 44 ? "xlong" : title.length > 26 ? "long" : title.length > 14 ? "medium" : "short";
/** The title's longest word, in characters, which caps its size so that word fits its column whole (index.css). */
export const titleFit = (title: string) => ({ "--word": Math.max(4, ...title.split(/\s+/).map(word => word.length)) }) as CSSProperties;

/** The Stage's title, in the display face, set by its length so a long one still reads as type, never a paragraph. */
export function StageTitle({ title, as: Heading = "h1", className, children }: { title: string; as?: "h1" | "h2"; className?: string; children?: ReactNode }) {
  return <Heading tabIndex={-1} data-length={titleLength(title)} style={titleFit(title)}
    className={cn("stage-title display-title text-balance outline-none", className)}>{children ?? title}</Heading>;
}
