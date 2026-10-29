import { Description } from "@/components/DetailHeader";
import { livePlayback, playbackControls } from "@/session/playback-controls";
import { usePictureMapping } from "@/session/picture-mapping";
import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { useCouchHotkeys } from "@/useCouchHotkeys";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, ChevronRight, Info, Maximize, Minimize, Music2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MediaArtwork, useArtRatio } from "@/components/MediaArtwork";
import { mediaSubtitle } from "@/components/MediaContext";
import { PlaybackTimeline, PlaybackTransport, VolumeButton, playbackCapabilities, toolPanel, useEndTime } from "@/components/PlaybackTransport";
import { DigitalClock } from "@/components/DigitalClock";
import { sourceLabel } from "@/source-label";
import { PlaybackMenu, playbackMenuRow } from "@/components/PlaybackSettings";
import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import type { Action } from "../../../shared/protocol";
import { useBottomBar } from "@/sections/shell/NowPlayingBar";
import { QueuePanel, UpNextButton } from "./QueuePanel";
import { usePlayerFullscreen } from "./usePlayerFullscreen";
import { isAudioOnly } from "./player-presentation";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { renderInto } from "@/session/renderer";
import { playsOn, showsPicture } from "@/session/device-id";
import { PlaysOnLine, WhereItPlays } from "@/sections/shell/Outputs";
import { LiveSharingStatus } from "@/sections/shell/LiveSharingStatus";
import { cn } from "@/lib/utils";
import { roomStyle, useArtworkLight } from "@/components/AmbientLight";
import { titleFit, titleLength } from "@/components/Stage";
import { Link, useLocation } from "@tanstack/react-router";
import { RadioNext, RadioProgress, RadioStationLine } from "@/components/RadioSchedule";
import { RadioRecognition } from "@/components/RadioRecognition";
import { radioFavoritesListQuery, radioProgrammesQuery, radioStationQuery } from "@/api/radio";
import { useQuery } from "@tanstack/react-query";
import { isRadio, radioHost, radioShowLabels, radioNext, type RadioGuide } from "../../../shared/radio";
import { useRadioClock } from "@/radio-clock";
import { useStationShow } from "@/sections/home/on-air";
import { queueItemLocation, restoreDetailFocus, useDetailNavigation } from "@/detail-navigation";

type Panel = "settings";
// From 960px audio's Up next opens over the room beside the title (index.css), so the queue doesn't repeat what plays.
const wideQuery = "(min-width: 960px)";
const subscribeWide = (onChange: () => void) => { const media = window.matchMedia(wideQuery); media.addEventListener("change", onChange); return () => media.removeEventListener("change", onChange); };
const isWide = () => window.matchMedia(wideQuery).matches;
// The band's controls that open something to take focus (Popovers, Up next); Info shows its part in place.
const opened = '[aria-expanded="true"]:not([data-info-toggle])';

export function PlayerPage({ queueOpen: requestedQueueOpen, onQueueOpenChange }: { queueOpen?: boolean; onQueueOpenChange?: (open: boolean) => void } = {}) {
  const fullscreen = usePlayerFullscreen();
  const shell = useShell();
  const { credentials, available, active, current } = shell;
  const currentProgramme = useStationShow();
  const { state, connected, run, seekBy, nativeHost, tvPresentation, videoQualityPreference, playerTarget, localLiveSourceId } = useSessionGate();
  const detailNavigation = useDetailNavigation();
  const location = useLocation();
  const [panelState, setPanelState] = useState<{ playbackId: string; panel: Panel } | null>(null);
  const [shown, setShown] = useState(true);
  const [localQueueOpen, setLocalQueueOpen] = useState(false);
  const queueOpen = playbackControls(state).queue && (requestedQueueOpen ?? localQueueOpen);
  const setQueueOpen = useCallback((open: boolean) => { if (onQueueOpenChange) onQueueOpenChange(open); else setLocalQueueOpen(open); }, [onQueueOpenChange]);
  const queueTrigger = useRef<HTMLButtonElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const queueClose = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLElement>(null);
  const firstTransport = () => root.current?.querySelector<HTMLElement>('[aria-label="Playback controls"] button:not(:disabled)');
  const surface = () => root.current?.querySelector<HTMLElement>("[data-player-surface]");
  // What a touch found when it landed (the controls shown or not), so its tap can show or hide them; null for a mouse.
  const tap = useRef<boolean | null>(null);
  // What the picture's last click asked for, so a double-click's second click can undo it.
  const clicked = useRef(false);
  // The band's control a click opened (a Popover, Up next), whose return of focus hands it to the picture.
  const clickOpened = useRef<Element | null>(null);
  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    // Up next is still expanded until the route commits, so one a click opened hands focus to the picture here.
    if (clickOpened.current && clickOpened.current === queueTrigger.current) { clickOpened.current = null; surface()?.focus({ preventScroll: true }); return; }
    (queueTrigger.current?.getClientRects().length ? queueTrigger.current : root.current?.querySelector<HTMLButtonElement>('button[data-play-button]:not(:disabled), button[data-primary]:not(:disabled)'))?.focus();
  }, [setQueueOpen]);
  const band = useRef<HTMLDivElement>(null);
  // Up next opened over a video (index.css) and toasts (sonner.tsx) start below the top band, so it publishes its height.
  const topBand = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(([entry]) => root.setProperty("--player-top", `${Math.round(entry!.borderBoxSize[0]!.blockSize)}px`));
    observer.observe(element, { box: "border-box" });
    return () => { observer.disconnect(); root.removeProperty("--player-top"); };
  }, []);
  const [now, setNow] = useState(Date.now());
  const radioGuides = useQuery({ ...radioProgrammesQuery(credentials), enabled: connected && isRadio(current), refetchInterval: 60_000 });
  const radioFavorites = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected && isRadio(current) && !current?.source.startsWith("radio:") });
  const stationId = current?.source.startsWith("radio:") ? current.source.slice(6) : radioFavorites.data?.favorites.find(station => station.url === current?.source)?.id ?? "";
  const stationDetails = useQuery({ ...radioStationQuery(credentials, stationId), enabled: connected && !!stationId });
  const player = state?.player;
  const panel = current && active && panelState?.playbackId === player?.playbackId ? panelState?.panel ?? null : null;
  const playing = player?.status === "playing";
  const pictureUnmapped = usePictureMapping(player?.playbackId) || player?.timeline?.mapping === "unavailable";
  const playback = state?.playbacks?.find(playback => playback.id === state.playback);
  const audioOnly = isAudioOnly(playback, current, player?.tracks);
  // The picture shows on the Playback's picture outputs; every other window shows the artwork (#644 ticket 9).
  const at = playsOn(state);
  // An mpv channel shows its picture in mpv's own window, so this one shows the artwork.
  const separate = !!playback?.hostOnly && showsPicture(state);
  const picture = showsPicture(state) && !separate;
  const showPicture = useCallback((element: HTMLDivElement | null) => picture ? renderInto(element) : undefined, [picture]);
  const artworkStage = audioOnly || !picture;
  const canFullscreen = !tvPresentation && fullscreen.supported && !fullscreen.pending;
  useCouchHotkeys([{ hotkey: "F", enabled: canFullscreen, action: () => void fullscreen.toggle() }]);
  const queueBeside = useSyncExternalStore(subscribeWide, isWide) && artworkStage;
  // Now playing is calm: artwork, title and where it comes from. Info shows the rest in place (a show's genres and host,
  // its broadcast, synopsis and the next show; an item's trail and end). It belongs to what this Playback shows, so
  // another entry or Playback starts calm, while a new programme on the same station keeps it open.
  const infoKey = current ? `${state?.playback}:${current.id}:${current.source}` : null;
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const info = artworkStage && !!infoKey && infoFor === infoKey;
  useEffect(() => { setInfoFor(null); }, [infoKey]);
  const infoToggle = useRef<HTMLButtonElement>(null);
  const [recognitionControls, setRecognitionControls] = useState<HTMLDivElement | null>(null);
  const infoRegion = useRef<HTMLDivElement>(null);
  // What Info hides takes its focus with it (a synopsis' More, the trail's links): Info's button, else the picture, takes it.
  const wasInfo = useRef(info);
  useLayoutEffect(() => {
    const was = wasInfo.current;
    wasInfo.current = info;
    if (!was || info || document.activeElement !== document.body && !infoRegion.current?.contains(document.activeElement)) return;
    const toggle = infoToggle.current;
    (toggle?.getClientRects().length && !toggle.closest("[inert]") ? toggle : surface())?.focus({ preventScroll: true });
  }, [info]);
  // Info pressed away from the player opens it with Info shown (AppShell); the request is that history entry's.
  const infoRequest = location.state.playerInfo ? location.state.__TSR_key : undefined;
  const servedInfo = useRef<string>(undefined);
  useEffect(() => {
    if (!infoRequest || !infoKey || servedInfo.current === infoRequest) return;
    servedInfo.current = infoRequest;
    setInfoFor(infoKey);
  }, [infoRequest, infoKey]);
  const sharing = !!localLiveSourceId;
  // While this device shares, the bands stay up, so the top band's Stop sharing stays on screen.
  const autoHide = connected && playing && !artworkStage && !sharing;
  useBottomBar(band, !!current && shown);
  useEffect(() => { setPanelState(null); }, [active, player?.playbackId]);
  useEffect(() => { if (queueOpen) queueClose.current?.focus(); }, [queueOpen]);
  const { transportReady, pausable } = playbackCapabilities(state, connected);
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
  // The controls stay up while the keyboard is in them, on a toast's action, which Back returns to them, or while one
  // of their Popovers or Sheets is open (Volume, Where it plays), as YouTube's stay up under an open menu; on the
  // picture they hide when idle.
  const idle = () => {
    const remoteFocus = tvPresentation && document.documentElement.hasAttribute("data-keyboard")
      && root.current?.contains(document.activeElement) && !document.activeElement?.matches("[data-player-surface]");
    const opened = document.querySelector('[data-slot="popover-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"]');
    if (remoteFocus || opened || root.current?.querySelector(":focus-visible:not([data-player-surface])") || document.activeElement?.closest("[data-sonner-toaster]")) return;
    // Hidden bands are inert; a control a click left focused hands its keys to the picture rather than to the page.
    if (!tvPresentation && document.activeElement?.closest("[data-player-band], [data-player-top]")) surface()?.focus({ preventScroll: true });
    setShown(false);
  };
  // Back on a TV, and its Info over a picture, hide the controls, handing their focus to the picture.
  const hide = () => {
    clearTimeout(timer.current);
    if (document.activeElement instanceof HTMLElement && root.current?.contains(document.activeElement)) surface()?.focus({ preventScroll: true });
    setShown(false);
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
        // Let an active timeline edit cancel before Back hides or leaves the player.
        if (event.target instanceof Element && event.target.closest('[data-playback-seek][data-seeking]')) return;
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]')) return;
        // Back on a toast's action only leaves it (navigation.ts).
        if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (panel) setPanelState(null);
        else if (queueOpen) closeQueue();
        else if (info) setInfoFor(null);
        else if (tvPresentation && shown) hide();
        else if (!tvPresentation && event.key === "Escape" && fullscreen.supported && fullscreen.fullscreen) void fullscreen.toggle();
        else shell.leavePlayer();
        return;
      }
      const inPlayer = root.current?.contains(document.activeElement) || document.activeElement === document.body;
      // A TV's first key on the picture enters the controls, even before their initial timeout.
      if (tvPresentation && !panel && (!shown || document.activeElement === surface()) && inPlayer && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); wake();
        if (playbackControls(state).seek && (event.key === "ArrowLeft" || event.key === "ArrowRight")) void seekBy(event.key === "ArrowLeft" ? -10 : 10);
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
  }, [tvPresentation, shown, panel, queueOpen, info, closeQueue, playing, autoHide, transportReady, pausable, player?.playbackId, run, seekBy, shell.leavePlayer, fullscreen]);
  // Info, from the I key, its button or a remote's Info key (dispatchTvRoute), over Up next shows Info. Over a picture,
  // whose top line already names what plays, a remote's Info shows or hides the controls, as a TV's info banner.
  const toggleInfo = () => {
    if (!artworkStage) { if (shown) hide(); else wake(); return; }
    const open = queueOpen || !info;
    if (queueOpen) closeQueue();
    setInfoFor(open ? infoKey : null);
  };
  useCouchHotkeys([{ hotkey: "I", enabled: artworkStage && !!current, action: toggleInfo }]);
  useEffect(() => {
    window.addEventListener("couch-info", toggleInfo);
    return () => window.removeEventListener("couch-info", toggleInfo);
  });
  // Beside the artwork the room takes its colours, and the artwork stands at its own shape (docs/design.md, Room).
  const roomArt = currentProgramme?.artworkUrl || current?.thumbnail;
  const roomLight = useArtworkLight(artworkStage ? roomArt : undefined);
  const [artFrame, artRatio] = useArtRatio(roomArt, 1);
  // An explicitly opened queue remains available after playback stops.
  if (!current && !queueOpen && !playerTarget) return null;

  const radio = isRadio(current);
  const detailHref = current && !current.liveSourceId ? queueItemLocation(current) : undefined;
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!detailHref || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Back returns the TV and a keyboard to the gear they opened Details from; a pointer's Back returns to the picture.
    event.preventDefault(); detailNavigation.open(detailHref, panel === "settings" && (tvPresentation || !event.detail) ? '.player-page button[aria-label="Playback"]' : undefined);
  };
  // A pointer has no Back key, so desktop and phones lead the top line with Back; the TV's remote has its own.
  const backLabel = `Back to ${playerTarget ? "Remote" : shell.playerBackLabel}`;
  const back = !tvPresentation && <Button variant="ghost" size="icon-lg" className="-ml-2.5 size-(--player-target) shrink-0" aria-label={backLabel} title={backLabel} onClick={shell.leavePlayer}><ArrowLeft aria-hidden="true" /></Button>;
  const artwork = currentProgramme?.artworkUrl ? <MediaArtwork priority thumbnail={currentProgramme.artworkUrl} title={currentProgramme.title} /> : current?.thumbnail ? <MediaArtwork priority thumbnail={current.thumbnail} title={current.title} /> : undefined;
  const setPanel = (value: Panel | null) => { if (!value) setPanelState(null); else if (player?.playbackId) { setPanelState({ playbackId: player.playbackId, panel: value }); setShown(true); } };
  const source = current ? sourceLabel(current.source) : "";
  const title = currentProgramme?.title || current?.title;
  // As in Home's hero: a show's genre and host (its station is the link above), else the subtitle (series, episode or
  // channel), else the source (a station's is its stream host). A subtitle the relationship links already name isn't
  // said twice.
  // A station's tags follow its link under the show, or stand in for the byline while the station is the title.
  const stationTags = radio ? stationDetails.data?.tags ?? [] : [];
  const byline = !current ? "" : currentProgramme ? [...radioShowLabels(currentProgramme), radioHost(currentProgramme)].filter(Boolean).join(", ") : stationTags.length ? stationTags.join(", ") : current.subtitle && !mediaSubtitle(current) ? "" : current.subtitle || (radio ? "Radio" : source);
  const osd = !!current && !artworkStage;
  const separateWindow = separate && ["playing", "paused"].includes(player?.status ?? "");
  const nowPlaying = player?.nowPlaying && [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" — ");
  const status = playbackStatus(state, connected, now);
  // A station's link names it under its show; without a show the title is the station, and already opens it. The
  // collections holding what plays are its trail, above the title as on a Stage.
  const context = current && <MediaContext creator={current.creator} radio={radio && currentProgramme && current.source.startsWith("radio:") ? { id: current.source.slice(6), title: current.title } : undefined} />;
  // A station's tags wait for Info; its link stays the same element either way, so focus on it survives Info.
  const copyContext = currentProgramme && stationTags.length ? <RadioStationLine station={context} tags={info ? stationTags : []} /> : context;
  const trail = current && <ContentBreadcrumb player collection={current.collection} className="[&_[data-slot=breadcrumb-list]]:text-base" />;
  const linkedTitle = detailHref ? <ContentLink href={detailHref} className="no-underline hover:underline">{title}</ContentLink> : title;
  // Up next over a picture grows from its button, as the band's Popovers do; it ends at the tools' edge as they do.
  const queueOrigin = queueOpen ? `calc(100% - ${(queueTrigger.current?.offsetWidth ?? 0) / 2 - (toolPanel(queueTrigger.current).alignOffset ?? 0)}px) 100%` : undefined;
  const settings = player && state?.preferences && playbackControls(state).programme ? { entry: current, player, ready: transportReady, connected, credentials, preferences: state.preferences, profile: state.activeProfile, onCommand: run, controls: state.controls } : null;
  // Over a picture the status is the picture's (a spinner centred on it, as YouTube's and Apple's HIG; a problem as a
  // short centred line with its one remedy); beside artwork it follows the title. Plain loading says nothing else.
  const remedy = connected && player?.status === "unavailable" && state?.playback ? <WhereItPlays state={state} connected={connected} run={run} label="Choose device" className="pointer-events-auto" />
    : player?.status === "error" && current && playbackControls(state).programme ? <Button variant="secondary" className="pointer-events-auto" disabled={!connected} onClick={() => void run({ type: "play", entryId: current.id })}>Try again</Button> : null;
  const statusView = current && !livePlayback(state) && !status.quiet && <div data-player-status className={osd ? "player-status" : "flex items-start gap-2 text-sm"}>
    {status.busy && <Spinner className={osd ? "size-8" : "mt-0.5 shrink-0"} role="presentation" aria-hidden="true" />}
    <div className={cn("min-w-0", osd && status.busy && !status.detail && "sr-only")}><p role="status" className="font-medium">{status.label}</p>{status.detail && <p aria-live={player?.status === "loading" && state?.radioRetry ? "off" : "polite"} className="max-w-prose break-words text-muted-foreground">{status.detail}</p>}</div>
    {remedy}
  </div>;

  // A mouse leaving the window shows the controls; a lifted finger "leaves" too, but must let them hide.
  return <section ref={root} style={artworkStage ? { ...roomStyle(roomLight), "--art-ratio": artRatio } as CSSProperties : undefined} className={cn("player-page fixed inset-0 isolate overflow-hidden bg-background", !shown && "cursor-none [&_*]:cursor-none")} data-page="Now" data-osd={osd || undefined} data-artwork-stage={artworkStage || undefined} data-info={info || undefined} data-queue-open={queueOpen || undefined} data-player-idle={!current || undefined} aria-label="Player" onPointerMove={wake} onPointerLeave={event => { if (event.pointerType === "touch") return; setShown(true); clearTimeout(timer.current); }} onFocus={wake} onBlur={wake}>
    {/* The picture is the player's surface. It fills the window and never moves or resizes: every panel lies over it. It
        takes focus when the player opens, and keys on it are shortcuts (useCouchHotkeys counts a tabindex of -1 as
        background). As on YouTube, a click on a video plays or pauses (on audio, a stray click leaves the music alone),
        a click while Up next is open only closes it, and a double-click toggles fullscreen; a tap shows or hides the controls. */}
    {/* Video keeps black letterbox bars in every view. Artwork stands in its room. */}
    {current && artworkStage && <div aria-hidden="true" className="room" />}
    <div ref={showPicture} data-player-surface tabIndex={-1} role="group" aria-label={title ? `Player: ${title}` : "Player"} className="player-video absolute inset-0 outline-none"
      onPointerDown={event => { tap.current = event.pointerType === "touch" ? shown : null; }}
      onClick={event => {
        if (queueOpen && (osd || queueBeside)) { closeQueue(); return; }
        if (tap.current !== null) { if (tap.current && autoHide) { clearTimeout(timer.current); setShown(false); } else wake(); return; }
        if (audioOnly || !active || !player?.playbackId || !transportReady || !pausable) return;
        // A double-click's second click undoes its first, so the double-click only toggles fullscreen.
        clicked.current = event.detail % 2 ? playing : !clicked.current;
        void run({ type: "pause", playbackId: player.playbackId, paused: clicked.current });
      }}
      onDoubleClick={() => { if (tap.current === null && canFullscreen) void fullscreen.toggle(); }}>
    </div>
    {osd && statusView}
    {pictureUnmapped && <p role="status" className="absolute left-(--gutter) top-20 z-20 max-w-prose text-sm text-muted-foreground">This browser cannot align this picture with the shared sound. Try another browser or device.</p>}
    {/* The top line shows and hides with the band. Over a video it is one line, as in YouTube's and Netflix's fullscreen:
        Back, the title (opening Details) with its relationship links under it, and at the right the end time and, on the
        TV, the clock. Beside artwork Info sits at the top right, with Back and a Remote's TV status on desktop and
        phones, and Stop sharing while this device shares (docs/live-inputs.md). */}
    <div ref={topBand} data-player-top={shown ? "shown" : "hidden"} inert={!shown} hidden={!osd && !back && !sharing && !(current && artworkStage)} className={cn("player-top absolute inset-x-0 top-0 z-20 grid pt-4 transition-opacity duration-200 motion-reduce:transition-none", osd && "player-video-controls", !shown && "opacity-0")}>
      {!osd && <div data-player-header className={cn("player-header drag-region window-controls-inset flex min-h-11 items-center gap-3 px-(--gutter)", playerTarget && "max-sm:flex-wrap max-sm:gap-y-0")}>
        {back}
        {playerTarget && <p role="status" title={playerTarget.status} className="min-w-0 truncate bg-background text-sm text-muted-foreground max-sm:order-last max-sm:w-full">{playerTarget.status}</p>}

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <LiveSharingStatus />
          <div ref={setRecognitionControls} className="empty:hidden" />
          {current && artworkStage && <Button ref={infoToggle} data-info-toggle variant="ghost" size="icon-lg" className="-mr-2.5 size-(--player-target) shrink-0" aria-label="Info" title="Info" aria-expanded={info} aria-controls="player-info" onClick={event => { toggleInfo(); if (event.detail) surface()?.focus({ preventScroll: true }); }}><Info aria-hidden="true" /></Button>}
        </div>
      </div>}
      {osd && <div data-player-heading className={cn("drag-region window-controls-inset grid items-center gap-x-3 px-(--gutter)", back ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]")}>
        {trail && <div className={cn("min-w-0", back ? "col-start-2 col-end-4" : "col-span-full")}>{trail}</div>}
        {back && <div className="row-start-2">{back}</div>}
        <h1 title={title} className="row-start-2 min-w-0 line-clamp-2 text-2xl leading-tight font-semibold tracking-[-.02em] break-words md:text-3xl">{linkedTitle}</h1>
        <div className="row-start-2 flex shrink-0 items-baseline gap-4 text-base text-muted-foreground tabular-nums">{sharing && <LiveSharingStatus />}{!radio && <PlayerEndTime state={state} />}{tvPresentation && <DigitalClock />}</div>
        {(byline || context) && <div className={cn("flex min-w-0 items-baseline gap-x-3 text-base text-muted-foreground [&_[data-media-context]]:text-base", back ? "col-start-2 col-end-4" : "col-span-full")}>{byline && <p className="min-w-0 truncate">{byline}</p>}{context}</div>}
      </div>}
    </div>
    <div className={cn("player-workspace", playerTarget && "max-sm:top-22!")}>
      <div className="player-main">
      {current && artworkStage && <div data-player-summary className="player-summary">
        <div ref={artFrame} data-player-art aria-hidden="true" className="player-art">{artwork || <Music2 className="size-12 text-muted-foreground" />}</div>
        {/* The media title leads, then where it comes from; Info adds the rest under them in place. Then what's wrong, if anything. */}
        <div data-player-audio-copy className="grid min-w-0 gap-3 [&_[data-media-context]]:text-base">
          {info && trail}
          {/* Set whole in the display face, its size and width by its length, as the Stage's title. */}
          {title && <h1 data-length={titleLength(title)} style={titleFit(title)} className="display-title min-w-0 text-balance">{linkedTitle}</h1>}
          {/* Where it plays leads the line under the title, as in the now-playing bar. */}
          <PlaysOnLine at={at}>{copyContext}</PlaysOnLine>
          {separateWindow && <p className="text-sm text-muted-foreground">In a separate window</p>}
          {radio && stationId && <RadioRecognition key={JSON.stringify([credentials.origin, credentials.token, state?.playback, player?.playbackId, current.id, stationId])} credentials={credentials} stationId={stationId} connected={connected} controls={recognitionControls} />}
          <div ref={infoRegion} id="player-info" hidden={!info} className="grid gap-3 duration-200 motion-safe:animate-in motion-safe:fade-in-0">
            {byline && <p className="text-sm text-pretty text-muted-foreground">{byline}</p>}
            {radio && <><RadioProgress show={currentProgramme} /><Description text={currentProgramme?.description} /><PlayerNextProgramme guide={stationId ? radioGuides.data?.[stationId] : undefined} /></>}
            {!radio && <PlayerEndTime state={state} className="text-sm text-muted-foreground tabular-nums" />}
          </div>
          {nowPlaying && <p role="status" className="text-sm text-pretty text-muted-foreground">{nowPlaying}</p>}
          {statusView}
        </div>
      </div>}
      </div>
      {/* Up next is summoned from its button: over a picture, and over the room beside artwork, a panel at the right above
          the band, as Netflix's episodes panel; on phones it takes the artwork's place. It closes from its heading row,
          and what plays now heads the list only where the player's own title is off screen (a phone's Up next). */}
      {queueOpen && <aside data-player-queue aria-label="Up next" className={cn("player-queue", (osd || queueBeside) && "duration-150 ease-out motion-safe:animate-in fade-in-0 zoom-in-90")} style={osd || queueBeside ? { transformOrigin: queueOrigin } : undefined}>
        <QueuePanel state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} defaultQuality={videoQualityPreference.quality} run={run} current={artworkStage && !queueBeside} onClose={queueOpen ? closeQueue : undefined} closeRef={queueClose} />
      </aside>}
    </div>
    {osd && state && !queueOpen && !panel && <NextUp state={state} run={run} />}
    {/* A pointer leaves the keys to the shortcuts: once a click in the band has done its job, focus returns to the
        picture; what it opened returns focus to the picture once it closes, off the TV. A keyboard's click (detail 0)
        keeps focus where the keyboard put it, and what it opened returns focus to its control. */}
    <div ref={band} hidden={!current} data-player-band={shown ? "shown" : "hidden"} inert={!shown} onClick={event => {
      if (event.detail) requestAnimationFrame(() => {
        const at = document.activeElement;
        clickOpened.current = !tvPresentation && document.querySelector(`.player-band ${opened}`) || null;
        if (at && band.current?.contains(at) && !at.matches(opened)) surface()?.focus({ preventScroll: true });
      });
      else clickOpened.current = null;
    }} onFocus={event => {
      if (event.target !== clickOpened.current || event.target.matches(opened)) return;
      clickOpened.current = null;
      surface()?.focus({ preventScroll: true });
    }} className={cn("player-band z-20 pt-1 transition-opacity duration-200 motion-reduce:transition-none", osd && "player-video-controls", !shown && "opacity-0")}>
      {/* The timeline, then the now-playing bar's own row: Play/Pause, Stop and Next in the middle, and at the right the
          bar's tools in its order, sound first, then content, then view: Volume, Where it plays, Up next and the Playback
          gear, then the last slot: fullscreen here, bottom right as on every player, where the bar has Open player. So
          each sits at the bar's x. Every control is a ghost icon (icon-lg) at the band's target (--player-target); those
          at the row's ends pull back (-2.5) so their glyphs line up with the timeline's times. */}
      <div className="grid gap-1">
        {state && <PlaybackTimeline state={state} connected={connected} run={run} pageFirst compact />}
        <div className="player-controls-scroll" onFocusCapture={event => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}>
          <div className="player-control-row [&_[data-size=icon-lg]]:size-(--player-target)">
            {state && <PlaybackTransport state={state} connected={connected} run={run} pageFirst className="player-transport" />}
            <div data-player-tools className="-mr-2.5 flex shrink-0 items-center gap-0.5">
              {/* A phone has its own volume keys, as YouTube's and Netflix's phone players assume, and Where it plays leads
                  with the same Volume, so the narrowest row leaves it out and keeps one line. */}
              {state && <VolumeButton state={state} connected={connected} run={run} className={livePlayback(state) ? undefined : "max-sm:hidden"} />}
              {state && !livePlayback(state) && <WhereItPlays state={state} connected={connected} run={run} />}
              <UpNextButton ref={queueTrigger} state={state} aria-expanded={queueOpen} onClick={() => setQueueOpen(!queueOpen)} />
              {/* Subtitles and Audio lead the gear's menu, then speed, quality, chapters and delay, as YouTube's; C still
                  turns subtitles on and off. It opens over the picture above the gear. */}
              {!livePlayback(state) && <Popover open={panel === "settings"} onOpenChange={open => setPanel(open ? "settings" : null)}>
                <PopoverTrigger asChild><Button ref={gear} data-panel="settings" variant="ghost" size="icon-lg" aria-label="Playback" title="Playback" disabled={!settings}><Settings aria-hidden="true" /></Button></PopoverTrigger>
                {panel === "settings" && settings && <PlaybackMenu {...settings} tracks={!audioOnly} trigger={gear.current} details={detailHref && <Button asChild variant="ghost" className={playbackMenuRow}><Link to={detailHref} aria-label="Details" onClick={openDetails}>Details<ChevronRight aria-hidden="true" className="-mr-1 ml-auto" /></Link></Button>} />}
              </Popover>}
              {/* Fullscreen stays bottom right for audio and video, directly under Info beside artwork. The TV is
                  already fullscreen; only its picture keeps an empty slot so the tools stay in place. */}
              {!tvPresentation
                ? <Button data-player-last variant="ghost" size="icon-lg" disabled={!canFullscreen} aria-label={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void fullscreen.toggle()}>{fullscreen.fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>
                : !artworkStage && <span data-player-last aria-hidden="true" className="size-(--player-target) shrink-0" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

// The station's next show by the guide's own clock, so a broadcast boundary moves it on without re-rendering the player.
function PlayerNextProgramme({ guide }: { guide?: RadioGuide }) {
  const now = useRadioClock(guide ? [guide] : []);
  return <RadioNext show={radioNext(guide, now)} className="mt-2" />;
}

// Clock ticks update their label without re-rendering the player, artwork and menus.
function PlayerEndTime({ state, className }: { state: ClientSessionState | null; className?: string }) {
  const ends = useEndTime(state);
  return ends ? <p data-player-ends className={className}>{ends}</p> : null;
}

/**
 * Near the end of an item, what plays next, over the picture at the right above the band, as Prime Video's "Next up"
 * card and Netflix's Next Episode: one target that skips to it now. Couch moves on by itself at the end either way.
 */
function NextUp({ state, run }: { state: ClientSessionState; run: (action: Action) => Promise<boolean> }) {
  const playbackClock = usePlaybackClock();
  const player = state.player;
  const index = state.queue.findIndex(entry => entry.id === state.currentEntryId);
  const current = state.queue[index];
  const next = state.queue[index + 1] ?? (state.autoplay?.enabled ? state.autoplay.upcoming[0] : undefined);
  const length = playbackClock.duration || current?.duration || 0;
  const remaining = (length - playbackClock.position) / (player.speed || 1);
  if (!playbackControls(state).programme || !playbackControls(state).queue || !current || !next || current.live || isRadio(current) || !length || remaining > 30 || remaining <= 0 || !player.playbackId || !["playing", "paused"].includes(player.status)) return null;
  return <Button data-next-up variant="ghost" aria-label={`Next: ${next.title}`} className="player-next-up h-auto text-foreground w-[min(22rem,calc(100%-2*var(--gutter)))] justify-start gap-3 rounded-md p-2 text-left font-normal whitespace-normal"
    onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}>
    <span aria-hidden="true" className="aspect-video w-28 shrink-0 overflow-hidden bg-muted [&_img]:size-full [&_img]:object-cover [&>*]:size-full"><MediaArtwork thumbnail={next.thumbnail} title={next.title} /></span>
    <span className="grid min-w-0 gap-0.5"><span className="text-sm text-muted-foreground">Next</span><span className="line-clamp-2 font-medium break-words">{next.title}</span></span>
  </Button>;
}
