import { offline } from "@/copy";
import { useOptionalSessionGate } from "@/session/session-context";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useCallback, useState } from "react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { PageHeader } from "@/components/PageHeader";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { HitList, SourceProblems } from "./SearchPanel";
import { SearchRadioResults } from "./SearchRadioResults";
import type { SearchPlaybackProps, SearchResultSummary } from "./SearchOnlineResults";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { radioBrowseLocation, radioBrowseSources } from "@/radio-navigation";
import { collectionPagination } from "@/collection-pagination";
import { BrowsePagination } from "@/components/BrowsePagination";
import { Input } from "@/components/ui/input";

export function BrowseRadio(props: SearchPlaybackProps) {
  const name = useOptionalSessionGate()?.state?.installationName;
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
  return <section className="min-w-0 space-y-6" aria-label="Browse radio">
    <ContentBreadcrumb title="Radio" />
    <PageHeader title="Radio" className="mb-0" />
    <ChoiceGroup label="Radio source" value={source} onValueChange={source => void navigate({ href: radioBrowseLocation(source) })} options={radioBrowseSources.map(value => ({ value, label: value }))} />
    {!props.connected && <p className="text-sm text-muted-foreground" role="status">{offline(name)}</p>}
    {summary?.loading && !summary.hits?.length && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />Loading stations…</p>}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><h2 id="radio-stations" tabIndex={-1} className="text-sm text-muted-foreground">{hits.length} {hits.length === 1 ? "station" : "stations"}</h2>
      <div className="flex flex-wrap items-center gap-4">
        {((summary?.hits?.length ?? 0) > 8 || filter) && <Input type="search" aria-label="Filter these stations" placeholder="Filter" className="h-8 w-32 border-0 bg-transparent px-0 shadow-none dark:bg-transparent sm:w-40" value={filter} onChange={event => void navigate({ href: radioBrowseLocation(source, 1, event.target.value), replace: true, resetScroll: false })} />}
        <BrowsePagination page={paging.page} pages={paging.pages} previous={paging.previous ? radioBrowseLocation(source, paging.page - 1, filter) : undefined} next={paging.next ? radioBrowseLocation(source, paging.page + 1, filter) : undefined} disabled={!props.connected || !!summary?.loading} onSelectPage={goToPage}
          onNavigate={(event, href) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); goToPage(Number(new URL(href, location.origin).searchParams.get("page") ?? 1)); }} />
      </div>
    </div>
    {hits.length ? <HitList hits={hits.slice(paging.start, paging.end)} timeline={false} label="Radio stations" /> : null}
    {summary && <SourceProblems summaries={[[source, summary]]} />}
    {summary && !summary.loading && !summary.error && !hits.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>{filter ? "No stations match this filter. Try another name or clear the filter." : source === "avoid radio" ? "No stations are available right now. Try Radio playlists." : source === "Radio directory" ? "No stations are available right now. Try another source." : "No radio playlists yet. An admin can add one in Settings → Sources → Radio playlists."}</EmptyDescription></EmptyHeader></Empty>}
    <SearchRadioResults {...props} browse source={source} query="" onResults={report} />
  </section>;
}
