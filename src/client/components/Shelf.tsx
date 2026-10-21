import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detailHref, useDetailNavigation } from "@/detail-navigation";

/**
 * A shelf of MediaTiles under its heading: a plain overflow row that scrolls as focus moves along it. Its padding keeps
 * the focus outline clear of the clip. A heading with `href` opens all of what the shelf samples (a source's home,
 * every station, Saved), as one focus stop between it and the shelf above.
 */
export function Shelf({ title, label = title, time, href, loading = false, children }: { title: string; label?: string; time?: string; href?: string; loading?: boolean; children: ReactNode }) {
  const details = useDetailNavigation();
  const id = useId();
  const row = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const before = element.scrollLeft > 1, after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges(previous => previous.before === before && previous.after === after ? previous : { before, after });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { observer.disconnect(); element.removeEventListener("scroll", measure); };
  }, [children]);
  const scroll = (direction: number) => {
    const element = row.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
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
      {(edges.before || edges.after) && <div className="ml-auto hidden gap-1 pointer-fine:flex touch:hidden tv:hidden">
        <Button variant="ghost" size="icon" aria-label={`Previous in ${title}`} aria-controls={id} aria-disabled={!edges.before} className="aria-disabled:opacity-30" onClick={() => edges.before && scroll(-1)}><ChevronLeft aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon" aria-label={`Next in ${title}`} aria-controls={id} aria-disabled={!edges.after} className="aria-disabled:opacity-30" onClick={() => edges.after && scroll(1)}><ChevronRight aria-hidden="true" /></Button>
      </div>}
    </header>
    {/* A pointer scrolls it by its scrollbar; the TV, which has none, hides it. */}
    <ol ref={row} id={id} data-nav-row aria-label={label} className="-m-1 flex scroll-px-1 gap-4 overflow-x-auto p-1 pb-3 [scrollbar-width:thin] tv:[scrollbar-width:none]">{children}</ol>
  </section>;
}
