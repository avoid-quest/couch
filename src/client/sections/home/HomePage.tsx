import { DetailSkeleton, MediaTilesSkeleton } from "@/components/LoadingMedia";
import { MediaContext } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { playbackStatus } from "@/playback-status";
import { browserActions } from "@/original-page";
import { usePlaybackClock } from "@/session/playback-clock";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaTile, tileAspect, tileShape, type TileShape } from "@/components/MediaTile";
import { Shelf } from "@/components/Shelf";
import { DurationBar, useDurationClock } from "@/components/DurationBar";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { PlaybackTransport } from "@/components/PlaybackTransport";
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
import { avoidRadioPlaylistId, isRadio, type RadioProgrammeDetails, type RadioStation } from "../../../shared/radio";
import type { HistoryItem } from "../../../shared/viewing";
import type { ForLaterItem } from "../../../shared/for-later";
import type { QueueEntry } from "../../../shared/protocol";
import { cn } from "@/lib/utils";
import { useOnAir, useStationMenu } from "@/sections/discover/on-air";
import { useHomeRows, useKeptOrder, type HomeRowId } from "./home-rows";

export type HistoryPlayback = (item: HistoryItem, options: { fromStart?: boolean; on?: string }) => Promise<boolean>;

// A shelf scrolls, so it holds more than fits; its heading opens the rest in Discover or Saved.
const shelfLength = 12;
const knownLength = (entry: QueueEntry) => entry.live || entry.duration == null || !Number.isFinite(entry.duration) ? null : Math.max(0, entry.duration);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const entryShape = (entry: QueueEntry): TileShape => isRadio(entry) ? "square" : tileShape(sourceLabel(entry.source), !!entry.collection);
const historyMeta = (item: HistoryItem) => item.creator?.title === item.subtitle ? item.sourceLabel : [item.subtitle, item.sourceLabel].filter(Boolean).join(" · ");
const recentMeta = (item: HistoryItem) => [historyMeta(item), item.duration ? formatDuration(item.duration) : null].filter(Boolean).join(", ");

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
  const { credentials, available, current, programme } = shell;
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
  const continued = useKeptOrder(unfinished, item => item.mediaId, historyReady, hero?.kind === "continue" ? hero.item.mediaId : playingMedia).slice(0, shelfLength);
  const recent = useKeptOrder(past.filter(item => !(item.position > 0 && !item.watched)), item => item.mediaId, historyReady, playingMedia).slice(0, shelfLength);
  const listed = useKeptOrder(allStations, station => station.id, hero !== undefined && !radioPending, hero?.kind === "radio" ? hero.station.id : allStations.find(playingStation)?.id).slice(0, shelfLength);
  const savedMedia = useKeptOrder(later.data?.items.filter(item => item.kind !== "radio" && !item.live) ?? [], item => item.id, hero !== undefined && !later.isPending);
  const stationMeta = (station: RadioStation) => showMeta(station) || (station.sourceId === avoidRadioPlaylistId ? "Live" : station.groupTitle || station.countryCode);
  const queries = [...(historyShown ? [history] : []), ...(hasRow("later") ? [later] : []), ...(hasRow("radio") ? [favorites] : [])];
  const filled: Record<HomeRowId, boolean> = { upNext: !!upcoming.length, continue: !!continued.length, radio: !!listed.length, later: !!savedMedia.length, recent: !!recent.length };
  const empty = hero === null && !builtIn.isLoading && queries.every(query => !query.isPending && !query.error) && !onHome.some(row => filled[row.id]);

  const live = !!(current?.live || current?.kind === "radio");
  const at = playsOn(state);
  const show = programme?.playbackId === player?.playbackId ? programme : null;
  // Where it plays reads "on {name}" here too, as in the now-playing bar and the player. A station without its show
  // reads Radio, as the player does, never its stream's host.
  const playingMeta = [current?.subtitle, playbackStatus(state, connected).label, at?.elsewhere && `on ${at.name}`].filter(Boolean).join(", ");

  const lead = !hero ? null : hero.kind === "playing" ? current && <HomeHero context={<MediaContext collection={current.collection} creator={current.creator} radio={isRadio(current) && current.source.startsWith("radio:") ? {id: current.source.slice(6), title: current.title} : undefined} />} thumbnail={show?.artworkUrl ?? current.thumbnail} shape={entryShape(current)} title={show?.title || current.title} meta={playingMeta}
      time={live ? "Live" : remaining != null && length ? `ends ${formatEndTime(remaining, now)}` : undefined}>
      <Button data-page-first size="lg" onClick={() => shell.changeSection("Now")}>Open player</Button>
      {/* Below md the transport starts its own line under the full-width verb, so it pulls back to the text's edge. */}
      {state && <PlaybackTransport state={state} connected={connected} run={run} className="max-md:-ml-2.5" />}
    </HomeHero>
    : hero.kind === "continue" ? <HomeHero context={<MediaContext collection={hero.item.collection} creator={hero.item.creator} />} thumbnail={hero.item.thumbnail} shape={tileShape(hero.item.sourceLabel, !!hero.item.collection)} title={hero.item.title} meta={historyMeta(hero.item)}
      time={hero.item.duration ? `ends ${formatEndTime(hero.item.duration - hero.item.position, now)}` : undefined}>
      <Button data-page-first size="lg" aria-label={on(`Resume ${hero.item.title}`)} disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, false)}><Play aria-hidden="true" />{on("Resume")}</Button>
      <Button variant="ghost" size="lg" disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, true)}>From start</Button>
      {/* Resume's playback destination lacks the history actions, so Continue keeps a Details stop. */}
      <Button variant="ghost" size="lg" aria-label={`Details ${hero.item.title}`} onClick={() => details.open(itemLocation("history", hero.item.mediaId))}>Details</Button>
    </HomeHero>
    : <HomeHero context={<MediaContext radio={{id: hero.station.id, title: hero.station.name}} />} thumbnail={hero.show.artworkUrl ?? hero.station.logoUrl} shape="square" title={hero.show.title} meta={hero.show.genre} time="Live">
      <Button data-page-first size="lg" aria-label={on(`Play ${hero.station.name}`)} disabled={!available} onClick={() => void shell.enqueueRadio(hero.station, true)}><Play aria-hidden="true" />{on("Play")}</Button>
    </HomeHero>;

  const shelves: Record<HomeRowId, ReactNode> = {
    continue: !!continued.length && <Shelf title="Continue" href="/saved?tab=played" time={`${unfinished.length} unfinished`}>
      {continued.map(item => <li key={item.mediaId} data-history-details={item.mediaId} className="flex shrink-0 flex-col items-start gap-1">
        <MediaTile context={<MediaContext collection={item.collection} creator={item.creator} />} shape={tileShape(item.sourceLabel, !!item.collection)} title={item.title} meta={historyMeta(item)} thumbnail={item.thumbnail}
          aria-label={on(`Resume ${item.title}`)} disabled={!resumable(item)} onClick={() => resume.mutate({ item, fromStart: false })} menu={historyMenu(item, true)}>
          <DurationBar duration={item.duration} position={item.position} />
        </MediaTile>
        <ContentLink className="inline-flex min-h-11 items-center text-sm" href={itemLocation("history", item.mediaId)} aria-label={`Details ${item.title}`}>Details</ContentLink>
      </li>)}
    </Shelf>,

    upNext: !!upcoming.length && <Shelf title="Up next" time={doneBy != null ? `until ${formatEndTime(doneBy, now)}` : plural(upcoming.length, "item")}>
      {plan.slice(0, shelfLength).map(({ entry, starts, seconds }, index) => <li key={entry.id} className="shrink-0">
        <UpNextTile entry={entry} disabled={!available} onPlay={() => void run({ type: "play", entryId: entry.id })} meta={seconds == null ? entry.live ? "Live" : undefined : [formatDuration(seconds), starts != null && `ends ${formatEndTime(starts + seconds, now)}`].filter(Boolean).join(", ")}
          verbs={{ credentials, entry, index: cursor + 1 + index, queue, connected, run, firstUpcomingIndex: cursor + 1, lastUpcomingIndex: queue.length - 1 }} />
      </li>)}
      {upcoming.length > shelfLength && <li className="shrink-0 self-center"><Button variant="ghost" onClick={() => setQueueOpen(true)}>{upcoming.length - shelfLength} more</Button></li>}
    </Shelf>,

    radio: !!listed.length && <Shelf title="Radio" label="Radio stations" href="/discover/radio" time={allStations.some(station => onAir(station.id)) ? "On air now" : plural(listed.length, "station")}>
      {listed.map(station => <li key={station.id} className="shrink-0">
        <MediaTile context={<MediaContext radio={{id: station.id, title: "Station details"}} />} shape="square" title={station.name} meta={stationMeta(station)} thumbnail={onAir(station.id)?.artworkUrl ?? station.logoUrl}
          aria-label={on(`Play ${station.name}`)} disabled={!available} onClick={() => void shell.enqueueRadio(station, true)} menu={stationMenu(station)} />
      </li>)}
    </Shelf>,

    later: !!savedMedia.length && <Shelf title="For later" href="/saved" time={`${savedMedia.length} saved`}>
      {savedMedia.slice(0, shelfLength).map(item => <li key={item.id} data-saved-details={item.id} className="shrink-0">
        <MediaTile shape={tileShape(savedSourceLabel(item), !!item.collection)} title={item.title} meta={[item.subtitle, savedSourceLabel(item)].filter(Boolean).join(" · ")} thumbnail={item.thumbnail}
          href={itemLocation("saved", item.id)} aria-label={`Details ${item.title}`} onClick={() => details.open(itemLocation("saved", item.id))} menu={savedMenu(item)} />
      </li>)}
    </Shelf>,

    recent: !!recent.length && <Shelf title="Played recently" href="/saved?tab=played" time={plural(recent.length, "title")}>
      {recent.map(item => <li key={item.mediaId} data-history-details={item.mediaId} className="shrink-0">
        <MediaTile context={<MediaContext collection={item.collection} creator={item.creator} />} shape={tileShape(item.sourceLabel, !!item.collection)} title={item.title} meta={recentMeta(item)} thumbnail={item.thumbnail}
          href={itemLocation("history", item.mediaId)} aria-label={`Details ${item.title}`} onClick={() => details.open(itemLocation("history", item.mediaId))} menu={historyMenu(item, false)} />
      </li>)}
    </Shelf>,
  };

  return <section data-page="Home" aria-label="Home" className="grid gap-12">
    <h1 className="sr-only">Home</h1>
    {historyShown && history.error && <Alert variant="destructive"><AlertDescription>{hasRow("continue") ? "Couldn't load Continue." : "Couldn't load Played recently."}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void history.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("later") && later.error && <Alert variant="destructive"><AlertDescription>Couldn't load For later.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void later.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("radio") && favorites.error && <Alert variant="destructive"><AlertDescription>Couldn't load your radio stations.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void favorites.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}

    {hero === undefined && <DetailSkeleton home />}
    {lead}
    {hero !== undefined && onHome.map(row => <Fragment key={row.id}>{shelves[row.id] || (connected && (row.id === "later" ? later.isPending : row.id === "radio" ? radioPending : ["continue", "recent"].includes(row.id) && history.isPending) && <Shelf title={row.id === "later" ? "For later" : row.id === "radio" ? "Radio" : row.id === "continue" ? "Continue" : "Played recently"} loading><MediaTilesSkeleton shape={row.id === "radio" ? "square" : "video"} /></Shelf>)}</Fragment>)}

    {empty && <Empty className="items-start py-12 text-left">
      <EmptyHeader className="items-start text-left"><EmptyTitle><h2>Find something to play</h2></EmptyTitle></EmptyHeader>
      <EmptyContent className="items-start"><Button data-page-first onClick={() => shell.changeSection("Discover")}>Discover</Button></EmptyContent>
    </Empty>}

    <Sheet modal={false} open={queueOpen} onOpenChange={setQueueOpen}>
      <SheetContent side="right" aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg" showCloseButton={false}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background px-6 py-4"><SheetTitle className="text-base font-medium">Up next</SheetTitle><SheetClose asChild><Button variant="ghost" size="icon-lg" className="-mr-2.5 size-11" aria-label="Close" title="Close"><X aria-hidden="true" /></Button></SheetClose></SheetHeader>
        <div className="px-6 pt-4 pb-8"><QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} titled={false} /></div>
      </SheetContent>
    </Sheet>
  </section>;
}

/** An Up next entry's tile: its press plays it now, and its menu holds what its Up next row's does. */
function UpNextTile({ entry, meta, disabled, onPlay, verbs }: { entry: QueueEntry; meta?: string; disabled: boolean; onPlay: () => void; verbs: QueueActionsProps }) {
  return <MediaTile context={<MediaContext collection={entry.collection} creator={entry.creator} />} shape={entryShape(entry)} title={entry.title} thumbnail={entry.thumbnail} meta={meta} aria-label={`Play ${entry.title}`} disabled={disabled} onClick={onPlay} menu={useQueueActions(verbs)} />;
}

/**
 * The board's top line, the one place Home spends boldness: contained artwork, the title at display size, one
 * muted meta line, the time it ends (the largest text after the title), then its verbs. Narrow screens stack it,
 * with the primary verb full-width. Its verbs are a row, so Up and Down pass between it and the shelves.
 */
function HomeHero({ thumbnail, shape, title, meta, context, time, children }: { thumbnail?: string; shape: TileShape; title: string; meta?: string; context?: ReactNode; time?: string; children: ReactNode }) {
  return <section data-home-hero aria-label={title} className="grid gap-x-12 gap-y-6 border-b pb-8 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-center md:pb-12">
    {/* Artwork as it comes, at its own aspect ratio on black; missing artwork keeps its shape's frame. */}
    <div aria-hidden="true" className="flex h-56 min-w-0 justify-center md:h-80 md:justify-start [&_img]:aspect-auto [&_img]:bg-transparent"><MediaArtwork thumbnail={thumbnail} title={title} className={cn("h-full w-auto max-w-full object-contain object-left", tileAspect[shape])} /></div>
    <div className="grid min-w-0 gap-4">
      {meta && <p className="text-sm leading-relaxed break-words text-muted-foreground">{meta}</p>}
      <h2 title={title} className="line-clamp-4 text-3xl leading-[1.08] font-semibold tracking-tight break-words md:text-5xl">{title}</h2>
      {context}
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time === "Live" ? "Live now" : time}</p>}
      <div data-nav-row className="mt-2 flex flex-wrap items-center gap-2 max-md:[&>[data-page-first]]:w-full">{children}</div>
    </div>
  </section>;
}
