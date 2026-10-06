import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { defaultStringifySearch, useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { offline, TRY_AGAIN } from "@/copy";
import { apiSend } from "@/api/client";
import { iptvGuideQuery, iptvLogoQuery } from "@/api/iptv";
import { collectionPageSize } from "@/collection-pagination";
import { BrowsePagination } from "@/components/BrowsePagination";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PageHeader } from "@/components/PageHeader";
import { playOnQuery, usePlayOn } from "@/components/PlayOn";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import type { GuideChannel, GuideRow } from "../../../shared/iptv";
import { BrowseActions } from "./SearchPanel";
import { searchError } from "./SearchOnlineResults";

type LiveTvSearch = { page?: number; filter?: string; group?: string };
const liveTvLocation = ({ page = 1, filter = "", group = "" }: LiveTvSearch = {}) => `/find${defaultStringifySearch({ browse: "live-tv", ...(group ? { group } : {}), ...(page > 1 ? { page } : {}), ...(filter ? { filter } : {}) })}`;
// Guide groups are display text without control characters, so this can't name one.
const allGroups = "\u0000";
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** Find > Live TV: the guide's channels with what's on now and next, a page at a time. */
export function BrowseLiveTv() {
  const { credentials, available } = useShell();
  const { connected, state, tvPresentation, queue } = useSessionGate();
  const search: Record<string, unknown> = useLocation().search;
  const navigate = useNavigate();
  const filter = typeof search.filter === "string" ? search.filter.slice(0, 100) : "";
  const group = typeof search.group === "string" ? search.group.slice(0, 200) : "";
  const requested = typeof search.page === "number" && Number.isSafeInteger(search.page) && search.page > 0 ? search.page : 1;
  // Now and next move on while the page is open.
  // Core accepts at most eight sources of 5,000 channels each.
  const guide = useQuery({ ...iptvGuideQuery(credentials, { offset: Math.min((requested - 1) * collectionPageSize, 40_000), group, q: filter }), enabled: connected, placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const channels = guide.data?.channels.slice(0, collectionPageSize) ?? [];
  const total = guide.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / collectionPageSize));
  useEffect(() => {
    if (guide.data && !guide.isPlaceholderData && requested > pages) void navigate({ href: liveTvLocation({ page: pages, filter, group }), replace: true, resetScroll: false });
  }, [guide.data, guide.isPlaceholderData, requested, pages, filter, group, navigate]);
  const { play } = usePlayOn();
  const action = useMutation({
    mutationFn: ({ channel, playNow, deviceId }: { channel: GuideChannel; playNow: boolean; deviceId?: string }) => playNow
      ? play(on => apiSend(credentials, `/api/iptv/channels/${channel.id}/play${playOnQuery(on)}`), deviceId)
      : queue(channel.name, () => apiSend(credentials, `/api/iptv/channels/${channel.id}/queue`)),
    onError: reason => toast.error(searchError(reason)),
  });
  const go = (next: LiveTvSearch, replace = false) => void navigate({ href: liveTvLocation({ page: requested, filter, group, ...next }), replace, resetScroll: false }).then(() => {
    if (replace) return;
    const heading = document.getElementById("live-tv-channels");
    heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" });
  });
  const disabled = !available || action.isPending;
  const row = (channel: GuideRow) => {
    const run = (playNow: boolean, deviceId?: string) => action.mutate({ channel, playNow, deviceId });
    return <MediaRow key={channel.id} compact title={channel.name} artFit="contain" art={<ChannelLogo channel={channel} />} tvSecondaryActions
      meta={[channel.now?.title, channel.next && `${clock(channel.next.start)} ${channel.next.title}`, !group && channel.group].filter(Boolean).join(" · ")}
      primary={{ label: "Play", disabled, onClick: () => run(true) }}
      actions={<BrowseActions title={channel.name} actions={[
        ...(tvPresentation ? [] : [{ label: "Play", disabled, run: () => run(true) }]),
        { label: "Play on", disabled, playOn: deviceId => run(true, deviceId) },
        { label: "Queue", disabled: !connected || action.isPending, run: () => run(false) },
      ]} />} />;
  };
  return <section className="min-w-0 space-y-6" aria-label="Browse Live TV">
    <ContentBreadcrumb title="Live TV" />
    <PageHeader title="Live TV" className="mb-0" />
    {!connected && <p className="text-sm text-muted-foreground" role="status">{offline(state?.installationName)}</p>}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><h2 id="live-tv-channels" tabIndex={-1} className="flex items-center gap-2 text-sm text-muted-foreground outline-none">{guide.isLoading ? <><Spinner className="size-3.5" /><span role="status">Loading channels…</span></> : <>{total} {total === 1 ? "channel" : "channels"}</>}</h2>
      <div className="flex flex-wrap items-center gap-4">
        {!!guide.data?.groups.length && <Select value={group || allGroups} onValueChange={value => go({ page: 1, group: value === allGroups ? "" : value }, true)}>
          <SelectTrigger aria-label="Group" className="h-8 w-auto border-0 bg-transparent px-0 text-muted-foreground shadow-none dark:bg-transparent"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={allGroups}>All groups</SelectItem>{guide.data.groups.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
        </Select>}
        <Input type="search" aria-label="Filter channels" placeholder="Filter" className="h-8 w-32 border-0 bg-transparent px-0 shadow-none dark:bg-transparent sm:w-40" value={filter} onChange={event => go({ page: 1, filter: event.target.value }, true)} />
        <BrowsePagination page={requested} pages={pages} previous={requested > 1 ? liveTvLocation({ page: requested - 1, filter, group }) : undefined} next={requested < pages ? liveTvLocation({ page: requested + 1, filter, group }) : undefined} disabled={!connected || guide.isFetching} onSelectPage={page => go({ page })}
          onNavigate={(event, href) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); go({ page: Number(new URL(href, location.origin).searchParams.get("page") ?? 1) }); }} />
      </div>
    </div>
    {guide.error && <Alert variant="destructive"><AlertDescription>Couldn't load Live TV. {searchError(guide.error)}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void guide.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {!!channels.length && <MediaList aria-label="Live TV channels">{channels.map(row)}</MediaList>}
    {guide.data && !guide.isPlaceholderData && requested <= pages && !guide.error && !channels.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>{filter || group ? "No channels match. Try another name or group, or clear the filter." : "No channels yet. An admin can add one in Settings → Sources → Live TV."}</EmptyDescription></EmptyHeader></Empty>}
  </section>;
}

function ChannelLogo({ channel }: { channel: GuideChannel }) {
  const { credentials } = useShell();
  const logo = useQuery({ ...iptvLogoQuery(credentials, channel.id), enabled: channel.hasLogo });
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (!logo.data) return;
    const url = URL.createObjectURL(logo.data);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [logo.data]);
  return <MediaArtwork thumbnail={src} title={channel.name} />;
}
