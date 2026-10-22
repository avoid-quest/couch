import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from "@/components/ui/pagination";

/** One pager under every list with more than one page: Previous, the page and Next hold their slots, disabled when they can't move. */
export function BrowsePagination({ page, pages, previous, next, disabled, onNavigate, onSelectPage }: {
  page: number; pages?: number; previous?: string; next?: string; disabled: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onSelectPage: (page: number) => void;
}) {
  if (pages ? pages < 2 : page < 2 && !next) return null;
  const step = (href: string | undefined, label: string, icon: ReactNode) => <PaginationItem>{href && !disabled
    ? <PaginationLink size="icon" href={href} aria-label={label} onClick={event => onNavigate(event, href)}>{icon}</PaginationLink>
    : <Button variant="ghost" size="icon" disabled aria-label={label}>{icon}</Button>}</PaginationItem>;
  return <Pagination aria-label="Browse pages" className="mx-0 w-auto justify-start">
    <PaginationContent>
      {step(previous, "Previous page", <ChevronLeft aria-hidden="true" />)}
      <PaginationItem><Select value={String(page)} onValueChange={value => onSelectPage(Number(value))} disabled={disabled || !pages}>
        <SelectTrigger aria-label="Page" className="w-auto border-0 bg-transparent text-muted-foreground shadow-none dark:bg-transparent"><SelectValue>{pages ? `Page ${page} of ${pages}` : `Page ${page}`}</SelectValue></SelectTrigger>
        <SelectContent>{Array.from({ length: pages ?? page }, (_, index) => <SelectItem key={index} value={String(index + 1)}>Page {index + 1}{pages ? ` of ${pages}` : ""}</SelectItem>)}</SelectContent>
      </Select></PaginationItem>
      {step(next, "Next page", <ChevronRight aria-hidden="true" />)}
    </PaginationContent>
  </Pagination>;
}
