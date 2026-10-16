import type { ReactNode } from "react";

/** A shelf of MediaTiles under its heading: a plain overflow row that scrolls as focus moves along it. Its padding keeps the focus outline clear of the clip. */
export function Shelf({ title, label = title, time, action, children }: { title: string; label?: string; time?: string; action?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="grid min-w-0 gap-3">
    <header className="flex min-h-8 items-baseline gap-3">
      <h2 className="text-base font-medium">{title}</h2>
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time}</p>}
      {/* The TV's tab bar reaches Live and Library and its now-playing bar Up next, so Up from a shelf meets only the shelves above it. */}
      {action && <div className="-my-2 ml-auto -mr-2.5 tv:hidden">{action}</div>}
    </header>
    <ol data-nav-row aria-label={label} className="-m-1 flex scroll-px-1 gap-4 overflow-x-auto p-1 [scrollbar-width:thin] tv:[scrollbar-width:none]">{children}</ol>
  </section>;
}
