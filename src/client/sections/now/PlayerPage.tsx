import { useCouchHotkeys } from "@/useCouchHotkeys";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, Captions, ChevronRight, Info, ListMusic, Maximize, Minimize, Music2, Pause, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackTimeline, PlaybackTransport, VolumeButton, playbackCapabilities, useEndTime } from "@/components/PlaybackTransport";
import { DigitalClock } from "@/components/DigitalClock";
import { sourceLabel } from "@/source-label";
import { PlaybackSettingsPanel } from "@/components/PlaybackSettings";
import { deviceName, offline } from "@/copy";
import { useBottomBar } from "@/sections/shell/NowPlayingBar";
import { QueuePanel } from "./QueuePanel";
import { usePlayerFullscreen } from "./usePlayerFullscreen";
import { isAudioOnly } from "./player-presentation";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { renderInto } from "@/session/renderer";
import { playsOn, showsPicture } from "@/session/device-id";
import { WhereItPlays } from "@/sections/shell/Outputs";
import { LiveSharingStatus } from "@/sections/shell/LiveSharingStatus";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "@tanstack/react-router";
import { isRadio } from "../../../shared/radio";
import { queueItemLocation, restoreDetailFocus, useDetailNavigation } from "@/detail-navigation";

type Panel = "tracks" | "settings";
const panelTitles: Record<Panel, string> = { tracks: "Audio & subtitles", settings: "Playback" };
// From 960px audio keeps Up next on screen beside the artwork (index.css), so the band's Up next has nothing to open.
const wideQuery = "(min-width: 960px)";
const subscribeWide = (onChange: () => void) => { const media = window.matchMedia(wideQuery); media.addEventListener("change", onChange); return () => media.removeEventListener("change", onChange); };
const isWide = () => window.matchMedia(wideQuery).matches;

export function PlayerPage({ queueOpen: requestedQueueOpen, onQueueOpenChange }: { queueOpen?: boolean; onQueueOpenChange?: (open: boolean) => void } = {}) {
  const fullscreen = usePlayerFullscreen();
  const shell = useShell();
  const { credentials, available, active, current, programme } = shell;
  const { state, connected, run, seekBy, nativeHost, tvPresentation, videoQualityPreference, playerTarget, localLiveSourceId } = useSessionGate();
  useCouchHotkeys([{ hotkey: "F", enabled: !tvPresentation && fullscreen.supported && !fullscreen.pending, action: () => void fullscreen.toggle() }]);
  const detailNavigation = useDetailNavigation();
  const location = useLocation();
  const [panelState, setPanelState] = useState<{ playbackId: string; panel: Panel } | null>(null);
  const [shown, setShown] = useState(true);
  const [localQueueOpen, setLocalQueueOpen] = useState(false);
  const queueOpen = requestedQueueOpen ?? localQueueOpen;
  const setQueueOpen = useCallback((open: boolean) => { if (onQueueOpenChange) onQueueOpenChange(open); else setLocalQueueOpen(open); }, [onQueueOpenChange]);
  const queueTrigger = useRef<HTMLButtonElement>(null);
  const queueClose = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLElement>(null);
  const firstTransport = () => root.current?.querySelector<HTMLElement>('[aria-label="Playback controls"] button:not(:disabled)');
  const surface = () => root.current?.querySelector<HTMLElement>("[data-player-surface]");
  // What a touch found when it landed (the controls shown or not), so its tap can show or hide them; null for a mouse.
  const tap = useRef<boolean | null>(null);
  // What the picture's last click asked for, so a double-click's second click can undo it.
  const clicked = useRef(false);
  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    (queueTrigger.current?.getClientRects().length ? queueTrigger.current : root.current?.querySelector<HTMLButtonElement>('button[data-play-button]:not(:disabled), button[data-primary]:not(:disabled)'))?.focus();
  }, [setQueueOpen]);
  const band = useRef<HTMLDivElement>(null);
  // Up next opened over a video (index.css) and toasts (sonner.tsx) start below the top band, so it publishes its height.
  const topBand = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => root.setProperty("--player-top", `${element.offsetHeight}px`));
    observer.observe(element, { box: "border-box" });
    return () => { observer.disconnect(); root.removeProperty("--player-top"); };
  }, []);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  const player = state?.player;
  const panel = current && active && panelState?.playbackId === player?.playbackId ? panelState?.panel ?? null : null;
  const playing = player?.status === "playing";
  const ended = player?.status === "ended";
  const findingNext = ended && state?.autoplay?.enabled && state.autoplay.pending;
  const playback = state?.playbacks?.find(playback => playback.id === state.playback);
  const audioOnly = isAudioOnly(playback, current, player?.tracks);
  // The picture shows on the Playback's picture outputs; every other window shows the artwork (#644 ticket 9).
  const at = playsOn(state);
  const elsewhere = !!at?.elsewhere;
  // An mpv channel shows its picture in mpv's own window, so this one shows the artwork.
  const separate = !!playback?.hostOnly && showsPicture(state);
  const picture = showsPicture(state) && !separate;
  const artworkStage = audioOnly || !picture;
  const queueBeside = useSyncExternalStore(subscribeWide, isWide) && artworkStage;
  const sharing = !!localLiveSourceId;
  // While this device shares, the bands stay up, so the top band's Stop sharing stays on screen.
  const autoHide = playing && !artworkStage && !sharing;
  useBottomBar(band, !!current && shown);
  useEffect(() => { setPanelState(null); }, [active, player?.playbackId]);
  useEffect(() => { if (panel) panelClose.current?.focus(); }, [panel]);
  useEffect(() => { if (queueOpen) queueClose.current?.focus(); }, [queueOpen]);
  const { transportReady, pausable } = playbackCapabilities(state, connected);
  const ends = useEndTime(state);
  // Opening, the player focuses the picture, so keys are shortcuts at once; a TV's remote starts on the transport.
  useEffect(() => {
    if (queueOpen) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement && root.current?.contains(document.activeElement) && !document.activeElement.matches(":disabled")) return;
      if (restoreDetailFocus(location.state.detailFocus)) return;
      (tvPresentation ? firstTransport() : surface())?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tvPresentation, current?.id, transportReady, location.state.__TSR_key]);
  const name = deviceName(state?.installationName);
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  const following = currentIndex >= 0 ? state?.queue[currentIndex + 1] ?? (state?.autoplay?.enabled ? state.autoplay.next : undefined) : undefined;
  const retry = state?.radioRetry?.retryAt != null && player?.status === "loading" ? state.radioRetry : null;
  const retrySeconds = retry ? Math.max(0, Math.ceil((retry.retryAt! - now) / 1000)) : 0;
  // The controls stay up while the keyboard is in them or on a toast's action, which Back returns to them;
  // on the picture they hide when idle.
  const idle = () => { if (!root.current?.querySelector(":focus-visible:not([data-player-surface])") && !document.activeElement?.closest("[data-sonner-toaster]")) setShown(false); };
  const wake = () => {
    setShown(true);
    clearTimeout(timer.current);
    if (autoHide && !panel && !queueOpen) timer.current = setTimeout(idle, 4000);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    if (!autoHide || panel || queueOpen) setShown(true);
    else timer.current = setTimeout(idle, 4000);
    return () => clearTimeout(timer.current);
  }, [autoHide, panel, queueOpen]);
  useEffect(() => {
    if (!nativeHost || !current || shown) return;
    document.documentElement.toggleAttribute("data-cursor-hidden", true);
    return () => { document.documentElement.toggleAttribute("data-cursor-hidden", false); };
  }, [nativeHost, !!current, shown]);
  useEffect(() => {
    if (!retry) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [retry?.retryAt]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape" || event.key === "BrowserBack") {
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]')) return;
        // Back on a toast's action only leaves it (navigation.ts).
        if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (panel) setPanelState(null);
        else if (queueOpen) closeQueue();
        else if (tvPresentation && shown) {
          clearTimeout(timer.current);
          if (document.activeElement instanceof HTMLElement && root.current?.contains(document.activeElement)) document.activeElement.blur();
          setShown(false);
        }
        else if (!tvPresentation && event.key === "Escape" && fullscreen.supported && fullscreen.fullscreen) void fullscreen.toggle();
        else shell.leavePlayer();
        return;
      }
      const inPlayer = root.current?.contains(document.activeElement) || document.activeElement === document.body;
      // A TV's remote with the controls hidden: OK shows them on the transport, the arrows on the timeline.
      if (tvPresentation && !panel && !shown && inPlayer && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); wake();
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") void seekBy(event.key === "ArrowLeft" ? -10 : 10);
        const timeline = event.key.startsWith("Arrow");
        requestAnimationFrame(() => (timeline ? root.current?.querySelector<HTMLElement>('[role="slider"][aria-label="Playback position"]:not([data-disabled])') ?? firstTransport() : firstTransport())?.focus());
        return;
      }
      if (tvPresentation && !panel && event.key === " " && inPlayer && !(event.target instanceof HTMLElement && event.target.closest('button, a, input, select, textarea, [role="slider"]')) && transportReady && pausable && player?.playbackId) {
        event.preventDefault(); void run({ type: "pause", playbackId: player.playbackId, paused: playing });
      }
      // Any other key shows the controls for a while and leaves focus where it is. Hidden bands are inert, so Tab
      // shows them before the browser moves focus, and enters them in their order.
      if (inPlayer) { if (event.key === "Tab" && !shown) flushSync(wake); else wake(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tvPresentation, shown, panel, queueOpen, closeQueue, playing, autoHide, transportReady, pausable, player?.playbackId, run, seekBy, shell.leavePlayer, fullscreen]);
  // An explicitly opened queue remains available after playback stops.
  if (!current && !queueOpen && !playerTarget) return null;

  const buffering = player?.status === "loading" && player.buffering;
  const bufferingStatus = buffering && <p role="status" className={cn("flex min-w-0 items-center gap-2 bg-background px-2 py-1 text-sm", !playerTarget && "ml-auto w-fit")}><Spinner role="presentation" aria-label={undefined} aria-hidden="true" />Buffering…</p>;
  const currentProgramme = programme?.playbackId === player?.playbackId ? programme : null;
  const radio = isRadio(current);
  const detailHref = current && !current.liveSourceId ? queueItemLocation(current) : undefined;
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!detailHref || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); detailNavigation.open(detailHref, panel === "settings" ? '.player-page button[aria-label="Playback"]' : undefined);
  };
  // A pointer has no Back key, so desktop and phones lead the top band with Back; the TV's remote has its own.
  const backLabel = `Back to ${playerTarget ? "Remote" : shell.playerBackLabel}`;
  const back = !tvPresentation && <Button variant="ghost" size="icon" className="-ml-2.5 size-11 shrink-0" aria-label={backLabel} title={backLabel} onClick={shell.leavePlayer}><ArrowLeft aria-hidden="true" /></Button>;
  const artwork = currentProgramme?.artworkUrl ? <MediaArtwork thumbnail={currentProgramme.artworkUrl} title={currentProgramme.title} /> : current?.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : undefined;
  const openPanel = (value: Panel, trigger: HTMLButtonElement) => { if (!player?.playbackId) return; panelTrigger.current = trigger; setPanelState({ playbackId: player.playbackId, panel: value }); setShown(true); };
  const source = current ? sourceLabel(current.source) : "";
  const title = currentProgramme?.title || current?.title;
  // As in Home's hero: a show's station, else the subtitle (series, episode or channel), else the source (a station's is its stream host).
  const byline = !current ? "" : !connected ? offline(name) : (currentProgramme ? current.title : current.subtitle) || (radio ? "Radio" : source);
  const osd = !!current && !artworkStage;
  const where = elsewhere && at ? `on ${at.name}${at.more ? ` +${at.more}` : ""}` : separate && ["playing", "paused"].includes(player?.status ?? "") ? "in a separate window" : null;
  const meta = !connected ? byline : [byline, ended ? findingNext ? "Finding the next item…" : "Finished" : player?.status === "paused" ? "Paused" : null, !ended && where].filter(Boolean).join(", ");
  const nowPlaying = player?.nowPlaying && [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" — ");
  const unavailable = connected && player?.status === "unavailable";
  const errorDetail = radio ? "The station stopped sending audio." : current?.live ? "This stream has ended." : "This video is unavailable.";
  const skip = () => void run(player?.playbackId ? { type: "next", playbackId: player.playbackId } : following ? { type: "play", entryId: following.id } : { type: "stop" });
  const status = !current ? null : unavailable ? { title: player?.error ?? `Nothing is playing on ${name}`, detail: "Press Play to start it again here." }
    : player?.status === "error" ? { title: `Can't play ${current.title}`, detail: player.error || errorDetail }
    : retry ? { title: `Reconnecting to ${current.title}`, detail: `Retrying in ${retrySeconds} s (${retry.attempt} of ${retry.maximum})`, busy: true }
    : player?.status === "loading" && !player.buffering ? { title: `Loading ${current.title}`, detail: `Connecting to ${source}…`, busy: true }
    : ended && !artworkStage ? { title: findingNext ? "Finding the next item…" : `Finished ${current.title}`, detail: findingNext ? "" : "Replay to watch again.", busy: !!findingNext }
    : null;

  // A mouse leaving the window shows the controls; a lifted finger "leaves" too, but must let them hide.
  return <section ref={root} className={cn("player-page fixed inset-0 overflow-hidden bg-background", !shown && "cursor-none [&_*]:cursor-none")} data-page="Now" data-artwork-stage={artworkStage || undefined} data-queue-open={queueOpen || undefined} data-player-idle={!current || undefined} aria-label="Player" onPointerMove={wake} onPointerLeave={event => { if (event.pointerType === "touch") return; setShown(true); clearTimeout(timer.current); }} onFocus={wake} onBlur={wake}>
    {/* The picture is the player's surface. It takes focus when the player opens, and keys on it are shortcuts
        (useCouchHotkeys counts a tabindex of -1 as background). As on YouTube, a click on a video plays or pauses (on
        audio, a stray click leaves the music alone) and a double-click toggles fullscreen; a tap shows or hides the controls. */}
    <div ref={picture ? renderInto : undefined} data-player-surface tabIndex={-1} role="group" aria-label={title ? `Player: ${title}` : "Player"} className="player-video absolute inset-0 outline-none"
      onPointerDown={event => { tap.current = event.pointerType === "touch" ? shown : null; }}
      onClick={event => {
        if (tap.current !== null) { if (tap.current) { clearTimeout(timer.current); setShown(false); } else wake(); return; }
        if (audioOnly || !active || !player?.playbackId || !transportReady || !pausable) return;
        // A double-click's second click undoes its first, so the double-click only toggles fullscreen.
        clicked.current = event.detail % 2 ? playing : !clicked.current;
        void run({ type: "pause", playbackId: player.playbackId, paused: clicked.current });
      }}
      onDoubleClick={() => { if (tap.current === null && fullscreen.supported && !fullscreen.pending) void fullscreen.toggle(); }}>
    </div>
    {/* The top band shows and hides with the band. Over a video it reads as one board line: the title and subtitle at the
        left, the clock and the end time at the right. Without a video desktop and phones show it for Back and a Remote's
        TV status, and every screen while this device shares, for Stop sharing (docs/live-inputs.md). */}
    <div ref={topBand} data-player-top={shown ? "shown" : "hidden"} inert={!shown} hidden={!osd && !back && !sharing} className={cn("player-top absolute inset-x-0 top-0 z-20 grid pt-6 transition-opacity duration-200 motion-reduce:transition-none", osd && "player-video-controls", !shown && "opacity-0")}>
      {!osd && <div data-player-header className={cn("player-header drag-region window-controls-inset flex min-h-11 items-center gap-3 px-(--gutter)", playerTarget && "max-sm:flex-wrap max-sm:gap-y-0")}>
        {back}
        {playerTarget && <p role="status" title={playerTarget.status} className="min-w-0 truncate bg-background text-sm text-muted-foreground max-sm:order-last max-sm:w-full">{playerTarget.status}</p>}
        {playerTarget && bufferingStatus}
        <LiveSharingStatus className="ml-auto" />
      </div>}
      {/* Two rows, each sizing itself, so a narrow screen gives the title all but the clock. */}
      {osd && <div data-player-heading className="drag-region window-controls-inset grid px-(--gutter)">
        <div className="flex items-baseline justify-between gap-6"><div className="flex min-w-0 items-center gap-1">{back}<h1 title={title} className="min-w-0 line-clamp-2 text-2xl font-semibold tracking-tight break-words">{title}</h1></div><div className="flex shrink-0 items-baseline gap-4"><LiveSharingStatus /><DigitalClock className="text-xl font-light" /></div></div>
        {(byline || ends) && <div className="flex items-baseline gap-6">{byline && <p className="min-w-0 truncate text-sm text-muted-foreground">{byline}</p>}{ends && <p data-player-ends className="ml-auto shrink-0 text-xl font-light">{ends}</p>}</div>}
      </div>}
    </div>
    <div className={cn("player-workspace", playerTarget && "max-sm:top-22!")}>
      <div className="player-main">
      {/* A large Paused reads from the sofa over a picture; Now playing's meta line already says it. */}
      {player?.status === "paused" && !artworkStage && <div data-player-paused role="status" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
        <div className="grid justify-items-center gap-2 bg-background px-6 py-4"><Pause aria-hidden="true" className="size-20 fill-current" /><span className="text-2xl font-medium">Paused</span></div>
      </div>}
      {current && (!picture || (active || ended) && audioOnly) && !status && <div data-player-summary className="player-summary">
        <div data-player-art aria-hidden="true" className="player-art grid min-h-0 min-w-0 items-end justify-items-start overflow-hidden">{artwork || <Music2 className="size-12 text-muted-foreground" />}</div>
        {/* Home's hero, in its order: the title at display size, one muted meta line, then the departures board's line. */}
        <div data-player-audio-copy className="grid min-w-0 gap-2">
          <h1 className="min-w-0 line-clamp-2 text-4xl font-semibold tracking-tight break-words md:text-5xl" title={title}>{title}</h1>
          <p role="status" className="truncate text-sm text-muted-foreground">{meta}</p>
          {ends && <p data-player-ends className="text-3xl font-light tabular-nums md:text-4xl">{ends}</p>}
          {nowPlaying && <p role="status" className="line-clamp-1 text-sm text-muted-foreground">{nowPlaying}</p>}
        </div>
      </div>}
    {current && status && <div data-player-status className={cn("pointer-events-none absolute inset-0 z-10 grid place-items-center px-(--gutter)", !artworkStage && "pb-48")}>
      <div role="status" className="pointer-events-auto grid max-h-full max-w-lg gap-2 overflow-y-auto bg-background p-6">
        <h2 className="text-2xl font-semibold tracking-tight break-words">{status.title}</h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">{status.busy && <Spinner role="presentation" aria-label={undefined} aria-hidden="true" />}{status.detail}</p>
        {(retry || player?.status === "error") && <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!available} onClick={() => void run({ type: "play", entryId: current.id })}>{retry ? "Try now" : "Try again"}</Button>
          <Button variant="ghost" disabled={!available} onClick={skip}>Skip</Button>
          {player?.status === "error" && <Button variant="ghost" onClick={shell.leavePlayer}>{shell.playerBackLabel || "Search"}</Button>}
        </div>}
      </div>
    </div>}
      </div>
      {(artworkStage || queueOpen) && <aside data-player-queue aria-label="Up next" className="player-queue bg-background">
        {queueOpen && current && <div className="flex shrink-0 justify-end pb-2"><Button ref={queueClose} variant="ghost" className="h-11" onClick={closeQueue}><ArrowLeft aria-hidden="true" />Close Up next</Button></div>}
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-4">
          <QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} />
        </div>
      </aside>}
    </div>
    {/* A pointer leaves the keys to the shortcuts: once a click in the band has done its job, focus returns to the
        picture, unless the click opened something. A keyboard's click (detail 0) keeps focus where the keyboard put it. */}
    <div ref={band} hidden={!current} data-player-band={shown ? "shown" : "hidden"} inert={!shown} onClick={event => {
      if (event.detail) requestAnimationFrame(() => { const at = document.activeElement; if (at && band.current?.contains(at) && !at.matches('[aria-expanded="true"]')) surface()?.focus({ preventScroll: true }); });
    }} className={cn("player-band z-20 py-3 transition-opacity duration-200 [view-transition-name:couch-player-band] motion-reduce:transition-none", artworkStage ? "border-t bg-background" : "player-video-controls", !shown && "opacity-0")}>
      {/* Gutter to gutter like the now-playing bar, in its order: transport, timeline, volume, Where it plays, Up next, then settings and fullscreen.
          A timeline takes its own row above (index.css), without the end time or "Live" the top band or Now playing says. Every tool is an icon. */}
      <div className="grid gap-1">
        {!playerTarget && bufferingStatus}
        <div className="player-control-row">
          {state && <PlaybackTimeline state={state} connected={connected} run={run} pageFirst compact />}
          {state && <PlaybackTransport state={state} connected={connected} run={run} pageFirst prominent />}
          <div data-player-tools className="flex shrink-0 items-center">
            {state && <VolumeButton state={state} connected={connected} run={run} className="size-11" />}
            {state && <WhereItPlays state={state} connected={connected} run={run} className="size-11" />}
            <Button ref={queueTrigger} data-panel="queue" variant="ghost" size="icon" className="size-11" aria-label="Up next" title="Up next" aria-expanded={queueOpen} disabled={queueBeside} onClick={() => setQueueOpen(!queueOpen)}><ListMusic aria-hidden="true" /></Button>
            <Button data-panel="settings" variant="ghost" size="icon" className="size-11" aria-label="Playback" title="Playback" aria-pressed={panel === "settings" || panel === "tracks"} onClick={event => openPanel("settings", event.currentTarget)}><Settings aria-hidden="true" /></Button>
            {/* The window can leave fullscreen; the TV's never does. */}
            {!tvPresentation && <Button variant="ghost" size="icon" className="size-11" disabled={!fullscreen.supported || fullscreen.pending} aria-label={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void fullscreen.toggle()}>{fullscreen.fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>}
          </div>
        </div>
      </div>
    </div>
    <Sheet modal={false} open={panel !== null} onOpenChange={open => { if (!open) setPanelState(null); }}>
      <SheetContent side="right" data-player-sheet aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); panelClose.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); panelTrigger.current?.focus(); }}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background px-6 py-4"><SheetTitle className="text-base font-medium">{panel && panelTitles[panel]}</SheetTitle><SheetClose asChild><Button ref={panelClose} variant="ghost" size="icon" aria-label="Close"><X aria-hidden="true" /></Button></SheetClose></SheetHeader>
        <div className="px-6 pt-4 pb-8">
          {panel === "tracks" && <Button variant="ghost" className="-ml-2.5 mb-4 h-11" onClick={() => { if (player?.playbackId) setPanelState({ playbackId: player.playbackId, panel: "settings" }); }}><ArrowLeft aria-hidden="true" />Playback</Button>}
          {panel === "settings" && <div className="grid divide-y border-b">
            {!audioOnly && <Button variant="ghost" className="h-14 justify-start rounded-none px-0" onClick={() => { if (player?.playbackId) setPanelState({ playbackId: player.playbackId, panel: "tracks" }); }}><Captions aria-hidden="true" />Audio & subtitles<ChevronRight aria-hidden="true" className="ml-auto" /></Button>}
            {detailHref && <Button asChild variant="ghost" className="h-14 justify-start rounded-none px-0"><Link to={detailHref} aria-label="Details" onClick={openDetails}><Info aria-hidden="true" />Details<ChevronRight aria-hidden="true" className="ml-auto" /></Link></Button>}
          </div>}
          {panel && player && state?.preferences && <PlaybackSettingsPanel panel={panel} entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}
        </div>
      </SheetContent>
    </Sheet>
  </section>;
}
