import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AudioLines,
  ChevronDown,
  CircleAlert,
  Headphones,
  Mic,
  MicOff,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  SlidersVertical,
  Volume2,
} from "lucide-react";
import { Level } from "@/components/Level";
import { LiveClock } from "@/components/LiveClock";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePlayOn } from "@/components/PlayOn";
import { toolPanel } from "@/components/PlaybackTransport";
import { cn } from "@/lib/utils";
import type { LiveSharing } from "@/session/live";
import type { LiveRoute } from "@/session/live-route";
import type { ClientSessionState } from "@/session/session";
import { deviceId } from "@/session/device-id";
import { errorText, useSessionGate } from "@/session/session-context";
import { PlayingChip, WhereBox } from "@/sections/shell/NowPlayingParts";
import { WhereItPlays } from "@/sections/shell/Outputs";
import type { PlayerSize } from "@/sections/shell/NowPlaying";
import type { PlayerSide } from "@/sections/shell/player-side";
import { formatClock } from "@/time-format";
import {
  liveTitle,
  type LiveVideoFrameRate,
  type LiveVideoQuality,
} from "../../../shared/live-input";
import type { Action } from "../../../shared/protocol";
import { InputLevel, useInputStream } from "./InputLevel";
import { LiveMetadataEditor } from "./LiveMetadata";
import { LiveSettings } from "./LiveOperator";
import { SharingPill } from "./ShareControl";
import { openShareFull } from "./share-view";
import {
  frameRateLabels,
  qualityLabels,
  shareKindOf,
  viewerLine,
  viewersOf,
  type Viewer,
} from "./share";

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
  // A native input's level, read from the same device as the browser names it.
  const meter = useInputStream(sharing?.meterId);
  if (!sharing || !source) return null;
  const input = sharing.input ?? meter ?? undefined;
  const parts = shareParts(
    state,
    sharing,
    connected,
    run,
    changed,
    playback?.id === state.playback,
    input,
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
  input: MediaStream | undefined,
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
        input={source.kind === "microphone" ? input : undefined}
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
  input,
}: {
  sharing: LiveSharing;
  title: string;
  what: string;
  capture?: string;
  live: boolean;
  input?: MediaStream;
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
      {input && <InputLevel stream={input} muted={sharing.muted} className="my-1" />}
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

/** Watching, Listening or Listeners: each device, how it gets the share, and Live audio's Remove. */
function Audience({
  sharing,
  viewers,
  routes,
  live,
  className,
}: {
  sharing: LiveSharing;
  viewers: Viewer[];
  routes: Record<string, LiveRoute>;
  live: boolean;
  className?: string;
}) {
  const { run, connected } = useSessionGate();
  const list = useRef<HTMLUListElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const picture = !!sharing.source.video;
  const heading = live ? "Listeners" : picture ? "Watching" : "Listening";
  const trouble = viewers.filter(
    (viewer) => viewer.error || viewer.state === "behind" || viewer.state === "stalled",
  ).length;
  const relayed = viewers.some((viewer) => viewer.state === "relayed");
  return (
    <div className={cn("mt-3.5 flex flex-col border-t pt-2", className)}>
      <div className="flex min-h-8 items-center gap-2">
        <h3 className="font-heading text-sm font-semibold">{heading}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {viewers.length > 0 && `${viewers.length}${trouble ? `, ${trouble} with trouble` : ""}`}
        </span>
        <span className="flex-1" />
        {live && <AddSpeakers sharing={sharing} viewers={viewers} />}
      </div>
      <ul
        ref={list}
        tabIndex={-1}
        aria-label={heading}
        className="-mx-1 grid min-h-0 content-start overflow-y-auto px-1 outline-none"
      >
        {viewers.map((viewer) => (
          <li
            key={viewer.device.id}
            className="flex min-h-11 items-center gap-2 border-b border-border/60 py-1 last:border-b-0"
          >
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm" title={viewer.device.name}>
                {viewer.device.id === deviceId()
                  ? `${viewer.device.name}, this device`
                  : viewer.device.name}
              </span>
              <span
                role={viewer.error ? "alert" : undefined}
                className={cn(
                  "text-xs [overflow-wrap:anywhere]",
                  viewer.error ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {viewer.error && (
                  <CircleAlert
                    aria-hidden="true"
                    className="mr-1 inline size-[1.1em] -translate-y-px text-destructive"
                  />
                )}
                {viewerLine(viewer, routes[viewer.device.id])}
              </span>
            </span>
            {viewer.sound && (
              <Level
                moving={
                  viewer.playing &&
                  viewer.state !== "joining" &&
                  viewer.state !== "stalled" &&
                  !viewer.error &&
                  !viewer.device.muted &&
                  viewer.device.volume > 0
                }
                className="text-muted-foreground"
              />
            )}
            {live && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!connected || pending === viewer.device.id}
                    aria-label={`Options for ${viewer.device.name}`}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  data-tv-local-only
                  align="end"
                  onCloseAutoFocus={(event) => {
                    if (pending !== viewer.device.id) return;
                    event.preventDefault();
                    list.current?.focus();
                  }}
                >
                  <DropdownMenuItem
                    onSelect={() => {
                      setPending(viewer.device.id);
                      void run({
                        type: "removeLiveListener",
                        playbackId: viewer.playbackId,
                        deviceId: viewer.device.id,
                      }).finally(() => setPending(null));
                    }}
                  >
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}
      </ul>
      {!viewers.length && (
        <div className="grid justify-items-start gap-2 pt-1">
          <p role="status" className="text-xs text-muted-foreground">
            {live
              ? "No listeners yet. People join from Home, under Shared sources."
              : `Still sharing, on no ${picture ? "screens" : "speakers"}. It waits in Shared sources for anyone to play.`}
          </p>
          {!live && <ChooseWhere sharing={sharing} />}
        </div>
      )}
      {relayed && (
        <p className="pt-2 text-xs text-muted-foreground">
          {sharing.relay ? (
            "A device playing through Couch couldn't connect directly, even through the relay."
          ) : (
            <>
              A device playing through Couch couldn't connect directly. A relay can fix that, in{" "}
              <Link
                to="/settings/couch/devices"
                className="text-foreground underline underline-offset-4"
              >
                Devices &amp; network
              </Link>
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Choose where it plays, for a share nobody plays yet: Play on's devices but this one, which never plays its own share;
 * it plays at once on the one chosen.
 */
function ChooseWhere({ sharing, icon = false }: { sharing: LiveSharing; icon?: boolean }) {
  const { run, connected } = useSessionGate();
  const { devices } = usePlayOn();
  const label = "Choose where it plays";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={icon ? "ghost" : "secondary"}
          size={icon ? "icon" : "sm"}
          className={icon ? "-mr-1.5 -mt-1 size-8" : "rounded-full"}
          disabled={!connected}
          aria-label={label}
          title={label}
        >
          <SlidersVertical aria-hidden="true" />
          {!icon && label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-tv-local-only align="start" className="max-w-80">
        <DropdownMenuLabel>Play on</DropdownMenuLabel>
        {devices
          .filter((device) => device.id !== sharing.source.deviceId)
          .map((device) => (
            <DropdownMenuItem
              key={device.id}
              className="break-words"
              onSelect={() =>
                void run({ type: "playLive", sourceId: sharing.source.id, deviceId: device.id })
              }
            >
              {device.name}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Add speakers, for Live audio's operator: every speaker that lends its sound, this computer's own included (an input
 * is never held out of its share), each turned on or off at once. People on their phones join by themselves.
 */
function AddSpeakers({
  sharing,
  viewers,
  icon = false,
}: {
  sharing: LiveSharing;
  viewers: Viewer[];
  icon?: boolean;
}) {
  const { state, run, connected } = useSessionGate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const here = deviceId();
  const devices = (state?.devices ?? []).filter((device) => device.online);
  const label = "Add speakers";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size={icon ? "icon" : "sm"}
          className={icon ? "-mr-1.5 -mt-1 size-8" : "-mr-2 h-8 text-xs"}
          aria-label={label}
          title={label}
        >
          {icon ? <SlidersVertical aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {!icon && label}
        </Button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          {...toolPanel(trigger.current)}
          data-tv-local-only
          aria-label="Speakers that listen"
          className="max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-2rem))] gap-2 overflow-y-auto p-3"
        >
          <p className="font-heading text-base font-semibold">Speakers that listen</p>
          <p className="text-xs text-muted-foreground">
            A speaker that lends its sound can listen too. People on their phones join by
            themselves, from Home.
          </p>
          <ul className="grid">
            {devices.map((device) => {
              const viewer = viewers.find((item) => item.device.id === device.id);
              const lends = device.id === here || !!device.sharing?.audio;
              return (
                <li key={device.id} className="flex min-h-11 items-center gap-2 border-t py-1">
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm">{device.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {device.id === here
                        ? "This device"
                        : !lends
                          ? "Private"
                          : viewer
                            ? "Listening"
                            : ""}
                    </span>
                  </span>
                  <Button
                    variant={viewer ? "default" : "secondary"}
                    size="icon"
                    className="rounded-full"
                    aria-pressed={!!viewer}
                    aria-label={`Sound on ${device.name}`}
                    title={lends ? `Sound on ${device.name}` : "Private"}
                    disabled={!connected || !lends || pending === device.id}
                    onClick={() => {
                      setPending(device.id);
                      void run(
                        viewer
                          ? {
                              type: "removeLiveListener",
                              playbackId: viewer.playbackId,
                              deviceId: device.id,
                            }
                          : { type: "playLive", sourceId: sharing.source.id, deviceId: device.id },
                      ).finally(() => setPending(null));
                    }}
                  >
                    <Volume2 aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      )}
    </Popover>
  );
}

/** The gear: what the capture can change while it runs. Picture and Frame rate; Codec, Capture buffer, Input channels. */
function ShareGear({
  sharing,
  picture,
  live,
  onChange,
}: {
  sharing: LiveSharing;
  picture: boolean;
  live: boolean;
  onChange: () => void;
}) {
  const { liveSharing, setError } = useSessionGate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const gear = (
    <Button
      ref={trigger}
      variant="ghost"
      size="icon-lg"
      aria-label={picture ? "Picture" : "Live audio settings"}
      title={picture ? "Picture" : "Live audio settings"}
    >
      <Settings aria-hidden="true" />
    </Button>
  );
  if (picture)
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>{gear}</DropdownMenuTrigger>
        <DropdownMenuContent data-tv-local-only align="end" className="w-64">
          <DropdownMenuLabel>Picture</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sharing.quality}
            onValueChange={(quality) =>
              void liveSharing
                .setQuality(quality as LiveVideoQuality)
                .then(onChange, (reason) => setError(errorText(reason)))
            }
          >
            {Object.entries(qualityLabels).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Frame rate</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(sharing.frameRate)}
            onValueChange={(rate) =>
              void liveSharing
                .setFrameRate(Number(rate) as LiveVideoFrameRate)
                .then(onChange, (reason) => setError(errorText(reason)))
            }
          >
            {Object.entries(frameRateLabels).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
            At most; your screen may give fewer.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  if (!live) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{gear}</PopoverTrigger>
      {open && (
        <PopoverContent
          {...toolPanel(trigger.current)}
          data-tv-local-only
          aria-label="Live audio settings"
          className="w-[min(22rem,calc(100vw-2rem))] p-3"
        >
          <LiveSettings sharing={sharing} onCaptureChange={onChange} />
        </PopoverContent>
      )}
    </Popover>
  );
}

/** Mute audio input, where Play stands: it silences the input for everyone, keeping the share and its listeners. */
function MuteInput({
  sharing,
  muted,
  onChange,
}: {
  sharing: LiveSharing;
  muted: boolean;
  onChange: () => void;
}) {
  const { liveSharing, connected } = useSessionGate();
  const label = muted ? "Unmute audio input" : "Mute audio input";
  return (
    <Button
      variant={muted ? "secondary" : "default"}
      size="icon-lg"
      className="size-11.5 rounded-full"
      aria-pressed={muted}
      aria-label={label}
      title={label}
      disabled={!connected}
      onClick={() => {
        liveSharing.setMuted(!sharing.muted);
        onChange();
      }}
    >
      {muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
    </Button>
  );
}

/** Each receiver's route, as its connection selected it, read every two seconds while the player shows the share. */
function useRoutes(sharing: LiveSharing | null) {
  const { liveSharing } = useSessionGate();
  const [routes, setRoutes] = useState<Record<string, LiveRoute>>({});
  const pcm = sharing?.source.audioDelivery === "pcm";
  useEffect(() => {
    if (!sharing || pcm) return;
    let live = true;
    const read = () =>
      void liveSharing.routes().then((next) => {
        if (live) setRoutes(next);
      });
    read();
    const timer = setInterval(read, 2_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [liveSharing, sharing?.source.id, pcm]);
  return routes;
}
