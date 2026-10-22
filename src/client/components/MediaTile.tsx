import type { ComponentProps, MouseEventHandler } from "react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { cn } from "@/lib/utils";
import { detailHref } from "@/detail-navigation";
import { isTvPresentation } from "@/session/presentation";
import { artAspect, artShape, fillsFrame, type ArtShape } from "@/art-shape";
import { ItemMenu, useItemMenu, type MenuAction } from "./RowMenu";
import { ArtLevel, useLevel } from "./Level";
import { useItemLight } from "./AmbientLight";
import { useRelatedMenu, type Related } from "./MediaContext";

// A channel keeps its circle in a frame of another shape: a circle the frame's height, centred.
export const roundInFrame = "mx-auto aspect-square! h-full w-auto! rounded-full object-cover";
export { artAspect as tileAspect, type ArtShape as TileShape };
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
 * "…" at the end of the title's line. Hovered or focused, the picture lights up in its own colour (index.css); focus
 * also rings it. The shadcn catalog has no media tile and Card breaks Flat, so it is the smallest Button composition.
 * `className` sizes the tile, such as its artwork's height (`--tile-art`).
 */
export function MediaTile({ title, meta, related, thumbnail, shape, own = shape, fit, progress, dim = false, source, className, href, onClick, disabled, menu = [], ...props }: {
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
  /** How far it got, 0 to 1: a line along the artwork's foot. */
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
  const body = <>
    <span data-tile-art className={cn("relative block h-(--tile-art) overflow-hidden bg-background has-[img:not([data-loaded])]:bg-muted", artAspect[shape], tileWidth[shape], !fillsFrame(own, shape) && "rounded-none", dim && "[&>.media-artwork]:brightness-50 [&>.media-artwork]:grayscale")}>
      <MediaArtwork thumbnail={thumbnail} title={title} className={cn("aspect-auto size-full bg-background", shape === "round" && fillsFrame(own, shape) && "rounded-full", fit === "contain" || !fillsFrame(own, shape) ? "object-contain" : "object-cover", own === "round" && shape !== "round" && roundInFrame)} />
      {progress != null && <span data-tile-progress aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-black/60"><span className="block h-full bg-foreground" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} /></span>}
      <ArtLevel level={level} className={cn("size-8 text-base", progress != null && "bottom-1")} />
    </span>
    {/* A title of up to two lines and one meta line, as wide as the artwork; nothing under it. */}
    <span data-tile-caption className="relative grid w-0 min-w-full content-start gap-0.5">
      <span className={cn("line-clamp-2 text-[.9375rem] leading-snug font-medium break-words", options.shown.length && "pr-8 touch:pr-11")}>{title}</span>
      {meta && <span data-tile-meta className="truncate text-sm text-muted-foreground">{meta}</span>}
    </span>
  </>;
  return <div data-tile {...options.item} onPointerEnter={light.onPointerEnter} onFocus={light.onFocus} style={light.style} className={cn("relative flex w-fit flex-col", tileHeight[shape], options.item.className, className)}>
    <Button variant="ghost" data-media-tile {...options.target} asChild={!!href && !disabled} disabled={disabled} className="peer h-auto w-min text-foreground flex-col items-stretch justify-start gap-2.5 rounded-none border-0 p-0 text-left font-normal whitespace-normal hover:bg-transparent active:bg-transparent disabled:opacity-50" {...props} onClick={event => {
      if (href && onClick) {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
      }
      onClick?.(event);
    }}>
      {href && !disabled ? <a href={detailHref(href)}>{body}</a> : body}
    </Button>
    {/* A "…" can't sit inside the tile's button, so it lies over the end of the title's first line, which leaves it
        room. A pointer sees it while it is over the tile or focus is in it (index.css); touch always does. On the TV it
        is always shown and no focus stop, so Up and Down still go shelf to shelf and a held OK opens the menu, unless
        the press is disabled (nothing can play): then it is the tile's one stop, so its other verbs stay in reach. */}
    <ItemMenu data-tile-menu menu={options} title={title} tabIndex={isTvPresentation() && !disabled ? -1 : undefined}
      className="absolute top-[calc(var(--tile-art)+.25rem)] right-0 size-8 text-muted-foreground hover:bg-transparent hover:text-foreground touch:top-[calc(var(--tile-art)+.0625rem)] touch:size-11" />
  </div>;
}
