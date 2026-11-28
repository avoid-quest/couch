import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { providerPageQuery } from "@/api/providers";
import { majorityShape, providerItemShape } from "@/art-shape";
import { useRoomLead } from "@/components/AmbientLight";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { MediaArtwork } from "@/components/MediaArtwork";
import { mediaSubtitle, useRelatedMenu } from "@/components/MediaContext";
import { MediaTile } from "@/components/MediaTile";
import { PlayPill, usePlayOn } from "@/components/PlayOn";
import { SaveToggle } from "@/components/DetailHeader";
import { ItemMenu, RowOptions, useItemMenu } from "@/components/RowMenu";
import { Shelf, ShelfHeading } from "@/components/Shelf";
import { TRY_AGAIN } from "@/copy";
import { StageTitle } from "@/components/Stage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import { metaLine } from "@/media-caption";
import type { SearchScope } from "@/search-palette";
import { useHomeAction, type AddTarget } from "@/sections/home/AddToHome";
import { browserActions } from "@/original-page";
import { DoorBody, doorClass } from "@/sections/home/HomeSources";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { cn } from "@/lib/utils";
import type { MediaCollection } from "../../../shared/media";
import {
  pageSection,
  providerNames,
  type ProviderId,
  type ProviderItem,
  type ProviderPage,
} from "../../../shared/providers";
import {
  SearchOnlineResults,
  type SearchHit,
  type SearchResultSummary,
} from "./SearchOnlineResults";
import { useFirstVerb } from "./SearchPanel";

/**
 * While a source's room is open, the header's field wears its scope as a token, so typing searches there; leaving the
 * room takes the token away, unless the field has been narrowed or widened since.
 */
export function useRoomScope(scope: SearchScope | null) {
  const { setSearchScope } = useShell();
  const key = JSON.stringify(scope);
  useEffect(() => {
    if (!scope) return;
    setSearchScope(scope);
    return () => setSearchScope((current) => (JSON.stringify(current) === key ? null : current));
  }, [key]);
}

/** The room is lit by its lead's picture while nothing plays, as search's results are by the top one (RoomLight.tsx). */
export function RoomLight({ thumbnail }: { thumbnail?: string }) {
  useRoomLead(thumbnail);
  return null;
}

/** A room's top: where it is (Home, the source, the section), its name set large, a count and its verbs. */
export function RoomHead({
  title,
  provider,
  context,
  meta,
  actions,
}: {
  title: string;
  provider?: ProviderId;
  context?: MediaCollection;
  meta?: string;
  actions?: ReactNode;
}) {
  const details = useDetailNavigation();
  // A phone's trail is the one place to go back to.
  const back =
    context ??
    (provider && title !== providerNames[provider]
      ? { title: providerNames[provider], url: "" }
      : undefined);
  const backHref = back ? collectionLocation({ provider: provider!, url: back.url }) : "/";
  return (
    <header className="grid gap-2">
      <ContentBreadcrumb
        title={title}
        provider={provider}
        collection={context}
        className="max-sm:hidden"
      />
      <a
        href={detailHref(backHref)}
        onClick={(event) => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          details.open(backHref);
        }}
        className="flex min-h-11 items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground sm:hidden"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {back?.title ?? "Home"}
      </a>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {/* At least a short title's width, else the whole line: what follows wraps under it. */}
        <div className="room-title @container min-w-0 grow basis-[min(100%,28rem)]">
          {title ? <StageTitle title={title} /> : <Skeleton className="h-14 w-72 max-w-full" />}
        </div>
        {meta && <p className="pb-1 text-body text-muted-foreground tabular-nums">{meta}</p>}
        {actions && <div className="ml-auto flex items-center gap-2 pb-0.5">{actions}</div>}
      </div>
    </header>
  );
}

/** A room's or a shelf's "…": Add it to Home (or Show it on Home), and its page beyond Couch. */
function useRoomOptions(target: AddTarget | undefined) {
  const homeAction = useHomeAction();
  return target ? [...homeAction(target), ...browserActions(target.url, target.title)] : [];
}

/** The room's own "…", at the end of its head. */
export function RoomOptions(target: AddTarget) {
  return <RowOptions title={target.title} actions={useRoomOptions(target)} />;
}

export type Door = { label: string; meta?: string; href?: string; onPress?: () => void };

/**
 * A room's own doors, as Home's Browse line draws its own: each names a place and what is behind it. The line scrolls
 * sideways where it doesn't fit; on the TV the room starts on its first door.
 */
export function DoorLine({ label, doors }: { label: string; doors: Door[] }) {
  const details = useDetailNavigation();
  const line = useRef<HTMLElement>(null);
  // The doors come with the source's answer, after the page took its first focus.
  useFirstVerb(line, doors.length > 0, label);
  if (!doors.length) return null;
  return (
    <nav
      ref={line}
      aria-label={label}
      className="-mx-(--gutter) flex overflow-x-auto border-y px-(--gutter) [scrollbar-width:none]"
    >
      <ul data-nav-row className="flex">
        {doors.map((door, index) => (
          <li
            key={`${door.label}:${door.href ?? index}`}
            className="flex w-max min-w-36 max-w-64 shrink-0 border-l first:border-l-0 max-sm:min-w-[40vw]"
          >
            <Button
              asChild={!!door.href}
              variant="ghost"
              data-page-first={index === 0 || undefined}
              className={doorClass}
              onClick={door.href ? undefined : door.onPress}
            >
              {door.href ? (
                <a
                  href={detailHref(door.href)}
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
                    details.open(door.href!);
                  }}
                >
                  <DoorBody label={door.label} meta={door.meta ?? ""} />
                </a>
              ) : (
                <DoorBody label={door.label} meta={door.meta ?? ""} />
              )}
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Seeds what a source's front page already answered for its lists, so each shelf opens without asking again. */
export function useSeededPages(provider: ProviderId, pages: (ProviderPage | undefined)[]) {
  const client = useQueryClient();
  const { credentials } = useShell();
  for (const page of pages) {
    const url = page?.item?.url;
    if (!page || !url) continue;
    const { queryKey } = providerPageQuery(credentials, provider, { url });
    if (!client.getQueryState(queryKey)?.dataUpdatedAt) client.setQueryData(queryKey, page);
  }
}

/** A list's hits paired with the items they were made from, as the page holds them. */
function entries(summary: SearchResultSummary | undefined) {
  return (summary?.hits ?? []).flatMap((hit) => {
    const item = summary?.page?.items.find(
      (item) =>
        hit.id ===
        `${item.provider}:${item.id}${item.collection?.index == null ? "" : `:${item.collection.index}`}`,
    );
    return item ? [{ hit, item }] : [];
  });
}

/** A list read from its own address, as SearchOnlineResults reads any source's page into hits with their verbs. */
export function useListHits(provider: ProviderId, url: string) {
  const { credentials, available, openProvider, playHistory } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const [summary, setSummary] = useState<SearchResultSummary>();
  const report = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  const reader = (
    <SearchOnlineResults
      provider={provider}
      query=""
      url={url}
      paged
      onOpenCollection={openProvider}
      onResults={report}
      onPlayHistory={playHistory}
      origin={credentials.origin}
      token={credentials.token}
      connected={connected}
      canPlay={available}
      active
      onCommand={run}
      quality={videoQualityPreference.quality}
      onEnqueued={() => {}}
    />
  );
  return { reader, summary, entries: entries(summary) };
}

/** A tile whose press does its main verb: Play what plays (an episode, a channel on now), Open what holds things. */
export function RoomTile({
  hit,
  item,
  shape,
  first,
  fluid = false,
}: {
  hit: SearchHit;
  item: ProviderItem;
  shape: ReturnType<typeof majorityShape>;
  first?: boolean;
  /** In a grid: as wide as its cell, its picture's height following (the cell is a size container). */
  fluid?: boolean;
}) {
  const { openProvider } = useShell();
  const { on } = usePlayOn();
  const play =
    item.kind === "media" ? hit.actions.find((action) => action.label === "Play") : undefined;
  return (
    <MediaTile
      related={{ collection: item.collection, creator: item.creator }}
      data-page-first={first || undefined}
      className={
        fluid
          ? cn("w-full [&_[data-media-tile]]:w-full [&_[data-tile-art]]:w-full", fluidHeight[shape])
          : undefined
      }
      shape={shape}
      own={providerItemShape(providerNames[item.provider], item)}
      dim={item.kind === "channel" && item.live === false}
      title={item.title}
      meta={metaLine(mediaSubtitle(item))}
      thumbnail={item.thumbnail}
      source={item.url}
      aria-label={play ? on(`Play ${item.title}`) : `Open ${item.title}`}
      disabled={play?.disabled}
      href={play ? undefined : collectionLocation(item)}
      onClick={() => (play ? play.run?.() : openProvider(item))}
      menu={hit.actions}
    />
  );
}

const fluidHeight = {
  video: "[--tile-art:56.25cqi]",
  poster: "[--tile-art:150cqi]",
  square: "[--tile-art:100cqi]",
  round: "[--tile-art:100cqi]",
} as const;

// A shelf scrolls, so it holds more than fits; its heading opens the whole list.
const shelfLength = 24;

/**
 * One of a source's lists as a shelf, read from its own address (seeded by the room when its page carried it). Its
 * heading opens the list (or `href`, another room); its "…" adds it to Home and holds its page. `note` is a muted word after the heading.
 */
export function ListShelf({
  provider,
  url,
  title,
  href = collectionLocation({ provider, url }),
  note,
  followable = true,
  first,
}: {
  provider: ProviderId;
  url: string;
  title: string;
  href?: string;
  note?: string;
  followable?: boolean;
  first?: boolean;
}) {
  const { reader, summary, entries: listed } = useListHits(provider, url);
  const loading = !summary || summary.loading;
  const shown = listed.filter(({ item }) => item.url !== url || item.live).slice(0, shelfLength);
  const frame = majorityShape(
    shown.map(({ item }) => providerItemShape(providerNames[provider], item)),
    "video",
  );
  const options = useRoomOptions(followable && url ? { provider, url, title } : undefined);
  const menu = options.length ? <RowOptions title={title} actions={options} /> : undefined;
  return (
    <>
      {reader}
      {summary?.error && !shown.length ? (
        // A list that can't be read says so in its place, quietly, as a followed one on Home does.
        <section aria-label={title} className="grid min-w-0 gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <ShelfHeading title={title} href={href} />
          </div>
          <p
            role="status"
            className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground"
          >
            Couldn't load {title}.
            {summary.retry && (
              <Button variant="ghost" size="sm" onClick={summary.retry}>
                {TRY_AGAIN}
              </Button>
            )}
          </p>
        </section>
      ) : !loading && !shown.length ? null : (
        <Shelf title={title} href={href} note={note} loading={loading} options={menu}>
          {loading ? (
            <MediaTilesSkeleton shape={frame} />
          ) : (
            shown.map(({ hit, item }, index) => (
              <li key={hit.id} className="flex shrink-0">
                <RoomTile hit={hit} item={item} shape={frame} first={first && index === 0} />
              </li>
            ))
          )}
        </Shelf>
      )}
    </>
  );
}

/** Shelves come in as the page goes down: a source's front page holds dozens. */
export function useInstalments(total: number, step = 6) {
  const [shown, setShown] = useState(step);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || shown >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown((value) => value + step);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown, total, step]);
  return {
    shown,
    more: shown < total ? <div ref={sentinel} aria-hidden="true" className="h-px" /> : null,
  };
}

/**
 * The room's lead, the source's own (RaiPlay's hero) or what the house would want on now (a saved Twitch channel): a
 * line of what it is, its title, a few words, then its main verb and its menu, with its picture standing at the right.
 */
export function RoomLead({
  hit,
  item,
  kicker,
  save,
}: {
  hit: SearchHit;
  item: ProviderItem;
  kicker?: string;
  /** What Save keeps when it isn't the hit's own (a channel, for the stream it is showing). */
  save?: { saved: boolean; run: () => void; disabled?: boolean };
}) {
  const { openProvider } = useShell();
  const details = useDetailNavigation();
  const { on } = usePlayOn();
  const play =
    item.kind === "media" ? hit.actions.find((action) => action.label === "Play") : undefined;
  const playOn = hit.actions.find((action) => action.label === "Play on");
  const own = hit.actions.find((action) => action.group === "keep" && action.pressed !== undefined);
  const keep =
    save ?? (own && { saved: !!own.pressed, run: () => own.run?.(), disabled: own.disabled });
  // The pill holds Play and where it plays, the icon Save; the "…" holds the rest, Play on… and where it belongs too.
  const rest = useItemMenu([
    ...hit.actions.filter((action) => action !== play && action !== own && action.label !== "Open"),
    ...useRelatedMenu({ collection: item.collection, creator: item.creator }),
  ]);
  const href = collectionLocation(item);
  const press = () => (play ? play.run?.() : openProvider(item));
  return (
    <section
      aria-label={item.title}
      data-room-lead
      className="grid items-center gap-x-10 gap-y-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
    >
      <div className="grid min-w-0 content-center justify-items-start gap-3 max-md:order-2">
        {kicker && <p className="text-meta text-muted-foreground">{kicker}</p>}
        <h2 className="text-page font-semibold text-balance break-words">{item.title}</h2>
        {item.description && (
          <p className="line-clamp-2 max-w-prose text-body text-muted-foreground">
            {item.description}
          </p>
        )}
        <div data-nav-row className="mt-1 flex flex-wrap items-center gap-2">
          {play ? (
            <PlayPill
              data-room-lead-verb
              size="lg"
              label="Play"
              aria-label={on(`Play ${item.title}`)}
              title={item.title}
              thumbnail={item.thumbnail}
              disabled={play.disabled}
              onClick={press}
              playOn={playOn?.playOn}
              playOnDisabled={playOn?.disabled}
            />
          ) : (
            <Button data-room-lead-verb size="lg" variant="secondary" asChild>
              <a
                href={detailHref(href)}
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
                Open
              </a>
            </Button>
          )}
          {keep && (
            <SaveToggle
              aria-label={`Save ${item.title}`}
              saved={keep.saved}
              disabled={keep.disabled}
              onClick={keep.run}
            />
          )}
          <ItemMenu menu={rest} size="icon-lg" title={item.title} className="opacity-100" />
        </div>
      </div>
      {item.thumbnail && (
        // The picture is a pointer target for the main verb, never a focus stop of its own.
        <div
          aria-hidden="true"
          onClick={press}
          className="aspect-video w-full max-w-[32rem] cursor-pointer justify-self-end overflow-hidden rounded-md shadow-(--object-shadow) max-md:order-1 max-md:justify-self-stretch max-md:max-w-none"
        >
          <MediaArtwork
            thumbnail={item.thumbnail}
            title={item.title}
            className="aspect-auto size-full object-cover"
          />
        </div>
      )}
    </section>
  );
}

/** A room's lead read from its own address: its first item, with its verbs. */
export function ListLead({
  provider,
  url,
  kicker,
}: {
  provider: ProviderId;
  url: string;
  kicker?: (item: ProviderItem) => string | undefined;
}) {
  const { reader, entries: listed } = useListHits(provider, url);
  const lead = listed.find(({ item }) => !pageSection(item));
  return (
    <>
      {reader}
      {lead && (
        <RoomLead
          hit={lead.hit}
          item={lead.item}
          kicker={kicker?.(lead.item) ?? lead.item.subtitle}
        />
      )}
    </>
  );
}
