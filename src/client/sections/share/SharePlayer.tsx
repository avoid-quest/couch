import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, ChevronDown, Headphones, SlidersVertical, Volume2 } from "lucide-react";
import { LiveClock } from "@/components/LiveClock";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LiveSharing } from "@/session/live";
import type { ClientSessionState } from "@/session/session";
import { useSessionGate } from "@/session/session-context";
import { DeckClock, DeskPanel } from "@/sections/shell/Deck";
import { WhereList } from "@/sections/shell/Desk";
import { PlaybackStrip, whereWords } from "@/sections/shell/NowPlayingParts";
import { useCrowded, type PlayerSize } from "@/sections/shell/NowPlaying";
import type { PlayerSide } from "@/sections/shell/player-side";
import { formatClock } from "@/time-format";
import { liveTitle } from "../../../shared/live-input";
import { LiveMetadataEditor } from "./LiveMetadata";
import { SharingPill } from "./ShareControl";
import { elsewhereRows, LiveListeners, ShareTargets, useRoutes } from "./ShareDesk";
import { MuteInput, ShareGear, ShareLevel } from "./ShareSettings";
import { openShareFull, useShareView } from "./share-view";
import { shareKindOf, viewersOf, type Viewer } from "./share";

type Props = {
  state: ClientSessionState;
  size: PlayerSize | "full";
  side: PlayerSide;
  onSize: (size: "side" | "mini") => void;
};

/**
 * The player as the share's place, on the device that shares (docs/live-inputs.md): what goes out, silent here, then its
 * title and format, then the desk, whose rows are who watches or listens and how. No Play, timeline or Volume: this
 * device never plays its own share. Live audio's input level stands where Volume would and Mute audio input where Play
 * would. Stop sharing is the header's pill's alone, one press from every screen, this one's full view included. The
 * side player, its capsule, the phone's dock and the full view (Live audio's console) show the same parts.
 */
export function SharePlayer({ state, size, side, onSize }: Props) {
  const { liveSharing, localLiveSourceId, run, connected } = useSessionGate();
  // Read again on each render: mute, quality and the capture's format change the capture, not the session's state.
  const [, refresh] = useState(0);
  const changed = () => refresh((count) => count + 1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const sharing = liveSharing.current();
  const source = state.liveSources?.find((item) => item.id === localLiveSourceId);
  const playback = state.playbacks?.find((item) => item.liveSourceId === source?.id);
  // The share's Playback, once anyone plays it, is the one this window controls while the player shows the share: its
  // Where it plays is the share's.
  useEffect(() => {
    if (playback && state.playback !== playback.id)
      void run({ type: "selectPlayback", playbackId: playback.id });
  }, [playback?.id]);
  const routes = useRoutes(sharing);
  // One input level at a time: the full share's while it stands over the side player.
  const { full } = useShareView();
  // The full share hands focus back to what opened it (the pill, the side player, Home's row) as it closes.
  const opener = useRef(size === "full" ? document.activeElement : null);
  useEffect(() => {
    const element = opener.current;
    if (!(element instanceof HTMLElement)) return;
    return () =>
      void requestAnimationFrame(() => {
        if (element.isConnected && document.activeElement === document.body)
          element.focus({ preventScroll: true });
      });
  }, []);
  const details = useItemMenu([{ label: "Edit details…", run: () => setEditing(true) }]);
  // As the side player does, the plate steps beside its title when the column is crowded (an opened desk, say).
  const column = useRef<HTMLDivElement>(null);
  const crowded = useCrowded(column, `${state.playback}:${open}:${editing}`);
  if (!sharing || !source) return null;
  const parts = shareParts(state, sharing, changed, size === "full" || !full);
  const selected = playback?.id === state.playback;
  const shell = { "data-now-playing": "", "data-share-player": "", "data-tv-local-only": "" };
  // Nobody receives it yet: the desk opens whole, on the devices that could.
  const desk = (
    <DeskPanel className={size === "full" ? "max-h-[70dvh]" : undefined}>
      {parts.live ? (
        <LiveListeners
          state={state}
          sharing={sharing}
          viewers={parts.viewers}
          routes={routes}
          open={open}
          onOpen={setOpen}
        />
      ) : selected && playback ? (
        <WhereList
          state={state}
          connected={connected}
          run={run}
          open={open || !parts.viewers.length}
          onOpen={setOpen}
          elsewhere={elsewhereRows(parts.viewers, routes, playback.id)}
        />
      ) : (
        <ShareTargets state={state} sharing={sharing} />
      )}
      <div className="shrink-0 border-t pt-1">
        {parts.meter}
        <div data-nav-row className="-mx-2.5 flex h-11 min-w-0 items-center gap-0.5">
          {parts.mute}
          <span className="flex-1" />
          {parts.since}
        </div>
      </div>
    </DeskPanel>
  );
  const heading = editing ? (
    <LiveMetadataEditor key={source.id} source={source} onDone={() => setEditing(false)} />
  ) : (
    parts.heading
  );
  const tools = (minimise?: () => void) => (
    <div
      data-nav-row
      className={cn(
        "drag-region mb-2 flex h-10 shrink-0 items-center gap-0.5",
        side === "left" && "window-controls-inset",
      )}
    >
      <PlaybackStrip state={state} />
      <span className="flex-1" />
      {parts.live && <ItemMenu menu={details} title={parts.title} size="icon-lg" />}
      {parts.gear}
      {minimise && (
        <Button
          data-player-size
          variant="ghost"
          size="icon-lg"
          aria-label="Minimise player"
          title="Minimise player"
          onClick={minimise}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      )}
    </div>
  );

  if (size === "full")
    return (
      <div
        {...shell}
        data-size="full"
        role="dialog"
        aria-modal="true"
        aria-label={`Sharing ${parts.title}`}
        className="share-full now-playing room-ground fixed inset-0 z-40 flex flex-col overflow-y-auto px-(--gutter) pt-3 pb-3"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          openShareFull(false);
        }}
      >
        <div className="drag-region window-controls-inset flex min-h-(--player-target) items-center gap-2">
          <Button
            autoFocus
            variant="secondary"
            className="rounded-full"
            onClick={() => openShareFull(false)}
          >
            <ChevronDown aria-hidden="true" />
            Home
          </Button>
          <span className="flex-1" />
          {parts.live && <ItemMenu menu={details} title={parts.title} size="icon-lg" />}
          {parts.gear}
          <SharingPill />
        </div>
        <div className="grid flex-1 content-center items-center gap-8 py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,1fr)] lg:gap-12">
          <What sharing={sharing} live={parts.live} large className="w-full" />
          <div className="grid min-w-0 content-start gap-4">
            {heading}
            {desk}
          </div>
        </div>
      </div>
    );

  if (size === "side")
    return (
      <aside
        {...shell}
        data-size="side"
        aria-label="Sharing"
        className={cn(
          "now-playing fixed top-3 bottom-3 z-30 flex w-(--side-player-width) flex-col",
          side === "left" ? "left-3" : "right-3",
        )}
      >
        <div ref={column} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tools(() => onSize("mini"))}
          <div className={cn("shrink-0", crowded && "flex items-center gap-3.5 py-1 pr-2 pl-1")}>
            <button
              type="button"
              data-player-last
              aria-label={`Open player: ${parts.title}`}
              onClick={() => openShareFull(true)}
              className={cn(
                "group/open block shrink-0 rounded-[0.875rem] text-left outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-foreground",
                crowded && "w-26 rounded-lg",
              )}
            >
              <What sharing={sharing} live={parts.live} small={crowded} />
            </button>
            <div className={cn("min-w-0", crowded ? "flex-1" : "px-3.5 pt-4")}>{heading}</div>
          </div>
          <span className="min-h-4 flex-1" />
          {desk}
        </div>
      </aside>
    );

  // The capsule and the dock: the share's name and where it goes, which shows it again or opens it full.
  const identity = (
    <button
      type="button"
      data-player-size={size === "mini" ? "" : undefined}
      data-player-last={size === "dock" ? "" : undefined}
      aria-label={`${size === "mini" ? "Show player" : "Open player"}: ${parts.title}`}
      onClick={() => (size === "mini" ? onSize("side") : openShareFull(true))}
      className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full pr-2.5 pl-1 text-left outline-none hover:bg-(--fill)"
    >
      <What sharing={sharing} live={parts.live} small className="h-9 shrink-0" />
      <span className="grid min-w-0">
        <span className="truncate text-sm font-semibold">{parts.title}</span>
        <span className="truncate text-caption text-subtle-foreground">{parts.summary}</span>
      </span>
    </button>
  );
  const where = (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={parts.live ? "Who listens" : "Where it plays"}
      title={parts.live ? "Who listens" : "Where it plays"}
      onClick={() => (size === "mini" ? onSize("side") : openShareFull(true))}
    >
      <SlidersVertical aria-hidden="true" />
    </Button>
  );
  return (
    <aside
      {...shell}
      data-size={size}
      aria-label="Sharing"
      className={cn(
        "now-playing desk lit-panel relative flex h-14 items-center gap-0.5 rounded-[1.75rem] px-2",
        size === "mini"
          ? cn("mb-3 w-[min(30rem,calc(100vw-1.5rem))]", side === "left" ? "ml-3" : "mr-3 ml-auto")
          : "mx-2 mb-2 h-15 rounded-[1.25rem]",
      )}
    >
      {parts.mute}
      {identity}
      {where}
    </aside>
  );
}

/** Each part the sizes arrange: the title and what goes out, the gear, Mute and the input's level, the line at the foot. */
function shareParts(
  state: ClientSessionState,
  sharing: LiveSharing,
  changed: () => void,
  meter: boolean,
) {
  const source = sharing.source;
  const live = source.intent === "live";
  const viewers = viewersOf(state, source.id);
  const title = liveTitle(source);
  const kind = shareKindOf(
    source.kind === "airplay" ? "screen" : source.kind,
    sharing.surface,
    source.intent,
  );
  const picture = sharing.stream.getVideoTracks().length > 0;
  const format = sharing.captureFormat;
  const what = picture
    ? `${kind.label}${source.audio ? " with sound" : ""}, ${sharing.quality === "original" ? "Original" : sharing.quality}, ${sharing.frameRate} FPS`
    : source.kind === "system-audio"
      ? "Everything this computer plays"
      : live
        ? source.metadata?.description || "Live audio"
        : "Audio input";
  // The capture's own format, and the device's buffer only where it differs from the one asked for.
  const capture =
    format &&
    `${format.sampleRate / 1000} kHz, ${format.channels === 1 ? "Mono" : `${format.channels} channels`}${
      format.native && format.native.reportedFrames !== format.native.requestedFrames
        ? `, device buffer ${format.native.reportedFrames} frames`
        : ""
    }`;
  const input = source.kind === "microphone";
  const muted = input && sharing.muted;
  const sounding = viewers.some((viewer) => viewer.playing && viewer.sound && !viewer.error);
  return {
    live,
    viewers,
    title,
    heading: (
      <div className="grid min-w-0 gap-1">
        <h2 className="line-clamp-2 font-heading text-[1.25rem] leading-6 font-semibold tracking-[-0.015em] [overflow-wrap:anywhere]">
          {title}
        </h2>
        <p className="flex flex-wrap gap-x-2.5 text-meta text-muted-foreground">
          <span>{what}</span>
          {live && capture && <span className="text-subtle-foreground">{capture}</span>}
        </p>
      </div>
    ),
    summary: <Summary viewers={viewers} live={live} state={state} />,
    gear: <ShareGear sharing={sharing} picture={picture} live={live} onChange={changed} />,
    mute: input && <MuteInput sharing={sharing} muted={muted} onChange={changed} />,
    meter: input && meter && (
      <div className="flex h-11 items-center gap-3 text-meta text-subtle-foreground">
        <span className="shrink-0">Input</span>
        <span className="min-w-0 flex-1">
          <ShareLevel sharing={sharing} />
        </span>
      </div>
    ),
    since: (
      <DeckClock moving={muted ? undefined : sounding}>
        {muted ? (
          <span role="status">Input muted. Nobody hears it until you unmute.</span>
        ) : live ? (
          <LiveClock startedAt={source.startedAt} />
        ) : (
          `Sharing since ${formatClock(sharing.since)}`
        )}
      </DeckClock>
    ),
  };
}

/** What goes out: the capture's own picture, silent; a plate for sound, with Live audio's clock set large. */
function What({
  sharing,
  live,
  small = false,
  large = false,
  className,
}: {
  sharing: LiveSharing;
  live: boolean;
  small?: boolean;
  large?: boolean;
  className?: string;
}) {
  const { state } = useSessionGate();
  const from = state?.devices?.find((device) => device.id === sharing.source.deviceId)?.name;
  const picture = sharing.stream.getVideoTracks().length > 0;
  if (picture)
    return (
      <span
        className={cn(
          "relative block aspect-video overflow-hidden rounded-[0.875rem] bg-black",
          small && "rounded-lg",
          className,
        )}
      >
        <video
          muted
          autoPlay
          playsInline
          aria-hidden="true"
          ref={(video) => {
            if (video && video.srcObject !== sharing.stream) video.srcObject = sharing.stream;
          }}
          className="block size-full object-contain"
        />
        {!small && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white">
            What goes out, silent here
          </span>
        )}
      </span>
    );
  const Icon = live || sharing.source.kind === "microphone" ? AudioLines : Volume2;
  const kind = live
    ? "Live audio"
    : sharing.source.kind === "system-audio"
      ? "System audio"
      : "Audio input";
  if (small)
    return (
      <span
        aria-hidden="true"
        className={cn("grid aspect-video place-items-center rounded-lg bg-black/40", className)}
      >
        <Icon className="size-5" />
      </span>
    );
  return (
    <span
      className={cn(
        "flex aspect-video flex-col justify-between rounded-[0.875rem] bg-black/35 p-4 shadow-[inset_0_0_0_1px_var(--border)]",
        large && "p-8",
        className,
      )}
    >
      <Icon aria-hidden="true" className={large ? "size-8" : "size-5"} />
      <span className="grid gap-1">
        {live && (
          <LiveClock
            time
            startedAt={sharing.source.startedAt}
            className={cn(
              "font-heading leading-none font-semibold tracking-[-0.03em] tabular-nums",
              large ? "text-[clamp(3rem,8vw,6.5rem)]" : "text-5xl",
            )}
          />
        )}
        <span className={cn("text-muted-foreground", large ? "text-xl" : "text-xs")}>
          {kind}
          {from ? `, from ${from}` : ""}
        </span>
      </span>
    </span>
  );
}

/** Who gets it, in a few words: "8 listening", where it plays, or that nobody does yet. */
function Summary({
  viewers,
  live,
  state,
}: {
  viewers: Viewer[];
  live: boolean;
  state: ClientSessionState;
}): ReactNode {
  if (live)
    return (
      <span className="inline-flex items-center gap-1.5">
        {viewers.length > 0 && <Headphones aria-hidden="true" className="size-3" />}
        {viewers.length ? `${viewers.length} listening` : "No listeners yet"}
      </span>
    );
  if (!viewers.length) return "On no screens yet";
  const playback = state.playbacks?.find((item) => item.id === viewers[0]!.playbackId);
  return whereWords(state, playback);
}
