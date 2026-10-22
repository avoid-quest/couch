import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { detailHref, useDetailNavigation } from "@/detail-navigation";

/**
 * A shelf of MediaTiles under its heading: a plain overflow row that scrolls as focus moves along it. Its padding keeps
 * the focus outline, and on the TV the lifted tile, clear of the clip. A heading with `href` opens all of what the shelf samples (a source's home,
 * every station, Saved), as one focus stop between it and the shelf above.
 */
export function Shelf({ title, label = title, time, href, loading = false, sparse = false, children }: { title: string; label?: string; time?: string; href?: string; loading?: boolean;
  /** One or two tiles: from `md` up, off the TV, the shelf takes only their width, so a page of short shelves sets them side by side. */
  sparse?: boolean; children: ReactNode }) {
  return <section aria-label={title} aria-busy={loading || undefined} data-sparse={sparse || undefined} className={cn("grid min-w-0 basis-full gap-2", sparse && "md:basis-auto tv:basis-full")}>
    <ShelfHeading title={title} href={href} time={time} loading={loading} />
    {/* It scrolls by wheel, trackpad, scrollbar or focus, out to the window's edges, so a long shelf runs off the right
        of the screen rather than stopping at the gutter; its padding holds a lit tile's glow, its ring and, on the TV, the
        lifted tile, clear of the clip. The TV, which moves by focus, hides the scrollbar. */}
    <ol data-nav-row data-shelf-row aria-label={label} className={cn("-mx-(--gutter) -my-6 flex scroll-px-(--gutter) gap-item overflow-x-auto px-(--gutter) py-6 [scrollbar-color:rgb(255_255_255/20%)_transparent] [scrollbar-width:thin] tv:[scrollbar-width:none]", sparse && "md:-mx-6 md:px-6 tv:-mx-(--gutter) tv:px-(--gutter)")}>{children}</ol>
  </section>;
}

/**
 * A shelf's or a list's heading at the heading size. With `href` it opens all of what it samples (a source's home, every
 * station, Saved), as one focus stop between it and what is above; `time` is a muted clock time after it.
 */
export function ShelfHeading({ title, href, time, loading = false }: { title: string; href?: string; time?: string; loading?: boolean }) {
  const details = useDetailNavigation();
  return <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="min-w-0 text-heading font-semibold">{href ? <Button asChild variant="ghost" className="group/heading -ml-3.5 h-auto min-h-11 gap-1 text-left text-heading font-semibold whitespace-normal text-foreground">
        {/* An id restores focus here when Back returns from what it opened. */}
        <a id={`shelf-${title.toLowerCase().replace(/\W+/g, "-")}`} href={detailHref(href)} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          details.open(href);
        }}>{title}<ChevronRight aria-hidden="true" className="text-muted-foreground group-hover/heading:text-foreground" /></a>
      </Button> : title}</h2>
      {loading && <span role="status" className="sr-only">Loading {title}…</span>}
      {time && <p className="text-meta text-muted-foreground tabular-nums">{time}</p>}
    </header>;
}
