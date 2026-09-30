import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from "@/components/ui/pagination";

export function BrowsePagination({ page, pages, previous, next, disabled, onNavigate, onSelectPage }: {
  page: number; pages?: number; previous?: string; next?: string; disabled: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onSelectPage: (page: number) => void;
}) {
  if (!previous && !next) return null;
  return <Pagination aria-label="Browse pages" className="mx-0 w-auto justify-start">
    <PaginationContent>
      {previous && <PaginationItem>{!disabled ? <PaginationLink size="icon" href={previous} aria-label="Previous page" onClick={event => onNavigate(event, previous)}><ChevronLeft aria-hidden="true" /></PaginationLink> : <Button variant="ghost" size="icon" disabled aria-label="Previous page"><ChevronLeft aria-hidden="true" /></Button>}</PaginationItem>}
      <PaginationItem>{pages && pages > 1 ? <Select value={String(page)} onValueChange={value => onSelectPage(Number(value))} disabled={disabled}>
        <SelectTrigger aria-label="Page" className="w-auto border-0 bg-transparent text-muted-foreground shadow-none dark:bg-transparent"><SelectValue>{page} / {pages}</SelectValue></SelectTrigger>
        <SelectContent>{Array.from({ length: pages }, (_, index) => <SelectItem key={index} value={String(index + 1)}>Page {index + 1} of {pages}</SelectItem>)}</SelectContent>
      </Select> : <span aria-current="page" className="px-3 text-sm text-muted-foreground">Page {page}</span>}</PaginationItem>
      {next && <PaginationItem>{!disabled ? <PaginationLink size="icon" href={next} aria-label="Next page" onClick={event => onNavigate(event, next)}><ChevronRight aria-hidden="true" /></PaginationLink> : <Button variant="ghost" size="icon" disabled aria-label="Next page"><ChevronRight aria-hidden="true" /></Button>}</PaginationItem>}
    </PaginationContent>
  </Pagination>;
}
