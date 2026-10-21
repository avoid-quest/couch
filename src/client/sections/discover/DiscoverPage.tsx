import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { MediaContext } from "@/components/MediaContext";
import { type ComponentProps, type MouseEvent, type ReactNode, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { iptvGuideQuery, iptvSourcesQuery } from "@/api/iptv";
import { providerFavoritesQuery } from "@/api/providers";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { ContentLink } from "@/components/ContentLink";
import { MediaTile, tileShape } from "@/components/MediaTile";
import { usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { Shelf } from "@/components/Shelf";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import { browserActions } from "@/original-page";
import { cn } from "@/lib/utils";
import { providerNames, type SearchHit } from "@/sections/find/SearchOnlineResults";
import { useLiveSourceHits } from "@/sections/find/useLiveSourceHits";
import { useKeptOrder } from "@/sections/home/home-rows";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { TRY_AGAIN } from "@/copy";
import type { GuideRow } from "../../../shared/iptv";
import type { ProviderId, ProviderItem } from "../../../shared/providers";
import { useOnAir, useStationMenu } from "./on-air";
import { useDiscoverRows } from "./discover-rows";
import { channelMeta, useChannelActions, useChannelLogo } from "./LiveTvPage";

// Live TV samples the guide; its heading opens the rest.
const shelfLength = 12;
// The sources with a home of their own: what's live first, then the catalogues, so wide frames break up the posters.
const homes: ProviderId[] = ["twitch", "streamingcommunity", "raiplay", "movies123", "animesaturn", "animeunity"];
// The sources without one open on a search of their own.
const searches: ProviderId[] = ["youtube", "bandcamp", "soundcloud"];

/**
 * Discover, Home's sibling: shared inputs, what's on air, then Live TV while a source has channels, then a shelf of what's
 * saved from each source (never the source's own front page, which its heading and the Sources row open on request),
 * then every source. Shelves load side by side and hold their place meanwhile, so nothing moves under the focus; one
 * that fails says so, and an empty one is left out.
 */
export function DiscoverPage() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled: connected });
  const favorites = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected });
  const shared = useLiveSourceHits("");
  const { rows } = useDiscoverRows();
  const saved = (provider: ProviderId) => favorites.data?.favorites.filter(item => item.provider === provider) ?? [];
  const shownHomes = rows.filter(row => row.shown && homes.includes(row.id as ProviderId)).map(row => row.id as ProviderId);
  // Saved channels fail, or are missing, once: where the first source shelf would be.
  const savedStatus = favorites.error && !favorites.data ? <Failed what="saved channels" retry={() => void favorites.refetch()} />
    : favorites.data && !shownHomes.some(provider => saved(provider).length) && <Empty data-nothing-saved className="py-0">
      <EmptyHeader><EmptyTitle>No saved channels or series</EmptyTitle>
        <EmptyDescription>Open a source below and Save its channels or series to see them here.</EmptyDescription></EmptyHeader>
    </Empty>;
  const sections: Record<string, ReactNode> = {
    shared: !!shared.length && <SharedSources hits={shared} />,
    radio: <OnAir />,
    "live-tv": iptv.data?.sources.some(source => source.channelCount) ? <LiveTv /> : iptv.error && !iptv.data ? <Failed what="Live TV" retry={() => void iptv.refetch()} /> : null,
    ...Object.fromEntries(homes.map(provider => [provider, provider === shownHomes[0] && savedStatus || <SavedShelf provider={provider} items={saved(provider)} />])),
    sources: <Sources />,
  };
  return <section data-page="Discover" aria-label="Discover" className="group/discover grid min-w-0 gap-12">
    {/* The current tab names the page, as Home's does; its sections are chosen in Settings. */}
    <h1 className="sr-only">Discover</h1>
    {rows.filter(row => row.shown).map(row => <Fragment key={row.id}>{sections[row.id]}</Fragment>)}
    <Empty className="group-has-[section]/discover:hidden group-has-[[role=alert]]/discover:hidden group-has-[[data-nothing-saved]]/discover:hidden">
      <EmptyHeader><EmptyTitle>{rows.every(row => !row.shown) ? "All sections are hidden" : "Nothing to discover here yet"}</EmptyTitle>
        <EmptyDescription>Choose sections in <ContentLink id="customize-discover" data-page-first href="/settings/device/home">Settings</ContentLink>, or search for something to play.</EmptyDescription></EmptyHeader>
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
  if (!stations.length && !onAir.favorites.isPending && !onAir.builtIn.isPending && (onAir.favorites.error || onAir.builtIn.error)) return <Failed what="Radio" retry={() => void Promise.all([onAir.favorites.refetch(), onAir.builtIn.refetch()])} />;
  if (!onAir.pending && !stations.length) return null;
  // It waits for the shows, so its tiles don't grow a line under the focus.
  return <Shelf loading={onAir.pending} title="Radio" label="Radio stations" href="/discover/radio">
    {onAir.pending ? <MediaTilesSkeleton shape="square" /> : stations.map((station, index) => <li key={station.id} className="flex shrink-0">
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
  if (guide.error && !guide.data) return <Failed what="Live TV" retry={() => void guide.refetch()} />;
  if (guide.data && !guide.data.channels.length) return null;
  return <Shelf loading={!guide.data} title="Live TV" href="/discover/live-tv">
    {!guide.data ? <MediaTilesSkeleton /> : guide.data.channels.slice(0, shelfLength).map((channel, index) => <li key={channel.id} className="shrink-0"><ChannelTile first={index === 0} channel={channel} {...actions(channel)} /></li>)}
  </Shelf>;
}

function ChannelTile({ channel, disabled, play, menu, first }: { first: boolean; channel: GuideRow; disabled: boolean; play: () => void; menu: MenuAction[] }) {
  const { on } = usePlayOn();
  return <MediaTile data-page-first={first || undefined} shape="video" title={channel.name} meta={channelMeta(channel) || undefined} thumbnail={useChannelLogo(channel)} aria-label={on(`Play ${channel.name}`)} disabled={disabled} onClick={play} menu={menu} />;
}

/** What's saved from a source, in Saved's order; each tile opens its page, and the heading the source's own home. */
function SavedShelf({ provider, items }: { provider: ProviderId; items: ProviderItem[] }) {
  const { openProvider } = useShell();
  const name = providerNames[provider];
  if (!items.length) return null;
  return <Shelf title={name} href={collectionLocation({ provider, url: "" })}>
    {items.map((item, index) => <li key={item.id} className="shrink-0">
      <MediaTile context={<MediaContext collection={item.collection} creator={item.creator} />} data-page-first={index === 0 || undefined} shape={tileShape(name, false)} title={item.title} meta={item.subtitle} thumbnail={item.thumbnail} aria-label={`Open ${item.title}`}
        menu={browserActions(item.url)} href={collectionLocation(item)} onClick={() => openProvider(item)} />
    </li>)}
  </Shelf>;
}

/** The devices' shared inputs, while any are shared; each plays, and its other verbs are its menu. */
function SharedSources({ hits }: { hits: SearchHit[] }) {
  const { on } = usePlayOn();
  return <section aria-labelledby="discover-shared-sources" className="grid min-w-0 gap-3">
    <h2 id="discover-shared-sources" className="flex min-h-11 items-center text-xl font-semibold tracking-tight">Shared sources</h2>
    <ul data-nav-row aria-label="Shared sources" className="-ml-2.5 flex flex-wrap gap-x-4 gap-y-2">
      {hits.map((hit, index) => <SourceButton key={hit.id} data-page-first={index === 0 || undefined} title={hit.title} meta={hit.meta} aria-label={on(`Play ${hit.title}`)} disabled={hit.primary.disabled} onClick={hit.primary.run} menu={hit.actions.filter(action => action.label !== "Play")} />)}
    </ul>
  </section>;
}

/** Every source, one quiet row: one with a home opens it, one without (YouTube, Bandcamp, SoundCloud) scopes the header's field to itself. */
function Sources() {
  const { scopeSearch } = useShell();
  const details = useDetailNavigation();
  return <section aria-labelledby="discover-sources" className="grid min-w-0 gap-3">
    <h2 id="discover-sources" className="flex min-h-11 items-center text-xl font-semibold tracking-tight">Sources</h2>
    <ul data-nav-row aria-label="Sources" className="-ml-2.5 flex flex-wrap gap-x-2 gap-y-1">
      {homes.map((provider, index) => <SourceButton data-page-first={index === 0 || undefined} key={provider} title={providerNames[provider]} aria-label={`Open ${providerNames[provider]}`} href={collectionLocation({ provider, url: "" })} onClick={() => details.open(collectionLocation({ provider, url: "" }))} />)}
      {searches.map(provider => <SourceButton key={provider} title={providerNames[provider]} aria-label={`Search ${providerNames[provider]}`} onClick={() => scopeSearch(providerNames[provider])} />)}
    </ul>
  </section>;
}

/** A source as its name (over a muted line, where it has one), one target; a shared input's other verbs are its menu, as a tile's are. */
function SourceButton({ title, meta, href, onClick, menu = [], ...props }: { title: string; meta?: string; href?: string; onClick: () => void; menu?: MenuAction[] } & Omit<ComponentProps<typeof Button>, "title" | "onClick" | "children">) {
  const options = useItemMenu(menu);
  const body = <><span className="text-base">{title}</span>{meta && <span className="text-sm text-muted-foreground">{meta}</span>}</>;
  return <li {...options.item} className={cn("relative flex", options.item.className)}>
    <Button variant="ghost" {...options.target} {...props} asChild={!!href} className={cn("h-auto flex-col items-start gap-0.5 px-2.5 py-2 text-left font-normal", options.shown.length && "pr-10")} onClick={(event: MouseEvent<HTMLElement>) => {
      if (href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
      event.preventDefault();
      onClick();
    }}>{href ? <a href={detailHref(href)}>{body}</a> : body}</Button>
    <ItemMenu menu={options} title={title} className="absolute top-2 right-1" />
  </li>;
}

function Failed({ what, retry }: { what: string; retry?: () => void }) {
  return <Alert variant="destructive"><AlertDescription>Couldn't load {what}.</AlertDescription>{retry && <AlertAction><Button data-page-first variant="ghost" size="sm" onClick={retry}>{TRY_AGAIN}</Button></AlertAction>}</Alert>;
}
