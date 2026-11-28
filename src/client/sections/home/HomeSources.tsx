import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { type ReactNode, useSyncExternalStore } from "react";
import { Airplay, AudioLines, Monitor, Volume2 } from "lucide-react";
import { Level } from "@/components/Level";
import { LiveClock } from "@/components/LiveClock";
import { deviceId } from "@/session/device-id";
import type { LiveSource } from "../../../shared/live-input";
import { notifyManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { iptvGuideQuery } from "@/api/iptv";
import { Button } from "@/components/ui/button";
import { MediaTile } from "@/components/MediaTile";
import { majorityShape, providerItemShape } from "@/art-shape";
import { metaLine } from "@/media-caption";
import { usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { Shelf, ShelfHeading, ShelfProblem } from "@/components/Shelf";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import { browserActions } from "@/original-page";
import { cn } from "@/lib/utils";
import { providerNames, type SearchHit } from "@/sections/find/SearchOnlineResults";
import { useShell } from "@/sections/shell/shell-context";
import type { SearchScope } from "@/search-palette";
import { useSessionGate } from "@/session/session-context";
import type { GuideRow } from "../../../shared/iptv";
import {
  pageSection,
  type BrowseRequest,
  type ProviderId,
  type ProviderItem,
} from "../../../shared/providers";
import { useHomeFollows } from "./home-follows";
import { channelMeta, useChannelActions, useChannelLogo } from "./LiveTvPage";

// Live TV samples the guide; its heading opens the rest.
const shelfLength = 12;
// The sources with a home of their own: what's live first, then the catalogues, so wide frames break up the posters.
export const sourceHomes = [
  "twitch",
  "streamingcommunity",
  "raiplay",
  "movies123",
  "animesaturn",
  "animeunity",
] as const satisfies readonly ProviderId[];

/** The first channels of the Live TV guide; the heading opens every channel. A channel has no page, so its tile plays it. */
export function LiveTvShelf({ options }: { options?: ReactNode }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  // The guide's first page, as Live TV's own page asks for it.
  const guide = useQuery({
    ...iptvGuideQuery(credentials, { offset: 0, group: "", q: "" }),
    enabled: connected,
    refetchInterval: 60_000,
  });
  const actions = useChannelActions();
  if (guide.error && !guide.data)
    return <Failed title="Live TV" href="/live-tv" retry={() => void guide.refetch()} />;
  if (guide.data && !guide.data.channels.length) return null;
  return (
    <Shelf loading={!guide.data} title="Live TV" href="/live-tv" options={options}>
      {!guide.data ? (
        <MediaTilesSkeleton />
      ) : (
        guide.data.channels.slice(0, shelfLength).map((channel, index) => (
          <li key={channel.id} className="shrink-0">
            <ChannelTile first={index === 0} channel={channel} {...actions(channel)} />
          </li>
        ))
      )}
    </Shelf>
  );
}

function ChannelTile({
  channel,
  disabled,
  play,
  menu,
  first,
}: {
  first: boolean;
  channel: GuideRow;
  disabled: boolean;
  play: () => void;
  menu: MenuAction[];
}) {
  const { on } = usePlayOn();
  return (
    <MediaTile
      data-page-first={first || undefined}
      shape="video"
      fit="contain"
      title={channel.name}
      meta={channelMeta(channel) || undefined}
      thumbnail={useChannelLogo(channel)}
      source={`iptv:${channel.id}`}
      aria-label={on(`Play ${channel.name}`)}
      disabled={disabled}
      onClick={play}
      menu={menu}
    />
  );
}

/**
 * What's saved from a source, in Saved's order, live channels first and offline ones dimmed; each tile opens its page,
 * and the heading the source's own home. Nothing saved, no shelf: the Browse line opens the source.
 */
export function SavedSourceShelf({
  provider,
  items: saved,
  options,
}: {
  provider: ProviderId;
  items: ProviderItem[];
  options?: ReactNode;
}) {
  const { openProvider } = useShell();
  const name = providerNames[provider];
  // A section of a source's front page (RaiPlay's "In Diretta") is that page's, which the heading opens; Save no longer offers it.
  const items = saved
    .filter((item) => !pageSection(item))
    .sort((a, b) => Number(!!b.live) - Number(!!a.live));
  if (!items.length) return null;
  const shape = (item: ProviderItem) => providerItemShape(name, item);
  const frame = majorityShape(items.map(shape));
  return (
    <Shelf title={name} href={collectionLocation({ provider, url: "" })} options={options}>
      {items.map((item, index) => (
        <li key={item.id} className="shrink-0">
          <MediaTile
            related={{ collection: item.collection, creator: item.creator }}
            data-page-first={index === 0 || undefined}
            shape={frame}
            own={shape(item)}
            dim={item.kind === "channel" && item.live === false}
            title={item.title}
            meta={metaLine(item.subtitle)}
            thumbnail={item.thumbnail}
            source={item.url}
            aria-label={`Open ${item.title}`}
            menu={browserActions(item.url)}
            href={collectionLocation(item)}
            onClick={() => openProvider(item)}
          />
        </li>
      ))}
    </Shelf>
  );
}

/**
 * The devices' shared inputs, while any are shared, right under Browse: each a row with its picture or mark, what it
 * is and who shares it, where it plays now, and its one verb (Play, Join, Leave, or Open once it plays here or on the
 * device that shares it); its other verbs are its menu.
 */
export function SharedSources({ hits, options }: { hits: SearchHit[]; options?: ReactNode }) {
  const { state } = useSessionGate();
  return (
    <section aria-label="Shared sources" className="grid min-w-0 gap-2">
      <div className="flex items-center gap-4">
        <ShelfHeading title="Shared sources" />
        {options}
      </div>
      <ul
        data-nav-row
        aria-label="Shared sources"
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-x-6"
      >
        {hits.map((hit, index) => {
          const source = state?.liveSources?.find((item) => `live:${item.id}` === hit.id);
          return (
            source && <SharedSourceRow key={hit.id} hit={hit} source={source} first={index === 0} />
          );
        })}
      </ul>
    </section>
  );
}

function SharedSourceRow({
  hit,
  source,
  first,
}: {
  hit: SearchHit;
  source: LiveSource;
  first: boolean;
}) {
  const { state, liveSharing, tvPresentation } = useSessionGate();
  const { on } = usePlayOn();
  const options = useItemMenu(hit.actions.filter((action) => action.label !== hit.primary.label));
  const here = deviceId();
  const mine = source.deviceId === here;
  const from =
    source.kind === "airplay"
      ? undefined
      : mine
        ? undefined
        : state?.devices?.find((device) => device.id === source.deviceId)?.name;
  // Where it plays now, by every Playback of it.
  const outputs = [
    ...new Set(
      (state?.playbacks ?? [])
        .filter((playback) => playback.liveSourceId === source.id)
        .flatMap((playback) => playback.outputs.map((output) => output.deviceId)),
    ),
  ].filter((id) => id !== (source.intent === "live" ? undefined : source.deviceId));
  const named = outputs.map((id) =>
    id === here
      ? tvPresentation
        ? "this TV"
        : "this device"
      : (state?.devices?.find((device) => device.id === id)?.name ?? "another device"),
  );
  const listening = source.intent === "live" && outputs.includes(here);
  const where = mine ? (
    "You're sharing this"
  ) : source.intent === "live" ? (
    <LiveClock prefix={listening ? "Listening, live" : "Live"} startedAt={source.startedAt} />
  ) : named.length ? (
    `Playing on ${list.format(named.slice(0, 2))}${named.length > 2 ? ` and ${named.length - 2} more` : ""}`
  ) : (
    "Not playing anywhere yet"
  );
  const preview = mine ? liveSharing.current()?.stream : undefined;
  const Mark =
    source.kind === "airplay"
      ? Airplay
      : source.video
        ? Monitor
        : source.intent === "live" || source.kind === "microphone"
          ? AudioLines
          : Volume2;
  return (
    <li
      {...options.item}
      className={cn("flex min-h-16 min-w-0 items-center gap-3 py-1.5", options.item.className)}
    >
      <span
        aria-hidden="true"
        className="grid aspect-video h-11 shrink-0 place-items-center overflow-hidden rounded-md bg-muted"
      >
        {preview?.getVideoTracks().length ? (
          <video
            muted
            autoPlay
            playsInline
            ref={(video) => {
              if (video && video.srcObject !== preview) video.srcObject = preview;
            }}
            className="size-full object-cover"
          />
        ) : (
          <Mark className="size-5 text-muted-foreground" />
        )}
      </span>
      <span className="grid min-w-0 flex-1 text-sm leading-snug">
        <span className="truncate font-medium" title={hit.title}>
          {hit.title}
        </span>
        <span className="truncate text-muted-foreground">
          {[hit.meta, from && `from ${from}`].filter(Boolean).join(", ")}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {(listening || (!mine && named.length > 0)) && <Level moving className="shrink-0" />}
          <span className="truncate">{where}</span>
        </span>
      </span>
      <Button
        {...options.target}
        data-page-first={first || undefined}
        variant={
          hit.primary.label === "Open" || hit.primary.label === "Leave" ? "secondary" : "default"
        }
        className="shrink-0 rounded-full px-4"
        aria-label={
          hit.primary.label === "Play"
            ? on(`Play ${hit.title}`)
            : `${hit.primary.label} ${hit.title}`
        }
        disabled={hit.primary.disabled}
        onClick={hit.primary.run}
      >
        {hit.primary.label}
      </Button>
      <ItemMenu menu={options} title={hit.title} className="size-control shrink-0" />
    </li>
  );
}

const list = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The sources whose latest answer here was a failure (their home, a page or a search), by their catalogue queries'
 * state, so the Browse line can say so before it is opened again. A list Home follows is left out: one that is gone
 * says so in its own section, and the source can still answer.
 */
function useFailingSources() {
  const client = useQueryClient();
  const follows = useHomeFollows();
  const read = () => {
    const latest = new Map<string, { at: number; failed: boolean }>();
    for (const query of client.getQueryCache().findAll({ queryKey: ["search"] })) {
      const [, kind, provider, request] = query.queryKey as [
        string,
        string,
        string,
        BrowseRequest?,
      ];
      if ((kind !== "provider-page" && kind !== "providers") || typeof provider !== "string")
        continue;
      if (follows.some((follow) => follow.url === request?.url)) continue;
      const { dataUpdatedAt, errorUpdatedAt, status } = query.state;
      const at = Math.max(dataUpdatedAt, errorUpdatedAt);
      if (at && at >= (latest.get(provider)?.at ?? 0))
        latest.set(provider, { at, failed: status === "error" });
    }
    return [...latest]
      .filter(([, answer]) => answer.failed)
      .map(([provider]) => provider)
      .sort()
      .join(" ");
  };
  // Batched as useQuery's own subscriptions are, so a query Home creates while it renders doesn't update this line mid-render.
  const failing = useSyncExternalStore(
    (listener) => client.getQueryCache().subscribe(notifyManager.batchCalls(listener)),
    read,
    read,
  );
  return (provider: ProviderId) => failing.split(" ").includes(provider);
}

// Home's Browse line: what is behind each door, in the order Home's sources come in. A door opens its place: a station
// list, a source's room, or a kind's room with a shelf per source. A door whose sources publish no lists (Music, Radio
// archives) narrows the header's field to them instead, so search stays the one way to look things up.
type Door = { label: string; meta: string } & (
  | { to: string }
  | { provider: ProviderId }
  | { scope: SearchScope }
);
const doors: Door[] = [
  { label: "Radio", meta: "Stations on air", to: "/radio" },
  { label: "Live TV", meta: "Channels from your playlists", to: "/live-tv" },
  { label: "RaiPlay", meta: "Rai's programmes, films and channels", provider: "raiplay" },
  { label: "Twitch", meta: "Channels on now and their videos", provider: "twitch" },
  {
    label: "Films and series",
    meta: "RaiPlay, StreamingCommunity, 123MoviesFree",
    to: "/films-and-series",
  },
  { label: "Anime", meta: "AnimeSaturn, AnimeUnity", to: "/anime" },
  {
    label: "Music",
    meta: "Spotify, Bandcamp, SoundCloud, Mixcloud, YouTube",
    scope: { kind: "music", source: "All" },
  },
  {
    label: "Radio archives",
    meta: "Past shows from NTS, Lyl and seven more",
    scope: { source: "Radio archives" },
  },
];

/** One quiet line of doors to the sources, each saying what is behind it; it scrolls sideways where it doesn't fit. */
export function BrowseLine() {
  const { scopeSearch } = useShell();
  const details = useDetailNavigation();
  const failing = useFailingSources();
  return (
    <section
      aria-labelledby="home-browse"
      className="-mx-(--gutter) flex overflow-x-auto border-y px-(--gutter) [scrollbar-width:none]"
    >
      <h2
        id="home-browse"
        className="flex shrink-0 items-center pr-6 font-display text-title font-semibold [font-stretch:118%] max-sm:pr-4"
      >
        Browse
      </h2>
      <ul data-nav-row aria-labelledby="home-browse" className="flex flex-1">
        {doors.map((door) => {
          const href =
            "to" in door
              ? door.to
              : "provider" in door
                ? collectionLocation({ provider: door.provider, url: "" })
                : undefined;
          // A source's door says it didn't load last time.
          const down = "provider" in door && failing(door.provider);
          const body = <DoorBody label={door.label} meta={down ? "Couldn't load" : door.meta} />;
          return (
            <li key={door.label} className="flex min-w-36 flex-1 border-l first:border-l-0">
              {href ? (
                <Button asChild variant="ghost" className={doorClass}>
                  <a
                    href={detailHref(href)}
                    aria-label={down ? `${door.label}, couldn't load` : undefined}
                    onClick={(event) => {
                      if (
                        event.button ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      details.open(href);
                    }}
                  >
                    {body}
                  </a>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className={doorClass}
                  onClick={() => "scope" in door && scopeSearch(door.scope)}
                >
                  {body}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// A door's words: its name, then what is behind it, muted and at most two lines.
export const doorClass =
  "h-auto min-h-16 w-full min-w-0 flex-col items-start justify-start gap-0.5 rounded-md px-4 py-3 text-left whitespace-normal";
export function DoorBody({ label, meta }: { label: string; meta: string }) {
  return (
    <>
      <span className="font-display text-body font-semibold">{label}</span>
      <span className="line-clamp-2 text-meta font-normal text-subtle-foreground">{meta}</span>
    </>
  );
}

/** A shared source as a chip with its name and a muted word after it, one target; its other verbs are its menu, as a tile's are. */
/** A Home shelf that couldn't load, in that shelf's place. */
export function Failed({
  title,
  href,
  what = title,
  options,
  retry,
}: {
  title: string;
  href?: string;
  what?: string;
  /** The section's "…". */
  options?: ReactNode;
  retry: () => void;
}) {
  return (
    <ShelfProblem
      title={title}
      href={href}
      options={options}
      problem={`Couldn't load ${what}.`}
      retry={retry}
    />
  );
}
