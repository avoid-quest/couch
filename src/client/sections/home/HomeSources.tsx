import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { type ComponentProps, type ReactNode, useSyncExternalStore } from "react";
import { notifyManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { coreSentence } from "@/api/client";
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
    return (
      <Failed
        title="Live TV"
        href="/live-tv"
        error={guide.error}
        options={options}
        retry={() => void guide.refetch()}
      />
    );
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

/** The devices' shared inputs, while any are shared; each plays, and its other verbs are its menu. */
export function SharedSources({ hits, options }: { hits: SearchHit[]; options?: ReactNode }) {
  const { on } = usePlayOn();
  return (
    <section aria-label="Shared sources" className="grid min-w-0 gap-stack">
      <div className="flex items-center gap-4">
        <ShelfHeading title="Shared sources" />
        {options}
      </div>
      <ul data-nav-row aria-label="Shared sources" className="flex flex-wrap gap-2">
        {hits.map((hit, index) => (
          <SourceChip
            key={hit.id}
            data-page-first={index === 0 || undefined}
            title={hit.title}
            meta={hit.meta}
            aria-label={
              hit.primary.label === "Play"
                ? on(`Play ${hit.title}`)
                : `${hit.primary.label} ${hit.title}`
            }
            disabled={hit.primary.disabled}
            onClick={hit.primary.run}
            menu={hit.actions.filter((action) => action.label !== hit.primary.label)}
          />
        ))}
      </ul>
    </section>
  );
}

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
    meta: "Spotify, Bandcamp, SoundCloud, Mixcloud",
    scope: { kind: "music", source: "All" },
  },
  {
    label: "Radio archives",
    meta: "Past shows from NTS, Lyl and seven more",
    scope: { source: "Radio archives" },
  },
];

/**
 * One quiet line of doors to the sources, each saying what is behind it, all as wide as each other, then the section's
 * "…". The doors scroll sideways where they don't fit; the "…" stays at the line's end. Its doors are its name: "Browse"
 * is for screen readers. With `first` (nothing to continue leads Home), its first door takes a remote's first press.
 */
export function BrowseLine({ options, first = false }: { options: ReactNode; first?: boolean }) {
  const { scopeSearch } = useShell();
  const details = useDetailNavigation();
  const failing = useFailingSources();
  return (
    // One row for a remote: Right from the last door goes on to the "…".
    <section
      data-nav-row
      aria-labelledby="home-browse"
      className="-mx-(--gutter) flex min-w-0 border-y pr-(--gutter)"
    >
      <h2 id="home-browse" className="sr-only">
        Browse
      </h2>
      <ul
        aria-labelledby="home-browse"
        className="flex min-w-0 flex-1 overflow-x-auto pl-(--gutter) [scrollbar-width:none]"
      >
        {doors.map((door, index) => {
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
            <li
              key={door.label}
              className="flex min-w-0 flex-[1_0_8.75rem] border-l first:border-l-0 sm:flex-[1_0_10.5rem]"
            >
              {href ? (
                <Button
                  asChild
                  variant="ghost"
                  className={doorClass}
                  data-page-first={(first && index === 0) || undefined}
                >
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
                  data-page-first={(first && index === 0) || undefined}
                  onClick={() => "scope" in door && scopeSearch(door.scope)}
                >
                  {body}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {/* On the doors' title line. */}
      <div className="flex shrink-0 items-start border-l pt-1.5 pl-1">{options}</div>
    </section>
  );
}

// A door's words: its name on one line, then what is behind it, muted and at most two lines.
export const doorClass =
  "h-auto min-h-16 w-full min-w-0 flex-col items-stretch justify-start gap-0.5 rounded-md px-4 py-3 text-left whitespace-normal";
export function DoorBody({ label, meta }: { label: string; meta: string }) {
  return (
    <>
      <span className="truncate font-display text-body font-semibold">{label}</span>
      <span className="line-clamp-2 text-meta font-normal text-subtle-foreground">{meta}</span>
    </>
  );
}

/** A shared source as a chip with its name and a muted word after it, one target; its other verbs are its menu, as a tile's are. */
function SourceChip({
  title,
  meta,
  onClick,
  menu = [],
  ...props
}: {
  title: string;
  meta?: string;
  onClick: () => void;
  menu?: MenuAction[];
} & Omit<ComponentProps<typeof Button>, "title" | "onClick" | "children">) {
  const options = useItemMenu(menu);
  return (
    <li
      {...options.item}
      className={cn("relative flex min-w-0 max-w-full", options.item.className)}
    >
      <Button
        variant="secondary"
        {...options.target}
        {...props}
        className={cn(
          "h-auto min-h-control min-w-0 max-w-full flex-wrap text-body font-normal whitespace-normal [overflow-wrap:anywhere]",
          options.shown.length && "pr-10",
        )}
        onClick={onClick}
      >
        <span>{title}</span>
        {meta && <span className="font-normal text-muted-foreground">{meta}</span>}
      </Button>
      <ItemMenu menu={options} title={title} className="absolute top-0 right-1 size-control" />
    </li>
  );
}

/** A Home shelf that couldn't load, in that shelf's place. */
export function Failed({
  title,
  href,
  what = title,
  error,
  options,
  retry,
}: {
  title: string;
  href?: string;
  what?: string;
  /** Why it failed: Core's own sentence shows under the problem when it sent one. */
  error: unknown;
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
      detail={coreSentence(error)}
      retry={retry}
    />
  );
}
