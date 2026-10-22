import { playbackStatus, sounding } from "@/playback-status";
import { Level } from "@/components/Level";
import { MediaContext } from "@/components/MediaContext";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronRight, ChevronUp, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { PlaybackMenu, playbackMenuRow } from "@/components/PlaybackSettings";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { isAudioOnly } from "@/sections/now/player-presentation";
import { UpNextButton } from "@/sections/now/QueuePanel";
import { useStationShow } from "@/sections/discover/on-air";
import { queueItemLocation } from "@/detail-navigation";
import { useShell } from "./shell-context";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PlaybackTimeline, PlaybackTransport, VolumeButton } from "@/components/PlaybackTransport";
import { playsOn } from "@/session/device-id";
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

/** Publishes a bar's height as --bottom-bar, which scroll padding and the player's workspace clear. */
export function useBottomBar(ref: RefObject<HTMLElement | null>, shown = true) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shown) return;
    const measure = () => { bars.set(element, element.offsetHeight); publishBars(); };
    const observer = new ResizeObserver(measure);
    // The border box: the player band drops its scrim's padding when Up next opens.
    observer.observe(element, { box: "border-box" });
    measure();
    return () => { observer.disconnect(); bars.delete(element); publishBars(); };
  }, [ref, shown]);
}

/** What plays, one row above the page (and the phone tab bar): its artwork and title open the player. */
export function NowPlayingBar({ state, connected, run, onOpen }: { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean>; onOpen: (panel?: "queue") => void }) {
  const { credentials } = useShell();
  const [menu, setMenu] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const programme = useStationShow();
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const playback = state.playbacks?.find(item => item.id === state.playback);
  const settings = state.preferences ? { entry: current, player, ready: playbackCapabilities(state, connected).transportReady, connected, credentials, preferences: state.preferences, profile: state.activeProfile, onCommand: run } : null;
  const detailHref = current.liveSourceId ? undefined : queueItemLocation(current);
  const radio = isRadio(current);
  // The player's words, less the title shown right above them and the plain states the transport already shows.
  // The status line says where it reconnects.
  const { label, quiet } = playbackStatus(state, connected);
  const status = quiet ? "" : label;
  const at = playsOn(state);
  const title = programme?.title || current.title;
  const artwork = programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} /> : <MediaArtwork thumbnail={current.thumbnail} title={current.title} />;
  // The band's zones, order and sizes: what plays · Play/Pause, Stop, Next centred · Volume, Where it plays, Up next,
  // the Playback gear, then Open player in the slot where the band has fullscreen, each at the band's target
  // (--player-target) and x; the timeline is the line along its top edge. Phones (below sm) keep Play/Pause and Open
  // player: a minimized player needs no mixer, and the player has the rest.
  const desktop = "max-sm:hidden";
  // The bar is the player's band, minimized, on a solid surface of its own (--bar) so nothing of the page or the
  // artwork's colour shows through it; its picture, title and controls are as large as a mini-player's.
  return <footer data-now-playing aria-label="Now playing" className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 bg-bar px-(--gutter) py-3 [--muted-foreground:rgb(255_255_255/72%)] max-sm:grid-cols-[minmax(0,1fr)_auto_auto] max-sm:gap-x-0 max-sm:py-2.5 [&_[data-size=icon-lg]]:size-(--player-target) [view-transition-name:couch-player-band]">
    <PlaybackTimeline state={state} connected={connected} run={run} className="bar-timeline absolute inset-x-0 top-0 z-10 -translate-y-1/2 [&_[data-time-labels]]:hidden" />
    {/* Two lines beside the artwork at its own shape, as a mini-player's. The title is the control, across the whole
        line, and the artwork a pointer target for it; the line under it keeps its own links, so they sit outside the
        title's button. Those links drop their row height here and keep a 24px hit area that doesn't push the line apart. */}
    <div className="relative flex min-w-0 items-center gap-4 max-sm:gap-3 max-sm:pr-4">
      <button data-bar-art type="button" tabIndex={-1} aria-hidden="true" className="relative flex h-14 max-w-28 min-w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-background max-sm:h-12 max-sm:min-w-12 [&_img]:aspect-auto [&_img]:h-full [&_img]:w-auto [&_img]:max-w-28 [&>span]:aspect-square [&>span]:h-full [&>span]:w-auto" onClick={() => onOpen()}>{artwork}</button>
      <div data-bar-title className="grid min-w-0 flex-1 gap-1">
        <Button variant="link" className="h-auto min-h-0 w-full min-w-0 justify-start rounded-sm p-0 text-left text-title font-medium text-foreground touch:min-h-0 max-sm:text-body" aria-label={`Open player: ${title}`} onClick={() => onOpen()}><span className="truncate" title={title}>{title}</span>{sounding(state, connected) && <Level moving className="ml-2 shrink-0 text-[.875rem]" />}</Button>
        {/* Where it plays leads, as in the player; the context gives way first, so the device and the status stay readable. */}
        <div className="flex min-w-0 items-center gap-x-2 overflow-x-clip text-meta text-muted-foreground">
          {at?.elsewhere && <PlaysOn at={at} />}
          <MediaContext creator={current.creator} collection={current.collection} radio={radio && programme && current.source.startsWith("radio:") ? { id: current.source.slice(6), title: current.title } : undefined} className="min-w-0 shrink flex-nowrap overflow-x-clip text-meta whitespace-nowrap [&_a]:-my-1 [&_a]:min-h-0 [&_a]:py-1" />
          <span role="status" className="max-w-full shrink-0 truncate empty:hidden" title={status}>{status}</span>
        </div>
      </div>
    </div>
    <PlaybackTransport state={state} connected={connected} run={run} moreClassName={desktop} />
    <div data-bar-tools className="-mr-2.5 flex shrink-0 items-center justify-self-end gap-0.5 max-sm:gap-0">
      <VolumeButton state={state} connected={connected} run={run} className={desktop} />
      <WhereItPlays state={state} connected={connected} run={run} className={desktop} />
      <UpNextButton state={state} className={desktop} onClick={() => onOpen("queue")} />
      {/* The player's own Playback menu, for whatever plays, here or on another device. */}
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild><Button ref={gear} data-panel="settings" variant="ghost" size="icon-lg" className={desktop} aria-label="Playback" title="Playback" disabled={!settings}><Settings aria-hidden="true" /></Button></PopoverTrigger>
        {settings && <PlaybackMenu {...settings} trigger={gear.current} tracks={!isAudioOnly(playback, current, player.tracks)} details={detailHref && <Button asChild variant="ghost" className={playbackMenuRow}><Link to={detailHref} aria-label="Details" onClick={() => setMenu(false)}>Details<ChevronRight aria-hidden="true" className="-mr-1 ml-auto" /></Link></Button>} />}
      </Popover>
      {/* A mini-player's expand arrow, as YouTube Music's: up, into the player, unlike fullscreen's corners. */}
      <Button data-player-last variant="ghost" size="icon-lg" aria-label="Open player" title="Open player" onClick={() => onOpen()}><ChevronUp aria-hidden="true" /></Button>
    </div>
  </footer>;
}
