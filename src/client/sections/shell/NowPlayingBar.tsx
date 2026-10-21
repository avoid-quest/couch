import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronRight, ChevronUp, ListMusic, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { PlaybackMenu, playbackMenuRow } from "@/components/PlaybackSettings";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { isAudioOnly } from "@/sections/now/player-presentation";
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
  const bar = useRef<HTMLElement>(null);
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const playback = state.playbacks?.find(item => item.id === state.playback);
  const settings = state.preferences ? { entry: current, player, ready: playbackCapabilities(state, connected).transportReady, connected, credentials, preferences: state.preferences, profile: state.activeProfile, onCommand: run } : null;
  const detailHref = current.liveSourceId ? undefined : queueItemLocation(current);
  // Its menus open above the whole bar, clear of the timeline along its top edge, as the band's do.
  const tools = bar.current?.querySelector("[data-bar-tools]")?.getBoundingClientRect().top, top = bar.current?.getBoundingClientRect().top;
  const sideOffset = tools != null && top != null ? Math.max(8, tools - top + 8) : 8;
  const radio = isRadio(current);
  // The player's words, less the title shown right above them and the plain states the transport already shows.
  // The status line says where it reconnects.
  const { label, quiet } = playbackStatus(state, connected);
  const status = quiet ? "" : label;
  const at = playsOn(state);
  const programme = connected &&state.radioProgramme?.playbackId === player.playbackId ? state.radioProgramme : null;
  const title = programme?.title || current.title;
  const artwork = programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} /> : <MediaArtwork thumbnail={current.thumbnail} title={current.title} />;
  // The band's zones, order and sizes: what plays · Play/Pause, Stop, Next centred · Volume, Where it plays, Up next,
  // the Playback gear, then Open player in the slot where the band has fullscreen, each at the band's target
  // (--player-target) and x; the timeline is the line along its top edge. Phones (below sm) keep Play/Pause and Open
  // player: a minimized player needs no mixer, and the player has the rest.
  const desktop = "max-sm:hidden";
  return <footer ref={bar} data-now-playing aria-label="Now playing" className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-t bg-background px-(--gutter) py-2 max-sm:grid-cols-[minmax(0,1fr)_auto_auto] max-sm:gap-x-0 [&_[data-size=icon-lg]]:size-(--player-target) [view-transition-name:couch-player-band]">
    <PlaybackTimeline state={state} connected={connected} run={run} className="absolute inset-x-0 top-0 -translate-y-1/2 [&_[data-time-labels]]:hidden [&_[data-slot=slider-track]]:rounded-none [&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-thumb]]:opacity-0 hover:[&_[data-slot=slider-thumb]]:opacity-100 focus-within:[&_[data-slot=slider-thumb]]:opacity-100" />
    <div className="flex min-w-0 items-center gap-3 max-sm:pr-4">
      {/* The title is the control; the artwork is a larger pointer target for it. */}
      <button type="button" tabIndex={-1} aria-hidden="true" className="size-12 shrink-0 overflow-hidden bg-muted hover:opacity-80 sm:size-14 [&_img]:size-full [&_img]:object-contain [&>*]:size-full" onClick={() => onOpen()}>{artwork}</button>
      <div className="min-w-0">
        <Button variant="link" className="h-auto min-w-0 max-w-full justify-start p-0 text-left text-sm font-medium" aria-label={`Open player: ${title}`} onClick={() => onOpen()}><span className="truncate" title={title}>{title}</span></Button>
        {/* Where it plays leads, as in the player; the context gives way first, so the device and the status stay readable. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {at?.elsewhere && <PlaysOn at={at} />}
          <MediaContext creator={current.creator} collection={current.collection} radio={radio && current.source.startsWith("radio:") ? { id: current.source.slice(6), title: current.title } : undefined} className="min-w-0 shrink text-xs" />
          <span role="status" className="max-w-full shrink-0 truncate empty:hidden" title={status}>{status}</span>
        </div>
      </div>
    </div>
    <PlaybackTransport state={state} connected={connected} run={run} moreClassName={desktop} />
    <div data-bar-tools className="-mr-2.5 flex shrink-0 items-center justify-self-end gap-0.5 max-sm:gap-0">
      <VolumeButton state={state} connected={connected} run={run} sideOffset={sideOffset} className={desktop} />
      <WhereItPlays state={state} connected={connected} run={run} sideOffset={sideOffset} className={desktop} />
      <Button data-panel="queue" variant="ghost" size="icon-lg" className={desktop} aria-label="Up next" title="Up next" onClick={() => onOpen("queue")}><ListMusic aria-hidden="true" /></Button>
      {/* The player's own Playback menu, for whatever plays, here or on another device. */}
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild><Button data-panel="settings" variant="ghost" size="icon-lg" className={desktop} aria-label="Playback" title="Playback" disabled={!settings}><Settings aria-hidden="true" /></Button></PopoverTrigger>
        {settings && <PlaybackMenu {...settings} sideOffset={sideOffset} tracks={!isAudioOnly(playback, current, player.tracks)} details={detailHref && <Button asChild variant="ghost" className={playbackMenuRow}><Link to={detailHref} aria-label="Details" onClick={() => setMenu(false)}>Details<ChevronRight aria-hidden="true" className="-mr-1 ml-auto" /></Link></Button>} />}
      </Popover>
      {/* A mini-player's expand arrow, as YouTube Music's: up, into the player, unlike fullscreen's corners. */}
      <Button data-player-last variant="ghost" size="icon-lg" aria-label="Open player" title="Open player" onClick={() => onOpen()}><ChevronUp aria-hidden="true" /></Button>
    </div>
  </footer>;
}
