import type { ReactNode } from "react";

/**
 * A shelf of MediaTiles under its heading: a plain overflow row that scrolls as focus moves along it. Its padding keeps
 * the focus outline clear of the clip. It has no action: the tabs and the now-playing bar reach Live, Library and Up
 * next, so Up from a shelf meets only the shelves above it.
 */
export function Shelf({ title, label = title, time, children }: { title: string; label?: string; time?: string; children: ReactNode }) {
  return <section aria-label={title} className="grid min-w-0 gap-3">
    <header className="flex min-h-8 items-baseline gap-3">
      <h2 className="text-base font-medium">{title}</h2>
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time}</p>}
    </header>
    {/* A pointer scrolls it by its scrollbar; the TV, which has none, hides it. */}
    <ol data-nav-row aria-label={label} className="-m-1 flex scroll-px-1 gap-4 overflow-x-auto p-1 [scrollbar-width:thin] tv:[scrollbar-width:none]">{children}</ol>
  </section>;
}
