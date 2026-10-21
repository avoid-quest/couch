import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detailHref, useDetailNavigation } from "@/detail-navigation";

/**
 * A shelf of MediaTiles under its heading: a plain overflow row that scrolls as focus moves along it. Its padding keeps
 * the focus outline, and on the TV the lifted tile, clear of the clip. A heading with `href` opens all of what the shelf samples (a source's home,
 * every station, Saved), as one focus stop between it and the shelf above.
 */
export function Shelf({ title, label = title, time, href, loading = false, children }: { title: string; label?: string; time?: string; href?: string; loading?: boolean; children: ReactNode }) {
  const details = useDetailNavigation();
  return <section aria-label={title} aria-busy={loading || undefined} className="grid min-w-0 gap-3">
    <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="min-w-0 text-xl font-semibold tracking-tight">{href ? <Button asChild variant="ghost" className="-ml-2.5 h-auto min-h-11 gap-1 text-left text-xl font-semibold tracking-tight whitespace-normal">
        {/* An id restores focus here when Back returns from what it opened. */}
        <a id={`shelf-${title.toLowerCase().replace(/\W+/g, "-")}`} href={detailHref(href)} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          details.open(href);
        }}>{title}<ChevronRight aria-hidden="true" className="text-muted-foreground" /></a>
      </Button> : title}</h2>
      {loading && <span role="status" className="sr-only">Loading {title}…</span>}
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time}</p>}
    </header>
    {/* It scrolls by wheel, trackpad, scrollbar or focus; the TV, which moves by focus, hides the scrollbar. */}
    <ol data-nav-row aria-label={label} className="-m-1 flex scroll-px-1 gap-4 overflow-x-auto p-1 pb-3 [scrollbar-width:thin] tv:-m-4 tv:scroll-px-4 tv:p-4 tv:[scrollbar-width:none]">{children}</ol>
  </section>;
}
