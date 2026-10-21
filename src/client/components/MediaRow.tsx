import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemMedia } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { artAspect, fillsFrame, type ArtShape } from "@/art-shape";
import { detailHref } from "@/detail-navigation";
import { usePlayOn } from "./PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "./RowMenu";
import { ArtLevel, Level, useLevel } from "./Level";

/** A divided list of MediaRow items. */
export function MediaList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("@container m-0 list-none border-t p-0", className)} {...props} />;
}

// The thumbnail column by the list's shape, each about as tall as the others: a compact row's square is 4rem.
const rowArt = {
  compact: { video: "[--row-art:7rem]", square: "[--row-art:4rem]", round: "[--row-art:4rem]", poster: "[--row-art:2.75rem]" },
  regular: { video: "[--row-art:6rem] @md:[--row-art:8rem]", square: "[--row-art:3.375rem] @md:[--row-art:4.5rem]", round: "[--row-art:3.375rem] @md:[--row-art:4.5rem]", poster: "[--row-art:2.25rem] @md:[--row-art:3rem]" },
} as const satisfies Record<string, Record<ArtShape, string>>;

type Props = {
  /** Thumbnail node. Omit for text-only rows (Up next). */
  art?: ReactNode;
  /** The thumbnail's frame: its list's majority shape (square in compact rows, else 16:9, unless given). */
  shape?: ArtShape;
  /** The item's own shape; another shape than the frame's is contained in it rather than cropped. */
  own?: ArtShape;
  /** Logos keep their margins: contain them whatever the frame. */
  artFit?: "cover" | "contain";
  title: string;
  meta?: ReactNode;
  context?: ReactNode;
  /** Extra line under the meta, e.g. a DurationBar. */
  children?: ReactNode;
  /** A short preview; keyboard focus reveals the full description. */
  description?: string;
  /** The row's one main verb: Play, Resume or Open. Omit for rows with no verb (a list's entries). */
  primary?: { label: string; onClick: () => void; disabled?: boolean; href?: string };
  /** The row's other verbs (Queue, Save, Play on, Remove…), in its menu: its "…", right-click, a long press or a held OK. */
  menu?: MenuAction[];
  /** The page the row opens holds every verb in its menu, so the row shows no "…"; its shortcuts still open the menu. */
  menuOnPage?: boolean;
  /** Controls shown on the row itself, for rows with no main verb (a list's entries): revealed on hover or focus in
   * wide lists; in narrow lists (container queries on MediaList) and on touch they sit under the title. */
  actions?: ReactNode;
  /** Browse rows keep artwork and secondary controls on the same line. */
  compact?: boolean;
  /** The row's main verb is where its page starts (a source's home, whose header has no verbs). */
  pageFirst?: boolean;
  /** A tracklist's number, in place of artwork; the meta (its time) then ends the title's line. */
  number?: number;
  /** Its addresses (a page's URL; a station's `radio:{id}` and stream URL): while it is what plays, its artwork shows the level. */
  source?: string | readonly (string | undefined)[];
} & Omit<ComponentProps<"li">, "title" | "children">;

/**
 * Media row: thumbnail, title, meta and the length bar, as one target whose press does its main verb; its other
 * verbs wait in its menu, behind a "…" at its end, and on its page. Used by Search, Saved and Discover's pages; Up next has its own compact rows.
 */
export function MediaRow({ art, shape: frame, own, artFit = "cover", title, meta, context, children, description, primary, menu = [], menuOnPage = false, actions, compact = false, pageFirst = false, number, source, className, ...props }: Props) {
  const options = useItemMenu(menu);
  const level = useLevel(source);
  const { on } = usePlayOn();
  const shape = frame ?? (compact ? "square" : "video");
  const label = primary && (primary.label === "Play" || primary.label === "Resume" ? on(`${primary.label} ${title}`) : `${primary.label} ${title}`);
  const body = <>
    {number != null ? <span className="flex w-full items-baseline gap-4"><span className="line-clamp-2 min-w-0 flex-1 text-base font-medium">{title}</span>{meta && <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{meta}</span>}</span>
      : <span className="line-clamp-2 w-full text-base font-medium">{title}</span>}
    {meta && number == null && <span className="w-full truncate text-sm text-muted-foreground">{meta}</span>}
    {children}
    {description && <span className="line-clamp-2 w-full min-w-0 max-w-prose break-words text-sm text-muted-foreground group-focus-visible/main:line-clamp-none">{description}</span>}
  </>;
  // A pointer over the row tints all of it, artwork and "…" too; its main verb's own tint stays off (the TV has none).
  return <Item asChild size="xs" className={cn("relative grid gap-y-1 rounded-none border-0 border-b border-border px-0 py-3", primary && !primary.disabled && "hover:bg-foreground/10", number != null ? "grid-cols-[2rem_minmax(0,1fr)] gap-x-2 py-1" : compact ? cn("gap-x-3 grid-cols-[var(--row-art)_minmax(0,1fr)]", rowArt.compact[shape], actions && "grid-cols-[var(--row-art)_minmax(0,1fr)_auto]") : art ? cn("gap-x-4 grid-cols-[var(--row-art)_minmax(0,1fr)]", rowArt.regular[shape], actions && "@3xl:grid-cols-[var(--row-art)_minmax(0,1fr)_auto]") : cn("gap-x-4 grid-cols-1", actions && "@3xl:grid-cols-[minmax(0,1fr)_auto]"), className)}>
    <li data-nav-row {...props} {...options.item}>
      {/* The artwork is a larger pointer target for the main verb, as the now-playing bar's is. */}
      {/* A tracklist's playing track shows the level in place of its number. */}
      {number != null && <span aria-hidden="true" className="flex justify-end self-start pt-1.5 text-right text-sm leading-6 text-muted-foreground tabular-nums">{level ? <Level moving={level === "moving"} className="mt-1.5 text-xs text-foreground" /> : number}</span>}
      {art && <ItemMedia aria-hidden={!!primary || undefined} onClick={primary?.disabled ? undefined : primary?.onClick} className={cn("relative w-full self-start overflow-hidden bg-muted *:size-full *:rounded-[inherit]", primary && !primary.disabled && "cursor-pointer", artAspect[shape], artFit === "contain" || own && !fillsFrame(own, shape) ? "[&_img]:object-contain" : "[&_img]:object-cover")}>{art}<ArtLevel level={level} className="size-6! text-xs" /></ItemMedia>}
      {/* The "…" ends the main verb's line, so it keeps the trailing end on every screen and width. */}
      <div className="flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1">
        {primary ? <Button asChild={!!primary.href && !primary.disabled} variant="ghost" data-play data-page-first={pageFirst || undefined} {...options.target} aria-label={label} title={label !== `${primary.label} ${title}` ? label : undefined} disabled={primary.disabled} onClick={event => {
          if (primary.href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
          if (primary.href) event.preventDefault();
          primary.onClick();
        }}
          className="group/main h-auto w-full min-w-0 flex-col items-start justify-center gap-0.5 self-stretch px-2 py-1.5 text-left font-normal whitespace-normal hover:bg-transparent">
          {primary.href && !primary.disabled ? <a href={detailHref(primary.href)}>{body}</a> : body}
        </Button> : <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 px-2 py-1.5">{body}</div>}
        {context && <div className="min-w-0 px-2 empty:hidden">{context}</div>}
        </div>
        <ItemMenu menu={options} title={title} hidden={menuOnPage} className="mt-1.5" />
      </div>
      {actions && <ItemActions className={compact ? "col-start-3 row-start-1 flex-nowrap gap-0.5 self-center" : cn("flex-wrap gap-0.5 motion-safe:transition-opacity @3xl:row-start-1 @3xl:justify-end @3xl:opacity-0 @3xl:group-hover/item:opacity-100 @3xl:group-focus-within/item:opacity-100 [@media(hover:none)]:opacity-100", art && "col-start-2 @3xl:col-start-auto")}>{actions}</ItemActions>}
    </li>
  </Item>;
}
