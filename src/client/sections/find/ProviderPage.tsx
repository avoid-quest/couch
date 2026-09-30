import { useCallback, useState, type MouseEvent } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { readCollectionSearch, collectionPagination } from "@/collection-pagination";
import { collectionLocation } from "@/detail-navigation";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { CollectionHeader, HitList, SourceProblems } from "./SearchPanel";
import { providerNames, SearchOnlineResults, type SearchResultSummary } from "./SearchOnlineResults";
import type { ProviderId } from "../../../shared/providers";

export function ProviderPage() {
  const { search } = useLocation();
  const state = readCollectionSearch(search);
  if (!state.provider) return <section data-page="Collection">
    <ContentBreadcrumb title="Collection unavailable" />
    <PageHeader title="Collection unavailable" />
    <p className="text-muted-foreground">This collection link is incomplete or unsupported.</p>
  </section>;
  return <CollectionPage key={`${state.provider}:${state.url}`} provider={state.provider} url={state.url ?? ""} search={state} />;
}

function CollectionPage({ provider, url, search }: { provider: ProviderId; url: string; search: ReturnType<typeof readCollectionSearch> }) {
  const { credentials, available, openProvider, current } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const navigate = useNavigate();
  const cursor = search.cursors.at(-1);
  const [reported, setReported] = useState<{ cursor?: string; summary: SearchResultSummary } | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setReported({ cursor, summary }), [cursor]);
  const summary = reported?.cursor === cursor ? reported?.summary : undefined;
  const collection = summary?.collection ?? { title: providerNames[provider], source: providerNames[provider], description: summary?.page?.description };
  const page = summary?.page;
  const source = current?.source.replace(/^web:/, "");
  const hits = (summary?.hits ?? []).filter(hit => `${hit.title} ${hit.meta}`.toLocaleLowerCase().includes(search.filter.toLocaleLowerCase()));
  const paging = collectionPagination(hits.length, search.page, search.cursors, page?.nextCursor);
  const currentId = hits.find(hit => hit.url === source)?.id;
  const noun = provider === "bandcamp" ? url ? "Tracks" : "Albums" : /\/season-\d+|\/ContentSet-/.test(url) ? "Episodes" : provider === "streamingcommunity" && /\/titles\/\d+/.test(url) && !!page?.items.length && page.items.every(item => item.kind === "collection") ? "Seasons" : "Items";
  const href = (direction: "previous" | "next") => collectionLocation({ provider, url }, { ...search,
    ...(paging.remote ? { cursors: direction === "previous" ? search.cursors.slice(0, -1) : [...search.cursors, page!.nextCursor!], page: 1 } : { page: paging.page + (direction === "previous" ? -1 : 1) }) });
  const goToPage = (href: string) => {
    void navigate({ href, resetScroll: false }).then(() => {
      const heading = document.getElementById("collection-items");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "start" });
    });
  };
  const turnPage = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); goToPage(href);
  };
  const pager = <CollectionPager page={paging.page} pages={paging.pages} previous={paging.previous ? href("previous") : undefined} next={paging.next ? href("next") : undefined} disabled={!connected || !!summary?.loading} onNavigate={turnPage}
    onSelectPage={page => goToPage(collectionLocation({ provider, url }, { ...search, page }))} />;
  return <section data-page="Collection" className="min-w-0 space-y-6">
    <SearchOnlineResults provider={provider} query="" url={url} cursor={cursor} context={search.context} paged onOpenCollection={openProvider} onResults={report} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    <ContentBreadcrumb title={collection.title} provider={provider} collection={search.context ?? page?.item?.collection ?? page?.parent} />
    <CollectionHeader collection={collection} canPlay={available} />
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this collection.</p>}
    {summary?.loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Loading items…</p>}
    {!collection.single && <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="collection-items" tabIndex={-1} className="text-sm text-muted-foreground">{hits.length} {noun.toLocaleLowerCase().replace(/s$/, hits.length === 1 ? "" : "s")}{paging.remote && " on this page"}</h2>
        <div className="flex flex-wrap items-center gap-4">
          {((summary?.hits?.length ?? 0) > 8 || search.filter) && <Input type="search" aria-label={paging.remote ? "Filter this page" : `Filter ${noun.toLocaleLowerCase()}`} placeholder="Filter" className="h-8 w-32 border-0 bg-transparent px-0 shadow-none dark:bg-transparent sm:w-40" value={search.filter}
            onChange={event => void navigate({ href: collectionLocation({ provider, url }, { ...search, page: 1, filter: event.target.value }), replace: true, resetScroll: false })} />}
          {pager}
        </div>
      </div>
      <HitList hits={hits.slice(paging.start, paging.end)} currentId={currentId} timeline={false} label={`${collection.title} ${noun.toLocaleLowerCase()}`} />
      {connected && summary && !summary.loading && !summary.error && !hits.length && <Empty><EmptyHeader><EmptyTitle>{search.filter ? "No matching items" : "No items available"}</EmptyTitle><EmptyDescription>{search.filter ? "Try another name or clear the filter to see this list." : "This collection has no available items."}</EmptyDescription></EmptyHeader>{search.filter && <Button variant="ghost" onClick={() => void navigate({ href: collectionLocation({ provider, url }, { ...search, page: 1, filter: "" }), replace: true })}>Clear filter</Button>}</Empty>}
    </>}
    <SourceProblems summaries={summary ? [[providerNames[provider], summary]] : []} />
  </section>;
}

function CollectionPager({ page, pages, previous, next, disabled, onNavigate, onSelectPage }: {
  page: number; pages?: number; previous?: string; next?: string; disabled: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onSelectPage: (page: number) => void;
}) {
  if (!previous && !next) return null;
  return <Pagination aria-label="Collection pages" className="justify-start">
    <PaginationContent>
      <PaginationItem>{previous && !disabled ? <PaginationPrevious href={previous} onClick={event => onNavigate(event, previous)} /> : <Button variant="ghost" disabled>Previous</Button>}</PaginationItem>
      <PaginationItem>{pages && pages > 1 ? <Select value={String(page)} onValueChange={value => onSelectPage(Number(value))} disabled={disabled}>
        <SelectTrigger aria-label="Page" className="w-auto"><SelectValue /></SelectTrigger>
        <SelectContent>{Array.from({ length: pages }, (_, index) => <SelectItem key={index} value={String(index + 1)}>Page {index + 1} of {pages}</SelectItem>)}</SelectContent>
      </Select> : <span aria-current="page" className="px-3 text-sm text-muted-foreground">Page {page}</span>}</PaginationItem>
      <PaginationItem>{next && !disabled ? <PaginationNext href={next} onClick={event => onNavigate(event, next)} /> : <Button variant="ghost" disabled>Next</Button>}</PaginationItem>
    </PaginationContent>
  </Pagination>;
}
