import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { offline } from "@/copy";
import { useSessionGate } from "@/session/session-context";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useCallback, useState } from "react";
import { FilterBar, FilterChoice, FilterInput } from "@/components/ContentFilters";
import { ContentBack } from "@/components/ContentBack";
import { PageHeader } from "@/components/PageHeader";
import { HitList, SourceProblems } from "@/sections/find/SearchPanel";
import { SearchRadioResults } from "@/sections/find/SearchRadioResults";
import type { SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { useShell } from "@/sections/shell/shell-context";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { radioBrowseLocation, radioBrowseSources } from "@/radio-navigation";
import { collectionPagination } from "@/collection-pagination";
import { BrowsePagination } from "@/components/BrowsePagination";

/** Every station, which Discover's Radio heading opens: its source and Filter, then the stations and, past one page, a pager. */
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
  const hits = (summary?.hits ?? []).filter(hit => `${hit.title} ${hit.meta}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())).map(hit => ({ ...hit, meta: hit.meta.split(" · ").filter(part => part !== source).join(" · ") }));
  const paging = collectionPagination(hits.length, requestedPage, []);
  const goToPage = (page: number) => void navigate({ href: radioBrowseLocation(source, page, filter), resetScroll: false }).then(() => {
    const heading = document.getElementById("radio-stations");
    heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" });
  });
  return <section data-page="Radio" className="min-w-0 space-y-6">
    <PageHeader back={<ContentBack />} title="Radio" className="mb-0" />
    {!connected && <p className="text-sm text-muted-foreground" role="status">{offline(state?.installationName)}</p>}
    <FilterBar label="Radio filters">
      <FilterChoice label="Source" value={source} onChange={source => void navigate({ href: radioBrowseLocation(source, 1, filter), resetScroll: false })} options={radioBrowseSources.map(value => ({ value, label: value }))} />
      <FilterInput label="Filter stations" value={filter} onChange={filter => void navigate({ href: radioBrowseLocation(source, 1, filter), replace: true, resetScroll: false })} />
    </FilterBar>
    <p id="radio-stations" tabIndex={-1} role="status" className="sr-only">{summary && !summary.loading ? `${hits.length} ${hits.length === 1 ? "station" : "stations"}` : ""}</p>
    {connected && (!summary || summary.loading) && !hits.length && <MediaRowsSkeleton compact label="Loading stations…" />}
    {hits.length ? <HitList showSource={false} pageFirst hits={hits.slice(paging.start, paging.end)} compact label="Radio stations" /> : null}
    <BrowsePagination page={paging.page} pages={paging.pages} previous={paging.previous ? radioBrowseLocation(source, paging.page - 1, filter) : undefined} next={paging.next ? radioBrowseLocation(source, paging.page + 1, filter) : undefined} disabled={!connected || !!summary?.loading} onSelectPage={goToPage}
      onNavigate={(event, href) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); goToPage(Number(new URL(href, location.origin).searchParams.get("page") ?? 1)); }} />
    {summary && <SourceProblems summaries={[[source, summary]]} />}
    {summary && !summary.loading && !summary.error && !hits.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>{filter ? "No stations match this filter. Try another name or clear the filter." : source === "avoid radio" ? "No stations are available right now. Try Radio playlists." : source === "Radio directory" ? "No stations are available right now. Try another source." : "No radio playlists yet. An admin can add one in Settings → Sources → Radio playlists."}</EmptyDescription></EmptyHeader></Empty>}
    <SearchRadioResults origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} browse source={source} query="" onResults={report} />
  </section>;
}
