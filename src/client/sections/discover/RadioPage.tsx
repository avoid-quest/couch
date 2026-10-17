import { offline } from "@/copy";
import { useSessionGate } from "@/session/session-context";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useCallback, useState } from "react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { PageHeader } from "@/components/PageHeader";
import { HitList, SourceProblems } from "@/sections/find/SearchPanel";
import { SearchRadioResults } from "@/sections/find/SearchRadioResults";
import type { SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { useShell } from "@/sections/shell/shell-context";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { radioBrowseLocation, radioBrowseSources } from "@/radio-navigation";
import { collectionPagination } from "@/collection-pagination";
import { BrowsePagination } from "@/components/BrowsePagination";
import { Input } from "@/components/ui/input";

/** Every station, which Discover's Radio heading opens: its source, count, Filter and pager. */
export function RadioPage() {
  const { credentials, available } = useShell();
  const { state, connected, run } = useSessionGate();
  const { search, searchStr } = useLocation();
  const navigate = useNavigate();
  const source = radioBrowseSources.find(value => value === new URLSearchParams(searchStr).get("radioSource")) ?? "avoid radio";
  const filter = typeof search.filter === "string" ? search.filter.slice(0, 200) : "";
  const requestedPage = typeof search.page === "number" && Number.isSafeInteger(search.page) && search.page > 0 ? search.page : 1;
  const [reported, setReported] = useState<{ source: string; summary: SearchResultSummary } | null>(null);
  const report = useCallback((name: string, summary: SearchResultSummary) => setReported({ source: name, summary }), []);
  const summary = reported?.source === source ? reported.summary : null;
  const hits = (summary?.hits ?? []).filter(hit => `${hit.title} ${hit.meta}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(hit => ({ ...hit, meta: hit.meta.split(" · ").filter(part => part !== source).join(" · ") }));
  const paging = collectionPagination(hits.length, requestedPage, []);
  const goToPage = (page: number) => void navigate({ href: radioBrowseLocation(source, page, filter), resetScroll: false }).then(() => {
    const heading = document.getElementById("radio-stations");
    heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" });
  });
  return <section data-page="Radio" className="min-w-0 space-y-6">
    <ContentBreadcrumb title="Radio" />
    <PageHeader title="Radio" />
    <ChoiceGroup label="Radio source" value={source} onValueChange={source => void navigate({ href: radioBrowseLocation(source) })} options={radioBrowseSources.map(value => ({ value, label: value }))} />
    {!connected && <p className="text-sm text-muted-foreground" role="status">{offline(state?.installationName)}</p>}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><p id="radio-stations" tabIndex={-1} className="flex items-center gap-2 text-sm text-muted-foreground outline-none">{summary?.loading && !summary.hits?.length ? <><Spinner className="size-3.5" /><span role="status">Loading stations…</span></> : <>{hits.length} {hits.length === 1 ? "station" : "stations"}</>}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Input type="search" aria-label="Filter these stations" placeholder="Filter" className="h-8 w-32 border-0 bg-transparent px-0 shadow-none dark:bg-transparent sm:w-40" value={filter} onChange={event => void navigate({ href: radioBrowseLocation(source, 1, event.target.value), replace: true, resetScroll: false })} />
        <BrowsePagination page={paging.page} pages={paging.pages} previous={paging.previous ? radioBrowseLocation(source, paging.page - 1, filter) : undefined} next={paging.next ? radioBrowseLocation(source, paging.page + 1, filter) : undefined} disabled={!connected || !!summary?.loading} onSelectPage={goToPage}
          onNavigate={(event, href) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); goToPage(Number(new URL(href, location.origin).searchParams.get("page") ?? 1)); }} />
      </div>
    </div>
    {hits.length ? <HitList pageFirst hits={hits.slice(paging.start, paging.end)} timeline={false} label="Radio stations" /> : null}
    {summary && <SourceProblems summaries={[[source, summary]]} />}
    {summary && !summary.loading && !summary.error && !hits.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>{filter ? "No stations match this filter. Try another name or clear the filter." : source === "avoid radio" ? "No stations are available right now. Try Radio playlists." : source === "Radio directory" ? "No stations are available right now. Try another source." : "No radio playlists yet. An admin can add one in Settings → Sources → Radio playlists."}</EmptyDescription></EmptyHeader></Empty>}
    <SearchRadioResults origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} browse source={source} query="" onResults={report} />
  </section>;
}
