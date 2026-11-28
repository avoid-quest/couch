import { Description } from "@/components/DetailHeader";
import { listeningLive, livePlayback, playbackControls } from "@/session/playback-controls";
import { usePictureMapping } from "@/session/picture-mapping";
import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Info,
  Maximize,
  Minimize,
  Music2,
  Settings,
  SlidersVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MediaArtwork, useArtRatio } from "@/components/MediaArtwork";
import { mediaSubtitle } from "@/components/MediaContext";
import { AddToHomeButton } from "@/sections/home/AddToHome";
import {
  PlaybackTime,
  PlaybackTimeline,
  PlaybackTransport,
  PlaybackVolume,
  VolumeButton,
  playbackCapabilities,
  useEndTime,
} from "@/components/PlaybackTransport";
import { DigitalClock } from "@/components/DigitalClock";
import { sourceLabel } from "@/source-label";
import { PlaybackMenu, playbackMenuRow } from "@/components/PlaybackSettings";
import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import type { Action } from "../../../shared/protocol";
import { PlayingChip, UpNext, WhereBox, WhereTokens } from "@/sections/shell/NowPlayingParts";
import { useBottomBar } from "@/sections/shell/bottom-bar";
import { QueuePanel, UpNextButton } from "./QueuePanel";
import { Container, DEFAULT_SEEK_STEP, Hotkey } from "@videojs/react";
import { useCouchPlayer } from "@/components/CouchPlayer";
import { useTouchTaps, type TapSide } from "./useTouchTaps";
import { useKeyHold } from "@tanstack/react-hotkeys";
import { useCouchHotkeys } from "@/useCouchHotkeys";
import { startHold } from "@/hold";
import { usePlayerFullscreen } from "./usePlayerFullscreen";
import { isAudioOnly } from "./player-presentation";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { renderInto } from "@/session/renderer";
import { playsOn, showsPicture } from "@/session/device-id";
import { PlaysOnLine } from "@/sections/shell/PlaysOnLine";
import { WhereItPlays } from "@/sections/shell/Outputs";
import { LiveSharingStatus } from "@/sections/shell/LiveSharingStatus";
import { cn } from "@/lib/utils";
import { titleFit, titleLength } from "@/components/Stage";
import { Link, useLocation } from "@tanstack/react-router";
import { RadioNext, RadioProgress, RadioStationLine } from "@/components/RadioSchedule";
import { RadioRecognition } from "@/components/RadioRecognition";
import { radioFavoritesListQuery, radioProgrammesQuery, radioStationQuery } from "@/api/radio";
import { useQuery } from "@tanstack/react-query";
import {
  isRadio,
  radioHost,
  radioShowLabels,
  radioNext,
  type RadioGuide,
} from "../../../shared/radio";
import { useRadioClock } from "@/radio-clock";
import { useStationShow } from "@/sections/home/on-air";
import { queueItemLocation, restoreDetailFocus, useDetailNavigation } from "@/detail-navigation";

const feedback =
  "pointer-events-none absolute z-10 rounded-full bg-black/70 px-3 py-1 text-sm font-medium text-white tabular-nums";

type Panel = "settings";
// From 960px audio's Up next opens over the room beside the title (index.css), so the queue doesn't repeat what plays.
const wideQuery = "(min-width: 960px)";
const subscribeWide = (onChange: () => void) => {
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const isWide = () => window.matchMedia(wideQuery).matches;
// Below the band's breakpoint (max-sm) a phone's player is one column, as the prototype's: the artwork and the title at
// the top, then Where it plays and Up next, the band under them.
const narrowQuery = "(max-width: 39.99rem)";
const subscribeNarrow = (onChange: () => void) => {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const isNarrow = () => window.matchMedia(narrowQuery).matches;
// The band's controls that open something to take focus (Popovers, Up next); Info shows its part in place.
const opened = '[aria-expanded="true"]:not([data-info-toggle])';
// Info over a picture opens on its first button, as the controls it hides would have held focus.
const focusFirstButton = (element: HTMLElement | null) => {
  element?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
};

export function PlayerPage({
  queueOpen: requestedQueueOpen,
  onQueueOpenChange,
}: { queueOpen?: boolean; onQueueOpenChange?: (open: boolean) => void } = {}) {
  const fullscreen = usePlayerFullscreen();
  // Leaving the player, by any route, leaves fullscreen too.
  const exitFullscreen = fullscreen.exit;
  useEffect(() => () => void exitFullscreen(), [exitFullscreen]);
  const shell = useShell();
  const { credentials, available, active, current } = shell;
  const currentProgramme = useStationShow();
  const {
    state,
    connected,
    run,
    nativeHost,
    tvPresentation,
    videoQualityPreference,
    playerTarget,
    localLiveSourceId,
  } = useSessionGate();
  const detailNavigation = useDetailNavigation();
  const location = useLocation();
  const [panelState, setPanelState] = useState<{ playbackId: string; panel: Panel } | null>(null);
  const [shown, setShown] = useState(true);
  const [localQueueOpen, setLocalQueueOpen] = useState(false);
  const queueOpen = playbackControls(state).queue && (requestedQueueOpen ?? localQueueOpen);
  const setQueueOpen = useCallback(
    (open: boolean) => {
      if (onQueueOpenChange) onQueueOpenChange(open);
      else setLocalQueueOpen(open);
    },
    [onQueueOpenChange],
  );
  const queueTrigger = useRef<HTMLButtonElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const queueClose = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLElement>(null);
  // A Live listener's Join/Leave sits outside the transport group.
  const firstTransport = () =>
    root.current?.querySelector<HTMLElement>(
      '[aria-label="Playback controls"] button:not(:disabled), [data-live-participation] button:not(:disabled)',
    );
  const surface = () => root.current?.querySelector<HTMLElement>("[data-player-surface]");
  // The band's control a click opened (a Popover, Up next), whose return of focus hands it to the picture.
  const clickOpened = useRef<Element | null>(null);
  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    // Up next is still expanded until the route commits, so one a click opened hands focus to the picture here.
    if (clickOpened.current && clickOpened.current === queueTrigger.current) {
      clickOpened.current = null;
      surface()?.focus({ preventScroll: true });
      return;
    }
    (queueTrigger.current?.getClientRects().length
      ? queueTrigger.current
      : root.current?.querySelector<HTMLButtonElement>(
          "button[data-play-button]:not(:disabled), button[data-primary]:not(:disabled)",
        )
    )?.focus();
  }, [setQueueOpen]);
  const band = useRef<HTMLDivElement>(null);
  // Up next opened over a video (index.css) and toasts (sonner.tsx) start below the top band, so it publishes its height.
  const topBand = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(([entry]) =>
      root.setProperty("--player-top", `${Math.round(entry!.borderBoxSize[0]!.blockSize)}px`),
    );
    observer.observe(element, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.removeProperty("--player-top");
    };
  }, []);
  const [now, setNow] = useState(Date.now());
  const radioGuides = useQuery({
    ...radioProgrammesQuery(credentials),
    enabled: connected && isRadio(current),
    refetchInterval: 60_000,
  });
  const radioFavorites = useQuery({
    ...radioFavoritesListQuery(credentials),
    enabled: connected && isRadio(current) && !current?.source.startsWith("radio:"),
  });
  const stationId = current?.source.startsWith("radio:")
    ? current.source.slice(6)
    : (radioFavorites.data?.favorites.find((station) => station.url === current?.source)?.id ?? "");
  const stationDetails = useQuery({
    ...radioStationQuery(credentials, stationId),
    enabled: connected && !!stationId,
  });
  const player = state?.player;
  const panel =
    current && active && panelState?.playbackId === player?.playbackId
      ? (panelState?.panel ?? null)
      : null;
  const playing = player?.status === "playing";
  const pictureUnmapped =
    usePictureMapping(player?.playbackId) || player?.timeline?.mapping === "unavailable";
  const playback = state?.playbacks?.find((playback) => playback.id === state.playback);
  const audioOnly = isAudioOnly(playback, current, player?.tracks);
  // The picture shows on the Playback's picture outputs; every other window shows the artwork (#644 ticket 9).
  const at = playsOn(state);
  // An mpv channel shows its picture in mpv's own window, so this one shows the artwork.
  const separate = !!playback?.hostOnly && showsPicture(state);
  const picture = showsPicture(state) && !separate;
  const showPicture = useCallback(
    (element: HTMLDivElement | null) => (picture ? renderInto(element) : undefined),
    [picture],
  );
  const artworkStage = audioOnly || !picture;
  const canFullscreen = !tvPresentation && fullscreen.supported;
  const queueBeside = useSyncExternalStore(subscribeWide, isWide) && artworkStage;
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const stacked = narrow && artworkStage && !!current && !!state;
  // Now playing is calm: artwork, title and where it comes from. Info shows the rest in place (a show's genres and host,
  // its broadcast, synopsis and the next show; an item's trail and end). It belongs to what this Playback shows, so
  // another entry or Playback starts calm, while a new programme on the same station keeps it open.
  const infoKey = current ? `${state?.playback}:${current.id}:${current.source}` : null;
  const [infoFor, setInfoFor] = useState<string | null>(null);
  // Over a picture only the TV has Info, its remote's Info key and the top line's button.
  const info = (artworkStage || tvPresentation) && !!infoKey && infoFor === infoKey;
  const infoOverPicture = info && !artworkStage;
  useEffect(() => {
    setInfoFor(null);
  }, [infoKey]);
  const infoToggle = useRef<HTMLButtonElement>(null);
  const [recognitionControls, setRecognitionControls] = useState<HTMLDivElement | null>(null);
  const infoRegion = useRef<HTMLDivElement>(null);
  // What Info hides takes its focus with it (a synopsis' More, the trail's links): Info's button, else the picture, takes it.
  const wasInfo = useRef(info);
  useLayoutEffect(() => {
    const was = wasInfo.current;
    wasInfo.current = info;
    if (
      !was ||
      info ||
      (document.activeElement !== document.body &&
        !infoRegion.current?.contains(document.activeElement))
    )
      return;
    const toggle = infoToggle.current;
    (toggle?.getClientRects().length && !toggle.closest("[inert]") ? toggle : surface())?.focus({
      preventScroll: true,
    });
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
  useEffect(() => {
    setPanelState(null);
  }, [active, player?.playbackId]);
  // Back from a row's Details returns to its opener; else Up next opens on Close.
  useEffect(() => {
    if (queueOpen && !restoreDetailFocus(location.state.detailFocus)) queueClose.current?.focus();
  }, [queueOpen]);
  const {
    audioReady,
    transportReady,
    pausable,
    playing: underway,
    canTogglePaused,
    seekable,
  } = playbackCapabilities(state, connected);
  // Unattended playback starts on the picture so automatic focus cannot pin the bands open.
  // A TV already driven by keys keeps its transport entry point.
  useEffect(() => {
    if (queueOpen) return;
    const frame = requestAnimationFrame(() => {
      if (
        document.activeElement instanceof HTMLElement &&
        root.current?.contains(document.activeElement) &&
        !document.activeElement.matches(":disabled")
      )
        return;
      if (restoreDetailFocus(location.state.detailFocus)) return;
      (tvPresentation && document.documentElement.hasAttribute("data-keyboard")
        ? firstTransport()
        : surface()
      )?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tvPresentation, current?.id, transportReady, location.state.__TSR_key]);
  const retry =
    state?.radioRetry?.retryAt != null && player?.status === "loading" ? state.radioRetry : null;
  // The controls stay up on a toast's action, which Back returns to them, or while one of their Popovers or Sheets is
  // open (Volume, Where it plays, the TV's playback picker), as YouTube's stay up under an open menu; off the TV also while the keyboard is in
  // them. On the TV they hide wherever focus is, and the next key brings them back on Pause.
  const idle = () => {
    const opened = document.querySelector(
      '[data-slot="popover-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"], [data-slot="dropdown-menu-content"][data-state="open"]',
    );
    if (
      opened ||
      (!tvPresentation &&
        root.current?.querySelector(":focus-visible:not([data-player-surface])")) ||
      document.activeElement?.closest("[data-sonner-toaster]")
    )
      return;
    // Hidden bands are inert; their focus goes to the picture rather than to the page.
    if (document.activeElement?.closest("[data-player-band], [data-player-top]"))
      surface()?.focus({ preventScroll: true });
    setShown(false);
  };
  // Back on a TV, and its Info over a picture, hide the controls, handing their focus to the picture.
  const hide = () => {
    clearTimeout(timer.current);
    if (
      document.activeElement instanceof HTMLElement &&
      root.current?.contains(document.activeElement)
    )
      surface()?.focus({ preventScroll: true });
    setShown(false);
  };
  const wake = () => {
    // Info over the picture keeps the controls out of its way until it closes.
    if (infoOverPicture) return;
    setShown(true);
    clearTimeout(timer.current);
    if (autoHide && !panel && !queueOpen) timer.current = setTimeout(idle, 4000);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    if (infoOverPicture) setShown(false);
    else if (!autoHide || panel || queueOpen) setShown(true);
    else timer.current = setTimeout(idle, 4000);
    return () => clearTimeout(timer.current);
  }, [autoHide, panel, queueOpen, infoOverPicture]);
  useEffect(() => {
    if (!nativeHost || !current || shown) return;
    document.documentElement.toggleAttribute("data-cursor-hidden", true);
    return () => {
      document.documentElement.toggleAttribute("data-cursor-hidden", false);
    };
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
      if (event.key === "Escape" || (tvPresentation && event.key === "BrowserBack")) {
        // Let an active timeline edit cancel before Back hides or leaves the player.
        if (
          event.target instanceof Element &&
          event.target.closest("[data-playback-seek][data-seeking]")
        )
          return;
        if (
          document.querySelector(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]',
          )
        )
          return;
        // Back on a toast's action only leaves it (navigation.ts).
        if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]"))
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (panel) setPanelState(null);
        else if (queueOpen) closeQueue();
        else if (info) setInfoFor(null);
        else if (tvPresentation && shown) hide();
        else if (
          !tvPresentation &&
          event.key === "Escape" &&
          fullscreen.supported &&
          fullscreen.fullscreen
        )
          void fullscreen.toggle();
        else shell.leavePlayer();
        return;
      }
      const inPlayer =
        root.current?.contains(document.activeElement) || document.activeElement === document.body;
      // A TV's first key on the picture brings the controls back on Pause, even before their initial timeout.
      if (
        tvPresentation &&
        !panel &&
        !infoOverPicture &&
        (!shown || document.activeElement === surface()) &&
        inPlayer &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " ", "Tab"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        wake();
        requestAnimationFrame(() =>
          (
            root.current?.querySelector<HTMLElement>("button[data-play-button]:not(:disabled)") ??
            firstTransport()
          )?.focus(),
        );
        return;
      }
      if (
        tvPresentation &&
        !panel &&
        event.key === " " &&
        inPlayer &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest('button, a, input, select, textarea, [role="slider"]')
        ) &&
        transportReady &&
        pausable &&
        player?.playbackId
      ) {
        event.preventDefault();
        void run({ type: "pause", playbackId: player.playbackId, paused: playing });
      }
      // Any other key shows the controls for a while and leaves focus where it is. Hidden bands are inert, so Tab off
      // the TV shows them before the browser moves focus, and enters them in their order.
      if (inPlayer) {
        if (event.key === "Tab" && !shown) flushSync(wake);
        else wake();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    tvPresentation,
    shown,
    panel,
    queueOpen,
    info,
    infoOverPicture,
    closeQueue,
    playing,
    autoHide,
    transportReady,
    pausable,
    player?.playbackId,
    run,
    shell.leavePlayer,
    fullscreen,
  ]);
  // Info, from the I key, its button or a remote's Info key (dispatchTvRoute), over Up next shows Info. Over a picture
  // it opens over the bottom of the picture with the controls hidden, focus on its first button.
  const toggleInfo = () => {
    if (!artworkStage) {
      if (!info) hide();
      setInfoFor(info ? null : infoKey);
      return;
    }
    const open = queueOpen || !info;
    if (queueOpen) closeQueue();
    setInfoFor(open ? infoKey : null);
  };
  useEffect(() => {
    window.addEventListener("couch-info", toggleInfo);
    return () => window.removeEventListener("couch-info", toggleInfo);
  });
  // The artwork stands at its own shape in the room its picture lights (docs/design.md, Room).
  const [artFrame, artRatio] = useArtRatio(currentProgramme?.artworkUrl || current?.thumbnail, 1);
  const radio = isRadio(current);
  const osd = !!current && !artworkStage;
  // iPhone Safari fills the window with the Player but has no document fullscreen.
  const gesturesEnabled = !tvPresentation && !queueOpen && !panel;
  const playerKeys = !tvPresentation && !livePlayback(state);
  const seekKeys = playerKeys && transportReady && seekable;
  const volumeKeys = playerKeys && available && audioReady;
  const touchGestures = gesturesEnabled && osd && (fullscreen.fullscreen || !fullscreen.supported);
  const dismissQueue = queueOpen && (osd || queueBeside);
  const shownAtTouch = useRef(shown);
  // The last press's pointer: a tap shows or hides the controls, a click plays or pauses.
  const pointer = useRef<string | null>(null);
  // What the picture's last click asked for, so a double-click's second click can undo it.
  const clicked = useRef(false);
  const transport = useCouchPlayer();
  const [seekShown, setSeekShown] = useState<{ side: TapSide; seconds: number } | null>(null);
  const seekShownTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(seekShownTimer.current), []);
  const seekByTap = (side: TapSide) => {
    const step = side === "left" ? -DEFAULT_SEEK_STEP : DEFAULT_SEEK_STEP;
    void transport.state.seek(transport.state.currentTime + step);
    setSeekShown((last) => ({
      side,
      seconds: (last?.side === side ? last.seconds : 0) + DEFAULT_SEEK_STEP,
    }));
    clearTimeout(seekShownTimer.current);
    // As long as Video.js's own indicators stay.
    seekShownTimer.current = setTimeout(() => setSeekShown(null), 800);
  };
  const touchTaps = useTouchTaps(
    () => {
      if (dismissQueue) closeQueue();
      else if (shownAtTouch.current && autoHide) hide();
      else wake();
    },
    touchGestures && transportReady && seekable ? seekByTap : undefined,
  );

  const speed =
    gesturesEnabled &&
    transportReady &&
    seekable &&
    playbackControls(state).speed &&
    !current?.endless &&
    !radio;
  const playbackId = player?.playbackId;
  const canHold = speed && underway && !!playbackId;
  const press = useRef<{ touch?: { x: number; y: number }; end: (tap?: boolean) => void } | null>(
    null,
  );
  const spaceDown = useKeyHold("Space");
  const [holdState, setHoldState] = useState<"pending" | "fast" | null>(null);
  function beginHold(touch?: { x: number; y: number }) {
    if (!canHold || press.current) return;
    // Returning focus to a control cancels the press.
    surface()?.focus({ preventScroll: true });
    setHoldState("pending");
    const timer = startHold(() => {
      setHoldState("fast");
      void run({ type: "holdSpeed", playbackId, held: true });
    });
    press.current = {
      touch,
      end(tap) {
        press.current = null;
        setHoldState(null);
        if (timer.release()) {
          if (tap) transport.state.pause();
        } else {
          void run({ type: "holdSpeed", playbackId, held: false });
        }
      },
    };
  }
  useCouchHotkeys([
    {
      hotkey: "Space",
      enabled: playerKeys && canTogglePaused,
      backgroundOnly: true,
      action: () => {
        if (canHold) beginHold();
        else if (transport.state.paused) void transport.state.play();
        else transport.state.pause();
      },
    },
    { hotkey: "F", enabled: canFullscreen, action: fullscreen.toggle },
    { hotkey: "I", enabled: artworkStage && !!current, action: toggleInfo },
  ]);
  useEffect(() => {
    if (holdState && !spaceDown && !press.current?.touch) press.current?.end(document.hasFocus());
  }, [spaceDown, holdState]);
  useEffect(() => () => press.current?.end(), [canHold, playbackId, touchGestures]);
  // An explicitly opened queue remains available after playback stops.
  if (!current && !queueOpen && !playerTarget) return null;

  const detailHref = current && !current.liveSourceId ? queueItemLocation(current) : undefined;
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      !detailHref ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    // Back returns the TV and a keyboard to the gear they opened Details from; a pointer's Back returns to the picture.
    event.preventDefault();
    detailNavigation.open(
      detailHref,
      panel === "settings" && (tvPresentation || !event.detail)
        ? '.player-page button[aria-label="Playback"]'
        : undefined,
    );
  };
  // Back leads the top line on every screen, naming where it goes: a pointer has no Back key, and on the TV a
  // controller reaches it too. It never stops anything.
  const backTo = playerTarget ? "Remote" : shell.playerBackLabel;
  const back = (
    <Button
      variant="ghost"
      className="-ml-1 h-(--player-target) shrink-0 gap-1.5 rounded-full bg-black/35 pr-4 pl-3 hover:bg-black/50"
      aria-label={`Back to ${backTo}`}
      title={`Back to ${backTo}. It keeps playing.`}
      onClick={shell.leavePlayer}
    >
      <ChevronDown aria-hidden="true" />
      {backTo}
    </Button>
  );
  const infoButton = (
    <Button
      ref={infoToggle}
      data-info-toggle
      variant="ghost"
      size="icon-lg"
      className="-mr-2.5 size-(--player-target) shrink-0 text-foreground"
      aria-label="Info"
      title="Info"
      aria-expanded={info}
      aria-controls="player-info"
      onClick={(event) => {
        toggleInfo();
        if (event.detail) surface()?.focus({ preventScroll: true });
      }}
    >
      <Info aria-hidden="true" />
    </Button>
  );
  const artwork = currentProgramme?.artworkUrl ? (
    <MediaArtwork priority thumbnail={currentProgramme.artworkUrl} title={currentProgramme.title} />
  ) : current?.thumbnail ? (
    <MediaArtwork priority thumbnail={current.thumbnail} title={current.title} />
  ) : undefined;
  const setPanel = (value: Panel | null) => {
    if (!value) setPanelState(null);
    else if (player?.playbackId) {
      setPanelState({ playbackId: player.playbackId, panel: value });
      setShown(true);
    }
  };
  const source = current ? sourceLabel(current.source) : "";
  const title = currentProgramme?.title || current?.title;
  // As in Home's hero: a show's genre and host (its station is the link above), else the subtitle (series, episode or
  // channel), else the source (a station's is its stream host). A subtitle the relationship links already name isn't
  // said twice.
  // A station's tags follow its link under the show, or stand in for the byline while the station is the title.
  const stationTags = radio ? (stationDetails.data?.tags ?? []) : [];
  const byline = !current
    ? ""
    : currentProgramme
      ? [...radioShowLabels(currentProgramme), radioHost(currentProgramme)]
          .filter(Boolean)
          .join(", ")
      : stationTags.length
        ? stationTags.join(", ")
        : current.subtitle && !mediaSubtitle(current)
          ? ""
          : current.subtitle || (radio ? "Radio" : source);
  const separateWindow = separate && ["playing", "paused"].includes(player?.status ?? "");
  const nowPlaying =
    player?.nowPlaying &&
    [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" — ");
  const status = playbackStatus(state, connected, now);
  // A station's link names it under its show; without a show the title is the station, and already opens it. The
  // collections holding what plays are its trail, above the title as on a Stage.
  const context = current && (
    <>
      <MediaContext
        creator={current.creator}
        collection={current.collection}
        radio={
          radio && currentProgramme && current.source.startsWith("radio:")
            ? { id: current.source.slice(6), title: current.title }
            : undefined
        }
      />
      {!radio && <AddToHomeButton entry={current} />}
    </>
  );
  // A station's tags wait for Info; its link stays the same element either way, so focus on it survives Info.
  const copyContext =
    currentProgramme && stationTags.length ? (
      <RadioStationLine station={context} tags={info ? stationTags : []} />
    ) : (
      context
    );
  const trail = current && (
    <ContentBreadcrumb
      player
      collection={current.collection}
      className="[&_[data-slot=breadcrumb-list]]:text-base"
    />
  );
  const linkedTitle = detailHref ? (
    <ContentLink href={detailHref} className="no-underline hover:underline">
      {title}
    </ContentLink>
  ) : (
    title
  );
  // Up next hangs from its button, as the band's Popovers do (toolPanel): it ends at the button's right edge and grows
  // from it.
  const queueAnchor = queueOpen &&
    root.current &&
    queueTrigger.current?.offsetWidth && {
      end: rightGap(root.current, queueTrigger.current),
      origin: `calc(100% - ${queueTrigger.current.offsetWidth / 2}px) 100%`,
    };
  const settings =
    player && state?.preferences && playbackControls(state).programme
      ? {
          entry: current,
          player,
          ready: transportReady,
          connected,
          credentials,
          preferences: state.preferences,
          profile: state.activeProfile,
          videoQualities: state.videoQualities,
          onCommand: run,
          controls: state.controls,
        }
      : null;
  // Over a picture the status is the picture's (a spinner centred on it, as YouTube's and Apple's HIG; a problem as a
  // short centred line with its one remedy); beside artwork it follows the title. Plain loading says nothing else.
  const remedy =
    connected && player?.status === "unavailable" && state?.playback ? (
      <WhereItPlays
        state={state}
        connected={connected}
        run={run}
        label="Choose device"
        className="pointer-events-auto"
      />
    ) : player?.status === "error" && current && playbackControls(state).programme ? (
      <Button
        variant="secondary"
        className="pointer-events-auto"
        disabled={!connected}
        onClick={() => void run({ type: "play", entryId: current.id })}
      >
        Try again
      </Button>
    ) : null;
  const statusView = current && !listeningLive(state) && !status.quiet && (
    <div data-player-status className={osd ? "player-status" : "flex items-start gap-2 text-sm"}>
      {status.busy && (
        <Spinner
          className={osd ? "size-8" : "mt-0.5 shrink-0"}
          role="presentation"
          aria-hidden="true"
        />
      )}
      <div className={cn("min-w-0", osd && status.busy && !status.detail && "sr-only")}>
        <p role="status" className="font-medium">
          {status.label}
        </p>
        {status.detail && (
          <p
            aria-live={player?.status === "loading" && state?.radioRetry ? "off" : "polite"}
            className="max-w-prose break-words text-muted-foreground"
          >
            {status.detail}
          </p>
        )}
      </div>
      {remedy}
    </div>
  );

  return (
    <section
      ref={root}
      style={artworkStage ? ({ "--art-ratio": artRatio } as CSSProperties) : undefined}
      className={cn(
        "player-page fixed inset-0 isolate overflow-hidden bg-black data-artwork-stage:bg-transparent",
        !shown && "cursor-none [&_*]:cursor-none",
      )}
      data-page="Now"
      data-osd={osd || undefined}
      data-artwork-stage={artworkStage || undefined}
      data-stacked={stacked || undefined}
      data-info={info || undefined}
      data-queue-open={queueOpen || undefined}
      data-player-idle={!current || undefined}
      aria-label="Player"
      onPointerMove={wake}
      onFocus={wake}
      onBlur={wake}
    >
      {/* Video keeps black letterbox bars in every view. Artwork stands in the shell's room (RoomLight.tsx). */}
      <Container
        ref={showPicture}
        data-player-surface
        tabIndex={-1}
        role="group"
        aria-label={title ? `Player: ${title}` : "Player"}
        className={cn(
          "player-video absolute inset-0 outline-none",
          touchGestures && "touch-manipulation select-none [-webkit-touch-callout:none]",
        )}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
          if (event.pointerType !== "touch") return;
          shownAtTouch.current = shown;
          touchTaps.down(event);
          if (!event.isPrimary) press.current?.end();
          else if (touchGestures) beginHold({ x: event.clientX, y: event.clientY });
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch") return;
          touchTaps.move(event);
          const origin = press.current?.touch;
          // As on row menus, allow a resting finger to move slightly.
          if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10)
            press.current?.end();
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== "touch") return;
          if (press.current?.touch) press.current.end();
          touchTaps.up(event);
        }}
        onPointerCancel={() => {
          touchTaps.cancel();
          if (press.current?.touch) press.current.end();
        }}
        onLostPointerCapture={() => {
          if (press.current?.touch) press.current.end();
        }}
        onContextMenu={(event) => {
          if (press.current?.touch) event.preventDefault();
        }}
        onBlur={() => press.current?.end()}
        onClick={(event) => {
          if (pointer.current === "touch") return;
          if (dismissQueue) {
            closeQueue();
            return;
          }
          if (audioOnly || !active || !playbackId || !transportReady || !pausable) return;
          // A double-click's second click undoes its first, so the double-click only toggles fullscreen.
          clicked.current = event.detail % 2 ? underway : !clicked.current;
          void run({ type: "pause", playbackId, paused: clicked.current });
        }}
        onDoubleClick={() => {
          if (pointer.current !== "touch" && canFullscreen && !dismissQueue)
            void fullscreen.toggle();
        }}
      >
        <Hotkey keys="ArrowLeft" action="seekStep" value={-5} disabled={!seekKeys} />
        <Hotkey keys="ArrowRight" action="seekStep" value={5} disabled={!seekKeys} />
        <Hotkey keys="ArrowUp" action="volumeStep" disabled={!volumeKeys} />
        <Hotkey keys="ArrowDown" action="volumeStep" disabled={!volumeKeys} />
        <Hotkey keys="<" action="speedDown" disabled={!speed} />
        <Hotkey keys=">" action="speedUp" disabled={!speed} />
        {seekShown && (
          <span
            aria-hidden="true"
            className={cn(
              feedback,
              "top-1/2 -translate-1/2",
              seekShown.side === "left" ? "left-1/4" : "left-3/4",
            )}
          >
            {`${seekShown.side === "left" ? "−" : "+"}${seekShown.seconds}s`}
          </span>
        )}
        {holdState === "fast" && player?.speed === 2 && (
          <span role="status" className={cn(feedback, "top-1/4 left-1/2 -translate-x-1/2")}>
            2×
          </span>
        )}
      </Container>
      {osd && statusView}
      {pictureUnmapped && (
        <p
          role="status"
          className="absolute left-(--gutter) top-20 z-20 max-w-prose text-sm text-muted-foreground"
        >
          This browser cannot align this picture with the shared sound. Try another browser or
          device.
        </p>
      )}
      {/* The top line shows and hides with the band. Over a video it is one line, as in YouTube's and Netflix's fullscreen:
        Back, the title (opening Details) with its relationship links under it, and at the right the end time and, on the
        TV, the clock and Info. Beside artwork Info sits at the top right, with Back, a Remote's TV status, and Stop
        sharing while this device shares (docs/live-inputs.md). */}
      <div
        ref={topBand}
        data-player-top={shown ? "shown" : "hidden"}
        inert={!shown}
        className={cn(
          "player-top absolute inset-x-0 top-0 z-20 grid pt-4 transition-opacity duration-200 motion-reduce:transition-none",
          osd && "player-video-controls",
          !shown && "opacity-0",
        )}
      >
        {!osd && (
          <div
            data-player-header
            className={cn(
              "player-header drag-region window-controls-inset flex min-h-11 items-center gap-3 px-(--gutter)",
              playerTarget && "max-sm:flex-wrap max-sm:gap-y-0",
            )}
          >
            {back}
            {playerTarget && (
              <p
                role="status"
                title={playerTarget.status}
                className="min-w-0 truncate bg-background text-sm text-muted-foreground max-sm:order-last max-sm:w-full"
              >
                {playerTarget.status}
              </p>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-3">
              <LiveSharingStatus />
              <div ref={setRecognitionControls} className="empty:hidden" />
              {current && artworkStage && infoButton}
            </div>
          </div>
        )}
        {/* Over a picture one quiet line: Back, the title (opening Details) and where it comes from; the TV adds its
          clock and Info at the right. */}
        {osd && (
          <div
            data-player-heading
            className="drag-region window-controls-inset flex min-h-11 items-center gap-3.5 px-(--gutter)"
          >
            {back}
            <h1
              title={title}
              className="min-w-0 shrink-0 basis-auto truncate text-sm font-semibold max-w-[50%]"
            >
              {linkedTitle}
            </h1>
            {(byline || context) && (
              <div className="flex min-w-0 flex-1 items-center gap-x-3 overflow-hidden text-sm whitespace-nowrap text-muted-foreground [&_[data-media-context]]:text-sm">
                <PlaysOnLine at={at} overPicture>
                  {byline && <p className="min-w-0 truncate">{byline}</p>}
                  {context}
                </PlaysOnLine>
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-baseline gap-4 text-base text-muted-foreground tabular-nums">
              {sharing && <LiveSharingStatus />}
              {tvPresentation && !radio && <PlayerEndTime state={state} />}
              {tvPresentation && <DigitalClock />}
              {tvPresentation && <span className="self-center">{infoButton}</span>}
            </div>
          </div>
        )}
      </div>
      <div className={cn("player-workspace", playerTarget && "max-sm:top-22!")}>
        <div className="player-main">
          {current && artworkStage && (
            <div data-player-summary className="player-summary">
              <div ref={artFrame} data-player-art aria-hidden="true" className="player-art">
                {artwork || <Music2 className="size-12 text-muted-foreground" />}
              </div>
              {/* The media title leads, then where it comes from; Info adds the rest under them in place. Then what's wrong, if anything. */}
              <div
                data-player-audio-copy
                className="grid min-w-0 gap-3 [&_[data-media-context]]:text-base"
              >
                {info && trail}
                {/* Set whole in the display face, its size and width by its length, as the Stage's title. */}
                {title && (
                  <h1
                    data-length={titleLength(title)}
                    style={titleFit(title)}
                    className="display-title min-w-0 text-balance"
                  >
                    {linkedTitle}
                  </h1>
                )}
                <PlaysOnLine at={stacked ? null : at}>
                  {livePlayback(state) && current.subtitle && (
                    <p className="text-base text-pretty text-muted-foreground [overflow-wrap:anywhere]">
                      {current.subtitle}
                    </p>
                  )}
                  {copyContext}
                </PlaysOnLine>
                {separateWindow && (
                  <p className="text-sm text-muted-foreground">In a separate window</p>
                )}
                {radio && player?.playbackId && (
                  <RadioRecognition
                    key={JSON.stringify([
                      credentials.origin,
                      credentials.token,
                      state?.playback,
                      player?.playbackId,
                      current.id,
                      current.source,
                    ])}
                    credentials={credentials}
                    playbackId={player.playbackId}
                    connected={connected}
                    controls={recognitionControls}
                  />
                )}
                <div
                  ref={infoRegion}
                  id="player-info"
                  hidden={!info}
                  className="grid gap-3 duration-200 motion-safe:animate-in motion-safe:fade-in-0"
                >
                  {byline && !livePlayback(state) && (
                    <p className="text-sm text-pretty text-muted-foreground">{byline}</p>
                  )}
                  {radio && (
                    <>
                      <RadioProgress show={currentProgramme} />
                      <Description text={currentProgramme?.description} />
                      <PlayerNextProgramme
                        guide={stationId ? radioGuides.data?.[stationId] : undefined}
                      />
                    </>
                  )}
                  {!radio && (
                    <PlayerEndTime
                      state={state}
                      className="text-sm text-muted-foreground tabular-nums"
                    />
                  )}
                </div>
                {nowPlaying && (
                  <p role="status" className="text-sm text-pretty text-muted-foreground">
                    {nowPlaying}
                  </p>
                )}
                {statusView}
                {stacked && (
                  <>
                    <span className="empty:hidden">
                      <PlayingChip state={state} />
                    </span>
                    <WhereBox state={state} connected={connected} run={run} />
                    <UpNext
                      state={state}
                      connected={connected}
                      run={run}
                      onOpen={() => setQueueOpen(true)}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {/* Up next is summoned from its button: over a picture, and over the room beside artwork, a panel at the right above
          the band, as Netflix's episodes panel; on phones it takes the artwork's place. It closes from its heading row,
          and what plays now heads the list where the player's own title is off screen: beside artwork, where the copy steps aside
          under it (wide) or it takes the artwork's place (phones). */}
        {queueOpen && (
          <aside
            data-player-queue
            aria-label="Up next"
            className={cn(
              "player-queue",
              (osd || queueBeside) &&
                "duration-150 ease-out motion-safe:animate-in fade-in-0 zoom-in-90",
            )}
            style={
              (osd || queueBeside) && queueAnchor
                ? ({
                    transformOrigin: queueAnchor.origin,
                    "--queue-end": `${queueAnchor.end}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            <QueuePanel
              state={state}
              credentials={credentials}
              connected={connected}
              available={available}
              nativeHost={nativeHost}
              defaultQuality={videoQualityPreference.quality}
              run={run}
              current={artworkStage}
              onClose={queueOpen ? closeQueue : undefined}
              closeRef={queueClose}
            />
          </aside>
        )}
      </div>
      {osd && state && !queueOpen && !panel && !info && <NextUp state={state} run={run} />}
      {infoOverPicture && state && (
        <div
          ref={infoRegion}
          id="player-info"
          data-player-info
          className="absolute inset-x-0 bottom-0 z-30 grid gap-3 bg-linear-to-t from-black/95 from-55% to-transparent px-(--gutter) pt-24 pb-10 duration-200 motion-safe:animate-in motion-safe:fade-in-0"
        >
          {title && (
            <h2
              data-length={titleLength(title)}
              style={titleFit(title)}
              className="display-title max-w-[62%] min-w-0 text-balance"
            >
              {title}
            </h2>
          )}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-base text-muted-foreground [&_[data-media-context]]:text-base">
            {byline && <span>{byline}</span>}
            {context}
            {!radio && <PlayerEndTime state={state} className="tabular-nums" />}
          </div>
          <div ref={focusFirstButton} className="mt-2 flex gap-2">
            {detailHref && (
              <Button variant="secondary" onClick={() => detailNavigation.open(detailHref)}>
                Details
              </Button>
            )}
            <WhereItPlays state={state} connected={connected} run={run} label="Where it plays" />
          </div>
        </div>
      )}
      {/* A pointer leaves the keys to the shortcuts: once a click in the band has done its job, focus returns to the
        picture; what it opened returns focus to the picture once it closes, off the TV. A keyboard's click (detail 0)
        keeps focus where the keyboard put it, and what it opened returns focus to its control. */}
      {current && (
        <div
          ref={band}
          data-player-band={shown ? "shown" : "hidden"}
          inert={!shown}
          onClick={(event) => {
            if (event.detail)
              requestAnimationFrame(() => {
                const at = document.activeElement;
                clickOpened.current =
                  (!tvPresentation && document.querySelector(`.player-band ${opened}`)) || null;
                if (at && band.current?.contains(at) && !at.matches(opened))
                  surface()?.focus({ preventScroll: true });
              });
            else clickOpened.current = null;
          }}
          onFocus={(event) => {
            if (event.target !== clickOpened.current || event.target.matches(opened)) return;
            clickOpened.current = null;
            surface()?.focus({ preventScroll: true });
          }}
          className={cn(
            "player-band z-20 pt-1 transition-opacity duration-200 motion-reduce:transition-none",
            osd && "player-video-controls",
            !shown && "opacity-0",
          )}
        >
          {/* The timeline, then one quiet row along the bottom, as YouTube's and Twitch's players: at the left Play/Pause,
            Next and a labelled Stop, nothing over the middle of the picture, and at the right the bar's tools in its
            order, sound first, then content, then view: Volume, Where it plays, Up next and the Playback gear, then the
            last slot: fullscreen here, bottom right as on every player, where the bar has Open player. Every control is a
            ghost at the band's target (--player-target); those at the row's ends pull back (-2.5) so their glyphs line
            up with the timeline's times. */}
          <div className="grid gap-1">
            {state && <PlaybackTimeline state={state} connected={connected} pageFirst compact />}
            <div
              className="player-controls-scroll"
              onFocusCapture={(event) =>
                event.target.scrollIntoView({ block: "nearest", inline: "nearest" })
              }
            >
              <div className="player-control-row [&_[data-size=icon-lg]]:size-(--player-target)">
                {state && (
                  <PlaybackTransport
                    state={state}
                    connected={connected}
                    run={run}
                    pageFirst
                    quiet
                    className="player-transport"
                  />
                )}
                {/* Volume's level and the time follow the transport, as YouTube's do. A phone has its own volume keys,
                  as YouTube's and Netflix's phone players assume, and Where it plays leads with the same Volume, so
                  the narrowest row leaves it out and keeps one line. */}
                {state && !livePlayback(state) && (
                  <div data-player-lead className="flex min-w-0 items-center gap-2 max-sm:hidden">
                    <PlaybackVolume
                      state={state}
                      connected={connected}
                      run={run}
                      showValue={false}
                      className="w-32 min-w-0 flex-none gap-0"
                    />
                    <PlaybackTime state={state} className="text-muted-foreground" />
                  </div>
                )}
                <div data-player-tools className="-mr-2.5 flex shrink-0 items-center gap-0.5">
                  {state && livePlayback(state) && (
                    <VolumeButton state={state} connected={connected} run={run} />
                  )}
                  {/* Where it plays, said as the devices it plays on, or its icon on a phone: the Mixer opens from it. One
                    instance, so a request to choose opens one Mixer; stacked, the Where it plays box above is it. */}
                  {state && !livePlayback(state) && !stacked && (
                    <WhereItPlays
                      state={state}
                      connected={connected}
                      run={run}
                      className={
                        narrow
                          ? undefined
                          : "mr-1 h-(--player-target) max-w-[min(22rem,40vw)] gap-2.5 rounded-full bg-white/10 pr-3 pl-3.5 font-medium hover:bg-white/20"
                      }
                    >
                      {!narrow && (
                        <>
                          <span className="flex min-w-0 gap-3 overflow-hidden text-sm">
                            <WhereTokens state={state} compact />
                          </span>
                          <SlidersVertical aria-hidden="true" />
                        </>
                      )}
                    </WhereItPlays>
                  )}
                  {/* Subtitles and Audio lead the gear's menu, then speed, quality, chapters and delay, as YouTube's; C still
                    turns subtitles on and off. It opens over the picture above the gear. */}
                  {!livePlayback(state) && (
                    <Popover
                      open={panel === "settings"}
                      onOpenChange={(open) => setPanel(open ? "settings" : null)}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          ref={gear}
                          data-panel="settings"
                          variant="ghost"
                          size="icon-lg"
                          aria-label="Playback"
                          title="Playback"
                          disabled={!settings}
                        >
                          <Settings aria-hidden="true" />
                        </Button>
                      </PopoverTrigger>
                      {panel === "settings" && settings && (
                        <PlaybackMenu
                          {...settings}
                          tracks={!audioOnly}
                          trigger={gear.current}
                          details={
                            detailHref && (
                              <Button asChild variant="ghost" className={playbackMenuRow}>
                                <Link to={detailHref} aria-label="Details" onClick={openDetails}>
                                  Details
                                  <ChevronRight aria-hidden="true" className="-mr-1 ml-auto" />
                                </Link>
                              </Button>
                            )
                          }
                        />
                      )}
                    </Popover>
                  )}
                  {/* Fullscreen stays bottom right for audio and video, directly under Info beside artwork. The TV is
                    already fullscreen; only its picture keeps an empty slot so the tools stay in place. */}
                  <UpNextButton
                    ref={queueTrigger}
                    state={state}
                    aria-expanded={queueOpen}
                    onClick={() => setQueueOpen(!queueOpen)}
                  />
                  {!tvPresentation ? (
                    <Button
                      data-player-last
                      variant="ghost"
                      size="icon-lg"
                      disabled={!canFullscreen}
                      aria-label={fullscreen.fullscreen ? "Exit full screen" : "Full screen"}
                      title={fullscreen.fullscreen ? "Exit full screen" : "Full screen"}
                      onClick={() => void fullscreen.toggle()}
                    >
                      {fullscreen.fullscreen ? (
                        <Minimize aria-hidden="true" />
                      ) : (
                        <Maximize aria-hidden="true" />
                      )}
                    </Button>
                  ) : (
                    !artworkStage && (
                      <span
                        data-player-last
                        aria-hidden="true"
                        className="size-(--player-target) shrink-0"
                      />
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** The gap from a box's right edge to the page's, in CSS pixels: rects are zoomed (--interface-scale), offsets aren't. */
function rightGap(page: HTMLElement, box: HTMLElement) {
  const outer = page.getBoundingClientRect();
  return ((outer.right - box.getBoundingClientRect().right) * page.offsetWidth) / outer.width;
}

// The station's next show by the guide's own clock, so a broadcast boundary moves it on without re-rendering the player.
function PlayerNextProgramme({ guide }: { guide?: RadioGuide }) {
  const now = useRadioClock(guide ? [guide] : []);
  return <RadioNext show={radioNext(guide, now)} className="mt-2" />;
}

// Clock ticks update their label without re-rendering the player, artwork and menus.
function PlayerEndTime({
  state,
  className,
}: {
  state: ClientSessionState | null;
  className?: string;
}) {
  const ends = useEndTime(state);
  return ends ? (
    <p data-player-ends className={className}>
      {ends}
    </p>
  ) : null;
}

/**
 * Near the end of an item, what plays next, over the picture at the right above the band, as Prime Video's "Next up"
 * card and Netflix's Next Episode: one target that skips to it now. Couch moves on by itself at the end either way.
 */
function NextUp({
  state,
  run,
}: {
  state: ClientSessionState;
  run: (action: Action) => Promise<boolean>;
}) {
  const playbackClock = usePlaybackClock();
  const player = state.player;
  const index = state.queue.findIndex((entry) => entry.id === state.currentEntryId);
  const current = state.queue[index];
  const next =
    state.queue[index + 1] ?? (state.autoplay?.enabled ? state.autoplay.upcoming[0] : undefined);
  const length = playbackClock.duration || current?.duration || 0;
  const remaining = (length - playbackClock.position) / (player.speed || 1);
  if (
    !playbackControls(state).programme ||
    !playbackControls(state).queue ||
    !current ||
    !next ||
    current.endless ||
    isRadio(current) ||
    !length ||
    remaining > 30 ||
    remaining <= 0 ||
    !player.playbackId ||
    !["playing", "paused"].includes(player.status)
  )
    return null;
  return (
    <Button
      data-next-up
      variant="ghost"
      aria-label={`Next: ${next.title}`}
      className="player-next-up h-auto text-foreground w-[min(22rem,calc(100%-2*var(--gutter)))] justify-start gap-3 rounded-md p-2 text-left font-normal whitespace-normal"
      onClick={() => {
        if (player.playbackId) void run({ type: "next", playbackId: player.playbackId });
      }}
    >
      <span
        aria-hidden="true"
        className="aspect-video w-28 shrink-0 overflow-hidden bg-muted [&_img]:size-full [&_img]:object-cover [&>*]:size-full"
      >
        <MediaArtwork thumbnail={next.thumbnail} title={next.title} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm text-muted-foreground">Next</span>
        <span className="line-clamp-2 font-medium break-words">{next.title}</span>
      </span>
    </Button>
  );
}
