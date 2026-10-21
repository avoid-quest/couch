import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { useCouchHotkeys } from "@/useCouchHotkeys";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, Captions, ChevronRight, Info, ListMusic, Maximize, Minimize, Music2, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackTimeline, PlaybackTransport, VolumeButton, playbackCapabilities, useEndTime } from "@/components/PlaybackTransport";
import { DigitalClock } from "@/components/DigitalClock";
import { sourceLabel } from "@/source-label";
import { PlaybackSettingsPanel } from "@/components/PlaybackSettings";
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
  const playback = state?.playbacks?.find(playback => playback.id === state.playback);
  const audioOnly = isAudioOnly(playback, current, player?.tracks);
  // The picture shows on the Playback's picture outputs; every other window shows the artwork (#644 ticket 9).
  const at = playsOn(state);
  const elsewhere = !!at?.elsewhere;
  // An mpv channel shows its picture in mpv's own window, so this one shows the artwork.
  const separate = !!playback?.hostOnly && showsPicture(state);
  const picture = showsPicture(state) && !separate;
  const artworkStage = audioOnly || !picture;
  const canFullscreen = !tvPresentation && fullscreen.supported && !fullscreen.pending && (!artworkStage || fullscreen.fullscreen);
  useCouchHotkeys([{ hotkey: "F", enabled: canFullscreen, action: () => void fullscreen.toggle() }]);
  const queueBeside = useSyncExternalStore(subscribeWide, isWide) && artworkStage;
  const sharing = !!localLiveSourceId;
  // While this device shares, the bands stay up, so the top band's Stop sharing stays on screen.
  const autoHide = connected && playing && !artworkStage && !sharing;
  useBottomBar(band, !!current && shown);
  useEffect(() => { setPanelState(null); }, [active, player?.playbackId]);
  useEffect(() => { if (panel) panelClose.current?.focus(); }, [panel]);
  useEffect(() => { if (queueOpen) queueClose.current?.focus(); }, [queueOpen]);
  const { transportReady, pausable } = playbackCapabilities(state, connected);
  const ends = useEndTime(state);
  // Unattended playback starts on the picture so automatic focus cannot pin the bands open.
  // A TV already driven by keys keeps its transport entry point.
  useEffect(() => {
    if (queueOpen) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement && root.current?.contains(document.activeElement) && !document.activeElement.matches(":disabled")) return;
      if (restoreDetailFocus(location.state.detailFocus)) return;
      (tvPresentation && document.documentElement.hasAttribute("data-keyboard") ? firstTransport() : surface())?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tvPresentation, current?.id, transportReady, location.state.__TSR_key]);
  const retry = state?.radioRetry?.retryAt != null && player?.status === "loading" ? state.radioRetry : null;
  // The controls stay up while the keyboard is in them or on a toast's action, which Back returns to them;
  // on the picture they hide when idle.
  const idle = () => {
    const remoteFocus = tvPresentation && document.documentElement.hasAttribute("data-keyboard")
      && root.current?.contains(document.activeElement) && !document.activeElement?.matches("[data-player-surface]");
    if (!remoteFocus && !root.current?.querySelector(":focus-visible:not([data-player-surface])") && !document.activeElement?.closest("[data-sonner-toaster]")) setShown(false);
  };
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
      if (event.key === "Escape" || tvPresentation && event.key === "BrowserBack") {
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]')) return;
        // Back on a toast's action only leaves it (navigation.ts).
        if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (panel) setPanelState(null);
        else if (queueOpen) closeQueue();
        else if (tvPresentation && shown) {
          clearTimeout(timer.current);
          if (document.activeElement instanceof HTMLElement && root.current?.contains(document.activeElement)) surface()?.focus({ preventScroll: true });
          setShown(false);
        }
        else if (!tvPresentation && event.key === "Escape" && fullscreen.supported && fullscreen.fullscreen) void fullscreen.toggle();
        else shell.leavePlayer();
        return;
      }
      const inPlayer = root.current?.contains(document.activeElement) || document.activeElement === document.body;
      // A TV's first key on the picture enters the controls, even before their initial timeout.
      if (tvPresentation && !panel && (!shown || document.activeElement === surface()) && inPlayer && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) {
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

  const currentProgramme = programme?.playbackId === player?.playbackId ? programme : null;
  const radio = isRadio(current);
  const detailHref = current && !current.liveSourceId ? queueItemLocation(current) : undefined;
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!detailHref || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); detailNavigation.open(detailHref, panel === "settings" ? '.player-page button[aria-label="Playback"]' : undefined);
  };
  // A pointer has no Back key, so desktop and phones lead the top band with Back; the TV's remote has its own.
  const backLabel = `Back to ${playerTarget ? "Remote" : shell.playerBackLabel}`;
  const back = !tvPresentation && <Button variant="ghost" size="icon-lg" className="-ml-2.5 size-11 shrink-0" aria-label={backLabel} title={backLabel} onClick={shell.leavePlayer}><ArrowLeft aria-hidden="true" /></Button>;
  const artwork = currentProgramme?.artworkUrl ? <MediaArtwork thumbnail={currentProgramme.artworkUrl} title={currentProgramme.title} /> : current?.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : undefined;
  const openPanel = (value: Panel, trigger: HTMLButtonElement) => { if (!player?.playbackId) return; panelTrigger.current = trigger; setPanelState({ playbackId: player.playbackId, panel: value }); setShown(true); };
  const source = current ? sourceLabel(current.source) : "";
  const title = currentProgramme?.title || current?.title;
  // As in Home's hero: a show's station, else the subtitle (series, episode or channel), else the source (a station's is its stream host).
  const byline = !current || currentProgramme || current.creator?.title === current.subtitle || current.collection?.title === current.subtitle ? "" : current.subtitle || (radio ? "Radio" : source);
  const osd = !!current && !artworkStage;
  const where = elsewhere && at ? `on ${at.name}${at.more ? ` +${at.more}` : ""}` : separate && ["playing", "paused"].includes(player?.status ?? "") ? "in a separate window" : null;
  const meta = [byline, where].filter(Boolean).join(", ");
  const nowPlaying = player?.nowPlaying && [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" — ");
  const status = playbackStatus(state, connected, now);
  const context = current && <MediaContext creator={current.creator} collection={current.collection} radio={radio && current.source.startsWith("radio:") ? { id: current.source.slice(6), title: current.title } : undefined} />;
  const linkedTitle = detailHref ? <ContentLink href={detailHref} className="no-underline hover:underline">{title}</ContentLink> : title;

  // A mouse leaving the window shows the controls; a lifted finger "leaves" too, but must let them hide.
  return <section ref={root} className={cn("player-page fixed inset-0 overflow-hidden bg-background", !shown && "cursor-none [&_*]:cursor-none")} data-page="Now" data-artwork-stage={artworkStage || undefined} data-queue-open={queueOpen || undefined} data-player-idle={!current || undefined} aria-label="Player" onPointerMove={wake} onPointerLeave={event => { if (event.pointerType === "touch") return; setShown(true); clearTimeout(timer.current); }} onFocus={wake} onBlur={wake}>
    {/* The picture is the player's surface. It takes focus when the player opens, and keys on it are shortcuts
        (useCouchHotkeys counts a tabindex of -1 as background). As on YouTube, a click on a video plays or pauses (on
        audio, a stray click leaves the music alone) and a double-click toggles fullscreen; a tap shows or hides the controls. */}
    <div ref={picture ? renderInto : undefined} data-player-surface tabIndex={-1} role="group" aria-label={title ? `Player: ${title}` : "Player"} className="player-video absolute inset-0 outline-none"
      onPointerDown={event => { tap.current = event.pointerType === "touch" ? shown : null; }}
      onClick={event => {
        if (tap.current !== null) { if (tap.current && autoHide) { clearTimeout(timer.current); setShown(false); } else wake(); return; }
        if (audioOnly || !active || !player?.playbackId || !transportReady || !pausable) return;
        // A double-click's second click undoes its first, so the double-click only toggles fullscreen.
        clicked.current = event.detail % 2 ? playing : !clicked.current;
        void run({ type: "pause", playbackId: player.playbackId, paused: clicked.current });
      }}
      onDoubleClick={() => { if (tap.current === null && canFullscreen) void fullscreen.toggle(); }}>
    </div>
    {/* The top band shows and hides with the band. Over a video it reads as one board line: the title and subtitle at the
        left, the clock and the end time at the right. Without a video desktop and phones show it for Back and a Remote's
        TV status, and every screen while this device shares, for Stop sharing (docs/live-inputs.md). */}
    <div ref={topBand} data-player-top={shown ? "shown" : "hidden"} inert={!shown} hidden={!osd && !back && !sharing} className={cn("player-top absolute inset-x-0 top-0 z-20 grid pt-6 transition-opacity duration-200 motion-reduce:transition-none", osd && "player-video-controls", !shown && "opacity-0")}>
      {!osd && <div data-player-header className={cn("player-header drag-region window-controls-inset flex min-h-11 items-center gap-3 px-(--gutter)", playerTarget && "max-sm:flex-wrap max-sm:gap-y-0")}>
        {back}
        {playerTarget && <p role="status" title={playerTarget.status} className="min-w-0 truncate bg-background text-sm text-muted-foreground max-sm:order-last max-sm:w-full">{playerTarget.status}</p>}

        <LiveSharingStatus className="ml-auto" />
      </div>}
      {/* Two rows, each sizing itself, so a narrow screen gives the title all but the clock. */}
      {osd && <div data-player-heading className="drag-region window-controls-inset grid px-(--gutter)">
        <div className="flex items-baseline justify-between gap-6"><div className="flex min-w-0 items-center gap-1">{back}<h1 title={title} className="min-w-0 line-clamp-2 text-2xl font-semibold tracking-tight break-words">{linkedTitle}</h1></div>{(sharing || tvPresentation) && <div className="flex shrink-0 items-baseline gap-4"><LiveSharingStatus />{tvPresentation && <DigitalClock className="text-sm text-muted-foreground tabular-nums" />}</div>}</div>
        {(byline || ends) && <div className="flex items-baseline gap-6">{byline && <p className="min-w-0 truncate text-sm text-muted-foreground">{byline}</p>}{ends && <p data-player-ends className="ml-auto shrink-0 text-sm text-muted-foreground">{ends}</p>}</div>}
        {context}
      </div>}
    </div>
    <div className={cn("player-workspace", playerTarget && "max-sm:top-22!")}>
      <div className="player-main">
      {current && artworkStage && <div data-player-summary className="player-summary">
        <div data-player-art aria-hidden="true" className="player-art grid min-h-0 min-w-0 items-end justify-items-start overflow-hidden">{artwork || <Music2 className="size-12 text-muted-foreground" />}</div>
        {/* The media title leads; related content and secondary metadata follow. */}
        <div data-player-audio-copy className="grid min-w-0 gap-2">
          <h1 className="min-w-0 line-clamp-2 text-4xl font-semibold tracking-tight break-words md:text-5xl" title={title}>{linkedTitle}</h1>
          {context}
          {meta && <p className="truncate text-sm text-muted-foreground">{meta}</p>}
          {ends && <p data-player-ends className="text-sm text-muted-foreground tabular-nums">{ends}</p>}
          {nowPlaying && <p role="status" className="line-clamp-1 text-sm text-muted-foreground">{nowPlaying}</p>}
        </div>
      </div>}
      </div>
      {/* Opened over the player it closes from its heading row; what plays now heads the list only where the player's
          own title is off screen: a phone's Up next over Now playing. Beside it, or over a video's top band, the
          title is already there. */}
      {(artworkStage || queueOpen) && <aside data-player-queue aria-label="Up next" className="player-queue bg-background">
        {/* Its controls pull back past the text (Close, Save as list, Played), so the scroller pads for them, with a
            little to spare: a vertical scroller with a stray pixel of overflow shifts its text when one takes focus. */}
        <div className="-mx-3 min-h-0 overflow-y-auto overscroll-contain px-3 pb-4">
          <QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} current={artworkStage && !queueBeside} onClose={queueOpen ? closeQueue : undefined} closeRef={queueClose} />
        </div>
      </aside>}
    </div>
    {/* A pointer leaves the keys to the shortcuts: once a click in the band has done its job, focus returns to the
        picture, unless the click opened something. A keyboard's click (detail 0) keeps focus where the keyboard put it. */}
    <div ref={band} hidden={!current} data-player-band={shown ? "shown" : "hidden"} inert={!shown} onClick={event => {
      if (event.detail) requestAnimationFrame(() => { const at = document.activeElement; if (at && band.current?.contains(at) && !at.matches('[aria-expanded="true"]')) surface()?.focus({ preventScroll: true }); });
    }} className={cn("player-band z-20 py-3 transition-opacity duration-200 [view-transition-name:couch-player-band] motion-reduce:transition-none", artworkStage ? "border-t bg-background" : "player-video-controls", !shown && "opacity-0")}>
      {/* One line in the now-playing bar's order, laid out around the transport (index.css): the timeline above, then
          Volume and Where it plays at the left, Play/Pause, Stop and Next in the middle, Up next, Playback and
          fullscreen at the right (including phones, where group gaps collapse). Up next shows only where it has something to open, and fullscreen only over a
          picture. Every tool is an icon. */}
      <div className="grid gap-1">
        {current && <div data-player-status data-player-paused={player?.status === "paused" || undefined} className="flex min-h-10 items-start gap-2 pb-2 text-sm">
          {status.busy && <Spinner className="mt-0.5 shrink-0" role="presentation" aria-hidden="true" />}
          <div className="min-w-0 flex-1"><p role="status" className="font-medium">{status.label}</p>{status.detail && <p aria-live={player?.status === "loading" && state?.radioRetry ? "off" : "polite"} className="max-w-prose break-words text-muted-foreground">{status.detail}</p>}</div>
          {connected && player?.status === "unavailable" && state?.playback && <WhereItPlays state={state} connected={connected} run={run} label="Choose device" />}
        </div>}
        {/* Every control is a ghost icon (icon-lg) at the band's 44px target, the now-playing bar's too; those at the
            band's ends pull back (-2.5) so their glyphs line up with the timeline's times, as Back does with the title. */}
        <div className="grid gap-2">
          {state && <PlaybackTimeline state={state} connected={connected} run={run} pageFirst compact />}
          <div className="player-controls-scroll" onFocusCapture={event => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}>
            <div className="player-control-row [&_[data-size=icon-lg]]:size-11">
              {state && <PlaybackTransport state={state} connected={connected} run={run} pageFirst className="player-transport" />}
              <div data-player-tools="sound" className="-ml-2.5 flex shrink-0 items-center gap-0.5">
                {state && <VolumeButton state={state} connected={connected} run={run} />}
                {state && <WhereItPlays state={state} connected={connected} run={run} />}
              </div>
              <div data-player-tools="more" className="-mr-2.5 flex shrink-0 items-center gap-0.5">
                {!queueBeside && <Button ref={queueTrigger} data-panel="queue" variant="ghost" size="icon-lg" aria-label="Up next" title="Up next" aria-expanded={queueOpen} onClick={() => setQueueOpen(!queueOpen)}><ListMusic aria-hidden="true" /></Button>}
                <Button data-panel="settings" variant="ghost" size="icon-lg" aria-label="Playback" title="Playback" aria-expanded={panel !== null} onClick={event => openPanel("settings", event.currentTarget)}><Settings aria-hidden="true" /></Button>
                {/* The window can leave fullscreen; the TV's never does, and artwork has nothing to fill. */}
                {!tvPresentation && (!artworkStage || fullscreen.fullscreen) && <Button variant="ghost" size="icon-lg" disabled={!canFullscreen} aria-label={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void fullscreen.toggle()}>{fullscreen.fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <Sheet modal={false} open={panel !== null} onOpenChange={open => { if (!open) setPanelState(null); }}>
      <SheetContent side="right" data-player-sheet aria-describedby={undefined} className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-lg" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); panelClose.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); panelTrigger.current?.focus(); }}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background px-6 py-4"><SheetTitle className="text-base font-medium">{panel && panelTitles[panel]}</SheetTitle><SheetClose asChild><Button ref={panelClose} variant="ghost" size="icon-lg" className="-mr-2.5 size-11" aria-label="Close" title="Close"><X aria-hidden="true" /></Button></SheetClose></SheetHeader>
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
