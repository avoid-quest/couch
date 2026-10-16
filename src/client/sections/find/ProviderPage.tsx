import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { readCollectionSearch, collectionPagination } from "@/collection-pagination";
import { collectionLocation } from "@/detail-navigation";
import { searchLocation } from "@/search";
import { SearchBar } from "@/components/SearchBar";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { RelatedCollection } from "@/components/RelatedCollection";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrowsePagination } from "@/components/BrowsePagination";
import { MediaTile } from "@/components/MediaTile";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { HitList, SourceProblems } from "./SearchPanel";
import { providerNames, SearchOnlineResults, type SearchCollection, type SearchResultSummary } from "./SearchOnlineResults";
import { DetailHeader } from "@/components/DetailHeader";
import { tileShape, type TileShape } from "@/components/MediaTile";
import { providerForUrl, type ProviderId } from "../../../shared/providers";
import { movies123Origin } from "../../../shared/movies123";

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
  const { credentials, available, openProvider, current, playHistory } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const navigate = useNavigate();
  const cursor = search.cursors.at(-1);
  const [reported, setReported] = useState<{ cursor?: string; summary: SearchResultSummary } | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setReported({ cursor, summary }), [cursor]);
  const summary = reported?.cursor === cursor ? reported?.summary : undefined;
  const collection = summary?.collection ?? { title: providerNames[provider], source: providerNames[provider], description: summary?.page?.description };
  const page = summary?.page;
  // Use the provider's canonical catalogue route; title and season pages keep their rows.
  const path = url ? new URL(page?.item?.url ?? url).pathname : "";
  const posterCatalogue = provider === "streamingcommunity" && (!url || /^\/(?:[a-z]{2}\/)?(?:archive|browse\/genre)\/?$/.test(path))
    || provider === "movies123" && (!url || path === "/" || /^\/(?:(?:movies|tv-series)(?:\/{1,2}[1-9]\d{0,3})?|home)\/?$/.test(path));
  useEffect(() => {
    // Back can restore focus while the cached results are still mounting; scroll once they settle.
    if (!posterCatalogue) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches("[data-media-tile]")) active.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [posterCatalogue, summary?.hits]);
  const source = current?.source.replace(/^web:/, "");
  const hits = (summary?.hits ?? []).filter(hit => `${hit.title} ${hit.meta}`.toLocaleLowerCase().includes(search.filter.toLocaleLowerCase()));
  const paging = collectionPagination(hits.length, search.page, search.cursors, page?.nextCursor);
  const currentId = hits.find(hit => hit.url === source)?.id;
  const emptyRoot = !url && connected && !!summary && !summary.loading && !summary.error && !summary.hits?.length;
  const episodeList = provider === "movies123" && /^\/season\/[\w-]+-\d+\/?$/.test(path) || /\/season-\d+|\/ContentSet-/.test(url)
    || provider === "streamingcommunity" && page?.item?.kind === "collection" && !!page.items.length && page.items.every(item => item.kind === "media");
  const seasonList = provider === "streamingcommunity" && /\/titles\/\d+/.test(url) && !!page?.items.length && page.items.every(item => item.kind === "collection");
  let noun = "Items";
  if (provider === "bandcamp") noun = url ? "Tracks" : "Albums";
  else if (episodeList) noun = "Episodes";
  else if (seasonList) noun = "Seasons";
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
  const pager = <BrowsePagination page={paging.page} pages={paging.pages} previous={paging.previous ? href("previous") : undefined} next={paging.next ? href("next") : undefined} disabled={!connected || !!summary?.loading} onNavigate={turnPage}
    onSelectPage={page => goToPage(collectionLocation({ provider, url }, { ...search, page }))} />;
  return <section data-page="Collection" className="min-w-0 space-y-6">
    <SearchOnlineResults provider={provider} query="" url={url} cursor={cursor} context={search.context} paged onOpenCollection={openProvider} onResults={report} onPlayHistory={playHistory} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    <ContentBreadcrumb title={collection.title} provider={provider} collection={search.context ?? page?.item?.collection ?? page?.parent} />
    <CollectionHeader collection={collection} canPlay={available} shape={tileShape(providerNames[provider], !!collection.single && !!(search.context ?? page?.item?.collection))} />
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this collection.</p>}
    {emptyRoot && <EmptyRoot provider={provider} />}
    {!collection.single && !emptyRoot && <>
      {/* Fixed slots: the count (or loading), Filter and the pager hold their places on every page and in every state. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="collection-items" tabIndex={-1} className="flex items-center gap-2 text-sm text-muted-foreground outline-none">{summary?.loading ? <><Spinner className="size-3.5" /><span role="status">Loading items…</span></> : <>{hits.length} {noun.toLocaleLowerCase().replace(/s$/, hits.length === 1 ? "" : "s")}{paging.remote && " on this page"}</>}</h2>
        <div className="flex flex-wrap items-center gap-4">
          {provider === "twitch" && !url && <Button variant="ghost" asChild><Link to={collectionLocation({ provider, url: "https://www.twitch.tv/directory" })}>Categories</Link></Button>}
          {provider === "movies123" && posterCatalogue && <>
            <Button variant="ghost" asChild><Link to={collectionLocation({ provider, url: `${url ? new URL(url).origin : movies123Origin}/movies/` })}>Movies</Link></Button>
            <Button variant="ghost" asChild><Link to={collectionLocation({ provider, url: `${url ? new URL(url).origin : movies123Origin}/tv-series/` })}>TV series</Link></Button>
          </>}
          <Input type="search" aria-label={paging.remote ? "Filter this page" : `Filter ${noun.toLocaleLowerCase()}`} placeholder="Filter" className="h-8 w-32 border-0 bg-transparent px-0 shadow-none dark:bg-transparent sm:w-40" value={search.filter}
            onChange={event => void navigate({ href: collectionLocation({ provider, url }, { ...search, page: 1, filter: event.target.value }), replace: true, resetScroll: false })} />
          {(paging.remote || (paging.pages ?? 1) > 1) && pager}
        </div>
      </div>
      {posterCatalogue ? <>
        <ul aria-label={`${collection.title} ${noun.toLocaleLowerCase()}`} className="hidden list-none grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-4 gap-y-2 p-0 md:grid">
          {hits.slice(paging.start, paging.end).map(hit => {
            const item = page?.items.find(item => item.url === hit.url);
            return item && <li key={hit.id} className="min-w-0">
              <MediaTile title={hit.title} meta={item.subtitle} thumbnail={hit.thumbnail} shape="poster" className="[&_[data-tile-art]]:h-36" aria-label={`Open ${hit.title}`} data-hit-id={hit.id}
                href={collectionLocation(item)} onClick={() => openProvider(item)} />
            </li>;
          })}
        </ul>
        <div className="md:hidden"><HitList hits={hits.slice(paging.start, paging.end)} currentId={currentId} timeline={false} label={`${collection.title} ${noun.toLocaleLowerCase()}`} /></div>
      </> : <HitList hits={hits.slice(paging.start, paging.end)} currentId={currentId} timeline={false} label={`${collection.title} ${noun.toLocaleLowerCase()}`} />}
      {connected && summary && !summary.loading && !summary.error && !hits.length && <Empty><EmptyHeader><EmptyTitle>{search.filter ? "No matching items" : "No items available"}</EmptyTitle><EmptyDescription>{search.filter ? "Try another name or clear the filter to see this list." : "This collection has no available items."}</EmptyDescription></EmptyHeader>{search.filter && <Button variant="ghost" onClick={() => void navigate({ href: collectionLocation({ provider, url }, { ...search, page: 1, filter: "" }), replace: true })}>Clear filter</Button>}</Empty>}
    </>}
    <SourceProblems summaries={summary ? [[providerNames[provider], summary]] : []} />
    {collection.single && <RelatedCollection collection={search.context ?? page?.item?.collection} currentUrl={page?.item?.url ?? url} />}
  </section>;
}

function CollectionHeader({ collection: c, canPlay, shape }: { collection: SearchCollection; canPlay: boolean; shape: TileShape }) {
  const disabled = !canPlay || c.disabled;
  return <DetailHeader title={c.title} meta={c.subtitle} description={c.description} thumbnail={c.thumbnail} shape={shape} position={c.position} duration={c.position ? c.duration : undefined}
    play={c.playAll && { label: c.playLabel ?? (c.single ? "Play" : "Play all"), run: c.playAll, disabled }}
    fromStart={c.fromStart && { label: "From start", run: c.fromStart, disabled }}
    queue={c.queueAll && { label: c.single ? "Queue" : "Queue all", run: c.queueAll, disabled: c.disabled }}
    save={c.save && { saved: !!c.saved, run: c.save, disabled: c.disabled || c.saveDisabled }}
    playOn={c.playOn && { run: c.playOn, disabled }}
    more={c.playNext ? [{ label: "Play next", disabled: c.disabled, run: c.playNext }] : []} />;
}

// Sources without a home page of their own start from a search.
function EmptyRoot({ provider }: { provider: ProviderId }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const name = providerNames[provider];
  const open = () => { const query = value.trim(); if (query) void navigate({ href: providerForUrl(query) === provider ? collectionLocation({ provider, url: query }) : searchLocation({ query, source: name }) }); };
  return <Empty className="py-0">
    <EmptyHeader><EmptyDescription>{provider === "youtube" ? "Search YouTube or paste a channel, playlist or video link." : `Search ${name} or paste a ${name} link.`}</EmptyDescription></EmptyHeader>
    <EmptyContent><SearchBar id="collection-search" className="w-full" ariaLabel={`Search ${name}`} value={value} onValueChange={setValue} onSubmit={open} onClear={() => setValue("")} /></EmptyContent>
  </Empty>;
}
