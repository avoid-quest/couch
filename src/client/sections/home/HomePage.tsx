import { usePlaybackClock } from "@/session/playback-clock";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaTile, tileAspect, tileShape, type TileShape } from "@/components/MediaTile";
import { DurationBar, useDurationClock } from "@/components/DurationBar";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { PlaybackTransport } from "@/components/PlaybackTransport";
import { usePlayOn } from "@/components/PlayOn";
import { historyQuery } from "@/api/progress";
import { forLaterQuery } from "@/api/for-later";
import { radioFavoritesListQuery, radioProgrammesQuery, radioSearchQuery } from "@/api/radio";
import { QueuePanel } from "@/sections/now/QueuePanel";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { savedSourceLabel } from "@/saved-source";
import { sourceLabel } from "@/source-label";
import { playsOn } from "@/session/device-id";
import { offline, TRY_AGAIN } from "@/copy";
import { formatDuration, formatEndTime } from "@/time-format";
import { avoidRadioPlaylistId, isRadio, type RadioProgrammeDetails, type RadioStation } from "../../../shared/radio";
import type { HistoryItem } from "../../../shared/viewing";
import type { QueueEntry } from "../../../shared/protocol";
import { cn } from "@/lib/utils";
import { useHomeRows, useKeptOrder, type HomeRowId } from "./home-rows";

export type HistoryPlayback = (item: HistoryItem, options: { fromStart?: boolean; on?: string }) => Promise<boolean>;

// A shelf scrolls, so it holds more than fits; Live and Library hold the rest.
const shelfLength = 12;
const knownLength = (entry: QueueEntry) => entry.live || entry.duration == null || !Number.isFinite(entry.duration) ? null : Math.max(0, entry.duration);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const entryShape = (entry: QueueEntry): TileShape => isRadio(entry) ? "square" : tileShape(sourceLabel(entry.source), !!entry.collection);
const historyMeta = (item: HistoryItem) => [item.subtitle, item.sourceLabel].filter(Boolean).join(" · ");
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
  const { state, connected, run, nativeHost, videoQualityPreference } = useSessionGate();
  const navigate = useNavigate();
  const details = useDetailNavigation();
  const now = useDurationClock();
  const [queueOpen, setQueueOpen] = useState(false);
  const layout = useHomeRows();
  const onHome = layout.rows.filter(row => row.shown);
  const hasRow = (id: HomeRowId) => onHome.some(row => row.id === id);
  const historyShown = hasRow("continue") || hasRow("recent");
  const history = useQuery({ ...historyQuery(credentials), enabled: connected && historyShown });
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected && hasRow("later") });
  const favorites = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected && hasRow("radio") });
  // Built-in stations fill the shelf, so a fresh Couch opens on something playable.
  const builtIn = useQuery({ ...radioSearchQuery(credentials, "avoid radio", ""), enabled: connected && hasRow("radio") });
  const allStations = [...shell.recentRadio, ...favorites.data?.favorites ?? [], ...builtIn.data?.stations ?? []].filter((station, index, all) => all.findIndex(other => other.id === station.id) === index);
  const onAirShown = connected && hasRow("radio") && allStations.some(station => station.sourceId === avoidRadioPlaylistId);
  const programmes = useQuery({ ...radioProgrammesQuery(credentials), enabled: onAirShown, refetchInterval: 60_000 });
  const onAir = (id: string) => { const value = programmes.data?.[id]; return value && value.expiresAt > now ? value : undefined; };
  const resume = useMutation({
    mutationFn: ({ item, fromStart }: { item: HistoryItem; fromStart: boolean }) => play(on => shell.playHistory(item, { fromStart, on })),
    onError: (error: Error, { item }) => toast.error(error.message || `Couldn't play ${item.title}.`),
  });
  const resumable = (item: HistoryItem) => available && !resume.isPending && !!(item.playable || item.queueEntryId);

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
  const radioPending = hasRow("radio") && (favorites.isPending || builtIn.isPending || onAirShown && programmes.isPending);
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
  const playingStation = (station: RadioStation) => current?.kind === "radio" && (current.source === `radio:${station.id}` || current.source === station.url);
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
  const stationMeta = (station: RadioStation) => { const show = onAir(station.id); return [playingStation(station) && "Playing", show?.title, show?.genre].filter(Boolean).join(" · ") || (station.sourceId === avoidRadioPlaylistId ? "Live" : station.groupTitle || station.countryCode); };
  const queries = [...(historyShown ? [history] : []), ...(hasRow("later") ? [later] : []), ...(hasRow("radio") ? [favorites] : [])];
  const filled: Record<HomeRowId, boolean> = { upNext: !!upcoming.length, continue: !!continued.length, radio: !!listed.length, later: !!savedMedia.length, recent: !!recent.length };
  const empty = hero === null && !builtIn.isLoading && queries.every(query => !query.isPending && !query.error) && !onHome.some(row => filled[row.id]);

  const live = !!(current?.live || current?.kind === "radio");
  const at = playsOn(state);
  const show = programme?.playbackId === player?.playbackId ? programme : null;
  // Where it plays reads "on {name}" here too, as in the now-playing bar and the player.
  const playingMeta = !current ? "" : !connected ? offline(state?.installationName)
    : player?.status === "error" ? `Can't play ${current.title}`
    : [(show ? current.title : current.subtitle) || sourceLabel(current.source), player?.status === "paused" ? "Paused" : player?.status === "loading" ? "Loading…" : null, at?.elsewhere && `on ${at.name}${at.more ? ` +${at.more}` : ""}`].filter(Boolean).join(", ");

  const lead = !hero ? null : hero.kind === "playing" ? current && <HomeHero thumbnail={show?.artworkUrl ?? current.thumbnail} shape={entryShape(current)} title={show?.title || current.title} meta={playingMeta}
      time={live ? "Live" : remaining != null && length ? `ends ${formatEndTime(remaining, now)}` : undefined}>
      <Button data-page-first size="lg" onClick={() => shell.changeSection("Now")}>Open player</Button>
      {state && <PlaybackTransport state={state} connected={connected} run={run} />}
    </HomeHero>
    : hero.kind === "continue" ? <HomeHero thumbnail={hero.item.thumbnail} shape={tileShape(hero.item.sourceLabel, !!hero.item.collection)} title={hero.item.title} meta={historyMeta(hero.item)}
      time={hero.item.duration ? `ends ${formatEndTime(hero.item.duration - hero.item.position, now)}` : undefined}>
      <Button data-page-first size="lg" aria-label={on(`Resume ${hero.item.title}`)} disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, false)}>{on("Resume")}</Button>
      <Button variant="ghost" size="lg" disabled={!resumable(hero.item)} onClick={() => playHero(hero.item, true)}>From start</Button>
      {/* Resume's playback destination lacks the history actions, so Continue keeps a Details stop. */}
      <Button variant="ghost" size="lg" aria-label={`Details ${hero.item.title}`} onClick={() => details.open(itemLocation("history", hero.item.mediaId))}>Details</Button>
    </HomeHero>
    : <HomeHero thumbnail={hero.show.artworkUrl ?? hero.station.logoUrl} shape="square" title={hero.show.title} meta={[hero.station.name, hero.show.genre].filter(Boolean).join(" · ")} time="Live">
      <Button data-page-first size="lg" aria-label={on(`Play ${hero.station.name}`)} disabled={!available} onClick={() => void shell.enqueueRadio(hero.station, true)}>{on("Play")}</Button>
    </HomeHero>;

  const shelves: Record<HomeRowId, ReactNode> = {
    continue: !!continued.length && <Shelf title="Continue" time={`${unfinished.length} unfinished`}>
      {continued.map(item => <li key={item.mediaId} data-history-details={item.mediaId} className="flex shrink-0 flex-col items-start gap-1">
        <MediaTile shape={tileShape(item.sourceLabel, !!item.collection)} title={item.title} meta={historyMeta(item)} thumbnail={item.thumbnail}
          aria-label={on(`Resume ${item.title}`)} disabled={!resumable(item)} onClick={() => resume.mutate({ item, fromStart: false })}>
          <DurationBar duration={item.duration} position={item.position} />
        </MediaTile>
        <Button variant="ghost" size="sm" className="-ml-1 min-h-11" aria-label={`Details ${item.title}`} onClick={() => details.open(itemLocation("history", item.mediaId))}>Details</Button>
      </li>)}
    </Shelf>,

    upNext: !!upcoming.length && <Shelf title="Up next" time={doneBy != null ? `until ${formatEndTime(doneBy, now)}` : plural(upcoming.length, "item")}
      action={<Button variant="ghost" data-panel="queue" onClick={() => setQueueOpen(true)}>Edit</Button>}>
      {plan.slice(0, shelfLength).map(({ entry, starts, seconds }) => <li key={entry.id} className="shrink-0">
        <MediaTile shape={entryShape(entry)} title={entry.title} thumbnail={entry.thumbnail} aria-label={`Play ${entry.title}`} disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}
          meta={seconds == null ? entry.live ? "Live" : undefined : [formatDuration(seconds), starts != null && `ends ${formatEndTime(starts + seconds, now)}`].filter(Boolean).join(", ")} />
      </li>)}
      {upcoming.length > shelfLength && <li className="shrink-0 self-center"><Button variant="ghost" onClick={() => setQueueOpen(true)}>{upcoming.length - shelfLength} more</Button></li>}
    </Shelf>,

    radio: !!listed.length && <Shelf title="Radio" label="Radio stations" time={allStations.some(station => onAir(station.id)) ? "On air now" : plural(listed.length, "station")}
      action={<Button variant="ghost" onClick={() => void navigate({ href: "/live" })}>Browse</Button>}>
      {listed.map(station => <li key={station.id} className="shrink-0">
        <MediaTile shape="square" title={station.name} meta={stationMeta(station)} thumbnail={onAir(station.id)?.artworkUrl ?? station.logoUrl}
          aria-label={on(`Play ${station.name}`)} disabled={!available} onClick={() => void shell.enqueueRadio(station, true)} />
      </li>)}
    </Shelf>,

    later: !!savedMedia.length && <Shelf title="For later" time={`${savedMedia.length} saved`} action={<Button variant="ghost" onClick={() => shell.changeSection("Library")}>Open Library</Button>}>
      {savedMedia.slice(0, shelfLength).map(item => <li key={item.id} data-saved-details={item.id} className="shrink-0">
        <MediaTile shape={tileShape(savedSourceLabel(item), !!item.collection)} title={item.title} meta={[item.subtitle, savedSourceLabel(item)].filter(Boolean).join(" · ")} thumbnail={item.thumbnail}
          aria-label={`Details ${item.title}`} onClick={() => details.open(itemLocation("saved", item.id))} />
      </li>)}
    </Shelf>,

    recent: !!recent.length && <Shelf title="Played recently" time={plural(recent.length, "title")}>
      {recent.map(item => <li key={item.mediaId} data-history-details={item.mediaId} className="shrink-0">
        <MediaTile shape={tileShape(item.sourceLabel, !!item.collection)} title={item.title} meta={recentMeta(item)} thumbnail={item.thumbnail}
          aria-label={`Details ${item.title}`} onClick={() => details.open(itemLocation("history", item.mediaId))} />
      </li>)}
    </Shelf>,
  };

  return <section data-page="Home" aria-label="Home" className="grid gap-10 tv:gap-12">
    <h1 className="sr-only">Home</h1>
    {historyShown && history.error && <Alert variant="destructive"><AlertDescription>{hasRow("continue") ? "Couldn't load Continue." : "Couldn't load Played recently."}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void history.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("later") && later.error && <Alert variant="destructive"><AlertDescription>Couldn't load For later.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void later.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("radio") && favorites.error && <Alert variant="destructive"><AlertDescription>Couldn't load your radio stations.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void favorites.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}

    {lead}
    {hero !== undefined && onHome.map(row => <Fragment key={row.id}>{shelves[row.id]}</Fragment>)}

    {empty && <Empty className="items-start py-12 text-left">
      <EmptyHeader className="items-start text-left"><EmptyTitle><h2>Search for something to play</h2></EmptyTitle></EmptyHeader>
      <EmptyContent className="items-start"><Button data-page-first onClick={() => shell.changeSection("Search")}>Search</Button></EmptyContent>
    </Empty>}

    <Sheet modal={false} open={queueOpen} onOpenChange={setQueueOpen}>
      <SheetContent side="right" aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg" showCloseButton={false}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center gap-2 border-b bg-background px-6 py-4"><SheetClose asChild><Button variant="ghost" className="-ml-2.5"><ArrowLeft aria-hidden="true" />Close</Button></SheetClose><SheetTitle className="text-base font-medium">Up next</SheetTitle></SheetHeader>
        <div className="px-6 pt-4 pb-8"><QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} titled={false} /></div>
      </SheetContent>
    </Sheet>
  </section>;
}

/**
 * The board's top line, the one place Home spends boldness: contained artwork, the title at display size, one
 * muted meta line, the time it ends (the largest text after the title), then its verbs. Narrow screens stack it,
 * with the primary verb full-width. Its verbs are a row, so Up and Down pass between it and the shelves.
 */
function HomeHero({ thumbnail, shape, title, meta, time, children }: { thumbnail?: string; shape: TileShape; title: string; meta?: string; time?: string; children: ReactNode }) {
  return <section data-home-hero aria-label={title} className="grid gap-x-12 gap-y-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-end">
    {/* Artwork as it comes, at its own aspect ratio on black; missing artwork keeps its shape's frame. */}
    <div aria-hidden="true" className="h-56 min-w-0 md:h-64 tv:h-72 [&_img]:aspect-auto [&_img]:bg-transparent"><MediaArtwork thumbnail={thumbnail} title={title} className={cn("h-full w-auto max-w-full object-contain", tileAspect[shape])} /></div>
    <div className="grid min-w-0 gap-2">
      <h2 title={title} className="line-clamp-2 text-3xl font-semibold tracking-tight">{title}</h2>
      {meta && <p className="truncate text-sm text-muted-foreground">{meta}</p>}
      {time && <p className="text-2xl tabular-nums">{time}</p>}
      <div data-nav-row className="mt-4 flex flex-wrap items-center gap-1 max-md:[&>[data-page-first]]:w-full">{children}</div>
    </div>
  </section>;
}

/** A shelf of MediaTiles under its heading: a plain overflow row that scrolls as focus moves along it. Its padding keeps the focus outline clear of the clip. */
function Shelf({ title, label = title, time, action, children }: { title: string; label?: string; time?: string; action?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="grid min-w-0 gap-3">
    <header className="flex min-h-8 items-baseline gap-3">
      <h2 className="text-base font-medium">{title}</h2>
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time}</p>}
      {/* The TV's tab bar reaches Live and Library and its now-playing bar Up next, so Up from a shelf meets only the shelves above it. */}
      {action && <div className="-my-2 ml-auto -mr-2.5 tv:hidden">{action}</div>}
    </header>
    <ol data-nav-row aria-label={label} className="-m-1 flex scroll-px-1 gap-4 overflow-x-auto p-1 [scrollbar-width:thin] tv:[scrollbar-width:none]">{children}</ol>
  </section>;
}
