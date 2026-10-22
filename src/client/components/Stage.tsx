import { useEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import type { ArtShape } from "@/art-shape";
import { cn } from "@/lib/utils";
import { MediaArtwork } from "./MediaArtwork";
import { useArtworkLight } from "./AmbientLight";

// While a page with a stage is at its top, the header lies over the stage's picture; once the page scrolls, the
// copy would pass under it, so it is black again.
const stages = new Set<Element>();
const mark = () => document.documentElement.toggleAttribute("data-stage-under-header", stages.size > 0 && scrollY < 4);

/**
 * The top of Home and of every Details page (docs/design.md, Stage): the picture enters from the window's right edge
 * at its own shape, under the header, and dissolves into its own light and then the black room; the title and its
 * verbs sit at the bottom left, in the dark. A logo or a channel's circle stands whole in that light instead. It is the
 * one bold thing in Couch; everything under it is quiet. `size` is Home's taller stage or a Details page's.
 */
export function Stage({ thumbnail, shape, fit, title, size = "details", label, className, children, ...props }: {
  thumbnail?: string; shape: ArtShape;
  /** Logos keep their margins: they stand whole, never bleed. */
  fit?: "contain";
  /** For the missing-artwork cover. */
  title: string;
  size?: "home" | "details";
  label?: string;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"section">, "title" | "children">) {
  const light = useArtworkLight(thumbnail);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    stages.add(element);
    mark();
    addEventListener("scroll", mark, { passive: true });
    return () => { removeEventListener("scroll", mark); stages.delete(element); mark(); };
  }, []);
  const whole = fit === "contain" || shape === "round";
  // A Details page's stage is its header; Home's is a section of the board.
  const Tag = size === "details" ? "header" : "section";
  return <Tag ref={root as never} {...props} data-stage={size} aria-label={label} className={cn("stage", className)}
    style={light ? { "--light-a": `rgb(${light.a.join(" ")})`, "--light-b": `rgb(${light.b.join(" ")})` } as CSSProperties : undefined}>
    {thumbnail !== undefined && <div aria-hidden="true" data-stage-picture data-detail-art={size === "details" || undefined} data-shape={shape} data-whole={whole || undefined} className="stage-picture">
      <div className="stage-frame"><MediaArtwork thumbnail={thumbnail} title={title} className={cn("aspect-auto size-full", whole ? "object-contain" : "object-cover", shape === "round" && "rounded-full object-cover")} /></div>
    </div>}
    <div className="stage-copy">{children}</div>
  </Tag>;
}

/** The Stage's title, set by its length so a long one still reads as one line of type, never a paragraph. */
export function StageTitle({ title, as: Heading = "h1", className }: { title: string; as?: "h1" | "h2"; className?: string }) {
  const length = title.length;
  return <Heading tabIndex={-1} title={title} data-length={length > 44 ? "long" : length > 22 ? "medium" : "short"}
    className={cn("stage-title line-clamp-3 font-semibold text-balance break-words outline-none", className)}>{title}</Heading>;
}
