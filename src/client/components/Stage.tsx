import { useEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import type { ArtShape } from "@/art-shape";
import { cn } from "@/lib/utils";
import { MediaArtwork, useArtRatio } from "./MediaArtwork";
import { roomStyle, useArtwork } from "./AmbientLight";

// While a page with a stage is at its top, the header lies over the stage's picture; once the page scrolls, the
// copy would pass under it, so it is black again.
const stages = new Set<Element>();
const mark = () => document.documentElement.toggleAttribute("data-stage-under-header", stages.size > 0 && (document.querySelector(".electron .app-page")?.scrollTop ?? scrollY) < 4);

/** Each kind's shape, as width over height, until the picture's own is known. */
export const shapeRatio: Record<ArtShape, number> = { video: 16 / 9, poster: 2 / 3, square: 1, round: 1 };
/** A picture this much wider than tall is wide: on a phone it spans the column. */
const wideRatio = 1.3;
const vector = (src: string | undefined) => /\.svg(\?|#|$)/i.test(src ?? "");

/**
 * The top of Home and of every Details page (docs/design.md, Stage). It reaches up under the header and out to the
 * window's edges, in a room painted with the picture's own colours. The picture stands whole at the right at its own
 * shape: an `object` (a frame, a cover, a poster, an avatar, a logo on its own ground) crisp with its shadow, a `mark`
 * (a logo on nothing: a vector, see-through edges) without the shadow, which would outline its box. A wide frame is
 * shown whole too, never as a backdrop, so a thumbnail's own lettering never ghosts beside the title. Without a
 * picture the room stands alone: the title is already set large, so no cover repeats it. The title and its verbs sit
 * at the bottom left. `onPicture` makes the picture a pointer target (Home's playing Stage opens the player), never a
 * focus stop of its own.
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
    addEventListener("scroll", mark, { passive: true, capture: true });
    return () => { removeEventListener("scroll", mark, true); stages.delete(element); mark(); };
  }, []);
  const form = vector(thumbnail) || art?.clear ? "mark" : "object";
  const wide = fit !== "contain" && shape !== "round" && ratio >= wideRatio;
  // A Details page's stage is its header; Home's is a section of the board.
  const Tag = size === "details" ? "header" : "section";
  return <Tag ref={root as never} {...props} data-stage={size} data-form={thumbnail ? form : undefined} aria-label={label} className={cn("stage", className)}
    style={{ ...roomStyle(art?.light), "--art-ratio": ratio } as CSSProperties}>
    {thumbnail !== undefined && <div aria-hidden="true" className="room" />}
    {thumbnail && <div ref={picture} aria-hidden="true" data-stage-picture data-detail-art={size === "details" || undefined} data-shape={shape} data-wide={wide || undefined} onClick={onPicture} className={cn("stage-picture", onPicture && "cursor-pointer")}>
      <MediaArtwork bare priority thumbnail={thumbnail} title={title} className="stage-object" />
    </div>}
    <div className="stage-copy">{children}</div>
  </Tag>;
}

/**
 * How long a title is, which sets its size and weight (index.css, .display-title): a short one runs large and heavy, a
 * long one steps down a size and a little weight and wraps to more lines, at the same width, so every title reads in
 * one voice and is set whole, never clipped.
 */
export const titleLength = (title: string) => title.length > 44 ? "xlong" : title.length > 26 ? "long" : title.length > 14 ? "medium" : "short";
/** The title's longest word, in characters, which caps its size so that word fits its column whole (index.css). */
export const titleFit = (title: string) => ({ "--word": Math.max(4, ...title.split(/\s+/).map(word => word.length)) }) as CSSProperties;

/** The Stage's title, in the display face, set by its length so a long one still reads as type, never a paragraph. */
export function StageTitle({ title, as: Heading = "h1", id, className, children }: { title: string; as?: "h1" | "h2"; id?: string; className?: string; children?: ReactNode }) {
  return <Heading id={id} tabIndex={-1} data-length={titleLength(title)} style={titleFit(title)}
    className={cn("display-title text-balance outline-none", className)}>{children ?? title}</Heading>;
}
