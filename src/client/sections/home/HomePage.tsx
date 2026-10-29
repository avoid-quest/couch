import { livePlayback, playbackControls } from "@/session/playback-controls";
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
import { artShape, historyShape, majorityShape, savedShape, type ArtShape } from "@/art-shape";
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
import { sourceLabel } from "@/source-label";
import { playsOn } from "@/session/device-id";
import { PlaysOnLine } from "@/sections/shell/Outputs";
import { TRY_AGAIN } from "@/copy";
import { formatDuration, formatRuntime, formatEndTime } from "@/time-format";
import { avoidRadioPlaylistId, isRadio, radioHost, radioShowLabels, stationSources, type RadioProgrammeDetails, type RadioStation } from "../../../shared/radio";
import type { HistoryItem, HistorySelection } from "../../../shared/viewing";
import type { ForLaterItem } from "../../../shared/for-later";
import type { QueueEntry } from "../../../shared/protocol";
import { RadioProgress, RadioStationLine } from "@/components/RadioSchedule";
import { useOnAir, useStationMenu, useStationShow } from "./on-air";
import { boardRows, homeRowLabels, useHomeRows, useKeptOrder, type HomeRowId } from "./home-rows";
import { Board, BoardArt, BoardList } from "./HomeBoard";
import { Failed, LiveTvShelf, SavedSourceShelf, SharedSources, SourcesLine, sourceHomes } from "./HomeSources";
import { MediaRow } from "@/components/MediaRow";
import { iptvSourcesQuery } from "@/api/iptv";
import { providerFavoritesQuery } from "@/api/providers";
import { useLiveSourceHits } from "@/sections/find/useLiveSourceHits";
import type { ProviderId } from "../../../shared/providers";

export type HistoryPlayback = (item: HistoryItem, options: { fromStart?: boolean; on?: string; selection?: HistorySelection }) => Promise<boolean>;

// A shelf scrolls, so it holds more than fits; a board's list holds its first few. Their headings open the rest.
const shelfLength = 12;
const boardLength = 4;
const knownLength = (entry: QueueEntry) => entry.live || entry.duration == null || !Number.isFinite(entry.duration) ? null : Math.max(0, entry.duration);
const entryShape = (entry: QueueEntry): ArtShape => isRadio(entry) ? "square" : artShape(sourceLabel(entry.source), entry.collection ? "episode" : "media");
const recentCaption = (item: HistoryItem) => { const caption = mediaCaption(item); return { title: caption.title, meta: metaLine(caption.lead, item.creator?.title ?? caption.subtitle) }; };
// Continue says how much is left where Played recently says how long it is; the line on the artwork shows how far it got.
const continueCaption = (item: HistoryItem) => { const caption = mediaCaption(item); return { title: caption.title, meta: metaLine(caption.lead, item.duration ? `${formatRuntime(Math.max(0, item.duration - item.position))} left` : null) }; };

type Hero = { kind: "playing" } | { kind: "continue"; item: HistoryItem } | { kind: "radio"; station: RadioStation; show: RadioProgrammeDetails };

/**
 * Home is the evening's departures board: one large item on top (what you control playing now, else the
 * first thing to continue, else the first station on air), then shelves of tiles, each headed by the
 * clock time it matters at. Each device picks which shelves it shows and in what order.
 */
export function HomePage() {
  const shell = useShell();
  const { on, play } = usePlayOn();
  const { credentials, available, current } = shell;
  const { state, connected, run, queue: queued, nativeHost, videoQualityPreference } = useSessionGate();
  const details = useDetailNavigation();
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

  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursor = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const upcoming = playbackControls(state).queue ? queue.slice(cursor + 1) : [];

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
  // Play replaces the hero's verbs with its playing title. Hand over lost focus,
  // as page entry would, unless the user moved elsewhere while playback started.
  const leading = useRef(false);
  const playHero = (item: HistoryItem, fromStart: boolean) => { leading.current = true; resume.mutate({ item, fromStart }, { onSettled: ok => { if (!ok) leading.current = false; } }); };
  const playRadioHero = (station: RadioStation) => {
    leading.current = true;
    void shell.enqueueRadio(station, true).then(ok => { if (!ok) leading.current = false; });
  };
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
  const continuingUrls = new Set(hasRow("continue") ? unfinished.map(item => item.url).filter(Boolean) : []);
  const currentUrl = current?.source.startsWith("web:") ? current.source.slice(4) : undefined;
  const savedMedia = useKeptOrder(later.data?.items.filter(item => item.kind !== "radio" && !item.live && !continuingUrls.has(item.url) && item.url !== currentUrl) ?? [], item => item.id, hero !== undefined && !later.isPending);
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
  // Where it plays reads "on {name}" before the links, on one line, as in the now-playing bar and the player. A
  // station without its show reads Radio, as the player does, never its stream's host.
  const status = playbackStatus(state, connected);
  const playing = current && mediaCaption({ ...current, title: show?.title || current.title });
  const playingMeta = metaLine(playing?.lead, playing?.subtitle, ...radioShowLabels(show), radioHost(show), current && !isRadio(current) && sourceLabel(current.source), !livePlayback(state) && !status.quiet && status.label);
  const heroCaption = hero?.kind === "continue" ? { ...historyCaption(hero.item), ...hero.item.creator ? { meta: mediaCaption(hero.item).lead } : {} } : undefined;

  const lead = !hero ? null : hero.kind === "playing" ? current && playing && <HomeHero context={<PlaysOnLine at={at}><MediaContext collection={current.collection} creator={current.creator} radio={isRadio(current) && current.source.startsWith("radio:") ? {id: current.source.slice(6), title: current.title} : undefined} /></PlaysOnLine>} thumbnail={show?.artworkUrl ?? current.thumbnail} shape={entryShape(current)} title={playing.title} meta={playingMeta}
      progress={live ? <RadioProgress show={show} /> : <PlayingProgress current={current} speed={state?.player.speed || 1} />}
      // The now-playing bar below holds the transport, so the playing Stage holds none: its title and picture open the player.
      open={() => shell.changeSection("Now")} />
    : hero.kind === "continue" && heroCaption ? <HomeHero context={<MediaContext collection={hero.item.collection} creator={hero.item.creator} />} thumbnail={hero.item.thumbnail} shape={historyShape(hero.item)} title={heroCaption.title} meta={heroCaption.meta}
      // Not playing, it has no end time: how much is left, as Details says it.
      progress={hero.item.duration ? <ProgressLine position={hero.item.position} duration={hero.item.duration} /> : undefined}>
      <Button data-page-first size="lg" aria-label={on(`Resume ${hero.item.title}`)} disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, false)}><Play aria-hidden="true" />{on("Resume")}</Button>
      <Button variant="ghost" size="lg" className="max-md:hidden" disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, true)}>From start</Button>
      {/* Resume's playback destination lacks the history actions, so Continue keeps a Details stop. */}
      <Button variant="ghost" size="lg" aria-label={`Details ${hero.item.title}`} onClick={() => details.open(itemLocation("history", hero.item.mediaId))}>Details</Button>
    </HomeHero>
    : hero.kind === "radio" ? <HomeHero context={<RadioStationLine className="text-sm" station={<MediaContext radio={{id: hero.station.id, title: hero.station.name}} />} tags={hero.station.tags} />} thumbnail={hero.show.artworkUrl ?? hero.station.logoUrl} shape="square" title={hero.show.title} meta={metaLine(...radioShowLabels(hero.show), radioHost(hero.show))} progress={<RadioProgress show={hero.show} />}>
      <Button data-page-first size="lg" aria-label={on(`Play ${hero.station.name}`)} disabled={!available} onClick={() => playRadioHero(hero.station)}><Play aria-hidden="true" />{on("Play")}</Button>
    </HomeHero> : null;

  // A list takes its items' majority shape; an item of another shape is contained in that frame.
  const shelfShape = (shapes: ArtShape[]) => shapes.every(shape => shape === shapes[0]) ? shapes[0] ?? "video" : "square";
  const continueShape = shelfShape(continued.slice(0, shelfLength).map(historyShape));
  const laterShape = shelfShape(savedMedia.slice(0, shelfLength).map(savedShape));
  const recentShape = shelfShape(recent.slice(0, shelfLength).map(historyShape));
  // With no Stage, a remote starts on the board's first row.
  const firstBoard = !hero && onHome.find(row => boardRows.includes(row.id) && filled[row.id])?.id;
  const lists: Partial<Record<HomeRowId, ReactNode>> = {
    continue: !!continued.length && <Shelf title="Continue" href="/saved?tab=played">
      {continued.slice(0, shelfLength).map((item, index) => <li key={item.mediaId} className="flex shrink-0">
        <MediaTile natural data-history-details={item.mediaId} data-page-first={firstBoard === "continue" && index === 0 || undefined} related={{ collection: item.collection, creator: item.creator }} shape={continueShape} own={historyShape(item)} {...continueCaption(item)} source={item.url}
          thumbnail={item.thumbnail} progress={item.duration ? item.position / item.duration : undefined}
          aria-label={`Resume ${item.title}`} disabled={!resumable(item)} onClick={() => resume.mutate({ item, fromStart: false })} menu={historyMenu(item, true)} />
      </li>)}
    </Shelf>,

    upNext: !!upcoming.length && <UpcomingBoard cursor={cursor} pageFirst={firstBoard === "upNext"} onMore={() => setQueueOpen(true)} />,

    later: !!savedMedia.length && <Shelf title="For later" href="/saved?tab=later">
      {savedMedia.slice(0, shelfLength).map((item, index) => <li key={item.id} className="flex shrink-0">
        <MediaTile natural data-saved-details={item.id} data-page-first={firstBoard === "later" && index === 0 || undefined} related={{ collection: item.collection, creator: item.creator }} shape={laterShape} own={savedShape(item)} title={savedCaption(item).title} meta={metaLine(mediaCaption(item).lead, item.creator?.title ?? item.subtitle)} source={item.url}
          thumbnail={item.thumbnail} aria-label={`Details ${item.title}`} href={itemLocation("saved", item.id)} onClick={() => details.open(itemLocation("saved", item.id))} menu={savedMenu(item)} />
      </li>)}
    </Shelf>,

    recent: !!recent.length && <Shelf title="Played recently" href="/saved?tab=played">
      {recent.slice(0, shelfLength).map((item, index) => <li key={item.mediaId} className="flex shrink-0">
        <MediaTile natural data-history-details={item.mediaId} data-page-first={firstBoard === "recent" && index === 0 || undefined} related={{ collection: item.collection, creator: item.creator }} shape={recentShape} own={historyShape(item)} {...recentCaption(item)} source={item.url}
          thumbnail={item.thumbnail} aria-label={`Details ${item.title}`} href={itemLocation("history", item.mediaId)} onClick={() => details.open(itemLocation("history", item.mediaId))} menu={historyMenu(item, false)} />
      </li>)}
    </Shelf>,

    shared: !!sharedSources.length && <SharedSources hits={sharedSources} />,

    // Every station on air, yours (played here lately, saved) first; the heading opens every station.
    radio: !!stations.length && <Shelf title="Radio" label="Radio stations" href="/radio">
      {stations.map((station, index) => <li key={station.id} className="flex shrink-0">
        {/* Tiles take the shelf's height, so one without a show stays level with the rest and Up and Down leave the shelf. */}
        <MediaTile fit="contain" logo={!onAir(station.id)?.artworkUrl || onAir(station.id)?.artworkUrl === station.logoUrl} data-page-first={index === 0 || undefined} shape="square" title={station.name} meta={stationMeta(station)} thumbnail={onAir(station.id)?.artworkUrl ?? station.logoUrl} source={stationSources(station)}
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
  const section = (id: HomeRowId) => lists[id] || (pending(id) && (id === "upNext" ? <BoardList title={homeRowLabels[id]} loading />
    : <Shelf title={homeRowLabels[id]} loading><MediaTilesSkeleton shape="square" /></Shelf>));
  // Adjacent artwork shelves share the width, as do compact history and queue lists.
  const groupKind = (id: HomeRowId) => id === "continue" || id === "later" || id === "recent" ? "shelves" : id === "upNext" ? "board" : id;
  const groups = onHome.reduce<HomeRowId[][]>((all, row) => {
    const last = all.at(-1);
    if (last && groupKind(row.id) === groupKind(last[0]!)) last.push(row.id); else all.push([row.id]);
    return all;
  }, []);

  return <section data-page="Home" aria-label="Home" className="grid gap-section">
    <PageHeader title="Home" hidden />
    {historyShown && history.error && <Alert variant="destructive"><AlertDescription>{hasRow("continue") ? "Couldn't load Continue." : "Couldn't load Played recently."}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void history.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("later") && later.error && <Alert variant="destructive"><AlertDescription>Couldn't load For later.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void later.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("radio") && !stations.length && (favorites.error || builtIn.error) && <Alert variant="destructive"><AlertDescription>Couldn't load Radio.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void Promise.all([favorites.refetch(), builtIn.refetch()])}>{TRY_AGAIN}</Button></AlertAction></Alert>}

    {hero === undefined && <DetailSkeleton home />}
    {lead}
    {hero !== undefined && groups.map(group => groupKind(group[0]!) === "shelves"
      ? group.some(id => lists[id] || pending(id)) && <div className="home-shelves" key={group.join(" ")}>{group.map(id => <Fragment key={id}>{section(id)}</Fragment>)}</div>
      : groupKind(group[0]!) === "board"
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

// Only the progress and timetable subscribe to playback time; a tick must not render Home's shelves and artwork.
function PlayingProgress({ current, speed }: { current: QueueEntry; speed: number }) {
  const clock = usePlaybackClock();
  const now = useDurationClock();
  const length = clock.duration || knownLength(current);
  if (!length) return null;
  const remaining = Math.max(0, length - clock.position) / speed;
  return <ProgressLine position={clock.position} duration={length} label={`${formatDuration(remaining)} left, ends ${formatEndTime(remaining, now)}`} />;
}

function UpcomingBoard({ cursor, pageFirst, onMore }: { cursor: number; pageFirst: boolean; onMore: () => void }) {
  const { credentials, available, current } = useShell();
  const { state, connected, run } = useSessionGate();
  const playbackClock = usePlaybackClock();
  const now = useDurationClock();
  const queue = state?.queue ?? [];
  const upcoming = playbackControls(state).queue ? queue.slice(cursor + 1) : [];
  const shape = majorityShape(upcoming.slice(0, boardLength).map(entryShape));
  const length = current ? current.live ? null : playbackClock.duration || knownLength(current) : 0;
  // Up next as a timetable: each entry starts when the one before it ends.
  let clock = length == null ? null : Math.max(0, length - playbackClock.position) / (state?.player.speed || 1);
  const plan = upcoming.map(entry => {
    const starts = clock, seconds = knownLength(entry);
    clock = clock == null || seconds == null ? null : clock + seconds;
    return { entry, starts, seconds };
  });
  return <BoardList title="Up next" time={clock != null ? `until ${formatEndTime(clock, now)}` : undefined}
    more={upcoming.length > boardLength && <Button variant="ghost" className="-ml-3.5 justify-self-start text-muted-foreground" onClick={onMore}>{upcoming.length - boardLength} more</Button>}>
    {plan.slice(0, boardLength).map(({ entry, starts, seconds }, index) => <UpNextRow key={entry.id} entry={entry} shape={shape} pageFirst={pageFirst && index === 0} disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })} meta={seconds == null ? undefined : metaLine(formatDuration(seconds), starts != null && `ends ${formatEndTime(starts + seconds, now)}`)}
      verbs={{ credentials, entry, index: cursor + 1 + index, queue, connected, run, firstUpcomingIndex: cursor + 1, lastUpcomingIndex: queue.length - 1 }} />)}
  </BoardList>;
}

/** An Up next entry's row: its press plays it now, and its menu holds what its Up next row in the player does. */
function UpNextRow({ entry, shape, meta, disabled, onPlay, verbs, pageFirst }: { entry: QueueEntry; shape: ArtShape; meta?: string; disabled: boolean; onPlay: () => void; verbs: QueueActionsProps; pageFirst: boolean }) {
  const caption = mediaCaption(entry);
  return <MediaRow compact pageFirst={pageFirst} related={{ collection: entry.collection, creator: entry.creator }} shape={shape} own={entryShape(entry)} title={caption.title} art={<BoardArt thumbnail={entry.thumbnail} title={entry.title} />} meta={metaLine(caption.lead, meta)} primary={{ label: "Play", disabled, onClick: onPlay }} menu={useQueueActions(verbs)} />;
}

/**
 * The board's top line, Home's Stage (Stage.tsx): a compact whole picture beside its title, one muted meta line and its links, how far it got, then its verbs. Its verbs are a row, so Up and Down
 * pass between it and the shelves. While something plays (`open`), the now-playing bar holds the transport, so the
 * Stage has no verbs: its title is the one stop and opens the player, as its picture does under a pointer.
 */
function HomeHero({ thumbnail, shape, title, meta, context, progress, open, children }: { thumbnail?: string; shape: ArtShape; title: string; meta?: string; context?: ReactNode; progress?: ReactNode; open?: () => void; children?: ReactNode }) {
  return <Stage data-home-hero size="home" label={title} thumbnail={thumbnail ?? ""} shape={shape} title={title} onPicture={open}>
    {open
      ? <div data-nav-row className="w-full"><StageTitle as="h2" title={title}><button type="button" data-page-first aria-label={`Open player: ${title}`} className="cursor-pointer rounded-sm text-left [font:inherit] [letter-spacing:inherit]" onClick={open}>{title}</button></StageTitle></div>
      : <StageTitle as="h2" title={title} />}
    {/* The meta line and its links read as one block under the title. */}
    {(meta || context) && <div className="home-hero-meta flex flex-wrap items-baseline gap-x-2 gap-y-1">{meta && <p className="text-sm leading-relaxed break-words text-muted-foreground">{meta}</p>}{context}</div>}
    {progress}
    {children && <div data-nav-row className="mt-2 flex flex-wrap items-center gap-2 max-md:w-full max-md:[&>[data-page-first]]:flex-1">{children}</div>}
  </Stage>;
}
