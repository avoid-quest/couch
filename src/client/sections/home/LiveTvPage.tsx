import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { defaultStringifySearch, useLocation, useNavigate } from "@tanstack/react-router";
import { offline, TRY_AGAIN } from "@/copy";
import { apiSend } from "@/api/client";
import { iptvGuideQuery, iptvLogoQuery } from "@/api/iptv";
import { collectionPageSize } from "@/collection-pagination";
import { BrowsePagination } from "@/components/BrowsePagination";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { NoPlaylists } from "@/components/NoPlaylists";
import { PageHeader } from "@/components/PageHeader";
import { playOnQuery, usePlayOn } from "@/components/PlayOn";
import type { MenuAction } from "@/components/RowMenu";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ContentFilters";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { failed } from "@/toasts";
import type { GuideChannel, GuideRow } from "../../../shared/iptv";
import { searchError } from "@/sections/find/SearchOnlineResults";
import { formatClock } from "@/time-format";

type LiveTvSearch = { page?: number; filter?: string; group?: string };
const liveTvLocation = ({ page = 1, filter = "", group = "" }: LiveTvSearch = {}) => `/live-tv${defaultStringifySearch({ group: group || undefined, page: page > 1 ? page : undefined, filter: filter || undefined })}`;
// Guide groups are display text without control characters, so this can't name one.
const allGroups = "\u0000";
/** What's on a channel now and next, then its group where the list mixes them. */
export const channelMeta = (channel: GuideRow, group = "") => [channel.now?.title, channel.next && `${formatClock(channel.next.start)} ${channel.next.title}`, !group && channel.group].filter(Boolean).join(", ");

/** A channel has no page: its press plays it, and its menu holds Play on and Queue. */
export function useChannelActions() {
  const { credentials, available } = useShell();
  const { connected, queue } = useSessionGate();
  const { play } = usePlayOn();
  const action = useMutation({
    mutationFn: ({ channel, playNow, deviceId }: { channel: GuideChannel; playNow: boolean; deviceId?: string }) => playNow
      ? play(on => apiSend(credentials, `/api/iptv/channels/${channel.id}/play${playOnQuery(on)}`), deviceId)
      : queue(channel.name, () => apiSend(credentials, `/api/iptv/channels/${channel.id}/queue`)),
    onError: (reason, { channel, playNow }) => failed(`Couldn't ${playNow ? "play" : "queue"} ${channel.name}.`, reason),
  });
  const disabled = !available || action.isPending;
  return (channel: GuideChannel): { disabled: boolean; play: () => void; menu: MenuAction[] } => ({
    disabled, play: () => action.mutate({ channel, playNow: true }),
    menu: [
      { label: "Play on", disabled, playOn: deviceId => action.mutate({ channel, playNow: true, deviceId }) },
      { label: "Queue", disabled: !connected || action.isPending, run: () => action.mutate({ channel, playNow: false }) },
    ],
  });
}

/** A channel's logo, which Core serves behind the device's credentials, as an object URL. */
export function useChannelLogo(channel: GuideChannel) {
  const { credentials } = useShell();
  const logo = useQuery({ ...iptvLogoQuery(credentials, channel.id), enabled: channel.hasLogo });
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (!logo.data) return;
    const url = URL.createObjectURL(logo.data);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [logo.data]);
  return src;
}

/** Every Live TV channel, which Home's Live TV heading opens: the guide's channels with what's on now and next, a page at a time. */
export function LiveTvPage() {
  const { credentials } = useShell();
  const { connected, state } = useSessionGate();
  const search: Record<string, unknown> = useLocation().search;
  const navigate = useNavigate();
  const filter = typeof search.filter === "string" ? search.filter.slice(0, 100) : "";
  const [queryFilter] = useDebouncedValue(filter.trim(), { wait: 200 });
  const group = typeof search.group === "string" ? search.group.slice(0, 200) : "";
  const requested = typeof search.page === "number" && Number.isSafeInteger(search.page) && search.page > 0 ? search.page : 1;
  // Now and next move on while the page is open.
  // Core accepts at most eight sources of 5,000 channels each.
  const guide = useQuery({ ...iptvGuideQuery(credentials, { offset: Math.min((requested - 1) * collectionPageSize, 40_000), group, q: queryFilter }), enabled: connected, placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const updating = filter.trim() !== queryFilter || guide.isPlaceholderData;
  const channels = guide.data?.channels.slice(0, collectionPageSize) ?? [];
  const total = guide.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / collectionPageSize));
  useEffect(() => {
    if (guide.data && !updating && requested > pages) void navigate({ href: liveTvLocation({ page: pages, filter, group }), replace: true, resetScroll: false });
  }, [guide.data, updating, requested, pages, filter, group, navigate]);
  const actions = useChannelActions();
  // No channels at all, unfiltered: nothing to choose or filter yet.
  const none = !!guide.data && !updating && !guide.error && !total && !filter && !group;
  const go = (next: LiveTvSearch, replace = false) => navigate({ href: liveTvLocation({ page: requested, filter, group, ...next }), replace, resetScroll: false }).then(() => {
    if (replace) return;
    const heading = document.getElementById("live-tv-channels");
    heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" });
  });
  return <section data-page="Live TV" className="min-w-0 space-y-6">
    <PageHeader breadcrumb={<ContentBreadcrumb />} title="Live TV" />
    {!connected && <p className="text-sm text-muted-foreground" role="status">{offline(state?.installationName)}</p>}
    {/* The filters wait for the guide, so an empty one never offers a choice. */}
    {none ? <NoPlaylists what="channels" settings="/settings/couch/sources/live-tv" /> : guide.data && <FilterBar label="Live TV filters">
      <FilterSelect label="Group" value={group || allGroups} onChange={value => go({ page: 1, group: value === allGroups ? "" : value }, true)} options={[{ value: allGroups, label: "All groups" }, ...[...new Set([...(guide.data?.groups ?? []), ...group ? [group] : []])].map(name => ({ value: name, label: name }))]} />
      <FilterInput label="Filter channels" value={filter} maxLength={100} onChange={filter => go({ page: 1, filter }, true)} />
    </FilterBar>}
    <p id="live-tv-channels" tabIndex={-1} role="status" className="sr-only">{guide.data && !updating ? `${total} ${total === 1 ? "channel" : "channels"}` : ""}</p>
    {guide.error && <Alert variant="destructive"><AlertDescription>Couldn't load Live TV. {searchError(guide.error)}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void guide.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {guide.isLoading && <MediaRowsSkeleton compact shape="video" label="Loading channels…" />}
    {!!channels.length && <MediaList aria-label="Live TV channels" aria-busy={updating} className="motion-safe:transition-opacity aria-busy:opacity-60">{channels.map((channel, index) => {
      const { disabled, play, menu } = actions(channel);
      // A channel has no page, so its row keeps its "…".
      return <MediaRow key={channel.id} compact shape="video" pageFirst={index === 0} source={`iptv:${channel.id}`} title={channel.name} artFit="contain" art={<ChannelLogo channel={channel} />} meta={channelMeta(channel, group)} primary={{ label: "Play", disabled, onClick: play }} menu={menu} />;
    })}</MediaList>}
    <BrowsePagination page={requested} pages={pages} previous={requested > 1 ? liveTvLocation({ page: requested - 1, filter, group }) : undefined} next={requested < pages ? liveTvLocation({ page: requested + 1, filter, group }) : undefined} disabled={!connected || guide.isFetching || updating} onSelectPage={page => go({ page })}
      onNavigate={(event, href) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); go({ page: Number(new URL(href, location.origin).searchParams.get("page") ?? 1) }); }} />
    {!none && guide.data && !updating && requested <= pages && !guide.error && !channels.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>No channels match. Try another name or group.</EmptyDescription></EmptyHeader>
      {(filter || group) && <EmptyContent><Button variant="ghost" onClick={() => void go({ page: 1, filter: "", group: "" }, true).then(() => document.querySelector<HTMLInputElement>('input[aria-label="Filter channels"]')?.focus())}>Clear filters</Button></EmptyContent>}
    </Empty>}
  </section>;
}

function ChannelLogo({ channel }: { channel: GuideChannel }) {
  return <MediaArtwork thumbnail={useChannelLogo(channel)} title={channel.name} />;
}
