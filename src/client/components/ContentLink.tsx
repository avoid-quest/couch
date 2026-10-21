import type { ComponentProps } from "react";
import { detailHref, useDetailNavigation } from "@/detail-navigation";
import { cn } from "@/lib/utils";

/** Internal content navigation with the same Back/focus behavior as Details. */
export function ContentLink({ href, className, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  const navigation = useDetailNavigation();
  return <a data-text-link {...props} href={detailHref(href)} className={cn("rounded-sm underline decoration-foreground/30 underline-offset-4 hover:text-foreground hover:decoration-foreground", className)} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigation.open(href);
  }} />;
}
