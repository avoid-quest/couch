import { listeningLive, livePlayback, playbackControls } from "@/session/playback-controls";
import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronRight, ChevronUp, Settings } from "lucide-react";
import { Link, useRouter, type AnyRouter } from "@tanstack/react-router";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { PlaybackMenu, playbackMenuRow } from "@/components/PlaybackSettings";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { isAudioOnly } from "@/sections/now/player-presentation";
import { UpNextButton } from "@/sections/now/QueuePanel";
import { useStationShow } from "@/sections/home/on-air";
import { detailHref, queueItemLocation, useDetailNavigation } from "@/detail-navigation";
import { useShell } from "./shell-context";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { roomStyle, useArtworkLight } from "@/components/AmbientLight";
import { PlaybackTimeline, PlaybackTransport, VolumeButton } from "@/components/PlaybackTransport";
import { playsOn } from "@/session/device-id";
import { focusPageControl } from "@/navigation";
import { PlaysOn, WhereItPlays } from "./Outputs";
import type { Action } from "../../../shared/protocol";
import { isRadio } from "../../../shared/radio";

// Bars at the bottom of the viewport (the shell's footer, the player band) can overlap
// for a commit during navigation, so the tallest registered one wins.
const bars = new Map<HTMLElement, number>();
function publishBars() {
  const height = Math.max(0, ...bars.values());
  if (height) document.documentElement.style.setProperty("--bottom-bar", `${height}px`);
  else document.documentElement.style.removeProperty("--bottom-bar");
}

/** Publishes --bottom-bar before paint; contentKey also measures when the shell adds/removes its playing bar. */
export function useBottomBar(ref: RefObject<HTMLElement | null>, shown = true, contentKey?: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shown) return;
    const measure = () => { bars.set(element, element.offsetHeight); publishBars(); };
    const observer = new ResizeObserver(([entry]) => {
      bars.set(element, Math.round(entry!.borderBoxSize[0]!.blockSize));
      publishBars();
    });
    // The border box: the player band drops its scrim's padding when Up next opens.
    observer.observe(element, { box: "border-box" });
    measure();
    return () => { observer.disconnect(); bars.delete(element); publishBars(); };
  }, [ref, shown, contentKey]);
}

// Stop may reveal a loading page. Its heading/other controls are provisional
// until the primary control arrives, unless the user chooses or navigates away.
function recoverPageFocus(page: HTMLElement, router: AnyRouter) {
  let provisional: Element | null = document.body;
  let restoring = false;
  const restore = () => {
    if (!page.isConnected || document.activeElement !== document.body && document.activeElement !== provisional) { stop(); return; }
    restoring = true;
    focusPageControl(page);
    provisional = document.activeElement;
    restoring = false;
    if (provisional?.matches("[data-page-first]")) stop();
  };
  const observer = new MutationObserver(restore);
  const chosen = () => { if (!restoring) stop(); };
  const stop = () => {
    observer.disconnect(); clearTimeout(timer); unsubscribe();
    window.removeEventListener("keydown", stop, true);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("focusin", chosen, true);
  };
  const timer = setTimeout(stop, 15_000);
  const unsubscribe = router.subscribe("onBeforeNavigate", stop);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "inert"] });
  window.addEventListener("keydown", stop, true);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("focusin", chosen, true);
  restore();
}

/** What plays, one row above the page (and the phone tab bar): its artwork and title open the player. */
export function NowPlayingBar({ state, connected, run, onOpen }: { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean>; onOpen: (panel?: "queue") => void }) {
  const { credentials } = useShell();
  const [menu, setMenu] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  // React focus events include this bar's portalled popovers and sheets.
  const focusWithin = useRef(false);
  useLayoutEffect(() => () => {
    if (!focusWithin.current) return;
    const page = document.querySelector<HTMLElement>("[data-page]");
    const location = router.state.location;
    // Stop removes the focused bar. After the commit, return lost focus to the
    // same page, leaving navigation and any deliberately chosen target alone.
    // The player hides the bar as it opens and puts focus on its own picture.
    queueMicrotask(() => {
      if (page?.isConnected && !page.matches('[data-page="Now"]') && router.state.location === location && document.activeElement === document.body) recoverPageFocus(page, router);
    });
  }, [router]);
  const detailNavigation = useDetailNavigation();
  const programme = useStationShow();
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  // The glass takes the playing artwork's colour (docs/design.md, Glass).
  const light = useArtworkLight(programme?.artworkUrl || current?.thumbnail);
  if (!current) return null;
  const playback = state.playbacks?.find(item => item.id === state.playback);
  const settings = state.preferences && playbackControls(state).programme ? { entry: current, player, ready: playbackCapabilities(state, connected).transportReady, connected, credentials, preferences: state.preferences, profile: state.activeProfile, onCommand: run, controls: state.controls } : null;
  const details = current.liveSourceId ? undefined : queueItemLocation(current);
  const radio = isRadio(current);
  // The player's words, less the title shown right above them and the plain states the transport already shows.
  // The status line says where it reconnects.
  const { label, quiet } = playbackStatus(state, connected);
  const status = quiet || listeningLive(state) ? "" : label;
  const at = playsOn(state);
  const title = programme?.title || current.title;
  const artwork = programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} /> : <MediaArtwork thumbnail={current.thumbnail} title={current.title} />;
  // The band's zones, order and sizes: what plays · Play/Pause, Stop, Next centred · Volume, Where it plays, Up next,
  // the Playback gear, then Open player in the slot where the band has fullscreen, each at the band's target
  // (--player-target) and x; the timeline is the line along its top edge. Phones (below sm) keep Play/Pause and Open
  // player: a minimized player needs no mixer, and the player has the rest.
  const desktop = "max-sm:hidden";
  // The bar is the player's band, minimized: a capsule of tinted glass floating over the page, its corners and its
  // shadow saying it lies above whatever scrolls under it; its picture, title and controls are a mini-player's.
  return <div className="px-[max(.5rem,calc(var(--gutter)-1rem))] pb-[max(.5rem,env(safe-area-inset-bottom))] max-sm:pb-1.5">
  <footer data-now-playing onFocusCapture={() => { focusWithin.current = true; }} onBlurCapture={() => { focusWithin.current = false; }} aria-label="Now playing" style={roomStyle(light)} className="bar-glass relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 py-3 pr-4 pl-3 [--muted-foreground:rgb(255_255_255/80%)] max-sm:grid-cols-[minmax(0,1fr)_auto_auto] max-sm:gap-x-0 max-sm:py-2 max-sm:pr-2 max-sm:pl-2 [&_[data-size=icon-lg]]:size-(--player-target)">
    <PlaybackTimeline state={state} connected={connected} run={run} className="bar-timeline absolute inset-x-5 top-0 z-10 -translate-y-1/2 max-sm:inset-x-4 [&_[data-time-labels]]:hidden" />
    {/* Two lines beside the artwork at its own shape, as a mini-player's. The title is the control, across the whole
        line, and the artwork a pointer target for it; the line under it keeps its own links, so they sit outside the
        title's button. Those links drop their row height here and keep a 24px hit area that doesn't push the line apart. */}
    <div className="relative flex min-w-0 items-center gap-4 max-sm:gap-3 max-sm:pr-4">
      <button data-bar-art type="button" tabIndex={-1} aria-hidden="true" className="relative flex h-14 max-w-28 min-w-14 shrink-0 items-center justify-center overflow-hidden rounded-md shadow-[0_.375rem_1rem_rgb(0_0_0/45%)] bg-black/40 max-sm:h-12 max-sm:min-w-12 [&_img]:aspect-auto [&_img]:h-full [&_img]:w-auto [&_img]:max-w-28 [&>span]:aspect-square [&>span]:h-full [&>span]:w-auto" onClick={() => onOpen()}>{artwork}</button>
      <div data-bar-title className="grid min-w-0 flex-1 gap-1">
        <Button variant="link" className="h-auto min-h-0 w-full min-w-0 justify-start rounded-sm p-0 text-left text-title leading-tight font-medium text-foreground touch:min-h-0 max-sm:text-body" aria-label={`Open player: ${title}`} onClick={() => onOpen()}>
          {/* Keep the collapsed bar compact; the player shows the whole title. */}
          <span className="truncate" title={title}>{title}</span></Button>
        {/* Where it plays leads, as in the player; the context gives way first, so the device and the status stay readable. */}
        <div className="flex min-w-0 items-center gap-x-2 overflow-x-clip text-meta text-muted-foreground">
          {at?.elsewhere && <PlaysOn at={at} />}
          {livePlayback(state) && current.subtitle && <span className="min-w-0 truncate" title={current.subtitle}>{current.subtitle}</span>}
          <MediaContext creator={current.creator} collection={current.collection} radio={radio && programme && current.source.startsWith("radio:") ? { id: current.source.slice(6), title: current.title } : undefined} className="min-w-0 shrink flex-nowrap overflow-x-clip text-meta whitespace-nowrap [&_a]:-my-1 [&_a]:min-h-0 [&_a]:py-1" />
          <span role="status" className="max-w-full shrink-0 truncate empty:hidden" title={status}>{status}</span>
        </div>
      </div>
    </div>
    <PlaybackTransport state={state} connected={connected} run={run} moreClassName={desktop} />
    <div data-bar-tools className="-mr-2.5 flex shrink-0 items-center justify-self-end gap-0.5 max-sm:gap-0">
      <VolumeButton state={state} connected={connected} run={run} className={livePlayback(state) ? undefined : desktop} />
      {!livePlayback(state) && <WhereItPlays state={state} connected={connected} run={run} className={desktop} />}
      <UpNextButton state={state} className={desktop} onClick={() => onOpen("queue")} />
      {/* The player's own Playback menu, for whatever plays, here or on another device. */}
      {!livePlayback(state) && <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild><Button ref={gear} data-panel="settings" variant="ghost" size="icon-lg" className={desktop} aria-label="Playback" title="Playback" disabled={!settings}><Settings aria-hidden="true" /></Button></PopoverTrigger>
        {menu && settings && <PlaybackMenu {...settings} trigger={gear.current} tracks={!isAudioOnly(playback, current, player.tracks)} details={details && <Button asChild variant="ghost" className={playbackMenuRow}><Link to={detailHref(details)} aria-label="Details" onClick={event => {
          // As the player's own Details: in the section it was opened from, and Back returns to the gear.
          setMenu(false);
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); detailNavigation.open(details, '[data-now-playing] button[aria-label="Playback"]');
        }}>Details<ChevronRight aria-hidden="true" className="-mr-1 ml-auto" /></Link></Button>} />}
      </Popover>}
      {/* A mini-player's expand arrow, as YouTube Music's: up, into the player, unlike fullscreen's corners. */}
      <Button data-player-last variant="ghost" size="icon-lg" aria-label="Open player" title="Open player" onClick={() => onOpen()}><ChevronUp aria-hidden="true" /></Button>
    </div>
  </footer>
  </div>;
}
