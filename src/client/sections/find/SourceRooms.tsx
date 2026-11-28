import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { providerFavoritesQuery, providerPageQuery } from "@/api/providers";
import { majorityShape, providerItemShape } from "@/art-shape";
import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { MediaTile } from "@/components/MediaTile";
import { usePlayOn } from "@/components/PlayOn";
import { Shelf, ShelfProblem } from "@/components/Shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { collectionLocation } from "@/detail-navigation";
import { metaLine } from "@/media-caption";
import { browserActions } from "@/original-page";
import type { SearchScope } from "@/search-palette";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import type { MediaCollection } from "../../../shared/media";
import {
  pageSection,
  providerNames,
  type ProviderId,
  type ProviderItem,
  type ProviderPage,
} from "../../../shared/providers";
import {
  AddRoomToHome,
  DoorLine,
  ListLead,
  ListShelf,
  RoomHead,
  RoomLead,
  RoomLight,
  RoomTile,
  useInstalments,
  useListHits,
  useRoomScope,
  useSeededPages,
  type Door,
} from "./Room";
import type { SearchResultSummary } from "./SearchOnlineResults";
import { useFirstVerb } from "./SearchPanel";

const doorOf = (item: ProviderItem, from?: MediaCollection): Door => ({
  label: item.title,
  meta: item.subtitle,
  href: collectionLocation(from ? { ...item, collection: from } : item),
});

/** The room's shelves' place while its page loads. */
function RoomSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-10">
      <Skeleton className="h-16 w-full" />
      {[0, 1].map((index) => (
        <div key={index} className="grid gap-3">
          <Skeleton className="h-6 w-48" />
          <ul className="flex gap-item overflow-hidden">
            <MediaTilesSkeleton />
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * RaiPlay's front page, or one of its sections (Film, Programmi…), as a room: its sections or genres as doors, its own
 * hero as the lead, then its lists as shelves, which come in as the page goes down. A section can be added to Home.
 */
export function RaiPlayRoom({
  page,
  summary,
  title,
  url,
  context,
}: {
  page?: ProviderPage;
  summary?: SearchResultSummary;
  title: string;
  url: string;
  context?: MediaCollection;
}) {
  const room = page?.room;
  useSeededPages("raiplay", [room?.lead, ...(room?.shelves ?? [])]);
  const shelves = room?.shelves.filter((shelf) => shelf.item) ?? [];
  const { shown, more } = useInstalments(shelves.length);
  // Once RaiPlay has answered, a failure is the page's problem below and a page with no lists says so; neither waits.
  const settled = !!summary && !summary.loading;
  // A section's doors (its genres) say where they were opened from.
  const here = url ? { title, url } : undefined;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <RoomLight thumbnail={room?.lead?.items[0]?.thumbnail ?? shelves[0]?.items[0]?.thumbnail} />
      <div className="grid gap-4">
        <RoomHead
          title={title}
          provider="raiplay"
          context={context}
          actions={
            url && page ? <AddRoomToHome provider="raiplay" url={url} title={title} /> : undefined
          }
        />
        <DoorLine
          label={url ? `${title} genres` : "RaiPlay sections"}
          doors={room?.doors.map((door) => doorOf(door, here)) ?? []}
        />
      </div>
      {!settled && !room ? (
        <RoomSkeleton />
      ) : settled && !summary.error && !room?.lead && !shelves.length ? (
        <p role="status" className="text-body text-muted-foreground">
          RaiPlay lists nothing {url ? `under ${title}` : "here"} today.
        </p>
      ) : (
        room && (
          <>
            {room.lead?.item && <ListLead provider="raiplay" url={room.lead.item.url} />}
            {shelves.slice(0, shown).map((shelf) => (
              <ListShelf
                key={shelf.item!.url}
                provider="raiplay"
                url={shelf.item!.url}
                title={shelf.title || shelf.item!.title}
              />
            ))}
            {more}
          </>
        )
      )}
    </div>
  );
}

/**
 * A list RaiPlay files by letter (a genre's programmes or films): a rail of letters, where an empty letter keeps its
 * place, then each letter's things. A letter jumps to its own; the page grows as it goes down.
 */
export function AToZRoom({
  page,
  summary,
  title,
  url,
  context,
}: {
  page?: ProviderPage;
  summary?: SearchResultSummary;
  title: string;
  url: string;
  context?: MediaCollection;
}) {
  const letters = page?.letters ?? [];
  const items = page?.items ?? [];
  let start = 0;
  const groups = letters.map((letter) => {
    return { ...letter, items: items.slice(start, (start += letter.count)) };
  });
  const filled = groups.filter((group) => group.count);
  const hits = new Map((summary?.hits ?? []).map((hit) => [hit.url, hit]));
  const frame = majorityShape(items.slice(0, 24).map((item) => providerItemShape("RaiPlay", item)));
  const [shown, setShown] = useState(3);
  const { more } = useGrowing(shown, filled.length, setShown);
  const [jumped, setJumped] = useState<string>();
  useEffect(() => {
    if (!jumped) return;
    const section = document.getElementById(letterId(jumped));
    section?.scrollIntoView({ block: "start" });
    section?.querySelector<HTMLElement>("[data-media-tile]")?.focus({ preventScroll: true });
    setJumped(undefined);
  }, [jumped, shown]);
  const noun = /^film/i.test(context?.title ?? title) ? "films" : "programmes";
  const rail = useRef<HTMLElement>(null);
  useFirstVerb(rail, letters.length > 0, url);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <RoomLight thumbnail={items[0]?.thumbnail} />
      <RoomHead
        title={title}
        provider="raiplay"
        context={context}
        meta={page && `${items.length.toLocaleString()} ${noun}`}
        actions={page && <AddRoomToHome provider="raiplay" url={url} title={title} />}
      />
      {!page && (!summary || summary.loading) && <RoomSkeleton />}
      <nav ref={rail} aria-label="Jump to a letter">
        <ul
          data-nav-row
          className="flex gap-1 max-sm:-mx-(--gutter) max-sm:overflow-x-auto max-sm:px-(--gutter) sm:flex-wrap"
        >
          {letters.map(({ letter, count }) => (
            <li key={letter} className="shrink-0">
              <Button
                variant="ghost"
                size="sm"
                // The rail starts on its first letter that holds something.
                data-page-first={letter === filled[0]?.letter || undefined}
                className="min-w-9 px-2 text-body font-semibold"
                disabled={!count}
                aria-label={`${letter}, ${count}`}
                onClick={() => {
                  setShown((value) =>
                    Math.max(value, filled.findIndex((group) => group.letter === letter) + 1),
                  );
                  setJumped(letter);
                }}
              >
                {letter}
              </Button>
            </li>
          ))}
        </ul>
      </nav>
      {page && !items.length && (
        <p role="status" className="text-body text-muted-foreground">
          RaiPlay lists nothing under {title} today.
        </p>
      )}
      {filled.slice(0, shown).map((group) => (
        <section
          key={group.letter}
          id={letterId(group.letter)}
          aria-label={group.letter}
          className="grid scroll-mt-[calc(var(--top-bar,4rem)+1rem)] grid-cols-[minmax(0,1fr)] gap-4 border-t pt-5 md:grid-cols-[3.5rem_minmax(0,1fr)]"
        >
          <h2 className="text-page font-semibold">{group.letter}</h2>
          <ul
            data-nav-row
            className="grid grid-cols-[repeat(auto-fill,minmax(min(12rem,40vw),1fr))] gap-x-4 gap-y-6"
          >
            {group.items.map((item) => {
              const hit = hits.get(item.url);
              return (
                hit && (
                  <li key={hit.id} className="@container min-w-0">
                    <RoomTile hit={hit} item={item} shape={frame} fluid />
                  </li>
                )
              );
            })}
          </ul>
        </section>
      ))}
      {more}
    </div>
  );
}
const letterId = (letter: string) => `letter-${letter.replace(/\W/g, "_")}`;

/** Like useInstalments, for a count the page also raises itself (a letter's jump). */
function useGrowing(shown: number, total: number, grow: (next: (value: number) => number) => void) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || shown >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) grow((value) => value + 3);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown, total]);
  return {
    more: shown < total ? <div ref={sentinel} aria-hidden="true" className="h-px" /> : null,
  };
}

const twitchDirectory = "https://www.twitch.tv/directory";
const twitchLive = "https://www.twitch.tv/directory/all";

/**
 * Twitch's room: its categories with their viewers as doors; a lead from what the house saved that is on now (Twitch
 * publishes none of its own), else what is most watched; the saved channels, on now first; what is on now; then the
 * three most watched categories' channels.
 */
export function TwitchRoom({ onNow }: { onNow?: ProviderItem[] }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const categories = useQuery({
    ...providerPageQuery(credentials, "twitch", { url: twitchDirectory }),
    enabled: connected,
  });
  const favorites = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected });
  const saved = (favorites.data?.favorites ?? [])
    .filter((item) => item.provider === "twitch" && !pageSection(item))
    .sort((a, b) => Number(!!b.live) - Number(!!a.live));
  const lead = saved.find((item) => item.live) ?? onNow?.find((item) => item.live);
  const top = categories.data?.items.slice(0, 3) ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <RoomLight thumbnail={lead?.thumbnail} />
      <div className="grid gap-4">
        <RoomHead title="Twitch" provider="twitch" />
        <DoorLine
          label="Twitch categories"
          doors={categories.data?.items.map((item) => doorOf(item)) ?? []}
        />
      </div>
      {lead && <ChannelLead key={lead.url} url={lead.url} />}
      {saved.length > 0 && <SavedChannels items={saved} />}
      <ListShelf provider="twitch" url={twitchLive} title="On now" />
      {top.map((category) => (
        <ListShelf
          key={category.url}
          provider="twitch"
          url={category.url}
          title={category.title}
          note={category.subtitle}
        />
      ))}
    </div>
  );
}

/** A channel on now as a room's lead: what it is showing, Play and where, and Save keeps the channel. */
function ChannelLead({ url }: { url: string }) {
  const { reader, summary, entries } = useListHits("twitch", url);
  const live = entries.find(({ item }) => item.url === url && item.live);
  const channel = summary?.collection;
  return (
    <>
      {reader}
      {live && (
        <RoomLead
          hit={live.hit}
          item={live.item}
          kicker={live.item.subtitle?.replace(" · ", ", ")}
          save={
            channel?.save && {
              saved: !!channel.saved,
              run: channel.save,
              disabled: channel.disabled || channel.saveDisabled,
            }
          }
        />
      )}
    </>
  );
}

/** The house's saved channels, those on now first: one on now plays, an offline one opens. */
function SavedChannels({ items }: { items: ProviderItem[] }) {
  const { openProvider } = useShell();
  const { run, videoQualityPreference } = useSessionGate();
  const { on, play } = usePlayOn();
  const frame = majorityShape(items.map((item) => providerItemShape("Twitch", item)));
  const start = (item: ProviderItem) =>
    void play((choice) =>
      run({
        type: "enqueueProvider",
        provider: "twitch",
        url: item.url,
        shape: "atom",
        title: item.title,
        thumbnail: item.thumbnail,
        quality: videoQualityPreference.quality,
        playNow: true,
        ...choice,
      }),
    );
  return (
    <Shelf title="Saved channels" note="On now first">
      {items.map((item, index) => (
        <li key={item.id} className="shrink-0">
          <MediaTile
            data-page-first={index === 0 || undefined}
            shape={frame}
            own={providerItemShape("Twitch", item)}
            dim={item.live === false}
            title={item.title}
            meta={metaLine(item.subtitle)}
            thumbnail={item.thumbnail}
            source={item.url}
            aria-label={item.live ? on(`Play ${item.title}`) : `Open ${item.title}`}
            href={item.live ? undefined : collectionLocation(item)}
            onClick={() => (item.live ? start(item) : openProvider(item))}
            menu={[
              ...(item.live ? [{ label: "Open", run: () => openProvider(item) }] : []),
              ...browserActions(item.url),
            ]}
          />
        </li>
      ))}
    </Shelf>
  );
}

/**
 * A catalogue's front page (StreamingCommunity, 123MoviesFree, the anime sources) as a room's top: its name set large
 * and its doors; its list follows as the page's grid.
 */
export function CatalogueRoomHead({ provider, doors }: { provider: ProviderId; doors: Door[] }) {
  const name = providerNames[provider];
  return (
    <div className="grid gap-4">
      <RoomLight />
      <RoomHead title={name} provider={provider} />
      <DoorLine label={`${name} lists`} doors={doors} />
    </div>
  );
}

type Kind = {
  title: string;
  scope: SearchScope;
  /** RaiPlay's sections of this kind, each a door and its first list a shelf. */
  sections: { label: string; url: string }[];
  catalogues: { provider: ProviderId; meta: string }[];
};
const kindRooms = {
  films: {
    title: "Films and series",
    scope: { kind: "films", source: "All" },
    sections: [
      { label: "Film", url: "https://www.raiplay.it/tipologia/film" },
      { label: "Serie italiane", url: "https://www.raiplay.it/tipologia/serieitaliane" },
    ],
    catalogues: [
      { provider: "streamingcommunity", meta: "Its films and series" },
      { provider: "movies123", meta: "Movies, TV series" },
    ],
  },
  anime: {
    title: "Anime",
    scope: { kind: "films", source: "All" },
    sections: [],
    catalogues: [
      { provider: "animesaturn", meta: "Its anime series and films" },
      { provider: "animeunity", meta: "Its anime archive" },
    ],
  },
} as const satisfies Record<string, Kind>;

/**
 * A door that names a kind (Films and series, Anime) opens a room with one shelf per source: each source's own first
 * list for the kind, whose heading opens that source's room.
 */
export function KindRoom({ kind }: { kind: keyof typeof kindRooms }) {
  const room: Kind = kindRooms[kind];
  useRoomScope(room.scope);
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const pages = useQueries({
    queries: room.sections.map((section) => ({
      ...providerPageQuery(credentials, "raiplay", { url: section.url }),
      enabled: connected,
    })),
  });
  const sections = room.sections.map((section, index) => ({
    ...section,
    page: pages[index]?.data,
    failed: pages[index]?.error,
    retry: () => void pages[index]?.refetch(),
  }));
  useSeededPages(
    "raiplay",
    sections.map((section) => section.page?.room?.shelves[0]),
  );
  return (
    <section
      data-page="Kind"
      aria-label={room.title}
      className="grid grid-cols-[minmax(0,1fr)] gap-6"
    >
      <RoomLight thumbnail={sections[0]?.page?.room?.shelves[0]?.items[0]?.thumbnail} />
      <div className="grid gap-4">
        <RoomHead title={room.title} />
        <DoorLine
          label={`${room.title} sources`}
          doors={[
            ...sections.map((section) => ({
              label: `RaiPlay, ${section.label}`,
              meta: section.page?.room?.shelves
                .slice(0, 3)
                .map((shelf) => shelf.title)
                .join(", "),
              href: collectionLocation({ provider: "raiplay", url: section.url }),
            })),
            ...room.catalogues.map(({ provider, meta }) => ({
              label: providerNames[provider],
              meta,
              href: collectionLocation({ provider, url: "" }),
            })),
          ]}
        />
      </div>
      {sections.map((section) => {
        const first = section.page?.room?.shelves[0];
        return first?.item ? (
          <ListShelf
            key={section.url}
            provider="raiplay"
            url={first.item.url}
            title={section.label}
            note={`RaiPlay, ${first.title}`}
            href={collectionLocation({ provider: "raiplay", url: section.url })}
          />
        ) : section.failed ? (
          <ShelfProblem
            key={section.url}
            title={section.label}
            href={collectionLocation({ provider: "raiplay", url: section.url })}
            problem={`Couldn't load RaiPlay's ${section.label}.`}
            detail={section.failed.message}
            retry={section.retry}
          />
        ) : (
          connected && !section.page && <ShelfSkeleton key={section.url} title={section.label} />
        );
      })}
      {room.catalogues.map(({ provider }) => (
        <ListShelf
          key={provider}
          provider={provider}
          url=""
          title={providerNames[provider]}
          href={collectionLocation({ provider, url: "" })}
          followable={false}
        />
      ))}
    </section>
  );
}

function ShelfSkeleton({ title }: { title: string }) {
  return (
    <Shelf title={title} loading>
      <MediaTilesSkeleton />
    </Shelf>
  );
}
