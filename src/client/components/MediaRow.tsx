import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemMedia } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { usePlayOn } from "./PlayOn";
import { isTvPresentation } from "@/session/presentation";

/** A divided list of MediaRow items. */
export function MediaList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("@container m-0 list-none border-t p-0", className)} {...props} />;
}

type Props = {
  /** Thumbnail node, drawn 16:9. Omit for text-only rows (Up next). */
  art?: ReactNode;
  /** Keep posters and album covers intact inside the thumbnail column. */
  artFit?: "cover" | "contain";
  title: string;
  meta?: ReactNode;
  /** Extra line under the meta, e.g. a DurationBar. */
  children?: ReactNode;
  /** A short preview; keyboard focus reveals the full description. */
  description?: string;
  /** The row's one main verb: Play, Resume or Open. Omit for rows with no verb (a list's entries). */
  primary?: { label: string; onClick: () => void; disabled?: boolean; href?: string };
  /** Secondary verbs, revealed on hover or focus in wide lists; in narrow lists
   * (container queries on MediaList) and on touch they sit under the title. */
  actions?: ReactNode;
  /** Keep operations reachable when the row has no complete Details destination. */
  tvSecondaryActions?: boolean;
  /** Browse rows keep artwork and secondary controls on the same line. */
  compact?: boolean;
} & Omit<ComponentProps<"li">, "title" | "children">;

/**
 * Clock media row: thumbnail, title, meta and the length bar, with one main
 * verb and quiet secondary actions. Used by Home, Live, Search and Library; Up next has its own compact rows.
 */
export function MediaRow({ art, artFit = "cover", title, meta, children, description, primary, actions, tvSecondaryActions = false, compact = false, className, ...props }: Props) {
  const tv = isTvPresentation();
  const { on } = usePlayOn();
  const label = primary && (primary.label === "Play" || primary.label === "Resume" ? on(`${primary.label} ${title}`) : `${primary.label} ${title}`);
  const body = <>
    <span className="line-clamp-2 w-full text-base font-medium">{title}</span>
    {meta && <span className="w-full truncate text-sm text-muted-foreground">{meta}</span>}
    {children}
    {description && <span className="line-clamp-2 w-full min-w-0 max-w-prose break-words text-sm text-muted-foreground group-focus-visible/main:line-clamp-none">{description}</span>}
  </>;
  return (
    <Item asChild size="xs" className={cn("grid gap-y-1 rounded-none border-0 border-b border-border px-0 py-2", compact ? "gap-x-3 grid-cols-[3rem_minmax(0,1fr)_auto]" : art ? "gap-x-4 grid-cols-[5rem_minmax(0,1fr)] @md:grid-cols-[7rem_minmax(0,1fr)] @3xl:grid-cols-[7rem_minmax(0,1fr)_auto]" : "gap-x-4 grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_auto]", className)}>
      <li data-nav-row {...props}>
        {art && <ItemMedia inert={tv && !!primary || undefined} aria-hidden={tv && !!primary || undefined} className={cn("w-full self-center overflow-hidden bg-muted *:size-full *:rounded-none", compact ? "aspect-square" : "aspect-video", artFit === "contain" ? "[&_img]:object-contain" : "[&_img]:object-cover")}>{art}</ItemMedia>}
        {primary ? <Button asChild={!!primary.href} variant="ghost" data-play aria-label={label} title={label !== `${primary.label} ${title}` ? label : undefined} disabled={primary.disabled} onClick={event => {
          if (primary.href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
          if (primary.href) event.preventDefault();
          primary.onClick();
        }}
          className="group/main h-auto min-w-0 flex-col items-start justify-center gap-0.5 px-2 py-1.5 text-left font-normal whitespace-normal disabled:opacity-100">
          {primary.href ? <a href={primary.href}>{body}</a> : body}
        </Button> : <div className="flex min-w-0 flex-col items-start justify-center gap-0.5 px-2 py-1.5">{body}</div>}
        {actions && !(tv && primary && !tvSecondaryActions) && <ItemActions className={compact ? "col-start-3 row-start-1 flex-nowrap gap-0.5 self-center" : cn("flex-wrap gap-0.5 @3xl:justify-end @3xl:opacity-0 @3xl:group-hover/item:opacity-100 @3xl:group-focus-within/item:opacity-100 [@media(hover:none)]:opacity-100", art && "col-start-2 @3xl:col-start-auto")}>{actions}</ItemActions>}
      </li>
    </Item>
  );
}
