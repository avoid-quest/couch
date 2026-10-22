import { DetailSkeleton, MediaRowsSkeleton, MediaTilesSkeleton } from "@/components/LoadingMedia";
import { MediaContext, mediaSubtitle } from "@/components/MediaContext";
import { browserActions } from "@/original-page";
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { readCollectionSearch, collectionPagination } from "@/collection-pagination";
import { collectionLocation, keepSection, useOwnSearch } from "@/detail-navigation";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { RelatedCollection } from "@/components/RelatedCollection";
import { FilterBar, FilterInput } from "@/components/ContentFilters";
import { Button } from "@/components/ui/button";
import { BrowsePagination } from "@/components/BrowsePagination";
import { MediaTile } from "@/components/MediaTile";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { HitList, SourceProblems } from "./SearchPanel";
import { ItemNotFound } from "@/sections/details/ItemPage";
import { providerNames, SearchOnlineResults, type SearchCollection, type SearchResultSummary } from "./SearchOnlineResults";
import { DetailHeader } from "@/components/DetailHeader";
import { artShape, type ArtShape } from "@/art-shape";
import { isChannelTab, metaLine, pageTitle } from "@/media-caption";
import { collectionLinks } from "@/collection-target";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TRY_AGAIN } from "@/copy";
import { useSettingsScope } from "@/sections/settings/settings-scope";
import type { ProviderId } from "../../../shared/providers";
import { movies123Origin } from "../../../shared/movies123";

export function ProviderPage() {
  const state = useOwnSearch(readCollectionSearch);
  if (!state.provider) return <section data-page="Collection"><ItemNotFound title="Collection not found" /></section>;
  return <CollectionPage key={`${state.provider}:${state.url}`} provider={state.provider} url={state.url ?? ""} search={state} />;
}

function CollectionPage({ provider, url, search }: { provider: ProviderId; url: string; search: ReturnType<typeof readCollectionSearch> }) {
  const { credentials, available, openProvider, current, playHistory, section } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const navigate = useNavigate();
  const cursor = search.cursors.at(-1);
  const [reported, setReported] = useState<{ cursor?: string; summary: SearchResultSummary } | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setReported({ cursor, summary }), [cursor]);
  const summary = reported?.cursor === cursor ? reported?.summary : undefined;
  const reportedCollection = summary?.collection ?? { title: providerNames[provider], source: providerNames[provider], description: summary?.page?.description };
  // A channel's tab ("Stanford - Videos") is the channel.
  const collection = { ...reportedCollection, title: pageTitle(reportedCollection.title) };
  const page = summary?.page;
  // A channel's tab sits under its channel, which is the page itself: the trail stops before it.
  const holder = search.context ?? page?.item?.collection ?? page?.parent;
  const trail = holder && !("parent" in holder && holder.parent) && holder.title === collection.title ? undefined : holder;
  // A Twitch page that isn't its directory is a channel, whose picture is its avatar.
  const channel = page?.item?.kind === "channel" || isChannelTab(reportedCollection.title) || provider === "twitch" && !!url && !new URL(url).pathname.startsWith("/directory");
  // The page's own shape: a channel is round, an album square, a series a poster, an episode a frame.
  const shape = artShape(providerNames[provider], channel ? "channel" : collection.single ? (search.context ?? page?.item?.collection ? "episode" : "media") : "collection");
  const cold = connected && (!summary || summary.loading) && !page;
  // Use the provider's canonical catalogue route; title and season pages keep their rows.
  const path = url ? new URL(page?.item?.url ?? url).pathname : "";
  const posterCatalogue = provider === "streamingcommunity" && (!url || /^\/(?:[a-z]{2}\/)?(?:archive|browse\/genre)\/?$/.test(path))
    || provider === "movies123" && (!url || path === "/" || /^\/(?:(?:movies|tv-series)(?:\/{1,2}[1-9]\d{0,3})?|home)\/?$/.test(path))
    || provider === "animesaturn" && (!url || path === "/" || /^\/anime(?:\/page\/[1-9]\d*)?\/?$/.test(path))
    || provider === "animeunity" && (!url || path === "/" || /^\/archivio\/?$/.test(path));
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
  const hits = (summary?.hits ?? []).filter(hit => `${hit.title} ${hit.meta}`.toLocaleLowerCase().includes(search.filter.trim().toLocaleLowerCase()));
  const paging = collectionPagination(hits.length, search.page, search.cursors, page?.nextCursor);
  const currentId = hits.find(hit => hit.url === source)?.id;
  const emptyRoot = !url && connected && !!summary && !summary.loading && !summary.error && !summary.hits?.length;
  const episodeList = provider === "movies123" && /^\/season\/[\w-]+-\d+\/?$/.test(path) || /\/season-\d+|\/ContentSet-/.test(url)
    || ["streamingcommunity", "animesaturn", "animeunity"].includes(provider) && page?.item?.kind === "collection" && !!page.items.length && page.items.every(item => item.kind === "media");
  const seasonList = provider === "streamingcommunity" && /\/titles\/\d+/.test(url) && !!page?.items.length && page.items.every(item => item.kind === "collection");
  const filterable = (summary?.hits?.length ?? 0) > filterAfter || !!paging.previous || !!paging.next || !!search.filter;
  // An album's tracks are a tracklist: number, title and time.
  const tracks = (provider === "bandcamp" || provider === "soundcloud") && !!url && !!hits.length && hits.every(hit => !hit.collection);
  let noun = "Items";
  if (provider === "bandcamp") noun = url ? "Tracks" : "Albums";
  else if (episodeList) noun = "Episodes";
  else if (seasonList) noun = "Seasons";
  const locationFor = (changes: { cursors?: string[]; page?: number; filter?: string }) => keepSection(collectionLocation({ provider, url, collection: search.context }, { ...search, ...changes }), search.from ? section : undefined);
  const href = (direction: "previous" | "next") => locationFor({
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
    onSelectPage={page => goToPage(locationFor({ page }))} />;
  return <section data-page="Collection" className="min-w-0 space-y-6">
    <SearchOnlineResults provider={provider} query="" url={url} cursor={cursor} context={search.context} paged onOpenCollection={openProvider} onResults={report} onPlayHistory={playHistory} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    {cold && url ? <DetailSkeleton trail={<ContentBreadcrumb stage title={collection.title} provider={provider} collection={trail} />} />
      : <CollectionHeader collection={collection} canPlay={available} shape={shape} trail={<ContentBreadcrumb stage title={collection.title} provider={provider} collection={trail} />} />}
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this collection.</p>}
    {emptyRoot && <EmptyRoot provider={provider} />}
    {!collection.single && !emptyRoot && <>
      {/* Filter waits for more than a glance holds: one season or eight tracks need none. */}
      {(filterable || provider === "twitch" && !url || provider === "movies123" && posterCatalogue) && <FilterBar label="Collection filters">
        {filterable && <FilterInput label={paging.remote ? "Filter this page" : `Filter ${noun.toLocaleLowerCase()}`} value={search.filter}
          onChange={filter => void navigate({ href: locationFor({ page: 1, filter }), replace: true, resetScroll: false })} />}
        {provider === "twitch" && !url && <Button variant="ghost" asChild><Link to={keepSection(collectionLocation({ provider, url: "https://www.twitch.tv/directory" }), section)}>Categories</Link></Button>}
        {provider === "movies123" && posterCatalogue && <>
          <Button variant="ghost" asChild><Link to={keepSection(collectionLocation({ provider, url: `${url ? new URL(url).origin : movies123Origin}/movies/` }), section)}>Movies</Link></Button>
          <Button variant="ghost" asChild><Link to={keepSection(collectionLocation({ provider, url: `${url ? new URL(url).origin : movies123Origin}/tv-series/` }), section)}>TV series</Link></Button>
        </>}
      </FilterBar>}
      <h2 id="collection-items" tabIndex={-1} className="sr-only"><span role="status">{cold ? "" : `${hits.length} ${noun.toLocaleLowerCase().replace(/s$/, hits.length === 1 ? "" : "s")}${paging.remote ? " on this page" : ""}`}</span></h2>
      {/* The first tile or row starts the page when the header has no verbs (a source's home); verbs come first, so they win. */}
      {/* The rows it loads into: a source's music as squares, everything else as frames. */}
      {cold && !posterCatalogue && <MediaRowsSkeleton compact shape={artShape(providerNames[provider]) === "square" ? "square" : "video"} />}
      {posterCatalogue ? <ul aria-label={`${collection.title} ${noun.toLocaleLowerCase()}`} className="grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-6 p-0">
        {cold && <MediaTilesSkeleton shape="poster" fluid />}
        {hits.slice(paging.start, paging.end).map((hit, index) => {
          const item = page?.items.find(item => item.url === hit.url);
          return item && <li key={hit.id} className="@container min-w-0">
            <MediaTile related={{ collection: item.collection, creator: item.creator }} className="w-full [--tile-art:150cqi] [&_[data-media-tile]]:w-full [&_[data-tile-art]]:w-full" data-page-first={index === 0 || undefined} title={hit.title} meta={metaLine(mediaSubtitle(item))} thumbnail={hit.thumbnail} source={hit.url} shape="poster" aria-label={`Open ${hit.title}`} data-hit-id={hit.id} menu={hit.actions}
              href={collectionLocation(item)} onClick={() => openProvider(item)} />
          </li>;
        })}
      </ul> : <HitList showSource={false} pageFirst hits={hits.slice(paging.start, paging.end)} currentId={currentId} compact numbered={tracks ? paging.start + 1 : undefined} label={`${collection.title} ${noun.toLocaleLowerCase()}`} />}
      {connected && summary && !summary.loading && !summary.error && !hits.length && <Empty><EmptyHeader><EmptyTitle>{search.filter ? "No matching items" : "No items available"}</EmptyTitle><EmptyDescription>{search.filter ? "Try another name or clear the filter to see this list." : "This collection has no available items."}</EmptyDescription></EmptyHeader>{search.filter && <Button variant="ghost" onClick={() => void navigate({ href: locationFor({ page: 1, filter: "" }), replace: true, resetScroll: false })}>Clear filter</Button>}</Empty>}
      {pager}
    </>}
    {summary?.error && moved.test(summary.errorMessage ?? "") ? <MovedSource name={providerNames[provider]} message={summary.errorMessage!.replace(moved, "")} retry={summary.retry} />
      : <SourceProblems summaries={summary ? [[providerNames[provider], summary]] : []} />}
    {collection.single && <RelatedCollection collection={search.context ?? page?.item?.collection} creator={page?.item?.creator} currentUrl={page?.item?.url ?? url} />}
  </section>;
}

// Filter shows once a list holds more than about a screen of rows.
const filterAfter = 20;

function CollectionHeader({ collection: c, canPlay, shape, trail }: { collection: SearchCollection; canPlay: boolean; shape: ArtShape; trail: ReactNode }) {
  const disabled = !canPlay || c.disabled;
  // The trail above already links the collections holding the page; a creator that is one of them, or the page, goes.
  const creator = c.creator && c.creator.url !== c.url && !collectionLinks(c.context).some(link => link.url === c.creator!.url) ? c.creator : undefined;
  return <DetailHeader trail={trail} context={<MediaContext creator={creator} />} title={c.title} meta={mediaSubtitle({ subtitle: c.subtitle, creator: c.creator, collection: c.context })} description={c.description} thumbnail={c.thumbnail} shape={shape} position={c.position} duration={c.duration}
    play={c.playAll && { label: c.playLabel ?? (c.single ? "Play" : "Play all"), run: c.playAll, disabled }}
    fromStart={c.fromStart && { label: "From start", run: c.fromStart, disabled }}
    queue={c.queueAll && { label: c.single ? "Queue" : "Queue all", run: c.queueAll, disabled: c.disabled }}
    save={c.save && { saved: !!c.saved, run: c.save, disabled: c.disabled || c.saveDisabled }}
    playOn={c.playOn && { run: c.playOn, disabled }}
    more={[...browserActions(c.url), ...c.playNext ? [{ label: "Play next", disabled: c.disabled, run: c.playNext }] : []]} />;
}

// Core ends a moved source's error with where to fix it, which an admin gets as a button instead.
const moved = / Set it in Settings → Sources\.$/;
function MovedSource({ name, message, retry }: { name: string; message: string; retry?: () => void }) {
  const { administrator } = useSettingsScope();
  return <Alert variant="destructive">
    <AlertTitle>Couldn't load {name}.</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
    <AlertAction className="flex gap-2">
      {administrator && <Button data-page-first variant="ghost" size="sm" asChild><Link to="/settings/couch/sources/streaming-community">Set site address</Link></Button>}
      <Button variant="ghost" size="sm" onClick={() => retry?.()}>{TRY_AGAIN}</Button>
    </AlertAction>
  </Alert>;
}

// Sources without a home page of their own start from the header's field, scoped to them.
function EmptyRoot({ provider }: { provider: ProviderId }) {
  const { scopeSearch } = useShell();
  const name = providerNames[provider];
  return <Empty className="py-0">
    <EmptyHeader><EmptyDescription>{provider === "youtube" ? "Search YouTube above, or paste a channel, playlist or video link." : `Search ${name} above, or paste a ${name} link.`}</EmptyDescription></EmptyHeader>
    <EmptyContent><Button data-page-first onClick={() => scopeSearch(name)}>Search {name}</Button></EmptyContent>
  </Empty>;
}
