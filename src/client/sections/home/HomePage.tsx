import { usePlaybackClock } from "@/session/playback-clock";
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar, useDurationClock } from "@/components/DurationBar";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { apiFetch } from "@/api/client";
import { historyQuery, removeFromContinue, undoProgressAction } from "@/api/progress";
import { forLaterQuery } from "@/api/for-later";
import { radioFavoritesListQuery, radioProgrammesQuery, radioSearchQuery } from "@/api/radio";
import { ForLaterSection } from "@/sections/saved/ForLaterSection";
import { QueuePanel } from "@/sections/now/QueuePanel";
import { useShell } from "@/sections/shell/AppShell";
import { useOptionalSessionGate, useSessionGate } from "@/session/session-context";
import type { Credentials } from "../../session/session";
import { sourceLabel } from "@/source-label";
import { playsOn } from "@/session/device-id";
import { offline, TRY_AGAIN } from "@/copy";
import { formatDuration, formatEndTime } from "@/time-format";
import { avoidRadioPlaylistId } from "../../../shared/radio";
import type { HistoryItem } from "../../../shared/viewing";
import type { QueueEntry } from "../../../shared/protocol";
import { cn } from "@/lib/utils";
import { useHomeRows, type HomeRowId } from "./home-rows";

export type HistoryPlayback = (item: HistoryItem, options: { fromStart?: boolean }) => Promise<boolean>;

const shown = { continue: 4, upNext: 8, radio: 6, later: 4, recent: 12 };
const knownLength = (entry: QueueEntry) => entry.live || entry.duration == null || !Number.isFinite(entry.duration) ? null : Math.max(0, entry.duration);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Home reads like a timetable for the evening: each row is labelled with the
 * clock time it matters at, and only rows with something in them appear.
 * Each device picks which rows it shows and in what order.
 */
export function HomePage() {
  const playbackClock = usePlaybackClock();
  const shell = useShell();
  const { on } = usePlayOn();
  const { credentials, available, current, programme } = shell;
  const { state, connected, run, nativeHost, videoQualityPreference } = useSessionGate();
  const navigate = useNavigate();
  const details = useDetailNavigation();
  const now = useDurationClock();
  const [queueOpen, setQueueOpen] = useState(false);
  const layout = useHomeRows();
  const playerBand = !!current && (shell.active || state?.player.status === "error");
  const onHome = layout.rows.filter(row => row.shown);
  const hasRow = (id: HomeRowId) => onHome.some(row => row.id === id);
  const playerFallback = !!current && !playerBand && !hasRow("now");
  const historyShown = hasRow("continue") || hasRow("recent");
  const history = useQuery({ ...historyQuery(credentials), enabled: connected && historyShown });
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected && hasRow("later") });
  const favorites = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected && hasRow("radio") });
  // Built-in stations fill the row, so a fresh Couch opens on something playable.
  const builtIn = useQuery({ ...radioSearchQuery(credentials, "avoid radio", ""), enabled: connected && hasRow("radio") });

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

  const past = (history.data?.items ?? []).filter(item => !(hasRow("now") && current && item.queueEntryId === current.id));
  const unfinished = past.filter(item => item.position > 0 && !item.watched);
  const recent = past.filter(item => !(item.position > 0 && !item.watched)).slice(0, shown.recent);
  const savedMedia = later.data?.items.filter(item => item.kind !== "radio" && !item.live) ?? [];
  const stations = [...shell.recentRadio, ...favorites.data?.favorites ?? [], ...builtIn.data?.stations ?? []].filter((station, index, all) => all.findIndex(other => other.id === station.id) === index).slice(0, shown.radio + 1);
  const programmes = useQuery({ ...radioProgrammesQuery(credentials), enabled: connected && hasRow("radio") && stations.some(station => station.sourceId === avoidRadioPlaylistId), refetchInterval: 60_000 });
  const onAir = (id: string) => { const value = programmes.data?.[id]; return value && value.expiresAt > now ? value : undefined; };
  const queries = [
    ...(historyShown ? [history] : []),
    ...(hasRow("later") ? [later] : []),
    ...(hasRow("radio") ? [favorites] : []),
  ];
  const filled: Record<HomeRowId, boolean> = { now: !!current, upNext: !!upcoming.length, continue: !!unfinished.length, radio: !!stations.length, later: !!savedMedia.length, recent: !!recent.length };
  const empty = !playerFallback && !builtIn.isLoading && queries.every(query => !query.isPending && !query.error) && !onHome.some(row => filled[row.id]);
  const featureContinue = !(current && layout.rows.find(row => row.id === "now")?.shown);
  // Nothing playing or to continue: the first station on air leads its row.
  const lead = !current && !unfinished.length ? stations.find(station => onAir(station.id)) : undefined;
  const leadShow = lead && onAir(lead.id);

  const art = (item: { thumbnail?: string; title: string }) => <Artwork item={item} />;
  const queueHistory = async (item: HistoryItem) => {
    if (!state || !item.playable) return false;
    await apiFetch(credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: state.activeProfile.id }) });
    return true;
  };

  const { pausable, transportReady, active: transportActive } = playbackCapabilities(state, connected);
  const playing = player?.status === "playing";
  const live = !!(current?.live || current?.kind === "radio");
  const at = playsOn(state);
  const playingArt = programme?.playbackId === player?.playbackId && programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} /> : current && art(current);
  // Where it plays reads "on {name}" here too, as in the mini player and the player.
  const playingStatus = !current ? "" : !connected ? offline(state?.installationName)
    : player?.status === "error" ? `Can't play ${current.title}`
    : [sourceLabel(current.source), player?.status === "paused" ? "Paused" : player?.status === "loading" ? "Loading…" : null, at?.elsewhere && `on ${at.name}${at.more ? ` +${at.more}` : ""}`].filter(Boolean).join(", ");

  const rows: Record<HomeRowId, ReactNode> = {
    now: current && <HomeRow title="Now" time={live ? "Live" : remaining != null ? `ends ${formatEndTime(remaining, now)}` : undefined}>
      <Feature art={playingArt} title={programme?.playbackId === player?.playbackId && programme?.title || current.title} meta={playingStatus}
        detail={!live && length ? <span className="flex items-center gap-3 text-sm tabular-nums text-muted-foreground"><Progress value={(playbackClock.position ?? 0) / length * 100} aria-label="Playback progress" className="h-1 max-w-xs flex-1 rounded-none bg-muted [&_[data-slot=progress-indicator]]:bg-foreground" />{formatDuration(playbackClock.position ?? 0)} / {formatDuration(length)}</span> : undefined}>
        <Button data-page-first onClick={() => shell.changeSection("Now")}>Open player</Button>
        <Button variant="ghost" disabled={!connected || (pausable ? !transportReady : !transportActive)} onClick={() => { if (!pausable) void run({ type: "stop" }); else if (player?.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>
          {!pausable ? <Square aria-hidden="true" className="fill-current" /> : playing ? <Pause aria-hidden="true" className="fill-current" /> : <Play aria-hidden="true" className="fill-current" />}{!pausable ? "Stop" : playing ? "Pause" : "Play"}
        </Button>
      </Feature>
    </HomeRow>,

    upNext: !!upcoming.length && <HomeRow title="Up next" time={doneBy != null ? `until ${formatEndTime(doneBy, now)}` : plural(upcoming.length, "item")}
      action={<Button variant="ghost" data-panel="queue" onClick={() => setQueueOpen(true)}>Edit</Button>}>
      <UpNextStrip plan={plan.slice(0, shown.upNext)} more={upcoming.length - shown.upNext} now={now} disabled={!available} pageFirst={!current}
        art={art} onPlay={entry => void run({ type: "play", entryId: entry.id })} onMore={() => setQueueOpen(true)} />
    </HomeRow>,

    continue: <ContinueSection credentials={credentials} connected={connected} canPlay={available} feature={featureContinue} onPlay={shell.playHistory} onAdd={queueHistory} currentEntryId={hasRow("now") ? current?.id : undefined} />,

    radio: !!stations.length && <HomeRow title="Radio" time={stations.some(station => onAir(station.id)) ? "On air now" : plural(Math.min(stations.length, shown.radio), "station")}
      action={<Button variant="ghost" onClick={() => void navigate({ href: "/find?browse=radio" })}>Browse</Button>}>
      {lead && leadShow && <div className="mb-6"><Feature onInspect={() => details.open(itemLocation("radio", lead.id))} art={<MediaArtwork thumbnail={leadShow.artworkUrl ?? lead.logoUrl} title={lead.name} />} title={leadShow.title} meta={[lead.name, leadShow.genre].filter(Boolean).join(" · ")}
        detail={leadShow.description && <p className="line-clamp-2 max-w-prose text-sm text-muted-foreground">{leadShow.description}</p>}>
        <Button data-page-first aria-label={on(`Play ${lead.name}`)} disabled={!available} onClick={() => void shell.enqueueRadio(lead, true)}><Play aria-hidden="true" className="fill-current" />Play {lead.name}</Button>
      </Feature></div>}
      <ul aria-label="Radio stations" className="grid border-t sm:grid-cols-2 sm:gap-x-6 xl:grid-cols-3">
        {stations.filter(station => station !== lead).slice(0, shown.radio).map(station => {
          const onNow = onAir(station.id);
          return <li key={station.id} className="border-b"><div className="flex items-center gap-2"><Button variant="ghost" aria-label={`Details ${station.name}`} onClick={() => details.open(itemLocation("radio", station.id))}
              className="group h-auto touch:h-auto min-w-0 flex-1 shrink justify-start gap-3 rounded-none px-0 py-2 text-left font-normal whitespace-normal disabled:opacity-100">
              <span className="size-12 shrink-0 overflow-hidden bg-muted"><MediaArtwork thumbnail={onNow?.artworkUrl ?? station.logoUrl} title={station.name} className="aspect-square size-full text-sm" /></span>
              <span className="grid min-w-0">
                <span className="truncate text-base font-medium">{station.name}</span>
                <span className="truncate text-sm text-muted-foreground">{[onNow?.title, onNow?.genre].filter(Boolean).join(" · ") || (station.sourceId === avoidRadioPlaylistId ? "Live" : station.groupTitle || station.countryCode)}</span>
              </span>
            </Button><Button variant="ghost" aria-label={`Play ${station.name}`} disabled={!available} onClick={() => void shell.enqueueRadio(station, true)}>Play</Button></div></li>;
        })}
      </ul>
    </HomeRow>,

    later: !!savedMedia.length && <HomeRow title="For later" time={`${savedMedia.length} saved`} action={<Button variant="ghost" onClick={() => shell.changeSection("Saved")}>Open Saved</Button>}>
      <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} showHeading={false} mediaOnly limit={shown.later} />
    </HomeRow>,

    recent: !!recent.length && <HomeRow title="Played recently" time={plural(recent.length, "title")}>
      <RecentRail items={recent} disabled={!available} onPlay={item => void shell.playHistory(item, { fromStart: true }).catch(reason => toast.error(reason instanceof Error ? reason.message : `Couldn't play ${item.title}.`))} />
    </HomeRow>,
  };

  return <section data-page="Home" aria-label="Home" className="pt-2">
    <h1 className="sr-only">Home</h1>
    {hasRow("recent") && !hasRow("continue") && history.error && <Alert variant="destructive" className="mb-6"><AlertDescription>Couldn't load Played recently.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void history.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("later") && later.error && <Alert variant="destructive" className="mb-6"><AlertDescription>Couldn't load For later.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void later.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {hasRow("radio") && favorites.error && <Alert variant="destructive" className="mb-6"><AlertDescription>Couldn't load your radio stations.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void favorites.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}

    {playerFallback && <Button data-page-first className="mb-6" onClick={() => shell.changeSection("Now")}>Open player</Button>}
    {onHome.map(row => <Fragment key={row.id}>{rows[row.id]}</Fragment>)}

    {empty && <Empty className="items-start py-12 text-left">
      <EmptyHeader className="items-start text-left"><EmptyTitle><h2>Find something to play</h2></EmptyTitle></EmptyHeader>
      <EmptyContent className="items-start"><Button data-page-first onClick={() => shell.changeSection("Find")}>Find</Button></EmptyContent>
    </Empty>}

    <Sheet modal={false} open={queueOpen} onOpenChange={setQueueOpen}>
      <SheetContent side="right" aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg" showCloseButton={false}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center gap-2 border-b bg-background px-6 py-4"><SheetClose asChild><Button variant="ghost" className="-ml-2.5"><ArrowLeft aria-hidden="true" />Close</Button></SheetClose><SheetTitle className="text-base font-medium">Up next</SheetTitle></SheetHeader>
        <div className="px-6 pt-4 pb-8"><QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} titled={false} /></div>
      </SheetContent>
    </Sheet>
  </section>;
}

type Planned = { entry: QueueEntry; starts: number | null; seconds: number | null };

/**
 * Up next against the clock: one ruler split by each entry's length, and the
 * entries under it. Pointing at an entry lights its stretch of the evening.
 */
function UpNextStrip({ plan, more, now, disabled, pageFirst, art, onPlay, onMore }: { plan: Planned[]; more: number; now: number; disabled: boolean; pageFirst: boolean; art: (entry: QueueEntry) => ReactNode; onPlay: (entry: QueueEntry) => void; onMore: () => void }) {
  const [lit, setLit] = useState<string | null>(null);
  const weight = (seconds: number | null) => seconds ?? 1_800;
  return <div onMouseLeave={() => setLit(null)} onBlur={() => setLit(null)}>
    <div aria-hidden="true" className="flex h-1 gap-0.5">
      {plan.map(({ entry, seconds }) => <span key={entry.id} className={cn("min-w-1 bg-muted-foreground transition-colors motion-reduce:transition-none", (lit ?? plan[0]?.entry.id) === entry.id && "bg-foreground")} style={{ flexGrow: weight(seconds) }} />)}
      {more > 0 && <span className="grow-[900] bg-border" />}
    </div>
    <ol data-nav-row aria-label="Up next" className="mt-3 grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1">
      {plan.map(({ entry, starts, seconds }, index) => <li key={entry.id} className="min-w-0">
        <Button variant="ghost" data-page-first={pageFirst && index === 0 ? true : undefined} aria-label={`Play ${entry.title}`} disabled={disabled}
          onClick={() => onPlay(entry)} onMouseEnter={() => setLit(entry.id)} onFocus={() => setLit(entry.id)}
          className="group h-auto touch:h-auto w-full flex-col items-stretch gap-2 rounded-none p-2 text-left font-normal whitespace-normal disabled:opacity-100">
          <span className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
            <span>{starts == null ? "Later" : formatEndTime(starts, now)}</span>
            <span className="text-muted-foreground">{entry.live ? "Live" : seconds == null ? "" : formatDuration(seconds)}</span>
          </span>
          <span className="block aspect-video overflow-hidden bg-muted [&_img]:size-full [&_img]:object-cover">{art(entry)}</span>
          <span className="line-clamp-2 text-base font-medium">{entry.title}</span>
        </Button>
      </li>)}
      {more > 0 && <li className="grid place-items-start"><Button variant="ghost" onClick={onMore}>{more} more</Button></li>}
    </ol>
  </div>;
}

/** What played lately, with details and an explicit replay action. */
function RecentRail({ items, disabled, onPlay }: { items: HistoryItem[]; disabled: boolean; onPlay: (item: HistoryItem) => void }) {
  const details = useDetailNavigation();
  return <ol data-nav-row aria-label="Played recently" className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 lg:auto-cols-[minmax(12rem,1fr)]">
    {items.map(item => {
      const play = <Button variant="ghost" aria-label={`Play ${item.title}`} disabled={disabled || !(item.playable || item.queueEntryId)} onClick={() => onPlay(item)}>Play</Button>;
      return <li key={item.mediaId} data-history-details={item.mediaId} className="min-w-0"><Button variant="ghost" aria-label={`Details ${item.title}`} onClick={() => details.open(itemLocation("history", item.mediaId))}
          className="group h-auto touch:h-auto w-full flex-col items-stretch gap-2 rounded-none p-2 text-left font-normal whitespace-normal">
          <span className="block aspect-video overflow-hidden bg-muted [&_img]:size-full [&_img]:object-contain"><Artwork item={item} /></span>
          <span className="line-clamp-2 text-base font-medium">{item.title}</span>
          <span className="truncate text-sm text-muted-foreground tabular-nums">{[historyMeta(item), item.duration ? formatDuration(item.duration) : null].filter(Boolean).join(", ")}</span>
        </Button>{play}</li>;
    })}
  </ol>;
}

/** A divided row: the section name and its clock time on the left, content on the right. */
function HomeRow({ title, time, action, children }: { title: string; time?: string; action?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="grid gap-x-12 gap-y-3 border-t py-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
    <header className="flex flex-wrap items-baseline gap-x-3 lg:flex-col lg:items-start lg:gap-y-1">
      <h2 className="text-base font-medium">{title}</h2>
      {time && <p className="text-sm text-muted-foreground tabular-nums">{time}</p>}
      {action && <div className="max-lg:ml-auto lg:-ml-2.5">{action}</div>}
    </header>
    <div className="min-w-0">{children}</div>
  </section>;
}

/** The one large item on a row: artwork beside a display title and its verbs. */
function Feature({ art, artFit = "cover", title, meta, detail, children, onInspect }: { art: ReactNode; artFit?: "cover" | "contain"; title: string; meta?: string; detail?: ReactNode; children: ReactNode; onInspect?: (event?: MouseEvent<HTMLElement>) => void }) {
  return <div className={cn("grid items-center gap-x-8 gap-y-4", artFit === "contain" ? "md:grid-cols-[fit-content(24rem)_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]")}>
    <div aria-hidden={!onInspect || undefined} className={artFit === "contain" ? "grid min-h-32 min-w-32 max-w-full place-items-center overflow-hidden bg-muted" : "aspect-video w-full max-w-md overflow-hidden bg-muted [&_img]:size-full [&_img]:object-cover [&>*]:h-full"}>{onInspect ? <Button variant="ghost" aria-label={`Artwork details for ${title}`} onClick={onInspect} className="h-auto touch:h-auto w-full rounded-none p-0 hover:opacity-80">{art}</Button> : art}</div>
    <div className="grid min-w-0 gap-2">
      <h3 title={title} className="line-clamp-2 text-3xl font-semibold tracking-tight">{onInspect ? <Button variant="ghost" aria-label={`Details ${title}`} onClick={onInspect} className="h-auto touch:h-auto min-h-11 justify-start p-0 text-left text-3xl font-semibold tracking-tight whitespace-normal">{title}</Button> : title}</h3>
      {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
      {detail}
      <div className="mt-2 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  </div>;
}

/** Unfinished items. Without anything playing, the latest one leads the row. */
export function ContinueSection({ credentials, connected, canPlay, feature, onPlay, onAdd, currentEntryId }: {
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  feature: boolean;
  onPlay: HistoryPlayback;
  onAdd: (item: HistoryItem) => Promise<boolean>;
  currentEntryId?: string;
}) {
  const session = useOptionalSessionGate();
  const details = useDetailNavigation();
  const history = useQuery({ ...historyQuery(credentials), enabled: connected });
  const [pending, setPending] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const search = new URLSearchParams(location.searchStr);
  const all = search.get("continue") === "all";
  const toggleAll = () => {
    if (all) search.delete("continue"); else search.set("continue", "all");
    void navigate({ href: `${location.pathname}${search.size ? `?${search}` : ""}`, replace: true, resetScroll: false });
  };
  const unfinished = (history.data?.items ?? []).filter(item => item.position > 0 && !item.watched && (!currentEntryId || item.queueEntryId !== currentEntryId));
  const lead = feature ? unfinished[0] : undefined;
  const rest = lead ? unfinished.slice(1) : unfinished;
  const content = useRef<HTMLDivElement>(null);
  const removed = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const target = removed.current;
    if (!target || pending || unfinished.some(item => item.mediaId === target.id)) return;
    removed.current = null;
    const controls = content.current?.querySelectorAll<HTMLElement>('[data-history-details]');
    (controls?.[Math.min(target.index, controls.length - 1)]?.querySelector<HTMLElement>('[aria-label^="Details "]') ?? document.querySelector<HTMLElement>('[data-page-first]:not(:disabled)'))?.focus();
  });
  const playable = (item: HistoryItem) => connected && canPlay && !pending && !!(item.playable || item.queueEntryId);
  const { on, play } = usePlayOn();
  async function act(item: HistoryItem, action: "resume" | "start" | "queue" | "remove", deviceId?: string) {
    if (pending) return;
    setPending(true);
    try {
      if (action === "remove") {
        removed.current = { id: item.mediaId, index: unfinished.findIndex(entry => entry.mediaId === item.mediaId) };
        const result = await removeFromContinue(credentials, item.mediaId);
        await history.refetch();
        if (result.undoToken && result.expiresAt && result.expiresAt > Date.now()) session?.offerUndo(`Removed ${item.title} from Continue.`, async () => {
          await undoProgressAction(credentials, result.undoToken!);
          await history.refetch();
        }, result.expiresAt - Date.now());
        return;
      }
      if (action !== "queue") removed.current = { id: item.mediaId, index: unfinished.findIndex(entry => entry.mediaId === item.mediaId) };
      const ok = action === "queue" ? await onAdd(item) : await play(() => onPlay(item, { fromStart: action === "start" }), deviceId);
      if (!ok) removed.current = null;
      if (action === "queue" && !ok) toast.error(`Couldn't queue ${item.title}.`);
    } catch (reason) { removed.current = null; toast.error(reason instanceof Error ? reason.message : `Couldn't play ${item.title}.`); }
    finally { setPending(false); }
  }
  const secondary = (item: HistoryItem) => <>
    <PlayOnMenu title={item.title} disabled={!playable(item)} onPlay={deviceId => void act(item, "resume", deviceId)} />
    <Button variant="ghost" aria-label={`From start ${item.title}`} disabled={!playable(item)} onClick={() => void act(item, "start")}>From start</Button>
    <Button variant="ghost" aria-label={`Queue ${item.title}`} disabled={!connected || pending} onClick={() => void act(item, "queue")}>Queue</Button>
    <Button variant="ghost" aria-label={`Remove ${item.title} from Continue`} disabled={!connected || pending} onClick={() => void act(item, "remove")}>Remove</Button>
  </>;

  if (history.error) return <Alert variant="destructive" className="mb-6"><AlertDescription>{history.error.message || "Couldn't load Continue."}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void history.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>;
  if (!unfinished.length) return null;
  const resume = (item: HistoryItem, featured = false) => <Button data-page-first disabled={!playable(item)} aria-label={on(`Resume ${item.title}`)} onClick={() => void act(item, "resume")}>{featured ? on("Resume") : "Resume"}</Button>;
  const preview = (item: HistoryItem, featured: boolean) => {
    const inspect = () => details.open(itemLocation("history", item.mediaId));
    return featured ? <div key={item.mediaId} data-history-details={item.mediaId} tabIndex={-1}><Feature art={<Artwork item={item} intrinsic />} artFit={item.thumbnail ? "contain" : "cover"} onInspect={inspect} title={item.title} meta={historyMeta(item)} detail={<>
        {item.description && <p className="line-clamp-2 max-w-prose text-sm text-muted-foreground">{item.description}</p>}
        <DurationBar duration={item.duration} position={item.position} />
      </>}>{resume(item, true)}{secondary(item)}</Feature></div> : <MediaRow key={item.mediaId} title={item.title} meta={historyMeta(item)} description={item.description} artFit="contain"
        art={<Button variant="ghost" className="size-full rounded-none p-0 hover:opacity-80" aria-label={`Artwork details for ${item.title}`} onClick={inspect}><Artwork item={item} /></Button>}
        primary={{ label: "Details", onClick: inspect }} actions={<>{resume(item)}{secondary(item)}</>} data-history-details={item.mediaId} tabIndex={-1}>
        <DurationBar duration={item.duration} position={item.position} />
      </MediaRow>;
  };
  return <HomeRow title="Continue" time={`${unfinished.length} unfinished`}><div ref={content}>
    {lead && preview(lead, true)}
    {!!rest.length && <MediaList aria-label="Continue" className={lead ? "mt-6" : undefined}>
      {(all ? rest : rest.slice(0, shown.continue)).map(item => preview(item, false))}
    </MediaList>}
    {rest.length > shown.continue && <Button variant="ghost" className="mt-2 -ml-2.5" onClick={toggleAll}>{all ? "Show fewer" : `Show all ${rest.length}`}</Button>}
  </div></HomeRow>;

}

function historyMeta(item: HistoryItem) {
  return [item.subtitle, item.sourceLabel].filter(Boolean).join(" · ");
}

function Artwork({ item, intrinsic = false }: { item: { thumbnail?: string; title: string }; intrinsic?: boolean }) {
  return <MediaArtwork thumbnail={item.thumbnail} title={item.title} className={intrinsic ? "aspect-auto h-auto w-auto max-h-64 max-w-full object-contain" : undefined} />;
}
