import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { collectionLinks } from "@/collection-target";
import { collectionLocation } from "@/detail-navigation";
import { cn } from "@/lib/utils";
import type { MediaCollection } from "../../shared/media";

export function CollectionLinks({ collection, compact = false, className }: { collection?: MediaCollection; compact?: boolean; className?: string }) {
  const links = collectionLinks(collection);
  if (!links.length) return null;
  return <nav aria-label="Browse related content" className={cn("min-w-0", className)}>
    <ol className={cn("flex min-w-0 items-center gap-1 text-sm text-muted-foreground", !compact && "flex-wrap")}>
      {(compact ? links.slice(-1) : links).map((item, index) => <li key={item.url} className="flex min-w-0 items-center gap-1">
        {index > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />}
        <Link to={collectionLocation(item)} className={cn("inline-flex min-h-8 items-center px-1 hover:text-foreground hover:underline touch:min-h-11", compact ? "truncate text-xs" : "break-words")}>{item.title}</Link>
      </li>)}
    </ol>
  </nav>;
}
