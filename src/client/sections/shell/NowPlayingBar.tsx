import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { useLayoutEffect, type RefObject } from "react";
import { ListMusic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList } from "@/components/ui/breadcrumb";
import { collectionTarget } from "@/collection-target";
import { collectionLocation } from "@/detail-navigation";
import { Link } from "@tanstack/react-router";
import { PlaybackTimeline, PlaybackTransport, VolumeButton } from "@/components/PlaybackTransport";
import { playsOn } from "@/session/device-id";
import { PlaysOn, WhereItPlays } from "./Outputs";
import type { Action } from "../../../shared/protocol";
import { deviceName } from "@/copy";
import { sourceLabel } from "@/source-label";
import { formatDuration } from "@/time-format";
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
  const playbackClock = usePlaybackClock();
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const radio = isRadio(current);
  const live = current.live || radio;
  const length = playbackClock.duration ?? current.duration ?? 0;
  const remaining = Math.max(0, length - playbackClock.position) / (player.speed || 1);
  // The player's words, less the title shown right above them. The status line says where it reconnects.
  const status = !connected ? "Offline"
    : player.status === "unavailable" ? player.error ?? `Nothing is playing on ${deviceName(state.installationName)}`
    : player.status === "error" ? "Can't play"
    : player.status === "loading" ? state.radioRetry?.retryAt != null ? "Reconnecting…" : player.buffering ? "Buffering…" : `Connecting to ${sourceLabel(current.source)}…`
    : player.status === "ended" ? state.autoplay?.enabled && state.autoplay.pending ? "Finding the next item…" : "Finished"
    : player.status === "paused" ? "Paused" : "";
  // Below lg the timeline has no room, so its time reads here.
  const time = live ? "Live" : length ? `−${formatDuration(remaining)}` : "";
  const at = playsOn(state);
  const programme = connected &&state.radioProgramme?.playbackId === player.playbackId ? state.radioProgramme : null;
  const title = programme?.title || current.title;
  const context = programme ? current.title : current.subtitle;
  const collection = collectionTarget(current.collection);
  const artwork = programme?.artworkUrl ? <MediaArtwork thumbnail={programme.artworkUrl} title={programme.title} /> : <MediaArtwork thumbnail={current.thumbnail} title={current.title} />;
  // Fixed slots, in the band's order: Play/Pause, Stop, Next, timeline · volume, Where it plays, Up next.
  // Phones keep Play/Pause and Where it plays; the player keeps the rest (tv: undoes touch: on a narrow TV).
  const desktop = "touch:hidden tv:inline-flex";
  return <footer data-now-playing aria-label="Now playing" className="flex items-center gap-4 border-t bg-background px-(--gutter) py-2 [&_[data-size=icon-lg]]:min-h-11 [&_[data-size=icon-lg]]:min-w-11 [view-transition-name:couch-player-band]">
    <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-80">
      {/* The title is the control; the artwork is a larger pointer target for it. */}
      <button type="button" tabIndex={-1} aria-hidden="true" className="size-12 shrink-0 overflow-hidden bg-muted hover:opacity-80 sm:size-14 [&_img]:size-full [&_img]:object-contain [&>*]:size-full" onClick={() => onOpen()}>{artwork}</button>
      <div className="min-w-0">
        <Button variant="ghost" className="h-auto min-h-11 min-w-0 max-w-full justify-start p-0 text-left text-sm font-medium" aria-label={`Open player: ${title}`} onClick={() => onOpen()}><span className="truncate" title={title}>{title}</span></Button>
        {/* The context gives way first, so the status and the device stay readable. */}
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 shrink-[100] overflow-hidden">{radio && !programme ? <Link to="/live" className="inline-flex min-h-6 items-center hover:text-foreground hover:underline">Radio</Link> : collection ? <Breadcrumb aria-label="Browse related content" className="min-w-0"><BreadcrumbList className="flex-nowrap text-xs"><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild><Link to={collectionLocation(collection)} className="block truncate leading-6 hover:underline">{collection.title}</Link></BreadcrumbLink></BreadcrumbItem></BreadcrumbList></Breadcrumb> : context && <span className="truncate">{context}</span>}</span>
          <span role="status" className="max-w-full shrink-0 truncate empty:hidden" title={status}>{status}</span>
          {!status && time && <span className="shrink-0 tabular-nums lg:hidden">{time}</span>}
          {at?.elsewhere && <PlaysOn at={at} />}
        </div>
      </div>
    </div>
    <PlaybackTransport state={state} connected={connected} run={run} moreClassName={desktop} />
    <PlaybackTimeline state={state} connected={connected} run={run} compact className="min-w-0 flex-1 max-lg:hidden [&_[data-current-chapter]]:hidden max-[1100px]:[&_[data-end-time]]:hidden [&_[data-slot=slider]]:min-h-4" />
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <VolumeButton state={state} connected={connected} run={run} className={desktop} />
      <WhereItPlays state={state} connected={connected} run={run} />
      <Button variant="ghost" size="icon-lg" className={desktop} aria-label="Up next" title="Up next" onClick={() => onOpen("queue")}><ListMusic aria-hidden="true" /></Button>
    </div>
  </footer>;
}
