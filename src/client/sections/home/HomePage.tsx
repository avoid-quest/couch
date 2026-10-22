import { DetailSkeleton, MediaTilesSkeleton } from "@/components/LoadingMedia";
import { MediaContext } from "@/components/MediaContext";
import { playbackStatus } from "@/playback-status";
import { browserActions } from "@/original-page";
import { usePlaybackClock } from "@/session/playback-clock";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Stage, StageTitle } from "@/components/Stage";
import { MediaTile } from "@/components/MediaTile";
import { artShape, majorityShape, type ArtShape } from "@/art-shape";
import { historyCaption, mediaCaption, metaLine, savedCaption } from "@/media-caption";
import { Shelf } from "@/components/Shelf";
import { PageHeader } from "@/components/PageHeader";
import { ProgressLine, useDurationClock } from "@/components/DurationBar";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { usePlayOn } from "@/components/PlayOn";
import { historyQuery } from "@/api/progress";
import { forLaterQuery, loadForLater } from "@/api/for-later";
import { apiSend } from "@/api/client";
import type { MenuAction } from "@/components/RowMenu";
import { failed } from "@/toasts";
import { QueuePanel } from "@/sections/now/QueuePanel";
import { useQueueActions, type QueueActionsProps } from "@/sections/now/QueueActions";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { savedSourceLabel } from "@/saved-source";
import { sourceLabel } from "@/source-label";
import { playsOn } from "@/session/device-id";
import { TRY_AGAIN } from "@/copy";
import { formatDuration, formatEndTime } from "@/time-format";
import { avoidRadioPlaylistId, isRadio, stationSources, type RadioProgrammeDetails, type RadioStation } from "../../../shared/radio";
import type { HistoryItem } from "../../../shared/viewing";
import type { ForLaterItem } from "../../../shared/for-later";
import type { QueueEntry } from "../../../shared/protocol";
import { useOnAir, useStationMenu, useStationShow } from "./on-air";
import { boardRows, homeRowLabels, useHomeRows, useKeptOrder, type HomeRowId } from "./home-rows";
import { Board, BoardArt, BoardList } from "./HomeBoard";
import { Failed, LiveTvShelf, SavedSourceShelf, SharedSources, SourcesLine, sourceHomes } from "./HomeSources";
import { MediaRow } from "@/components/MediaRow";
import { iptvSourcesQuery } from "@/api/iptv";
import { providerFavoritesQuery } from "@/api/providers";
import { useLiveSourceHits } from "@/sections/find/useLiveSourceHits";
import type { ProviderId } from "../../../shared/providers";

export type HistoryPlayback = (item: HistoryItem, options: { fromStart?: boolean; on?: string }) => Promise<boolean>;

// A shelf scrolls, so it holds more than fits; a board's list holds its first few. Their headings open the rest.
const shelfLength = 12;
const boardLength = 4;
const knownLength = (entry: QueueEntry) => entry.live || entry.duration == null || !Number.isFinite(entry.duration) ? null : Math.max(0, entry.duration);
const entryShape = (entry: QueueEntry): ArtShape => isRadio(entry) ? "square" : artShape(sourceLabel(entry.source), entry.collection ? "episode" : "media");
const historyShape = (item: HistoryItem) => artShape(item.sourceLabel, item.collection ? "episode" : "media");
const savedShape = (item: ForLaterItem) => artShape(savedSourceLabel(item), item.collection ? "episode" : "media");
const recentCaption = (item: HistoryItem) => { const caption = historyCaption(item); return { ...caption, meta: metaLine(caption.meta, item.duration ? formatDuration(item.duration) : null) }; };
// Continue says how much is left where Played recently says how long it is; the line on the artwork shows how far it got.
const continueCaption = (item: HistoryItem) => { const caption = historyCaption(item); return { ...caption, meta: metaLine(caption.meta, item.duration ? `${formatDuration(Math.max(0, item.duration - item.position))} left` : null) }; };

type Hero = { kind: "playing" } | { kind: "continue"; item: HistoryItem } | { kind: "radio"; station: RadioStation; show: RadioProgrammeDetails };

/**
 * Home is the evening's departures board: one large item on top (what you control playing now, else the
 * first thing to continue, else the first station on air), then shelves of tiles, each headed by the
 * clock time it matters at. Each device picks which shelves it shows and in what order.
 */
export function HomePage() {
  const playbackClock = usePlaybackClock();
  const shell = useShell();
  const { on, play } = usePlayOn();
  const { credentials, available, current } = shell;
  const { state, connected, run, queue: queued, nativeHost, videoQualityPreference } = useSessionGate();
  const details = useDetailNavigation();
  const now = useDurationClock();
  const [queueOpen, setQueueOpen] = useState(false);
  const layout = useHomeRows();
  const onHome = layout.rows.filter(row => row.shown);
  const hasRow = (id: HomeRowId) => onHome.some(row => row.id === id);
  const historyShown = hasRow("continue") || hasRow("recent");
  const history = useQuery({ ...historyQuery(credentials), enabled: connected && historyShown });
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected && hasRow("later") });
  const { stations: allStations, show: onAir, playing: playingStation, meta: showMeta, pending: radioPending, favorites, builtIn } = useOnAir(hasRow("radio"), shell.recentRadio);
  const resume = useMutation({
    mutationFn: ({ item, fromStart, deviceId }: { item: HistoryItem; fromStart: boolean; deviceId?: string }) => play(on => shell.playHistory(item, { fromStart, on }), deviceId),
  });
  const resumable = (item: HistoryItem) => available && !resume.isPending && !!(item.playable || item.queueEntryId);
  // Each tile's menu holds its Details' verbs: Details itself where the press plays, else the press's own verb.
  const stationMenu = useStationMenu();
  const queueItem = (title: string, work: () => Promise<unknown>) => void queued(title, work).catch(reason => failed(`Couldn't queue ${title}.`, reason));
  const historyMenu = (item: HistoryItem, resumes: boolean): MenuAction[] => [
    resumes ? { label: "Details", run: () => details.open(itemLocation("history", item.mediaId)) } : { label: item.position > 0 ? "Resume" : "Play", disabled: !resumable(item), run: () => resume.mutate({ item, fromStart: item.position === 0 }) },
    ...item.position > 0 ? [{ label: "From start", disabled: !resumable(item), run: () => resume.mutate({ item, fromStart: true }) }] : [],
    { label: "Queue", disabled: !connected, run: () => queueItem(item.title, () => apiSend(credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { profileId: state?.activeProfile.id })) },
    ...browserActions(item.url),
    { label: "Play on", disabled: !resumable(item) || !item.playable, playOn: deviceId => resume.mutate({ item, fromStart: item.position === 0, deviceId }) },
  ];
  const savedMenu = (item: ForLaterItem): MenuAction[] => {
    const start = (deviceId?: string) => void play(on => loadForLater(credentials, item.id, "play", on), deviceId).catch(reason => failed(`Couldn't play ${item.title}.`, reason));
    return [
      { label: "Play", disabled: !available, run: () => start() },
      { label: "Queue", disabled: !connected, run: () => queueItem(item.title, () => loadForLater(credentials, item.id, "append")) },
      { label: "Play on", disabled: !available, playOn: start },
      ...browserActions(item.url),
    ];
  };

  const player = state?.player;
  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursor = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const upcoming = queue.slice(cursor + 1);
  const length = current ? current.live ? null : playbackClock.duration ?? knownLength(current) : 0;
  const remaining = length == null ? null : Math.max(0, length - (playbackClock.position ?? 0)) / (player?.speed || 1);
  // Up next as a timetable: each entry starts when the one before it ends.
  let clock = remaining;
  const plan = upcoming.map(entry => {
    const starts = clock, seconds = knownLength(entry);
    clock = clock == null || seconds == null ? null : clock + seconds;
    return { entry, starts, seconds };
  });
  const doneBy = clock;

  const past = history.data?.items ?? [];
  const unfinished = past.filter(item => item.position > 0 && !item.watched);
  const firstOnAir = allStations.find(station => onAir(station.id));
  // The hero waits for what decides it (undefined), so it never swaps under the focus; null when there is nothing to lead with.
  const hero: Hero | null | undefined = !state ? undefined
    : current ? { kind: "playing" }
    : hasRow("continue") && history.isPending ? undefined
    : hasRow("continue") && unfinished[0] ? { kind: "continue", item: unfinished[0] }
    : radioPending ? undefined
    // A hidden Radio's queries are off, but their cache (and recents) still hold stations on air.
    : hasRow("radio") && firstOnAir ? { kind: "radio", station: firstOnAir, show: onAir(firstOnAir.id)! }
    : null;
  const playingMedia = current && past.find(item => item.queueEntryId === current.id)?.mediaId;
  // A hero verb disables while it plays, which drops the focus, and the playing hero then puts the transport where
  // From start was, so focus moves to its Open player when it leads (as page entry would) unless it went elsewhere.
  const leading = useRef(false);
  const playHero = (item: HistoryItem, fromStart: boolean) => { leading.current = true; resume.mutate({ item, fromStart }, { onSettled: ok => { if (!ok) leading.current = false; } }); };
  useEffect(() => {
    if (hero?.kind !== "playing" || !leading.current) return;
    leading.current = false;
    if (document.activeElement === document.body) document.querySelector<HTMLElement>("[data-home-hero] [data-page-first]")?.focus();
  }, [hero?.kind]);
  // Shelves keep the order Home opened with, less the item that led it then, so nothing moves under the focus: a station that starts playing stays where it is, marked Playing.
  const historyReady = hero !== undefined && !history.isPending;
  const continued = useKeptOrder(unfinished, item => item.mediaId, historyReady, hero?.kind === "continue" ? hero.item.mediaId : playingMedia);
  const recent = useKeptOrder(past.filter(item => !(item.position > 0 && !item.watched)), item => item.mediaId, historyReady, playingMedia);
  // One Radio shelf: your stations (played here lately, saved) first, then the rest on air (on-air.ts).
  const stations = useKeptOrder(allStations, station => station.id, hero !== undefined && !radioPending, hero?.kind === "radio" ? hero.station.id : allStations.find(playingStation)?.id).slice(0, shelfLength);
  const onAirPending = favorites.isPending || builtIn.isPending;
  const savedMedia = useKeptOrder(later.data?.items.filter(item => item.kind !== "radio" && !item.live) ?? [], item => item.id, hero !== undefined && !later.isPending);
  const stationMeta = (station: RadioStation) => metaLine(showMeta(station) || (station.sourceId === avoidRadioPlaylistId ? undefined : station.groupTitle || station.countryCode));
  const filled: Partial<Record<HomeRowId, boolean>> = { upNext: !!upcoming.length, continue: !!continued.length, later: !!savedMedia.length, recent: !!recent.length };
  // The sources: shared inputs, Live TV while a source has channels, and what's saved from each source with a home.
  const sharedSources = useLiveSourceHits("");
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled: connected && hasRow("live-tv") });
  const shownHomes = sourceHomes.filter(hasRow);
  const sourceFavorites = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected && shownHomes.length > 0 });
  const saved = (provider: ProviderId) => sourceFavorites.data?.favorites.filter(item => item.provider === provider) ?? [];

  const live = !!(current?.live || current?.kind === "radio");
  const at = playsOn(state);
  const show = useStationShow();
  // Where it plays reads "on {name}" here too, as in the now-playing bar and the player. A station without its show
  // reads Radio, as the player does, never its stream's host.
  const status = playbackStatus(state, connected);
  const playing = current && mediaCaption({ ...current, title: show?.title || current.title });
  const playingMeta = metaLine(playing?.lead, playing?.subtitle, current && !isRadio(current) && sourceLabel(current.source), !status.quiet && status.label, at?.elsewhere && `on ${at.name}`);
  const heroCaption = hero?.kind === "continue" ? historyCaption(hero.item) : undefined;

  const lead = !hero ? null : hero.kind === "playing" ? current && playing && <HomeHero context={<MediaContext collection={current.collection} creator={current.creator} radio={isRadio(current) && current.source.startsWith("radio:") ? {id: current.source.slice(6), title: current.title} : undefined} />} thumbnail={show?.artworkUrl ?? current.thumbnail} shape={entryShape(current)} title={playing.title} meta={playingMeta}
      progress={!live && length ? <ProgressLine position={playbackClock.position ?? 0} duration={length} label={remaining != null ? `${formatDuration(remaining)} left, ends ${formatEndTime(remaining, now)}` : undefined} /> : undefined}
      // The now-playing bar below holds the transport, so the playing Stage holds none: its title and picture open the player.
      open={() => shell.changeSection("Now")} />
    : hero.kind === "continue" && heroCaption ? <HomeHero context={<MediaContext collection={hero.item.collection} creator={hero.item.creator} />} thumbnail={hero.item.thumbnail} shape={historyShape(hero.item)} title={heroCaption.title} meta={heroCaption.meta}
      // Not playing, it has no end time: how much is left, as Details says it.
      progress={hero.item.duration ? <ProgressLine position={hero.item.position} duration={hero.item.duration} /> : undefined}>
      <Button data-page-first size="lg" aria-label={on(`Resume ${hero.item.title}`)} disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, false)}><Play aria-hidden="true" />{on("Resume")}</Button>
      <Button variant="ghost" size="lg" disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, true)}>From start</Button>
      {/* Resume's playback destination lacks the history actions, so Continue keeps a Details stop. */}
      <Button variant="ghost" size="lg" aria-label={`Details ${hero.item.title}`} onClick={() => details.open(itemLocation("history", hero.item.mediaId))}>Details</Button>
    </HomeHero>
    : hero.kind === "radio" ? <HomeHero context={<MediaContext radio={{id: hero.station.id, title: hero.station.name}} />} thumbnail={hero.show.artworkUrl ?? hero.station.logoUrl} shape="square" title={hero.show.title} meta={metaLine(hero.show.genre)}>
      <Button data-page-first size="lg" aria-label={on(`Play ${hero.station.name}`)} disabled={!available} onClick={() => void shell.enqueueRadio(hero.station, true)}><Play aria-hidden="true" />{on("Play")}</Button>
    </HomeHero> : null;

  // A list takes its items' majority shape; an item of another shape is contained in that frame.
  const continueShape = majorityShape(continued.map(historyShape));
  const upNextShape = majorityShape(upcoming.slice(0, boardLength).map(entryShape));
  const laterShape = majorityShape(savedMedia.slice(0, boardLength).map(savedShape));
  const recentShape = majorityShape(recent.map(historyShape));
  // With no Stage, a remote starts on the board's first row.
  const firstBoard = !hero && onHome.find(row => boardRows.includes(row.id) && filled[row.id])?.id;
  const lists: Partial<Record<HomeRowId, ReactNode>> = {
    continue: !!continued.length && <BoardList title="Continue" href="/saved?tab=played">
      {continued.slice(0, boardLength).map((item, index) => <MediaRow compact key={item.mediaId} data-history-details={item.mediaId} pageFirst={firstBoard === "continue" && index === 0} related={{ collection: item.collection, creator: item.creator }} shape={continueShape} own={historyShape(item)} {...continueCaption(item)} source={item.url}
        art={<BoardArt thumbnail={item.thumbnail} title={item.title} progress={item.duration ? item.position / item.duration : undefined} />}
        primary={{ label: "Resume", disabled: !resumable(item), onClick: () => resume.mutate({ item, fromStart: false }) }} menu={historyMenu(item, true)} />)}
    </BoardList>,

    upNext: !!upcoming.length && <BoardList title="Up next" time={doneBy != null ? `until ${formatEndTime(doneBy, now)}` : undefined}
      more={upcoming.length > boardLength && <Button variant="ghost" className="-ml-3.5 justify-self-start text-muted-foreground" onClick={() => setQueueOpen(true)}>{upcoming.length - boardLength} more</Button>}>
      {plan.slice(0, boardLength).map(({ entry, starts, seconds }, index) => <UpNextRow key={entry.id} entry={entry} shape={upNextShape} pageFirst={firstBoard === "upNext" && index === 0} disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })} meta={seconds == null ? undefined : metaLine(formatDuration(seconds), starts != null && `ends ${formatEndTime(starts + seconds, now)}`)}
        verbs={{ credentials, entry, index: cursor + 1 + index, queue, connected, run, firstUpcomingIndex: cursor + 1, lastUpcomingIndex: queue.length - 1 }} />)}
    </BoardList>,

    later: !!savedMedia.length && <BoardList title="For later" href="/saved?tab=later">
      {savedMedia.slice(0, boardLength).map((item, index) => <MediaRow compact key={item.id} data-saved-details={item.id} pageFirst={firstBoard === "later" && index === 0} related={{ collection: item.collection, creator: item.creator }} shape={laterShape} own={savedShape(item)} {...savedCaption(item)} source={item.url}
        art={<BoardArt thumbnail={item.thumbnail} title={item.title} />}
        primary={{ label: "Details", href: itemLocation("saved", item.id), onClick: () => details.open(itemLocation("saved", item.id)) }} menu={savedMenu(item)} />)}
    </BoardList>,

    recent: !!recent.length && <BoardList title="Played recently" href="/saved?tab=played">
      {recent.slice(0, boardLength).map((item, index) => <MediaRow compact key={item.mediaId} data-history-details={item.mediaId} pageFirst={firstBoard === "recent" && index === 0} related={{ collection: item.collection, creator: item.creator }} shape={recentShape} own={historyShape(item)} {...recentCaption(item)} source={item.url}
        art={<BoardArt thumbnail={item.thumbnail} title={item.title} />}
        primary={{ label: "Details", href: itemLocation("history", item.mediaId), onClick: () => details.open(itemLocation("history", item.mediaId)) }} menu={historyMenu(item, false)} />)}
    </BoardList>,

    shared: !!sharedSources.length && <SharedSources hits={sharedSources} />,

    // Every station on air, yours (played here lately, saved) first; the heading opens every station.
    radio: !!stations.length && <Shelf title="Radio" label="Radio stations" href="/radio">
      {stations.map((station, index) => <li key={station.id} className="flex shrink-0">
        {/* Tiles take the shelf's height, so one without a show stays level with the rest and Up and Down leave the shelf. */}
        <MediaTile data-page-first={index === 0 || undefined} shape="square" title={station.name} meta={stationMeta(station)} thumbnail={onAir(station.id)?.artworkUrl ?? station.logoUrl} source={stationSources(station)}
          aria-label={on(`Play ${station.name}`)} disabled={!available} onClick={() => void shell.enqueueRadio(station, true)} menu={stationMenu(station)} />
      </li>)}
    </Shelf>,

    "live-tv": iptv.data?.sources.some(source => source.channelCount) ? <LiveTvShelf /> : iptv.error && !iptv.data ? <Failed what="Live TV" retry={() => void iptv.refetch()} /> : null,
    // Saved channels fail once, where the first source shelf would be.
    ...Object.fromEntries(sourceHomes.map(provider => [provider, provider === shownHomes[0] && sourceFavorites.error && !sourceFavorites.data
      ? <Failed what="saved channels" retry={() => void sourceFavorites.refetch()} />
      : <SavedSourceShelf provider={provider} items={saved(provider)} />])),
    sources: <SourcesLine />,
  };
  // A list or shelf still loading holds its place, so nothing moves under the focus when it arrives.
  const pending = (id: HomeRowId) => connected && (id === "later" ? later.isPending : id === "continue" || id === "recent" ? history.isPending : id === "radio" ? onAirPending : false);
  const section = (id: HomeRowId) => lists[id] || (pending(id) && (boardRows.includes(id) ? <BoardList title={homeRowLabels[id]} loading />
    : <Shelf title={homeRowLabels[id]} loading><MediaTilesSkeleton shape="square" /></Shelf>));
  // Consecutive rows of your own share one board; every other row is a section of its own.
  const groups = onHome.reduce<HomeRowId[][]>((all, row) => {
    const last = all.at(-1);
    if (last && boardRows.includes(row.id) && boardRows.includes(last[0]!)) last.push(row.id); else all.push([row.id]);
    return all;
  }, []);

  return <section data-page="Home" aria-label="Home" className="grid gap-section">
    <PageHeader title="Home" hidden />
    {historyShown && history.error && <Alert variant="destructive"><AlertDescription>{hasRow("continue") ? "Couldn't load Continue." : "Couldn't load Played recently."}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void history.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("later") && later.error && <Alert variant="destructive"><AlertDescription>Couldn't load For later.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void later.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("radio") && !stations.length && (favorites.error || builtIn.error) && <Alert variant="destructive"><AlertDescription>Couldn't load Radio.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void Promise.all([favorites.refetch(), builtIn.refetch()])}>{TRY_AGAIN}</Button></AlertAction></Alert>}

    {hero === undefined && <DetailSkeleton home />}
    {lead}
    {hero !== undefined && groups.map(group => boardRows.includes(group[0]!)
      ? group.some(id => lists[id] || pending(id)) && <Board key={group.join(" ")}>{group.map(id => <Fragment key={id}>{section(id)}</Fragment>)}</Board>
      : <Fragment key={group[0]}>{section(group[0]!)}</Fragment>)}

    <Sheet modal={false} open={queueOpen} onOpenChange={setQueueOpen}>
      <SheetContent side="right" aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg" showCloseButton={false}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background px-6 py-4"><SheetTitle className="text-base font-medium">Up next</SheetTitle><SheetClose asChild><Button variant="ghost" size="icon-lg" className="-mr-2.5 size-11" aria-label="Close" title="Close"><X aria-hidden="true" /></Button></SheetClose></SheetHeader>
        <div className="px-6 pt-4 pb-8"><QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} titled={false} /></div>
      </SheetContent>
    </Sheet>
  </section>;
}

/** An Up next entry's row: its press plays it now, and its menu holds what its Up next row in the player does. */
function UpNextRow({ entry, shape, meta, disabled, onPlay, verbs, pageFirst }: { entry: QueueEntry; shape: ArtShape; meta?: string; disabled: boolean; onPlay: () => void; verbs: QueueActionsProps; pageFirst: boolean }) {
  const caption = mediaCaption(entry);
  return <MediaRow compact pageFirst={pageFirst} related={{ collection: entry.collection, creator: entry.creator }} shape={shape} own={entryShape(entry)} title={caption.title} art={<BoardArt thumbnail={entry.thumbnail} title={entry.title} />} meta={metaLine(caption.lead, meta)} primary={{ label: "Play", disabled, onClick: onPlay }} menu={useQueueActions(verbs)} />;
}

/**
 * The board's top line, Home's Stage (Stage.tsx): the picture at the right under the header, the title large at the
 * bottom left, one muted meta line and its links, how far it got, then its verbs. Its verbs are a row, so Up and Down
 * pass between it and the shelves. While something plays (`open`), the now-playing bar holds the transport, so the
 * Stage has no verbs: its title is the one stop and opens the player, as its picture does under a pointer.
 */
function HomeHero({ thumbnail, shape, title, meta, context, progress, open, children }: { thumbnail?: string; shape: ArtShape; title: string; meta?: string; context?: ReactNode; progress?: ReactNode; open?: () => void; children?: ReactNode }) {
  return <Stage data-home-hero size="home" label={title} thumbnail={thumbnail ?? ""} shape={shape} title={title} onPicture={open}>
    {open
      ? <div data-nav-row className="w-full"><StageTitle as="h2" title={title}><button type="button" data-page-first aria-label={`Open player: ${title}`} className="cursor-pointer rounded-sm text-left [font:inherit] [letter-spacing:inherit]" onClick={open}>{title}</button></StageTitle></div>
      : <StageTitle as="h2" title={title} />}
    {/* The meta line and its links read as one block under the title. */}
    {(meta || context) && <div className="grid justify-items-start">{meta && <p className="text-base leading-relaxed break-words text-muted-foreground">{meta}</p>}{context}</div>}
    {progress}
    {children && <div data-nav-row className="mt-2 flex flex-wrap items-center gap-2 max-md:w-full max-md:[&>[data-page-first]]:flex-1">{children}</div>}
  </Stage>;
}
