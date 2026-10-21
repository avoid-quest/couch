import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { cn } from "@/lib/utils";
import { detailHref } from "@/detail-navigation";
import { isTvPresentation } from "@/session/presentation";
import { ItemMenu, useItemMenu, type MenuAction } from "./RowMenu";

export const tileAspect = { poster: "aspect-[2/3]", square: "aspect-square", video: "aspect-video" } as const;
export type TileShape = keyof typeof tileAspect;

/** Films and series are posters, stations and albums squares, videos and episodes 16:9 frames. */
export function tileShape(source: string | undefined, episode: boolean): TileShape {
  return source === "Radio" || source === "Bandcamp" ? "square" : ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"].includes(source ?? "") && !episode ? "poster" : "video";
}

/**
 * One media item as a single focus stop whose press does its main verb: contained artwork, a title
 * and one meta line, with its other verbs behind a "…" at the end of the title's line. The shadcn catalog has no
 * media tile and Card breaks Flat, so it is the smallest Button composition; index.css outlines its artwork and
 * inverts its caption on focus. `className` sizes the tile, such as its artwork's height (`--tile-art`).
 */
export function MediaTile({ title, meta, context, thumbnail, shape, children, className, href, onClick, disabled, menu = [], ...props }: {
  title: string;
  meta?: string;
  context?: ReactNode;
  thumbnail?: string;
  shape: TileShape;
  /** Extra caption line, e.g. Continue's DurationBar. */
  children?: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  /** The item's other verbs, in its menu: its "…", right-click, a long press or a held OK. */
  menu?: MenuAction[];
} & Omit<ComponentProps<typeof Button>, "title" | "children" | "asChild" | "onClick">) {
  const options = useItemMenu(menu);
  const body = <>
    <span data-tile-art className={cn("block h-(--tile-art) overflow-hidden bg-background", tileAspect[shape])}><MediaArtwork thumbnail={thumbnail} title={title} className="aspect-auto size-full bg-background object-contain" /></span>
    {/* The caption takes the artwork's width; two title lines keep metadata aligned across the shelf. */}
    <span data-tile-caption className="grid w-0 min-w-full gap-0.5 px-1 pb-1">
      <span className={cn("line-clamp-2 min-h-[2.75em] text-base leading-snug font-medium break-words", options.shown.length && "pr-8 touch:pr-11")}>{title}</span>
      {meta && <span className="truncate text-sm text-muted-foreground">{meta}</span>}
      {children}
    </span>
  </>;
  return <div {...options.item} className={cn("relative flex w-fit flex-col", shape === "poster" ? "[--tile-art:18rem]" : shape === "square" ? "[--tile-art:12rem]" : "[--tile-art:11rem]", options.item.className, className)}>
    <Button variant="ghost" data-media-tile {...options.target} asChild={!!href && !disabled} disabled={disabled} className="peer h-auto w-min flex-col items-stretch justify-start gap-3 rounded-none border-0 p-0 text-left font-normal whitespace-normal disabled:opacity-50" {...props} onClick={event => {
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
        room), its dots flush with the text, and inverts with the caption. On the TV it is no focus stop, so Up and
        Down still go shelf to shelf and a held OK opens the menu, unless the press is disabled (nothing can play): then
        it is the tile's one stop, so its other verbs stay in reach. The two-line title reserves room for a real
        44px touch target, without an invisible hit area over the artwork or its neighbour. */}
    <ItemMenu menu={options} title={title} tabIndex={isTvPresentation() && !disabled ? -1 : undefined}
      className="absolute top-[calc(var(--tile-art)+0.75rem)] right-0 size-8 peer-focus-visible:text-background touch:size-11" />
  </div>;
}
