import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { cn } from "@/lib/utils";
import { detailHref } from "@/detail-navigation";

export const tileAspect = { poster: "aspect-[2/3]", square: "aspect-square", video: "aspect-video" } as const;
export type TileShape = keyof typeof tileAspect;

/** Films and series are posters, stations and albums squares, videos and episodes 16:9 frames. */
export function tileShape(source: string | undefined, episode: boolean): TileShape {
  return source === "Radio" || source === "Bandcamp" ? "square" : (source === "StreamingCommunity" || source === "123MoviesFree") && !episode ? "poster" : "video";
}

/**
 * One media item as a single focus stop whose press does its main verb: contained artwork, a title
 * and one meta line. The shadcn catalog has no media tile and Card breaks Flat, so it is the smallest
 * Button composition; index.css outlines its artwork and inverts its caption on focus.
 */
export function MediaTile({ title, meta, thumbnail, shape, children, className, href, onClick, disabled, ...props }: {
  title: string;
  meta?: string;
  thumbnail?: string;
  shape: TileShape;
  /** Extra caption line, e.g. Continue's DurationBar. */
  children?: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
} & Omit<ComponentProps<typeof Button>, "title" | "children" | "asChild" | "onClick">) {
  const body = <>
    <span data-tile-art className={cn("block h-44 overflow-hidden bg-muted", tileAspect[shape])}><MediaArtwork thumbnail={thumbnail} title={title} className="aspect-auto size-full object-contain" /></span>
    {/* The caption takes the artwork's width. A DurationBar keeps one scale across tiles and wraps its label under the bar. */}
    <span data-tile-caption className="grid w-0 min-w-full gap-0.5 px-1 pb-1 [--duration-width:6.5rem] [&_span:has(>[data-slot=progress])]:flex-wrap [&_span:has(>[data-slot=progress])]:gap-y-1">
      <span className="line-clamp-2 text-base font-medium">{title}</span>
      {meta && <span className="truncate text-sm text-muted-foreground">{meta}</span>}
      {children}
    </span>
  </>;
  return <Button variant="ghost" data-media-tile asChild={!!href && !disabled} disabled={disabled} className={cn("h-auto w-min flex-col items-stretch gap-2 rounded-none border-0 p-0 text-left font-normal whitespace-normal disabled:opacity-100", className)} {...props} onClick={event => {
    if (href && onClick) {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
    }
    onClick?.(event);
  }}>
    {href && !disabled ? <a href={detailHref(href)}>{body}</a> : body}
  </Button>;
}
