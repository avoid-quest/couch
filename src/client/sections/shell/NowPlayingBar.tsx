import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, type RefObject } from "react";
import { ListMusic } from "lucide-react";
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
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const radio = isRadio(current);
  // The player's words, less the title shown right above them and the plain states the transport already shows.
  // The status line says where it reconnects.
  const { label, quiet } = playbackStatus(state, connected);
  const status = quiet ? "" : label;
  const at = playsOn(state);
  const programme = connected &&state.radioProgramme?.playbackId === player.playbackId ? state.radioProgramme : null;
  const title = programme?.title || current.title;
  const artwork = programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} /> : <MediaArtwork thumbnail={current.thumbnail} title={current.title} />;
  // The band's zones and order: what plays · Play/Pause, Stop, Next centred · Volume, Where it plays, Up next; the
  // timeline is the line along its top edge. Phones keep Play/Pause and Where it plays; the player keeps the rest
  // (tv: undoes touch: on a narrow TV).
  const desktop = "touch:hidden tv:inline-flex";
  return <footer data-now-playing aria-label="Now playing" className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-t bg-background px-(--gutter) py-2 touch:grid-cols-[minmax(0,1fr)_auto_auto] tv:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] [&_[data-size=icon-lg]]:size-11 [view-transition-name:couch-player-band]">
    <PlaybackTimeline state={state} connected={connected} run={run} className="absolute inset-x-0 top-0 -translate-y-1/2 [&_[data-time-labels]]:hidden [&_[data-slot=slider-track]]:rounded-none [&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-thumb]]:opacity-0 hover:[&_[data-slot=slider-thumb]]:opacity-100 focus-within:[&_[data-slot=slider-thumb]]:opacity-100" />
    <div className="flex min-w-0 items-center gap-3">
      {/* The title is the control; the artwork is a larger pointer target for it. */}
      <button type="button" tabIndex={-1} aria-hidden="true" className="size-12 shrink-0 overflow-hidden bg-muted hover:opacity-80 sm:size-14 [&_img]:size-full [&_img]:object-contain [&>*]:size-full" onClick={() => onOpen()}>{artwork}</button>
      <div className="min-w-0">
        <Button variant="link" className="h-auto min-w-0 max-w-full justify-start p-0 text-left text-sm font-medium" aria-label={`Open player: ${title}`} onClick={() => onOpen()}><span className="truncate" title={title}>{title}</span></Button>
        {/* The context gives way first, so the status and the device stay readable. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <MediaContext creator={current.creator} collection={current.collection} radio={radio && current.source.startsWith("radio:") ? { id: current.source.slice(6), title: current.title } : undefined} className="min-w-0 shrink text-xs" />
          <span role="status" className="max-w-full shrink-0 truncate empty:hidden" title={status}>{status}</span>
          {at?.elsewhere && <PlaysOn at={at} />}
        </div>
      </div>
    </div>
    <PlaybackTransport state={state} connected={connected} run={run} moreClassName={desktop} />
    <div className="-mr-2.5 flex shrink-0 items-center justify-self-end gap-0.5">
      <VolumeButton state={state} connected={connected} run={run} className={desktop} />
      <WhereItPlays state={state} connected={connected} run={run} />
      <Button variant="ghost" size="icon-lg" className={desktop} aria-label="Up next" title="Up next" onClick={() => onOpen("queue")}><ListMusic aria-hidden="true" /></Button>
    </div>
  </footer>;
}
