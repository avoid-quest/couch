import type { ComponentProps, CSSProperties, MouseEventHandler } from "react";
import { Button } from "@/components/ui/button";
import { MediaArtwork, useArtRatio } from "@/components/MediaArtwork";
import { cn } from "@/lib/utils";
import { detailHref } from "@/detail-navigation";
import { isTvPresentation } from "@/session/presentation";
import { shapeRatio } from "./Stage";
import { artAspect, artShape, fillsFrame, type ArtShape } from "@/art-shape";
import { ItemMenu, useItemMenu, type MenuAction } from "./RowMenu";
import { ArtLevel, useLevel } from "./Level";
import { useArtwork, useItemLight } from "./AmbientLight";
import { useRelatedMenu, type Related } from "./MediaContext";

// A channel keeps its circle in a frame of another shape: as large as the frame's shorter side, centred.
export const roundInFrame = "mx-auto aspect-square! h-auto! w-[min(100%,var(--tile-art))]! rounded-full object-cover";
/** A media item's shape (art-shape.ts): an episode is a frame, the rest go by their source. */
export const tileShape = (source: string | undefined, episode: boolean) => artShape(source, episode ? "episode" : "media");
// A tile's artwork height by its shelf's shape, so posters, frames and squares carry about the same weight and a shelf
// shows four to seven of them across a desktop; a frame on a 320px phone stays narrower than the column, so the next
// tile peeks.
const tileHeight = { poster: "[--tile-art:15rem]", square: "[--tile-art:10.5rem]", video: "[--tile-art:min(9rem,calc((100vw_-_2*var(--gutter))*.5))]", round: "[--tile-art:9rem]" } as const satisfies Record<ArtShape, string>;
// Its width follows from that height, set outright so the caption wraps at the artwork's edge.
const tileWidth = { poster: "w-[calc(var(--tile-art)*2/3)]", square: "w-(--tile-art)", video: "w-[calc(var(--tile-art)*16/9)]", round: "w-(--tile-art)" } as const satisfies Record<ArtShape, string>;

/**
 * One media item as a picture with a caption: its artwork at its true shape, how far it got as a line along the
 * artwork's foot, then a title and one meta line, and nothing else. It is one focus stop whose press does its main
 * verb; its other verbs, and where it leads (its series, channel or station: `related`), wait in its menu, behind a
 * "…" over the artwork's upper corner. Hovered or focused, the picture lights up in its own colour (index.css); focus
 * also rings it. The shadcn catalog has no media tile and Card breaks Flat, so it is the smallest Button composition.
 * `className` sizes the tile, such as its artwork's height (`--tile-art`).
 */
export function MediaTile({ title, meta, related, thumbnail, shape, own = shape, fit, logo = false, natural = false, progress, dim = false, source, className, href, onClick, disabled, menu = [], ...props }: {
  title: string;
  meta?: string;
  /** Where it leads (its source, creator, series, station), as "Go to …" verbs at the end of its menu. */
  related?: Related;
  thumbnail?: string;
  /** The frame: its shelf's majority shape. */
  shape: ArtShape;
  /** The item's own shape; another shape than the frame's is contained in it rather than cropped. */
  own?: ArtShape;
  /** Logos keep their margins: contain them whatever the frame. */
  fit?: "contain";
  /** A station mark needs a neutral ground that keeps both dark and light ink visible. */
  logo?: boolean;
  /** Home's shelves and Saved size the frame to the picture itself (a letterboxed frame without its bars), so it fills it. */
  natural?: boolean;
  progress?: number;
  /** Not available now (an offline channel): the artwork dims. */
  dim?: boolean;
  /** Its addresses (a page's URL; a station's `radio:{id}` and stream URL): while it is what plays, its artwork shows the level. */
  source?: string | readonly (string | undefined)[];
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  /** The item's other verbs, in its menu: its "…", right-click, a long press or a held OK. */
  menu?: MenuAction[];
} & Omit<ComponentProps<typeof Button>, "title" | "children" | "asChild" | "onClick">) {
  const options = useItemMenu([...menu, ...useRelatedMenu(related)]);
  const level = useLevel(source);
  const light = useItemLight(thumbnail);
  const mark = useArtwork(logo ? thumbnail : undefined);
  const [artRef, ratio] = useArtRatio(natural ? thumbnail : undefined, shapeRatio[own]);
  const body = <>
    <span data-tile-art data-own={own} className={cn("relative block h-(--tile-art) overflow-hidden rounded-md bg-background has-[img:not([data-loaded])]:bg-muted", artAspect[shape], tileWidth[shape], !fillsFrame(own, shape) && "rounded-none", own === "round" && shape !== "round" && "flex items-center", logo && mark?.clear !== false && "bg-neutral-500 [&>img]:bg-transparent [&>img]:p-3", dim && "[&>.media-artwork]:brightness-50 [&>.media-artwork]:grayscale")}>
      <MediaArtwork thumbnail={thumbnail} title={title} className={cn("aspect-auto size-full bg-background", shape === "round" && fillsFrame(own, shape) && "rounded-full", !natural && (logo || fit === "contain" || !fillsFrame(own, shape)) ? "object-contain" : "object-cover", own === "round" && shape !== "round" && roundInFrame)} />
      {progress != null && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-white/25"><span className="block h-full bg-white" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} /></span>}
      <ArtLevel level={level} className="size-8 text-base" />
    </span>
    {/* The title and its meta line, as wide as the artwork and wrapped whole (a shelf's tiles keep their own heights); nothing under them. */}
    <span data-tile-caption className="relative grid w-0 min-w-full content-start gap-caption">
      <span className="min-w-0 text-body font-medium text-pretty wrap-anywhere">{title}</span>
      {meta && <span data-tile-meta className="min-w-0 text-meta text-pretty wrap-anywhere text-muted-foreground">{meta}</span>}
    </span>
  </>;
  return <div ref={natural ? artRef : undefined} data-tile data-natural={natural || undefined} style={natural ? { "--tile-ratio": ratio } as CSSProperties : undefined} data-tile-shape={shape} {...options.item} onPointerEnter={light.onPointerEnter} onFocus={light.onFocus} className={cn("relative flex w-fit flex-col", tileHeight[shape], options.item.className, className)}>
    <Button variant="ghost" data-media-tile {...options.target} asChild={!!href && !disabled} disabled={disabled} className="peer h-auto w-min text-foreground flex-col items-stretch justify-start gap-3 rounded-none border-0 p-0 text-left font-normal whitespace-normal hover:bg-transparent active:bg-transparent disabled:opacity-50" {...props} onClick={event => {
      if (href && onClick) {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
      }
      onClick?.(event);
    }}>
      {href && !disabled ? <a href={detailHref(href)}>{body}</a> : body}
    </Button>
    {/* A "…" can't sit inside the tile's button, so it lies over the artwork's upper corner. A pointer sees it while it is over the tile or focus is in it (index.css); touch always does. On the TV it
        shows on the focused tile and is no focus stop, so Up and Down still go shelf to shelf and a held OK opens the menu, unless
        the press is disabled (nothing can play): then it is the tile's one stop, so its other verbs stay in reach. */}
    <ItemMenu data-tile-menu menu={options} title={title} tabIndex={isTvPresentation() && !disabled ? -1 : undefined}
      className="absolute top-1.5 right-1.5 size-8 bg-black/65 text-white backdrop-blur-sm hover:bg-black/85 hover:text-white touch:size-11" />
  </div>;
}
