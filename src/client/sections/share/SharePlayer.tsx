import { useEffect, useRef, useState } from "react";
import { AudioLines, ChevronDown, Headphones, Monitor, Pencil, Volume2 } from "lucide-react";
import { Level } from "@/components/Level";
import { LiveClock } from "@/components/LiveClock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LiveSharing } from "@/session/live";
import type { ClientSessionState } from "@/session/session";
import { deviceId } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import { PlayingChip, WhereBox } from "@/sections/shell/NowPlayingParts";
import { WhereItPlays } from "@/sections/shell/Outputs";
import type { PlayerSize } from "@/sections/shell/NowPlaying";
import type { PlayerSide } from "@/sections/shell/player-side";
import { formatClock } from "@/time-format";
import { liveTitle } from "../../../shared/live-input";
import type { Action } from "../../../shared/protocol";
import { LiveMetadataEditor } from "./LiveMetadata";
import { SharingPill } from "./ShareControl";
import { AddSpeakers, Audience, ChooseWhere, useRoutes } from "./ShareAudience";
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
 * The player as the share's place, on the device that shares (docs/live-inputs.md): where a programme has its picture,
 * what goes out, silent here; where Up next stands, who watches or listens and how each gets it; where Play starts,
 * Mute audio input for an input. No Play, timeline or Volume: this device never plays its own share. Stop sharing is
 * the header's pill's alone, one press from every screen, this one's full view included. The side player, its capsule,
 * the phone's dock and the full view (Live audio's console) show the same parts.
 */
export function SharePlayer({ state, size, side, onSize }: Props) {
  const { liveSharing, localLiveSourceId, run, connected } = useSessionGate();
  // Read again on each render: mute, quality and the capture's format change the capture, not the session's state.
  const [, refresh] = useState(0);
  const changed = () => refresh((count) => count + 1);
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
  if (!sharing || !source) return null;
  const parts = shareParts(
    state,
    sharing,
    connected,
    run,
    changed,
    playback?.id === state.playback,
    size === "full" || !full,
  );
  const shell = { "data-now-playing": "", "data-share-player": "", "data-tv-local-only": "" };
  const audience = (
    <Audience
      sharing={sharing}
      viewers={parts.viewers}
      routes={routes}
      live={parts.live}
      className={size === "full" ? undefined : "min-h-0 flex-1"}
    />
  );
  // The line that says how it goes (or that the input is muted), with Mute audio input before it for an input.
  const foot = (
    <div className="flex min-h-(--player-target) min-w-0 items-center gap-2.5">
      {parts.mute}
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {parts.since}
      </span>
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
          <SharingPill />
        </div>
        <div className="grid flex-1 content-center items-center gap-8 py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,1fr)] lg:gap-12">
          <What sharing={sharing} live={parts.live} large className="w-full" />
          <div className="grid min-w-0 content-start gap-3">
            {parts.heading}
            {parts.where}
            {audience}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {foot}
          <span className="flex-1" />
          {parts.tool}
          {parts.gear}
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
          "now-playing lit-panel side-player fixed top-3 bottom-3 z-30 flex w-(--side-player-width) flex-col overflow-hidden rounded-[1.625rem]",
          side === "left" ? "left-3" : "right-3",
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col px-3 pt-3">
          <div
            className={cn(
              "drag-region -mx-0.5 mb-2 flex h-(--player-target) shrink-0 items-center gap-0.5",
              side === "left" && "window-controls-inset",
            )}
          >
            <PlayingChip state={state} />
            <span className="flex-1" />
            {parts.gear}
            <Button
              data-player-size
              variant="ghost"
              size="icon-lg"
              aria-label="Minimise player"
              title="Minimise player"
              onClick={() => onSize("mini")}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </div>
          <button
            type="button"
            data-player-last
            aria-label={`Open player: ${parts.title}`}
            onClick={() => openShareFull(true)}
            className="group/open block rounded-[0.875rem] text-left outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <What sharing={sharing} live={parts.live} />
          </button>
          <div className="flex min-h-0 flex-1 flex-col px-1 pt-3">
            {parts.heading}
            {parts.where}
            {audience}
          </div>
        </div>
        <div className="relative shrink-0 px-3.5 pb-3.5">{foot}</div>
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
      className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full pr-2.5 text-left outline-none hover:bg-accent focus-visible:bg-foreground focus-visible:text-background"
    >
      <What sharing={sharing} live={parts.live} small className="h-11 shrink-0" />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-semibold">{parts.title}</span>
        <span className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
          {parts.summary}
        </span>
      </span>
    </button>
  );
  if (size === "mini")
    return (
      <aside
        {...shell}
        data-size="mini"
        aria-label="Sharing"
        className={cn(
          "now-playing lit-panel now-capsule relative mb-3 flex w-[min(37.5rem,calc(100vw-1.5rem))] items-center gap-1.5 overflow-hidden rounded-[2.125rem] py-2.5 pr-2.5 pl-3",
          side === "left" ? "ml-3" : "mr-3 ml-auto",
        )}
      >
        {parts.mute}
        {identity}
        {parts.tool}
      </aside>
    );
  return (
    <aside
      {...shell}
      data-size="dock"
      aria-label="Sharing"
      className="now-playing lit-panel now-dock relative mx-2 mb-1 grid gap-2 overflow-hidden rounded-3xl pt-2.5 pr-2 pb-2 pl-3"
    >
      <div className="relative flex min-w-0 items-center gap-1">
        {parts.mute}
        {identity}
        {parts.tool}
      </div>
    </aside>
  );
}

/** Each part the sizes arrange: the title and what goes out, where it plays, the gear, Mute, the line above Stop. */
function shareParts(
  state: ClientSessionState,
  sharing: LiveSharing,
  connected: boolean,
  run: (action: Action) => Promise<boolean>,
  changed: () => void,
  selected: boolean,
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
  const muted = source.kind === "microphone" && sharing.muted;
  const sounding = viewers.some((viewer) => viewer.playing && viewer.sound && !viewer.error);
  return {
    live,
    viewers,
    title,
    heading: (
      <ShareHeading
        sharing={sharing}
        title={title}
        what={what}
        capture={live ? capture : undefined}
        live={live}
        meter={meter && source.kind === "microphone"}
      />
    ),
    where: (
      <ShareWhere
        state={state}
        sharing={sharing}
        viewers={viewers}
        live={live}
        selected={selected}
      />
    ),
    summary: <Summary viewers={viewers} live={live} picture={!!source.video} />,
    tool: live ? (
      <AddSpeakers sharing={sharing} viewers={viewers} icon />
    ) : selected ? (
      <WhereItPlays state={state} connected={connected} run={run} className="relative" />
    ) : (
      <ChooseWhere sharing={sharing} icon />
    ),
    gear: <ShareGear sharing={sharing} picture={picture} live={live} onChange={changed} />,
    mute: source.kind === "microphone" && (
      <MuteInput sharing={sharing} muted={muted} onChange={changed} />
    ),
    since: muted ? (
      <span role="status">Input muted. Nobody hears it until you unmute.</span>
    ) : (
      <span className="flex min-w-0 items-center gap-2">
        <Level moving={sounding} className="shrink-0" />
        {live ? (
          <LiveClock startedAt={source.startedAt} />
        ) : (
          <span className="truncate">Sharing since {formatClock(sharing.since)}</span>
        )}
      </span>
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

/** The title, what goes out, and for Live audio its details with Edit details, which opens them in place. */
function ShareHeading({
  sharing,
  title,
  what,
  capture,
  live,
  meter,
}: {
  sharing: LiveSharing;
  title: string;
  what: string;
  capture?: string;
  live: boolean;
  meter: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const source = sharing.source;
  if (editing)
    return <LiveMetadataEditor key={source.id} source={source} onDone={() => setEditing(false)} />;
  return (
    <div className="grid min-w-0 gap-1">
      <h2 className="font-heading text-xl leading-tight font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">
        {title}
      </h2>
      <p className="flex flex-wrap gap-x-2.5 text-sm text-muted-foreground">
        <span className={cn(live && "text-foreground")}>{what}</span>
        {capture && <span>{capture}</span>}
      </p>
      {meter && <ShareLevel sharing={sharing} />}
      {live && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5 h-7 justify-self-start rounded-full px-2.5 text-xs shadow-[inset_0_0_0_1px_var(--border)]"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden="true" />
          Edit details
        </Button>
      )}
    </div>
  );
}

/** Where it plays: the Mixer of the share's Playback once anyone plays it; Live audio's count of listeners. */
function ShareWhere({
  state,
  sharing,
  viewers,
  live,
  selected,
}: {
  state: ClientSessionState;
  sharing: LiveSharing;
  viewers: Viewer[];
  live: boolean;
  selected: boolean;
}) {
  const { connected, run } = useSessionGate();
  if (!live && selected) return <WhereBox state={state} connected={connected} run={run} />;
  return (
    <div className="side-where mt-3.5 -mx-1 flex items-start gap-2 rounded-2xl px-3 pt-2 pb-2.5">
      <span className="grid min-w-0 flex-1 gap-1.5">
        <span className="text-xs text-muted-foreground">Where it plays</span>
        <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-sm font-medium">
          <Summary viewers={viewers} live={live} picture={!!sharing.source.video} />
        </span>
      </span>
      {live ? (
        <AddSpeakers sharing={sharing} viewers={viewers} icon />
      ) : (
        <ChooseWhere sharing={sharing} icon />
      )}
    </div>
  );
}

/** Who gets it, in a few words: "10 listening", each device with what it gives, or that nobody does yet. */
function Summary({
  viewers,
  live,
  picture,
}: {
  viewers: Viewer[];
  live: boolean;
  picture: boolean;
}) {
  if (live)
    return (
      <span className="inline-flex items-center gap-1.5">
        {viewers.length > 0 && <Headphones aria-hidden="true" className="size-3.5" />}
        {viewers.length ? `${viewers.length} listening` : "No listeners yet"}
      </span>
    );
  if (!viewers.length)
    return (
      <span className="text-muted-foreground">
        {picture ? "Not playing anywhere yet" : "Not playing on any speaker yet"}
      </span>
    );
  return viewers.map((viewer) => (
    <span
      key={viewer.device.id}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
    >
      {viewer.picture && (
        <Monitor aria-label="Picture" className="size-3.5 text-muted-foreground" />
      )}
      {viewer.sound && <Volume2 aria-label="Sound" className="size-3.5 text-muted-foreground" />}
      {viewer.device.id === deviceId() ? "This device" : viewer.device.name}
    </span>
  ));
}
