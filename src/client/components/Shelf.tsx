import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detailHref, useDetailNavigation } from "@/detail-navigation";

/**
 * A shelf of MediaTiles under its heading: native overflow, with paging controls when a mouse needs them. Its padding keeps
 * the focus outline, and on the TV the lifted tile, clear of the clip. A heading with `href` opens all of what the shelf samples (a source's home,
 * every station, Saved), as one focus stop between it and the shelf above.
 */
export function Shelf({ title, label = title, href, loading = false, children }: { title: string; label?: string; href?: string; loading?: boolean; children: ReactNode }) {
  const id = useId();
  const row = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  useEffect(() => {
    const element = row.current!;
    const measure = () => {
      const previous = element.scrollLeft > 1;
      const next = element.scrollWidth - element.clientWidth - element.scrollLeft > 1;
      setEdges(old => old.previous === previous && old.next === next ? old : { previous, next });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { observer.disconnect(); element.removeEventListener("scroll", measure); };
  }, [children]);
  const advance = (direction: number) => {
    const element = row.current!;
    const gutter = parseFloat(getComputedStyle(element).paddingLeft);
    element.scrollBy({ left: direction * (element.clientWidth - 2 * gutter), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <section aria-label={title} aria-busy={loading || undefined} className="grid min-w-0 gap-2">
    <div className="flex items-center justify-between gap-4">
      <ShelfHeading title={title} href={href} loading={loading} />
      {(edges.previous || edges.next) && <div className="flex gap-1 tv:hidden [@media(pointer:coarse)]:hidden">
        <Button variant="ghost" size="icon-lg" aria-label={`Previous ${title}`} aria-controls={id} disabled={!edges.previous} onClick={() => advance(-1)}><ChevronLeft aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon-lg" aria-label={`Next ${title}`} aria-controls={id} disabled={!edges.next} onClick={() => advance(1)}><ChevronRight aria-hidden="true" /></Button>
      </div>}
    </div>
    {/* It scrolls by wheel, trackpad, scrollbar or focus, out to the window's edges, so a long shelf runs off the right
        of the screen rather than stopping at the gutter; its padding holds a lit tile's glow, its ring and, on the TV, the
        lifted tile, clear of the clip. The TV, which moves by focus, hides the scrollbar. */}
    <ol ref={row} id={id} data-nav-row data-shelf-row aria-label={label} className="-mx-(--gutter) -my-6 flex scroll-px-(--gutter) gap-item overflow-x-auto px-(--gutter) py-6 [scrollbar-color:rgb(255_255_255/20%)_transparent] [scrollbar-width:thin] tv:[scrollbar-width:none]">{children}</ol>
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
