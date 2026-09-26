import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemMedia } from "@/components/ui/item";
import { cn } from "@/lib/utils";

/** A divided list of MediaRow items. */
export function MediaList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("@container m-0 list-none border-t p-0", className)} {...props} />;
}

type Props = {
  /** Thumbnail node, drawn 16:9. Omit for text-only rows (Up next). */
  art?: ReactNode;
  title: string;
  meta?: ReactNode;
  /** Extra line under the meta, e.g. a DurationBar. */
  children?: ReactNode;
  /** Shown only while the main button has keyboard focus. */
  description?: string;
  /** The row's one main verb: Play, Resume or Open. Omit for rows with no verb (a list's entries). */
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  /** Secondary verbs, revealed on hover or focus in wide lists; in narrow lists
   * (container queries on MediaList) and on touch they sit under the title. */
  actions?: ReactNode;
} & Omit<ComponentProps<"li">, "title" | "children">;

/**
 * Clock media row: thumbnail, title, meta and the length bar, with one main
 * verb and quiet secondary actions. Used by Find, Saved and Up next.
 */
export function MediaRow({ art, title, meta, children, description, primary, actions, className, ...props }: Props) {
  const body = <>
    <span className="w-full truncate text-base font-medium">{title}</span>
    {meta && <span className="w-full truncate text-sm text-muted-foreground">{meta}</span>}
    {children}
    {description && <span className="hidden max-w-prose text-sm text-muted-foreground group-focus-visible/main:block">{description}</span>}
  </>;
  return (
    <Item asChild size="xs" className={cn("grid gap-x-4 gap-y-1 rounded-none border-0 border-b border-border px-0 py-2", art ? "grid-cols-[5rem_minmax(0,1fr)] @md:grid-cols-[7rem_minmax(0,1fr)] @3xl:grid-cols-[7rem_minmax(0,1fr)_auto]" : "grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_auto]", className)}>
      <li data-nav-row {...props}>
        {art && <ItemMedia className="aspect-video w-full self-center overflow-hidden bg-muted *:size-full *:rounded-none [&_img]:object-cover">{art}</ItemMedia>}
        {primary ? <Button variant="ghost" data-play aria-label={`${primary.label} ${title}`} disabled={primary.disabled} onClick={primary.onClick}
          className="group/main h-auto min-w-0 touch:h-auto flex-col items-start justify-center gap-0.5 px-2 py-1.5 text-left font-normal whitespace-normal disabled:opacity-100">
          {body}
        </Button> : <div className="flex min-w-0 flex-col items-start justify-center gap-0.5 px-2 py-1.5">{body}</div>}
        {actions && <ItemActions className={cn("flex-wrap gap-0.5 @3xl:justify-end @3xl:opacity-0 @3xl:group-hover/item:opacity-100 @3xl:group-focus-within/item:opacity-100 [@media(hover:none)]:opacity-100", art && "col-start-2 @3xl:col-start-auto")}>{actions}</ItemActions>}
      </li>
    </Item>
  );
}
