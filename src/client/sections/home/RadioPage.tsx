import { radioLabels } from "../../../shared/radio";
import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { offline } from "@/copy";
import { useSessionGate } from "@/session/session-context";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useCallback, useState } from "react";
import { FilterBar, FilterChoice, FilterInput, FilterSelect } from "@/components/ContentFilters";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { PageHeader } from "@/components/PageHeader";
import { NoPlaylists } from "@/components/NoPlaylists";
import { HitList, SourceProblems } from "@/sections/find/SearchPanel";
import { SearchRadioResults } from "@/sections/find/SearchRadioResults";
import type { SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { useShell } from "@/sections/shell/shell-context";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { radioBrowseLocation, radioBrowseSources } from "@/radio-navigation";
import { collectionPagination } from "@/collection-pagination";
import { BrowsePagination } from "@/components/BrowsePagination";

// The sources as tabs under Radio, which names them already: Couch's built-in station list, the admin's playlists, and
// the public directory.
const sourceLabels = { "avoid radio": "Built-in", "Radio playlists": "Playlists", "Radio directory": "Directory" } as const satisfies Record<typeof radioBrowseSources[number], string>;

/** Every station, which Home's Radio heading opens: its source and Filter, then the stations and, past one page, a pager. */
export function RadioPage() {
  const { credentials, available } = useShell();
  const { state, connected, run } = useSessionGate();
  const { search, searchStr } = useLocation();
  const navigate = useNavigate();
  const source = radioBrowseSources.find(value => value === new URLSearchParams(searchStr).get("radioSource")) ?? "avoid radio";
  const filter = typeof search.filter === "string" ? search.filter.slice(0, 200) : "";
  const genre = new URLSearchParams(searchStr).get("genre") ?? "";
  const requestedPage = typeof search.page === "number" && Number.isSafeInteger(search.page) && search.page > 0 ? search.page : 1;
  const [reported, setReported] = useState<{ source: string; summary: SearchResultSummary } | null>(null);
  const report = useCallback((name: string, summary: SearchResultSummary) => setReported({ source: name, summary }), []);
  const summary = reported?.source === source ? reported.summary : null;
  const labels = (hit: NonNullable<SearchResultSummary["hits"]>[number]) => radioLabels([...(hit.radio?.tags ?? []), ...(hit.radio?.categories ?? [])]);
  const genres = radioLabels((summary?.hits ?? []).flatMap(labels)).sort((a, b) => a.localeCompare(b));
  const hits = (summary?.hits ?? []).filter(hit => (!genre || labels(hit).some(label => label.toLowerCase() === genre.toLowerCase())) && [hit.title, hit.meta, hit.radio?.host, hit.radio?.group, ...labels(hit)].join(" ").toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())).map(hit => ({ ...hit, meta: hit.meta.split(" · ").filter(part => part !== source).join(" · ") }));
  const paging = collectionPagination(hits.length, requestedPage, []);
  const goToPage = (page: number) => void navigate({ href: radioBrowseLocation(source, page, filter, genre), resetScroll: false }).then(() => {
    const heading = document.getElementById("radio-stations");
    heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" });
  });
  return <section data-page="Radio" className="min-w-0 space-y-6">
    <PageHeader breadcrumb={<ContentBreadcrumb />} title="Radio" />
    {!connected && <p className="text-sm text-muted-foreground" role="status">{offline(state?.installationName)}</p>}
    <FilterBar label="Radio filters">
      <FilterChoice label="Source" value={source} onChange={source => void navigate({ href: radioBrowseLocation(source, 1, filter, genre), resetScroll: false })} options={radioBrowseSources.map(value => ({ value, label: sourceLabels[value] }))} />
      {(genres.length > 0 || genre) && <FilterSelect label="Genre" value={genre || "__all"} onChange={value => void navigate({ href: radioBrowseLocation(source, 1, filter, value === "__all" ? "" : value), resetScroll: false })} options={[{ value: "__all", label: "All genres" }, ...radioLabels([...genres, ...(genre ? [genre] : [])]).map(value => ({ value, label: value }))]} />}
      <FilterInput label="Filter stations" value={filter} onChange={filter => void navigate({ href: radioBrowseLocation(source, 1, filter, genre), replace: true, resetScroll: false })} />
    </FilterBar>
    <p id="radio-stations" tabIndex={-1} role="status" className="sr-only">{summary && !summary.loading ? `${hits.length} ${hits.length === 1 ? "station" : "stations"}` : ""}</p>
    {connected && (!summary || summary.loading) && !hits.length && <MediaRowsSkeleton compact label="Loading stations…" />}
    {hits.length ? <HitList showSource={false} pageFirst hits={hits.slice(paging.start, paging.end)} compact label="Radio stations" /> : null}
    <BrowsePagination page={paging.page} pages={paging.pages} previous={paging.previous ? radioBrowseLocation(source, paging.page - 1, filter, genre) : undefined} next={paging.next ? radioBrowseLocation(source, paging.page + 1, filter, genre) : undefined} disabled={!connected || !!summary?.loading} onSelectPage={goToPage}
      onNavigate={(event, href) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); goToPage(Number(new URL(href, location.origin).searchParams.get("page") ?? 1)); }} />
    {summary && <SourceProblems summaries={[[source, summary]]} />}
    {summary && !summary.loading && !summary.error && !hits.length && (!filter && !genre && source === "Radio playlists" ? <NoPlaylists what="radio playlists" settings="/settings/couch/sources/radio" />
      : <Empty className="py-0"><EmptyHeader><EmptyDescription>{filter || genre ? "No stations match. Try another name or genre, or clear the filter." : "No stations are available right now. Try another source."}</EmptyDescription></EmptyHeader></Empty>)}
    <SearchRadioResults origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} browse source={source} query="" onResults={report} />
  </section>;
}
