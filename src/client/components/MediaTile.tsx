import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { cn } from "@/lib/utils";
import { detailHref } from "@/detail-navigation";
import { isTvPresentation } from "@/session/presentation";
import { artAspect, artShape, fillsFrame, type ArtShape } from "@/art-shape";
import { ItemMenu, useItemMenu, type MenuAction } from "./RowMenu";
import { ArtLevel, useLevel } from "./Level";

export { artAspect as tileAspect, type ArtShape as TileShape };
/** A media item's shape (art-shape.ts): an episode is a frame, the rest go by their source. */
export const tileShape = (source: string | undefined, episode: boolean) => artShape(source, episode ? "episode" : "media");
// A tile's artwork height by its shelf's shape, so posters, frames and squares carry about the same weight; a frame on a
// 320px phone stays narrower than the column, so its "…" and the next tile show.
const tileHeight = { poster: "[--tile-art:18rem]", square: "[--tile-art:12rem]", video: "[--tile-art:min(11rem,calc((100vw-2*var(--gutter))*.5))]", round: "[--tile-art:10rem]" } as const satisfies Record<ArtShape, string>;
// Its width follows from that height, set outright so a shelf's grid sizes its columns by it.
const tileWidth = { poster: "w-[calc(var(--tile-art)*2/3)]", square: "w-(--tile-art)", video: "w-[calc(var(--tile-art)*16/9)]", round: "w-(--tile-art)" } as const satisfies Record<ArtShape, string>;

/**
 * One media item as a single focus stop whose press does its main verb: contained artwork, a title
 * and one meta line, with its other verbs behind a "…" at the end of the title's line. The shadcn catalog has no
 * media tile and Card breaks Flat, so it is the smallest Button composition; index.css outlines its artwork and
 * inverts its caption on focus. `className` sizes the tile, such as its artwork's height (`--tile-art`).
 */
export function MediaTile({ title, meta, context, thumbnail, shape, own = shape, fit, plays = false, dim = false, source, children, className, href, onClick, disabled, menu = [], ...props }: {
  title: string;
  meta?: string;
  context?: ReactNode;
  thumbnail?: string;
  /** The frame: its shelf's majority shape. */
  shape: ArtShape;
  /** The item's own shape; another shape than the frame's is contained in it rather than cropped. */
  own?: ArtShape;
  /** Logos keep their margins: contain them whatever the frame. */
  fit?: "contain";
  /** The press plays (or resumes): a pointer over the artwork sees Play. */
  plays?: boolean;
  /** Not available now (an offline channel): the artwork dims. */
  dim?: boolean;
  /** Its addresses (a page's URL; a station's `radio:{id}` and stream URL): while it is what plays, its artwork shows the level. */
  source?: string | readonly (string | undefined)[];
  /** Extra caption line, e.g. Continue's DurationBar. */
  children?: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  /** The item's other verbs, in its menu: its "…", right-click, a long press or a held OK. */
  menu?: MenuAction[];
} & Omit<ComponentProps<typeof Button>, "title" | "children" | "asChild" | "onClick">) {
  const options = useItemMenu(menu);
  const level = useLevel(source);
  const body = <>
    <span data-tile-art className={cn("relative block h-(--tile-art) overflow-hidden bg-background", artAspect[shape], tileWidth[shape], dim && "[&>.media-artwork]:brightness-50 [&>.media-artwork]:grayscale")}>
      <MediaArtwork thumbnail={thumbnail} title={title} className={cn("aspect-auto size-full bg-background", shape === "round" && "rounded-full", fit === "contain" || !fillsFrame(own, shape) ? "object-contain" : "object-cover")} />
      {/* Where the press plays, a pointer or keyboard focus dims the artwork under a Play disc (index.css); never on the TV. */}
      {plays && <span data-tile-hover aria-hidden="true" className="absolute inset-0 grid place-items-center"><span className="grid size-12 place-items-center rounded-full bg-foreground text-background"><Play className="size-5 translate-x-px fill-current" /></span></span>}
      <ArtLevel level={level} className="size-8 text-base" />
    </span>
    {/* The caption takes the artwork's width and always the room of two title lines and a meta line, so the shelf's
        tiles end level while each meta line follows its own title. */}
    <span data-tile-caption className="grid min-h-[4.375rem] w-0 min-w-full content-start gap-0.5 px-1 pb-1">
      <span className={cn("line-clamp-2 text-base leading-snug font-medium break-words", options.shown.length && "pr-8 touch:pr-11")}>{title}</span>
      {meta && <span className="truncate text-sm text-muted-foreground">{meta}</span>}
      {children}
    </span>
  </>;
  return <div data-tile {...options.item} className={cn("relative flex w-fit flex-col", tileHeight[shape], options.item.className, className)}>
    <Button variant="ghost" data-media-tile {...options.target} asChild={!!href && !disabled} disabled={disabled} className="peer h-auto w-min flex-col items-stretch justify-start gap-3 rounded-none border-0 p-0 text-left font-normal whitespace-normal hover:bg-transparent active:bg-transparent disabled:opacity-50" {...props} onClick={event => {
      if (href && onClick) {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
      }
      onClick?.(event);
    }}>
      {href && !disabled ? <a href={detailHref(href)}>{body}</a> : body}
    </Button>
    {context && <div className="w-0 min-w-full px-1">{context}</div>}
    {/* A "…" can't sit inside the tile's button, so it lies over the end of the title's first line (which leaves it
        room), its dots flush with the text, and inverts with the caption. A pointer sees it over or in the tile
        (index.css); touch always does. On the TV it is always shown and no focus stop, so Up and
        Down still go shelf to shelf and a held OK opens the menu, unless the press is disabled (nothing can play): then
        it is the tile's one stop, so its other verbs stay in reach. The two-line title reserves room for a real
        44px touch target, without an invisible hit area over the artwork or its neighbour. */}
    <ItemMenu data-tile-menu menu={options} title={title} tabIndex={isTvPresentation() && !disabled ? -1 : undefined}
      className="absolute top-[calc(var(--tile-art)+0.75rem)] right-0 size-8 peer-focus-visible:text-background touch:size-11" />
  </div>;
}
