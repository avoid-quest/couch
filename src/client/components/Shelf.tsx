import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detailHref, useDetailNavigation } from "@/detail-navigation";

/**
 * A shelf of MediaTiles under its heading: a plain overflow row that scrolls as focus moves along it. Its padding keeps
 * the focus outline clear of the clip. A heading with `href` opens all of what the shelf samples (a source's home,
 * every station, Saved), as one focus stop between it and the shelf above.
 */
export function Shelf({ title, label = title, time, href, children }: { title: string; label?: string; time?: string; href?: string; children: ReactNode }) {
  const details = useDetailNavigation();
  return <section aria-label={title} className="grid min-w-0 gap-3">
    <header className="flex min-h-8 items-baseline gap-3">
      <h2 className="text-base font-medium">{href ? <Button asChild variant="ghost" className="-ml-2.5 gap-1 text-base font-medium">
        {/* An id restores focus here when Back returns from what it opened. */}
        <a id={`shelf-${title.toLowerCase().replace(/\W+/g, "-")}`} href={detailHref(href)} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          details.open(href);
        }}>{title}<ChevronRight aria-hidden="true" className="text-muted-foreground" /></a>
      </Button> : title}</h2>
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time}</p>}
    </header>
    {/* A pointer scrolls it by its scrollbar; the TV, which has none, hides it. */}
    <ol data-nav-row aria-label={label} className="-m-1 flex scroll-px-1 gap-4 overflow-x-auto p-1 [scrollbar-width:thin] tv:[scrollbar-width:none]">{children}</ol>
  </section>;
}
