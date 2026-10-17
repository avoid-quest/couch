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
  return source === "Radio" || source === "Bandcamp" ? "square" : (source === "StreamingCommunity" || source === "123MoviesFree") && !episode ? "poster" : "video";
}

/**
 * One media item as a single focus stop whose press does its main verb: contained artwork, a title
 * and one meta line, with its other verbs behind a "…" at the end of the title's line. The shadcn catalog has no
 * media tile and Card breaks Flat, so it is the smallest Button composition; index.css outlines its artwork and
 * inverts its caption on focus. `className` sizes the tile, such as its artwork's height (`--tile-art`).
 */
export function MediaTile({ title, meta, thumbnail, shape, children, className, href, onClick, disabled, menu = [], ...props }: {
  title: string;
  meta?: string;
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
    <span data-tile-art className={cn("block h-(--tile-art) overflow-hidden bg-muted", tileAspect[shape])}><MediaArtwork thumbnail={thumbnail} title={title} className="aspect-auto size-full object-contain" /></span>
    {/* The caption takes the artwork's width. A DurationBar keeps one scale across tiles and wraps its label under the bar. */}
    <span data-tile-caption className="grid w-0 min-w-full gap-0.5 px-1 pb-1 [--duration-width:6.5rem] [&_span:has(>[data-slot=progress])]:flex-wrap [&_span:has(>[data-slot=progress])]:gap-y-1">
      <span className={cn("line-clamp-2 text-base font-medium", options.shown.length && "pr-5")}>{title}</span>
      {meta && <span className="truncate text-sm text-muted-foreground">{meta}</span>}
      {children}
    </span>
  </>;
  return <div {...options.item} className={cn("relative flex w-fit [--tile-art:11rem]", options.item.className, className)}>
    <Button variant="ghost" data-media-tile {...options.target} asChild={!!href && !disabled} disabled={disabled} className="peer h-auto w-min flex-col items-stretch justify-start gap-2 rounded-none border-0 p-0 text-left font-normal whitespace-normal disabled:opacity-100" {...props} onClick={event => {
      if (href && onClick) {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
      }
      onClick?.(event);
    }}>
      {href && !disabled ? <a href={detailHref(href)}>{body}</a> : body}
    </Button>
    {/* A "…" can't sit inside the tile's button, so it lies over the end of the title's first line (which leaves it
        room), its dots flush with the text, and inverts with the caption. On the TV it is no focus stop, so Up and
        Down still go shelf to shelf; a held OK opens the menu. It is the line's height, so the caption keeps its
        own; on touch its ::after makes the 44px target. */}
    <ItemMenu menu={options} title={title} tabIndex={isTvPresentation() ? -1 : undefined}
      className="absolute top-[calc(var(--tile-art)+0.5rem)] right-0 size-6 peer-focus-visible:text-background touch:size-6 touch:after:absolute touch:after:-inset-2.5" />
  </div>;
}
