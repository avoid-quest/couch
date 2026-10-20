import { useCallback, useState, type ComponentProps, type MouseEvent, type ReactNode, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { iptvGuideQuery, iptvSourcesQuery } from "@/api/iptv";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { MediaTile, tileShape } from "@/components/MediaTile";
import { usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { Shelf } from "@/components/Shelf";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import { cn } from "@/lib/utils";
import { providerNames, SearchOnlineResults, type SearchHit, type SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { useLiveSourceHits } from "@/sections/find/useLiveSourceHits";
import { useKeptOrder } from "@/sections/home/home-rows";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { TRY_AGAIN } from "@/copy";
import type { GuideRow } from "../../../shared/iptv";
import type { ProviderId } from "../../../shared/providers";
import { useOnAir, useStationMenu } from "./on-air";
import { useDiscoverRows } from "./discover-rows";
import { channelMeta, useChannelActions, useChannelLogo } from "./LiveTvPage";

// A shelf samples its source's home; its heading opens the rest.
const shelfLength = 12;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
// The sources with a home of their own: what's live first, then the catalogues, so wide frames break up the posters.
const homes: { provider: ProviderId; time: string }[] = [
  { provider: "twitch", time: "Live now" },
  { provider: "streamingcommunity", time: "Films and series" },
  { provider: "raiplay", time: "Programmes" },
  { provider: "movies123", time: "Films" },
  { provider: "animesaturn", time: "Films and series" },
  { provider: "animeunity", time: "Films and series" },
];
// The sources without one open on a search of their own.
const searches: { provider: ProviderId; meta: string }[] = [
  { provider: "youtube", meta: "Channels and playlists" },
  { provider: "bandcamp", meta: "Albums and tracks" },
  { provider: "soundcloud", meta: "Tracks" },
];

/**
 * Discover, Home's sibling: shared inputs, what's on air, then Live TV while a source has channels, then a shelf from each source's
 * own home, then the sources that start from a search. Shelves load side by side and hold their place meanwhile, so
 * nothing moves under the focus; one that fails says so, and an empty one is left out.
 */
export function DiscoverPage() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled: connected });
  const shared = useLiveSourceHits("");
  const { rows } = useDiscoverRows();
  const details = useDetailNavigation();
  const sections: Record<string, ReactNode> = {
    shared: !!shared.length && <SharedSources hits={shared} />,
    radio: <OnAir />,
    "live-tv": iptv.data?.sources.some(source => source.channelCount) ? <LiveTv /> : iptv.error && !iptv.data ? <Failed what="Live TV" retry={() => void iptv.refetch()} /> : null,
    ...Object.fromEntries(homes.map(home => [home.provider, <SourceHome {...home} />])),
    sources: <Sources />,
  };
  return <section data-page="Discover" aria-label="Discover" className="group/discover grid min-w-0 gap-12">
    <header className="flex justify-end">
      <h1 className="sr-only">Discover</h1>
      <Button variant="ghost" asChild><a id="customize-discover" href="/settings/device/discover" onClick={event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); details.open("/settings/device/discover");
      }}>Customize Discover</a></Button>
    </header>
    {rows.filter(row => row.shown).map(row => <Fragment key={row.id}>{sections[row.id]}</Fragment>)}
    <Empty className="group-has-[section]/discover:hidden group-has-[[role=alert]]/discover:hidden">
      <EmptyHeader><EmptyTitle>{rows.every(row => !row.shown) ? "All sections are hidden" : "Nothing to discover here yet"}</EmptyTitle>
        <EmptyDescription>Choose sections in Customize Discover, or search for something to play.</EmptyDescription></EmptyHeader>
    </Empty>
  </section>;
}

/** The stations on air (Home's Radio shelf, without its recents); the heading opens every station. */
function OnAir() {
  const { available, enqueueRadio } = useShell();
  const { on } = usePlayOn();
  const onAir = useOnAir();
  const stationMenu = useStationMenu();
  // As on Home, the shelf keeps the order it opened with, so a refetch or a new favourite never moves a tile under the focus.
  const stations = useKeptOrder(onAir.stations, station => station.id, !onAir.pending);
  if (onAir.favorites.error || onAir.builtIn.error) return <Failed what="Radio" retry={() => void Promise.all([onAir.favorites.refetch(), onAir.builtIn.refetch()])} />;
  if (!onAir.pending && !stations.length) return null;
  // It waits for the shows, so its tiles don't grow a line under the focus.
  return <Shelf title="Radio" label="Radio stations" href="/discover/radio" time={onAir.pending ? undefined : stations.some(station => onAir.show(station.id)) ? "On air now" : plural(stations.length, "station")}>
    {onAir.pending ? <Pending /> : stations.map((station, index) => <li key={station.id} className="flex shrink-0">
      {/* Tiles take the shelf's height, so one without a show stays level with the rest and Up and Down leave the shelf. */}
      <MediaTile data-page-first={index === 0 || undefined} shape="square" title={station.name} meta={onAir.meta(station) || station.groupTitle || station.countryCode || undefined} thumbnail={onAir.show(station.id)?.artworkUrl ?? station.logoUrl}
        aria-label={on(`Play ${station.name}`)} disabled={!available} onClick={() => void enqueueRadio(station, true)} menu={stationMenu(station)} />
    </li>)}
  </Shelf>;
}

/** The first channels of the Live TV guide; the heading opens every channel. A channel has no page, so its tile plays it. */
function LiveTv() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  // The guide's first page, as Live TV's own page asks for it.
  const guide = useQuery({ ...iptvGuideQuery(credentials, { offset: 0, group: "", q: "" }), enabled: connected, refetchInterval: 60_000 });
  const actions = useChannelActions();
  if (guide.error) return <Failed what="Live TV" retry={() => void guide.refetch()} />;
  if (guide.data && !guide.data.channels.length) return null;
  return <Shelf title="Live TV" href="/discover/live-tv" time={guide.data && plural(guide.data.total, "channel")}>
    {!guide.data ? <Pending /> : guide.data.channels.slice(0, shelfLength).map((channel, index) => <li key={channel.id} className="shrink-0"><ChannelTile first={index === 0} channel={channel} {...actions(channel)} /></li>)}
  </Shelf>;
}

function ChannelTile({ channel, disabled, play, menu, first }: { first: boolean; channel: GuideRow; disabled: boolean; play: () => void; menu: MenuAction[] }) {
  const { on } = usePlayOn();
  return <MediaTile data-page-first={first || undefined} shape="video" title={channel.name} meta={channelMeta(channel) || undefined} thumbnail={useChannelLogo(channel)} aria-label={on(`Play ${channel.name}`)} disabled={disabled} onClick={play} menu={menu} />;
}

/** The first of a source's own home, as its page reads it (ProviderPage, url ""); each tile opens its Details, and the heading the home. */
function SourceHome({ provider, time }: { provider: ProviderId; time: string }) {
  const { credentials, available, openProvider } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const [summary, setSummary] = useState<SearchResultSummary>();
  const report = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  const name = providerNames[provider];
  const items = summary?.page?.items ?? [];
  const hits = (summary?.hits ?? []).slice(0, shelfLength);
  const results = <SearchOnlineResults provider={provider} query="" url="" paged onOpenCollection={openProvider} onResults={report} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />;
  if (summary?.error && !hits.length) return <>{results}<Failed what={name} retry={summary.retry} /></>;
  if (summary && !summary.loading && !hits.length) return results;
  return <>
    {results}
    <Shelf title={name} href={collectionLocation({ provider, url: "" })} time={time}>
      {!hits.length ? <Pending /> : hits.map((hit, index) => {
        const item = items.find(item => item.url === hit.url);
        return item && <li key={hit.id} className="shrink-0">
          <MediaTile data-page-first={index === 0 || undefined} shape={tileShape(name, false)} title={hit.title} meta={item.subtitle} thumbnail={hit.thumbnail} aria-label={`Open ${hit.title}`} data-hit-id={hit.id} menu={hit.actions}
            href={collectionLocation(item)} onClick={() => openProvider(item)} />
        </li>;
      })}
    </Shelf>
  </>;
}

/** The devices' shared inputs, while any are shared; each plays, and its other verbs are its menu. */
function SharedSources({ hits }: { hits: SearchHit[] }) {
  const { on } = usePlayOn();
  return <section aria-labelledby="discover-shared-sources" className="grid min-w-0 gap-3">
    <h2 id="discover-shared-sources" className="flex min-h-8 items-center text-base font-medium">Shared sources</h2>
    <ul data-nav-row aria-label="Shared sources" className="-ml-2.5 flex flex-wrap gap-x-4 gap-y-2">
      {hits.map((hit, index) => <SourceButton key={hit.id} data-page-first={index === 0 || undefined} title={hit.title} meta={hit.meta} aria-label={on(`Play ${hit.title}`)} disabled={hit.primary.disabled} onClick={hit.primary.run} menu={hit.actions.filter(action => action.label !== "Play")} />)}
    </ul>
  </section>;
}

/** The sources that start from a search (YouTube, Bandcamp, SoundCloud): each scopes the header's field to itself. */
function Sources() {
  const { scopeSearch } = useShell();
  return <section aria-labelledby="discover-sources" className="grid min-w-0 gap-3">
    <h2 id="discover-sources" className="flex min-h-8 items-center text-base font-medium">Sources</h2>
    <ul data-nav-row aria-label="Sources" className="-ml-2.5 flex flex-wrap gap-x-4 gap-y-2">
      {searches.map(({ provider, meta }, index) => <SourceButton data-page-first={index === 0 || undefined} key={provider} title={providerNames[provider]} meta={meta} aria-label={`Search ${providerNames[provider]}`} onClick={() => scopeSearch(providerNames[provider])} />)}
    </ul>
  </section>;
}

/** A source as a name over a muted line, one target; a shared input's other verbs are its menu, as a tile's are. */
function SourceButton({ title, meta, href, onClick, menu = [], ...props }: { title: string; meta: string; href?: string; onClick: () => void; menu?: MenuAction[] } & Omit<ComponentProps<typeof Button>, "title" | "onClick" | "children">) {
  const options = useItemMenu(menu);
  const body = <><span className="text-base">{title}</span><span className="text-sm text-muted-foreground">{meta}</span></>;
  return <li {...options.item} className={cn("relative flex", options.item.className)}>
    <Button variant="ghost" {...options.target} {...props} asChild={!!href} className={cn("h-auto flex-col items-start gap-0.5 px-2.5 py-2 text-left font-normal", options.shown.length && "pr-10")} onClick={(event: MouseEvent<HTMLElement>) => {
      if (href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
      event.preventDefault();
      onClick();
    }}>{href ? <a href={detailHref(href)}>{body}</a> : body}</Button>
    <ItemMenu menu={options} title={title} className="absolute top-2 right-1" />
  </li>;
}

/** A shelf's place while it loads, about a tile's height, so the shelves below don't move when it fills. */
function Pending() {
  return <li className="h-58"><span role="status" className="flex items-center gap-2 pt-1 text-sm text-muted-foreground"><Spinner aria-hidden="true" className="size-3.5" />Loading…</span></li>;
}

function Failed({ what, retry }: { what: string; retry?: () => void }) {
  return <Alert variant="destructive"><AlertDescription>Couldn't load {what}.</AlertDescription>{retry && <AlertAction><Button data-page-first variant="ghost" size="sm" onClick={retry}>{TRY_AGAIN}</Button></AlertAction>}</Alert>;
}
