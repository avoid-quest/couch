import { playbackControls } from "@/session/playback-controls";
import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { browserActions } from "@/original-page";
import { usePlaybackClock } from "@/session/playback-clock";
import { Fragment, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaTile } from "@/components/MediaTile";
import { historyShape, majorityShape, savedShape, type ArtShape } from "@/art-shape";
import { mediaCaption, metaLine, savedCaption } from "@/media-caption";
import { Shelf, StaleNote } from "@/components/Shelf";
import { PageHeader } from "@/components/PageHeader";
import { useDurationClock } from "@/components/DurationBar";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { usePlayOn } from "@/components/PlayOn";
import { historyQuery } from "@/api/progress";
import { forLaterQuery, loadForLater } from "@/api/for-later";
import { apiSend } from "@/api/client";
import type { MenuAction } from "@/components/RowMenu";
import { failed } from "@/toasts";
import { QueuePanel, entryShape } from "@/sections/now/QueuePanel";
import { useQueueActions, type QueueActionsProps } from "@/sections/now/QueueActions";
import { useShell } from "@/sections/shell/AppShell";
import { mediaIdentity } from "@/sections/find/provider-progress";
import { useSessionGate } from "@/session/session-context";
import { formatDuration, formatEndTime } from "@/time-format";
import {
  avoidRadioPlaylistId,
  stationSources,
  type RadioProgrammeDetails,
  type RadioStation,
} from "../../../shared/radio";
import type { HistoryItem, HistorySelection } from "../../../shared/viewing";
import type { ForLaterItem } from "../../../shared/for-later";
import type { PlayOn, QueueEntry } from "../../../shared/protocol";
import { useOnAir, useStationMenu } from "./on-air";
import {
  homeRows,
  useHomeRows,
  useKeptOrder,
  type HomeRowId,
  type HomeSectionId,
} from "./home-rows";
import { isFollowId, useHomeFollows } from "./home-follows";
import { FollowShelf } from "./FollowShelf";
import { AddSectionPanel } from "./AddToHome";
import { BoardArt, BoardList } from "./HomeBoard";
import { ContinueSection, LeadSkeleton } from "./ContinueSection";
import { HomeOrder, SectionOptions } from "./SectionOptions";
import {
  Failed,
  LiveTvShelf,
  SavedSourceShelf,
  SharedSources,
  BrowseLine,
  sourceHomes,
} from "./HomeSources";
import { MediaRow } from "@/components/MediaRow";
import { iptvSourcesQuery } from "@/api/iptv";
import { providerFavoritesQuery } from "@/api/providers";
import { useLiveSourceHits } from "@/sections/find/useLiveSourceHits";
import { providerMediaPage, type ProviderId } from "../../../shared/providers";
import { settingsPagePath } from "../../../shared/settings-pages";

export type HistoryPlayback = (
  item: HistoryItem,
  options: { fromStart?: boolean; on?: PlayOn; selection?: HistorySelection },
) => Promise<boolean>;

// A shelf scrolls, so it holds more than fits; Up next holds its first few. Their headings open the rest.
const shelfLength = 12;
const boardLength = 4;
const knownLength = (entry: QueueEntry) =>
  entry.endless || entry.duration == null || !Number.isFinite(entry.duration)
    ? null
    : Math.max(0, entry.duration);
const recentCaption = (item: HistoryItem) => {
  const caption = mediaCaption(item);
  return {
    title: caption.title,
    meta: metaLine(caption.lead, item.creator?.title ?? caption.subtitle),
  };
};

/**
 * Home is your shelf: the Browse line, then sections in the order this device keeps (Continue, whose lead is what you
 * stopped last; the lists you follow; For later; Radio; the sources). Each section's "…" moves or hides it. What plays
 * is the player's: Home never leads with it, and nothing on Home moves when something starts.
 */
export function HomePage() {
  const shell = useShell();
  const { on, play } = usePlayOn();
  const { credentials, available, current } = shell;
  const {
    state,
    connected,
    run,
    queue: queued,
    nativeHost,
    videoQualityPreference,
  } = useSessionGate();
  const details = useDetailNavigation();
  const [queueOpen, setQueueOpen] = useState(false);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const layout = useHomeRows();
  const onHome = layout.rows.filter((row) => row.shown);
  const follows = useHomeFollows();
  const hasRow = (id: HomeRowId) => onHome.some((row) => row.id === id);
  const historyShown = hasRow("continue") || hasRow("recent");
  const history = useQuery({ ...historyQuery(credentials), enabled: connected && historyShown });
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected && hasRow("later") });
  const {
    stations: allStations,
    show: onAir,
    meta: showMeta,
    pending: radioPending,
    favorites,
    builtIn,
  } = useOnAir(hasRow("radio"), shell.recentRadio);
  const resume = useMutation({
    mutationFn: ({ item, fromStart, on }: { item: HistoryItem; fromStart: boolean; on?: PlayOn }) =>
      play((on) => shell.playHistory(item, { fromStart, on }), on),
  });
  const resumable = (item: HistoryItem) =>
    available && !resume.isPending && !!(item.playable || item.queueEntryId);
  // Each tile's menu holds its Details' verbs: Details itself where the press plays, else the press's own verb.
  const stationMenu = useStationMenu();
  const queueItem = (title: string, work: () => Promise<unknown>) =>
    void queued(title, work).catch((reason) => failed(`Couldn't queue ${title}.`, reason));
  const historyMenu = (item: HistoryItem, resumes: boolean): MenuAction[] => [
    resumes
      ? { label: "Details", run: () => details.open(itemLocation("history", item.mediaId)) }
      : {
          label: item.position > 0 ? "Resume" : "Play",
          disabled: !resumable(item),
          run: () => resume.mutate({ item, fromStart: item.position === 0 }),
        },
    ...(item.position > 0
      ? [
          {
            label: "From start",
            disabled: !resumable(item),
            run: () => resume.mutate({ item, fromStart: true }),
          },
        ]
      : []),
    {
      label: "Queue",
      disabled: !connected,
      run: () =>
        queueItem(item.title, () =>
          apiSend(credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, {
            profileId: state?.activeProfile.id,
          }),
        ),
    },
    ...browserActions(item.url),
    {
      label: "Play on",
      disabled: !resumable(item) || !item.playable,
      thumbnail: item.thumbnail,
      verb: item.position > 0 ? "Resume" : undefined,
      playOn: (on) => resume.mutate({ item, fromStart: item.position === 0, on }),
    },
  ];
  const savedMenu = (item: ForLaterItem): MenuAction[] => {
    const start = (on?: PlayOn) =>
      void play((on) => loadForLater(credentials, item.id, "play", on), on).catch((reason) =>
        failed(`Couldn't play ${item.title}.`, reason),
      );
    return [
      { label: "Play", disabled: !available, run: () => start() },
      {
        label: "Queue",
        disabled: !connected,
        run: () => queueItem(item.title, () => loadForLater(credentials, item.id, "append")),
      },
      { label: "Play on", disabled: !available, thumbnail: item.thumbnail, playOn: start },
      ...browserActions(item.url),
    ];
  };

  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex((entry) => entry.id === state?.currentEntryId);
  const cursor =
    currentIndex >= 0
      ? currentIndex
      : queue.findIndex((entry) => entry.id === state?.queueCursorEntryId);
  const upcoming = playbackControls(state).queue ? queue.slice(cursor + 1) : [];

  const past = history.data?.items ?? [];
  // One programme can be in history twice, under each form of link it played from (a share's ?si=, a moved catalogue):
  // the same known media is one programme, its latest; an item whose media isn't known stays itself.
  const identityOf = (url?: string) =>
    (url && mediaIdentity(providerMediaPage(url) ?? url)) || undefined;
  const unfinished = past.filter(
    (item, index) =>
      item.position > 0 &&
      !item.watched &&
      (!identityOf(item.url) ||
        past.findIndex((other) => identityOf(other.url) === identityOf(item.url)) === index),
  );
  const playingMedia = current && past.find((item) => item.queueEntryId === current.id)?.mediaId;
  const currentUrl = current?.source.startsWith("web:") ? current.source.slice(4) : undefined;
  const playingIdentity = identityOf(currentUrl);
  const isPlaying = (item: HistoryItem) =>
    item.mediaId === playingMedia ||
    (!!playingIdentity && identityOf(item.url) === playingIdentity);
  // A row still loading holds its place, so nothing moves under the focus when it arrives; before Couch answers, all do.
  const loading = (query: { isPending: boolean }) => (!state || connected) && query.isPending;
  // Each row keeps the order Home opened with (useKeptOrder), so nothing takes an item's place under you. Continue
  // keeps what plays too, its level showing: Resume opens the player, and its lead is still there on the way back.
  // For later and Played recently leave out what played as Home opened; it is the player's.
  const continued = useKeptOrder(unfinished, (item) => item.mediaId, !history.isPending);
  // Played recently and For later leave out what Continue shows.
  const continuing = new Set(
    (hasRow("continue") ? unfinished : []).map((item) => identityOf(item.url)).filter(Boolean),
  );
  const recent = useKeptOrder(
    past.filter(
      (item) => !(item.position > 0 && !item.watched) && !continuing.has(identityOf(item.url)),
    ),
    (item) => item.mediaId,
    !history.isPending,
    isPlaying,
  );
  // One Radio shelf: your stations (played here lately, saved) first, then the rest on air (on-air.ts). A station
  // that starts playing keeps its place, its level showing that it plays.
  const stations = useKeptOrder(allStations, (station) => station.id, !radioPending).slice(
    0,
    shelfLength,
  );
  const onAirPending = favorites.isPending || builtIn.isPending;
  const savedMedia = useKeptOrder(
    later.data?.items.filter(
      (item) => item.kind !== "radio" && !item.endless && !continuing.has(identityOf(item.url)),
    ) ?? [],
    (item) => item.id,
    !later.isPending,
    (item) =>
      (!!currentUrl && item.url === currentUrl) ||
      (!!playingIdentity && identityOf(item.url) === playingIdentity),
  );
  const stationMeta = (station: RadioStation, show: RadioProgrammeDetails | null) =>
    metaLine(
      showMeta(station, show) ||
        (station.sourceId === avoidRadioPlaylistId
          ? undefined
          : station.groupTitle || station.countryCode),
    );
  // The sources: shared inputs, Live TV while a source has channels, and what's saved from each source with a home.
  const sharedSources = useLiveSourceHits("");
  const iptv = useQuery({
    ...iptvSourcesQuery(credentials),
    enabled: connected && hasRow("live-tv"),
  });
  const shownHomes = sourceHomes.filter(hasRow);
  const sourceFavorites = useQuery({
    ...providerFavoritesQuery(credentials),
    enabled: connected && shownHomes.length > 0,
  });
  const saved = (provider: ProviderId) =>
    sourceFavorites.data?.favorites.filter((item) => item.provider === provider) ?? [];
  const options = (id: HomeRowId) => <SectionOptions id={id} name={homeRows[id].label} />;

  // A list takes its items' majority shape; an item of another shape is contained in that frame.
  const shelfShape = (shapes: ArtShape[]) =>
    shapes.every((shape) => shape === shapes[0]) ? (shapes[0] ?? "video") : "square";
  const laterShape = shelfShape(savedMedia.slice(0, shelfLength).map(savedShape));
  const recentShape = shelfShape(recent.slice(0, shelfLength).map(historyShape));
  const lists: Partial<Record<HomeSectionId, ReactNode>> = {
    continue:
      continued.length || loading(history) ? (
        <ContinueSection
          items={continued}
          loading={loading(history)}
          resume={(item, options) => resume.mutate({ item, ...options })}
          resumable={resumable}
          menu={(item) => historyMenu(item, true)}
          playing={isPlaying}
          note={history.isRefetchError && <StaleNote />}
        />
      ) : (
        history.error && (
          <Failed
            title="Continue"
            href="/saved?tab=played"
            error={history.error}
            options={options("continue")}
            retry={() => void history.refetch()}
          />
        )
      ),

    upNext: !!upcoming.length && (
      <UpcomingBoard
        cursor={cursor}
        options={options("upNext")}
        onMore={() => setQueueOpen(true)}
      />
    ),

    later: savedMedia.length ? (
      <Shelf
        title="For later"
        href="/saved?tab=later"
        note={later.isRefetchError && <StaleNote />}
        options={options("later")}
      >
        {savedMedia.slice(0, shelfLength).map((item, index) => (
          <li key={item.id} className="flex shrink-0">
            <MediaTile
              natural
              data-saved-details={item.id}
              data-page-first={index === 0 || undefined}
              related={{ collection: item.collection, creator: item.creator }}
              shape={laterShape}
              own={savedShape(item)}
              title={savedCaption(item).title}
              meta={metaLine(mediaCaption(item).lead, item.creator?.title ?? item.subtitle)}
              source={item.url}
              thumbnail={item.thumbnail}
              aria-label={`Details ${item.title}`}
              href={itemLocation("saved", item.id)}
              onClick={() => details.open(itemLocation("saved", item.id))}
              menu={savedMenu(item)}
            />
          </li>
        ))}
      </Shelf>
    ) : (
      later.error && (
        <Failed
          title="For later"
          href="/saved?tab=later"
          error={later.error}
          options={options("later")}
          retry={() => void later.refetch()}
        />
      )
    ),

    recent: recent.length ? (
      <Shelf
        title="Played recently"
        href="/saved?tab=played"
        note={history.isRefetchError && <StaleNote />}
        options={options("recent")}
      >
        {recent.slice(0, shelfLength).map((item, index) => (
          <li key={item.mediaId} className="flex shrink-0">
            <MediaTile
              natural
              data-history-details={item.mediaId}
              data-page-first={index === 0 || undefined}
              related={{ collection: item.collection, creator: item.creator }}
              shape={recentShape}
              own={historyShape(item)}
              {...recentCaption(item)}
              source={item.url}
              thumbnail={item.thumbnail}
              aria-label={`Details ${item.title}`}
              href={itemLocation("history", item.mediaId)}
              onClick={() => details.open(itemLocation("history", item.mediaId))}
              menu={historyMenu(item, false)}
            />
          </li>
        ))}
      </Shelf>
    ) : (
      // One failure, said once: at Continue when Home shows it.
      history.error &&
      !hasRow("continue") && (
        <Failed
          title="Played recently"
          href="/saved?tab=played"
          error={history.error}
          options={options("recent")}
          retry={() => void history.refetch()}
        />
      )
    ),

    shared: !!sharedSources.length && (
      <SharedSources hits={sharedSources} options={options("shared")} />
    ),

    // Every station on air, yours (played here lately, saved) first; the heading opens every station.
    radio: stations.length ? (
      <Shelf
        title="Radio"
        label="Radio stations"
        href="/radio"
        note={(favorites.isRefetchError || builtIn.isRefetchError) && <StaleNote />}
        options={options("radio")}
      >
        {stations.map((station, index) => {
          const show = onAir(station.id);
          const logo = !show?.artworkUrl || show.artworkUrl === station.logoUrl;
          return (
            <li key={station.id} className="flex shrink-0">
              {/* Every picture stands at the shelf's height in its own shape, a logo on its square ground, so a row reads as one shelf. */}
              <MediaTile
                className="home-radio-tile"
                fit="contain"
                natural={!logo}
                logo={logo}
                data-page-first={index === 0 || undefined}
                shape="square"
                title={station.name}
                meta={stationMeta(station, show)}
                thumbnail={show?.artworkUrl ?? station.logoUrl}
                source={stationSources(station)}
                aria-label={on(`Play ${station.name}`)}
                disabled={!available}
                onClick={() => void shell.enqueueRadio(station, true)}
                menu={stationMenu(station)}
              />
            </li>
          );
        })}
      </Shelf>
    ) : (
      (favorites.error || builtIn.error) && (
        <Failed
          title="Radio"
          href="/radio"
          error={favorites.error ?? builtIn.error}
          options={options("radio")}
          retry={() => void Promise.all([favorites.refetch(), builtIn.refetch()])}
        />
      )
    ),

    "live-tv": iptv.data?.sources.some((source) => source.channelCount) ? (
      <LiveTvShelf options={options("live-tv")} />
    ) : iptv.error && !iptv.data ? (
      <Failed
        title="Live TV"
        href="/live-tv"
        error={iptv.error}
        options={options("live-tv")}
        retry={() => void iptv.refetch()}
      />
    ) : null,
    // Saved channels fail once, where the first source shelf would be.
    ...Object.fromEntries(
      sourceHomes.map((provider) => [
        provider,
        provider === shownHomes[0] && sourceFavorites.error && !sourceFavorites.data ? (
          <Failed
            title={homeRows[provider].label}
            what="saved channels"
            error={sourceFavorites.error}
            options={options(provider)}
            retry={() => void sourceFavorites.refetch()}
          />
        ) : (
          <SavedSourceShelf
            provider={provider}
            items={saved(provider)}
            options={options(provider)}
          />
        ),
      ]),
    ),
    // Its "…" ends the line, beside the doors, as every section's ends its heading's.
    sources: (
      <section className="flex min-w-0">
        <div className="min-w-0 flex-1 [&>section]:mr-0">
          <BrowseLine first={!(hasRow("continue") && continued.length)} />
        </div>
        <div className="-mr-(--gutter) flex items-center border-y pr-(--gutter) pl-1">
          {options("sources")}
        </div>
      </section>
    ),
  };
  for (const follow of follows)
    lists[follow.id] = (
      <FollowShelf follow={follow} lead={hasRow("continue") ? continued[0] : undefined} />
    );
  // A shelf still loading holds its place, so nothing moves under the focus when it arrives.
  const pending = (id: HomeSectionId) =>
    id === "later"
      ? loading(later)
      : id === "radio"
        ? (!state || connected) && onAirPending
        : false;
  const deciding = !state || (hasRow("continue") && loading(history));
  // What Home shows, in order: a section's moves pass over sections hidden or empty here, so each is seen.
  const rendered = onHome.map((row) => row.id).filter((id) => lists[id] || pending(id));
  const section = (id: HomeSectionId) =>
    lists[id] ||
    (!isFollowId(id) && pending(id) && (
      <Shelf title={homeRows[id].label} loading options={options(id)}>
        <MediaTilesSkeleton shape="square" />
      </Shelf>
    ));

  return (
    <section data-page="Home" aria-label="Home" className="grid gap-section">
      <PageHeader title="Home" hidden />
      {/* Home waits for what decides Continue's lead, so no control above it (Browse) or below it takes a remote's
        first press. Which sections it shows, and in what order, is this device's choice: Edit Home is its page in Settings. */}
      {deciding ? (
        <div role="status" aria-label="Loading your Home…">
          <LeadSkeleton />
        </div>
      ) : (
        <>
          <HomeOrder.Provider value={rendered}>
            {rendered.map((id) => (
              <Fragment key={id}>{section(id)}</Fragment>
            ))}
          </HomeOrder.Provider>
          <div data-nav-row className="-ml-3.5 flex flex-wrap gap-1">
            <Button asChild variant="ghost" className="text-muted-foreground">
              <Link to={settingsPagePath("home")}>
                <SlidersHorizontal aria-hidden="true" />
                Edit Home
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={(event) => setAdding(event.currentTarget)}
            >
              <Plus aria-hidden="true" />
              Add a section
            </Button>
          </div>
          <AddSectionPanel anchor={adding} onClose={() => setAdding(null)} />
        </>
      )}

      <Sheet modal={false} open={queueOpen} onOpenChange={setQueueOpen}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
          showCloseButton={false}
        >
          <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background px-6 py-4">
            <SheetTitle className="text-base font-medium">Up next</SheetTitle>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                className="-mr-2.5 size-11"
                aria-label="Close"
                title="Close"
              >
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
          </SheetHeader>
          <div className="px-6 pt-4 pb-8">
            <QueuePanel
              state={state}
              credentials={credentials}
              connected={connected}
              available={available}
              nativeHost={nativeHost}
              defaultQuality={videoQualityPreference.quality}
              run={run}
              titled={false}
            />
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

// Only the timetable subscribes to playback time; a tick must not render Home's shelves and artwork.
function UpcomingBoard({
  cursor,
  options,
  onMore,
}: {
  cursor: number;
  options: ReactNode;
  onMore: () => void;
}) {
  const { credentials, available, current } = useShell();
  const { state, connected, run } = useSessionGate();
  const playbackClock = usePlaybackClock();
  const now = useDurationClock();
  const queue = state?.queue ?? [];
  const upcoming = playbackControls(state).queue ? queue.slice(cursor + 1) : [];
  const shape = majorityShape(upcoming.slice(0, boardLength).map(entryShape));
  const length = current
    ? current.endless
      ? null
      : playbackClock.duration || knownLength(current)
    : 0;
  // Up next as a timetable: each entry starts when the one before it ends.
  let clock =
    length == null
      ? null
      : Math.max(0, length - playbackClock.position) / (state?.player.speed || 1);
  const plan = upcoming.map((entry) => {
    const starts = clock,
      seconds = knownLength(entry);
    clock = clock == null || seconds == null ? null : clock + seconds;
    return { entry, starts, seconds };
  });
  return (
    <BoardList
      title="Up next"
      time={clock != null ? `until ${formatEndTime(clock, now)}` : undefined}
      options={options}
      more={
        upcoming.length > boardLength && (
          <Button
            variant="ghost"
            className="-ml-3.5 justify-self-start text-muted-foreground"
            onClick={onMore}
          >
            {upcoming.length - boardLength} more
          </Button>
        )
      }
    >
      {plan.slice(0, boardLength).map(({ entry, starts, seconds }, index) => (
        <UpNextRow
          key={entry.id}
          entry={entry}
          shape={shape}
          pageFirst={index === 0}
          disabled={!available}
          onPlay={() => void run({ type: "play", entryId: entry.id })}
          meta={
            seconds == null
              ? undefined
              : metaLine(
                  formatDuration(seconds),
                  starts != null && `ends ${formatEndTime(starts + seconds, now)}`,
                )
          }
          verbs={{
            credentials,
            entry,
            index: cursor + 1 + index,
            queue,
            connected,
            run,
            firstUpcomingIndex: cursor + 1,
            lastUpcomingIndex: queue.length - 1,
          }}
        />
      ))}
    </BoardList>
  );
}

/** An Up next entry's row: its press plays it now, and its menu holds what its Up next row in the player does. */
function UpNextRow({
  entry,
  shape,
  meta,
  disabled,
  onPlay,
  verbs,
  pageFirst,
}: {
  entry: QueueEntry;
  shape: ArtShape;
  meta?: string;
  disabled: boolean;
  onPlay: () => void;
  verbs: QueueActionsProps;
  pageFirst: boolean;
}) {
  const caption = mediaCaption(entry);
  return (
    <MediaRow
      compact
      pageFirst={pageFirst}
      related={{ collection: entry.collection, creator: entry.creator }}
      shape={shape}
      own={entryShape(entry)}
      title={caption.title}
      art={<BoardArt thumbnail={entry.thumbnail} title={entry.title} />}
      meta={metaLine(caption.lead, meta)}
      primary={{ label: "Play", disabled, onClick: onPlay }}
      menu={useQueueActions(verbs)}
    />
  );
}
