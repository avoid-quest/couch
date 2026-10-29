import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { type ComponentProps, type MouseEvent, useSyncExternalStore } from "react";
import { notifyManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { iptvGuideQuery } from "@/api/iptv";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MediaTile } from "@/components/MediaTile";
import { majorityShape, providerItemShape } from "@/art-shape";
import { metaLine } from "@/media-caption";
import { usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { Shelf, ShelfHeading } from "@/components/Shelf";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import { browserActions } from "@/original-page";
import { cn } from "@/lib/utils";
import { providerNames, type SearchHit } from "@/sections/find/SearchOnlineResults";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { TRY_AGAIN } from "@/copy";
import type { GuideRow } from "../../../shared/iptv";
import { pageSection, type ProviderId, type ProviderItem } from "../../../shared/providers";
import { channelMeta, useChannelActions, useChannelLogo } from "./LiveTvPage";

// Live TV samples the guide; its heading opens the rest.
const shelfLength = 12;
// The sources with a home of their own: what's live first, then the catalogues, so wide frames break up the posters.
export const sourceHomes = ["twitch", "streamingcommunity", "raiplay", "movies123", "animesaturn", "animeunity"] as const satisfies readonly ProviderId[];
// The sources without one open on a search of their own.
const searches: ProviderId[] = ["youtube", "bandcamp", "soundcloud"];

/** The first channels of the Live TV guide; the heading opens every channel. A channel has no page, so its tile plays it. */
export function LiveTvShelf() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  // The guide's first page, as Live TV's own page asks for it.
  const guide = useQuery({ ...iptvGuideQuery(credentials, { offset: 0, group: "", q: "" }), enabled: connected, refetchInterval: 60_000 });
  const actions = useChannelActions();
  if (guide.error && !guide.data) return <Failed what="Live TV" retry={() => void guide.refetch()} />;
  if (guide.data && !guide.data.channels.length) return null;
  return <Shelf loading={!guide.data} title="Live TV" href="/live-tv">
    {!guide.data ? <MediaTilesSkeleton /> : guide.data.channels.slice(0, shelfLength).map((channel, index) => <li key={channel.id} className="shrink-0"><ChannelTile first={index === 0} channel={channel} {...actions(channel)} /></li>)}
  </Shelf>;
}

function ChannelTile({ channel, disabled, play, menu, first }: { first: boolean; channel: GuideRow; disabled: boolean; play: () => void; menu: MenuAction[] }) {
  const { on } = usePlayOn();
  return <MediaTile data-page-first={first || undefined} shape="video" fit="contain" title={channel.name} meta={channelMeta(channel) || undefined} thumbnail={useChannelLogo(channel)} source={`iptv:${channel.id}`} aria-label={on(`Play ${channel.name}`)} disabled={disabled} onClick={play} menu={menu} />;
}

/**
 * What's saved from a source, in Saved's order, live channels first and offline ones dimmed; each tile opens its page,
 * and the heading the source's own home. Nothing saved, no shelf: the Sources line opens the source.
 */
export function SavedSourceShelf({ provider, items: saved }: { provider: ProviderId; items: ProviderItem[] }) {
  const { openProvider } = useShell();
  const name = providerNames[provider];
  // A section of a source's front page (RaiPlay's "In Diretta") is that page's, which the heading opens; Save no longer offers it.
  const items = saved.filter(item => !pageSection(item)).sort((a, b) => Number(!!b.live) - Number(!!a.live));
  if (!items.length) return null;
  const shape = (item: ProviderItem) => providerItemShape(name, item);
  const frame = majorityShape(items.map(shape));
  return <Shelf title={name} href={collectionLocation({ provider, url: "" })}>
    {items.map((item, index) => <li key={item.id} className="shrink-0">
      <MediaTile related={{ collection: item.collection, creator: item.creator }} data-page-first={index === 0 || undefined} shape={frame} own={shape(item)} dim={item.kind === "channel" && item.live === false} title={item.title} meta={metaLine(item.subtitle)} thumbnail={item.thumbnail} source={item.url} aria-label={`Open ${item.title}`}
        menu={browserActions(item.url)} href={collectionLocation(item)} onClick={() => openProvider(item)} />
    </li>)}
  </Shelf>;
}

/** The devices' shared inputs, while any are shared; each plays, and its other verbs are its menu. */
export function SharedSources({ hits }: { hits: SearchHit[] }) {
  const { on } = usePlayOn();
  return <section aria-label="Shared sources" className="grid min-w-0 gap-stack">
    <ShelfHeading title="Shared sources" />
    <ul data-nav-row aria-label="Shared sources" className="flex flex-wrap gap-2">
      {hits.map((hit, index) => <SourceChip key={hit.id} data-page-first={index === 0 || undefined} title={hit.title} meta={hit.meta} aria-label={hit.primary.label === "Play" ? on(`Play ${hit.title}`) : `${hit.primary.label} ${hit.title}`} disabled={hit.primary.disabled} onClick={hit.primary.run} menu={hit.actions.filter(action => action.label !== hit.primary.label)} />)}
    </ul>
  </section>;
}

/**
 * The sources whose latest answer here was a failure (their home, a page or a search), by their catalogue queries'
 * state, so the Sources line can say so before it is opened again.
 */
function useFailingSources() {
  const client = useQueryClient();
  const read = () => {
    const latest = new Map<string, { at: number; failed: boolean }>();
    for (const query of client.getQueryCache().findAll({ queryKey: ["search"] })) {
      const [, kind, provider] = query.queryKey as [string, string, string];
      if (kind !== "provider-page" && kind !== "providers" || typeof provider !== "string") continue;
      const { dataUpdatedAt, errorUpdatedAt, status } = query.state;
      const at = Math.max(dataUpdatedAt, errorUpdatedAt);
      if (at && at >= (latest.get(provider)?.at ?? 0)) latest.set(provider, { at, failed: status === "error" });
    }
    return [...latest].filter(([, answer]) => answer.failed).map(([provider]) => provider).sort().join(" ");
  };
  // Batched as useQuery's own subscriptions are, so a query Home creates while it renders doesn't update this line mid-render.
  const failing = useSyncExternalStore(listener => client.getQueryCache().subscribe(notifyManager.batchCalls(listener)), read, read);
  return (provider: ProviderId) => failing.split(" ").includes(provider);
}

/** Every source as a chip: one with a home opens it, one without (YouTube, Bandcamp, SoundCloud) scopes the header's field to itself. */
export function SourcesLine() {
  const { scopeSearch } = useShell();
  const details = useDetailNavigation();
  const failing = useFailingSources();
  return <section aria-label="Sources" className="grid min-w-0 gap-stack">
    <ShelfHeading title="Sources" />
    <ul data-nav-row aria-label="Sources" className="flex flex-wrap gap-2 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-2 max-md:[&>li]:shrink-0">
      {sourceHomes.map((provider, index) => <SourceChip data-page-first={index === 0 || undefined} key={provider} title={providerNames[provider]} failing={failing(provider)} aria-label={`Open ${providerNames[provider]}`} href={collectionLocation({ provider, url: "" })} onClick={() => details.open(collectionLocation({ provider, url: "" }))} />)}
      {searches.map(provider => <SourceChip key={provider} title={providerNames[provider]} failing={failing(provider)} aria-label={`Search ${providerNames[provider]}`} onClick={() => scopeSearch(providerNames[provider])} />)}
    </ul>
  </section>;
}

/**
 * A source as a chip with its name (and a muted word after it, where it has one), one target; a shared input's other
 * verbs are its menu, as a tile's are. A source that didn't load last time is muted and says so; it still opens, to try again.
 */
function SourceChip({ title, meta, failing = false, href, onClick, menu = [], ...props }: { title: string; meta?: string; failing?: boolean; href?: string; onClick: () => void; menu?: MenuAction[] } & Omit<ComponentProps<typeof Button>, "title" | "onClick" | "children">) {
  const options = useItemMenu(menu);
  const body = <><span className={cn(failing && "text-muted-foreground")}>{title}</span>{(failing || meta) && <span className="font-normal text-muted-foreground">{failing ? "Couldn't load" : meta}</span>}</>;
  // A label replaces the chip's words, so it says the failure too.
  const label = props["aria-label"] && failing ? `${props["aria-label"]}, couldn't load` : props["aria-label"];
  return <li {...options.item} className={cn("relative flex min-w-0 max-w-full", options.item.className)}>
    <Button variant="secondary" {...options.target} {...props} aria-label={label} asChild={!!href} className={cn("h-auto min-h-control min-w-0 max-w-full flex-wrap text-body font-normal whitespace-normal [overflow-wrap:anywhere]", options.shown.length && "pr-10")} onClick={(event: MouseEvent<HTMLElement>) => {
      if (href && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
      event.preventDefault();
      onClick();
    }}>{href ? <a href={detailHref(href)}>{body}</a> : body}</Button>
    <ItemMenu menu={options} title={title} className="absolute top-0 right-1 size-control" />
  </li>;
}

export function Failed({ what, retry }: { what: string; retry?: () => void }) {
  return <Alert variant="destructive"><AlertDescription>Couldn't load {what}.</AlertDescription>{retry && <AlertAction><Button data-page-first variant="ghost" size="sm" onClick={retry}>{TRY_AGAIN}</Button></AlertAction>}</Alert>;
}
