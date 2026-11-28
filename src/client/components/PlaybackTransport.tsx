import { usePlaybackClock } from "@/session/playback-clock";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ClientSessionState } from "@/session/session";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { PlayButton, Time, TimeSlider, useMedia } from "@videojs/react";
import { Pause, Play, RotateCcw, SkipForward, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Action } from "../../shared/protocol";
import { isRadio } from "../../shared/radio";
import { heldOutOf, liveTitle } from "../../shared/live-input";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { adjust } from "@/navigation";
import { formatDuration, formatEndTime } from "@/time-format";
import { RangeControl } from "./RangeControl";
import { PlaybackThumbnail } from "./PlaybackThumbnail";
import { useDurationClock } from "./DurationBar";
import { CouchMedia } from "@/session/couch-media";
import { livePlayback, playbackControls } from "@/session/playback-controls";
import { LiveClock } from "./LiveClock";
import { subscribeTapToHear, tapToHear as hear, waitingForTap } from "@/session/tap-to-hear";
import { leftLive } from "@/toasts";

/** Whether this browser waits for a tap before it plays sound: the player then offers Tap to hear where Play is. */
const useWaitingForTap = () => useSyncExternalStore(subscribeTapToHear, waitingForTap, () => false);
function TapToHear({ pageFirst, children }: { pageFirst?: boolean; children: ReactNode }) {
  if (!useWaitingForTap()) return children;
  return (
    <Button
      data-page-first={pageFirst}
      className="h-(--player-target) rounded-full px-4"
      onClick={hear}
    >
      Tap to hear
    </Button>
  );
}

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};

// Fade the completed glyph: translucent fill and stroke would overlap into a bright contour.
const transportInk =
  "text-foreground active:text-foreground [&_svg]:opacity-80 motion-safe:[&_svg]:transition-opacity motion-safe:[&_svg]:duration-150 hover:[&_svg]:opacity-100 active:[&_svg]:opacity-60 focus-visible:[&_svg]:opacity-100 focus-visible:[&_svg]:duration-0";

export function playbackCapabilities(state: ClientSessionState | null, connected: boolean) {
  const controls = playbackControls(state);
  const player = state?.player;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const live = current?.endless || isRadio(current);
  const available = connected && !!player && player.status !== "unavailable";
  const currentIndex = state?.queue.findIndex((entry) => entry.id === state.currentEntryId) ?? -1;
  // A stall mid-watch (a seek, too) reports "loading" with buffering: the item has started, as in Core's session.
  const transportReady =
    available &&
    !!player?.playbackId &&
    (["playing", "paused"].includes(player.status) ||
      (player.status === "loading" && player.buffering === true));
  // Captures keep programme controls without seeking; paused external live media can still resume.
  const pausable =
    controls.programme &&
    (!live || !!current?.liveSourceId || !!player?.seekable || player?.status === "paused");
  return {
    available,
    active: !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status),
    playing:
      player?.status === "playing" || (player?.status === "loading" && player.buffering === true),
    // Stop clears whatever is current: loading or playing, paused, finished or failed.
    stoppable:
      controls.programme &&
      available &&
      !!current &&
      !!player &&
      ["loading", "playing", "paused", "ended", "error"].includes(player.status),
    audioReady: !state?.systemAudio || state.systemAudio.volume !== null,
    transportReady,
    nextReady:
      controls.programme &&
      controls.queue &&
      available &&
      !!player?.playbackId &&
      ["loading", "playing", "paused", "ended", "error"].includes(player.status),
    seekable: controls.seek && !!player?.seekable,
    pausable,
    canTogglePaused:
      !!current &&
      (player?.status === "ended" ? available && controls.programme : transportReady && pausable),
    programme: controls.programme,
    hasNext:
      currentIndex >= 0 &&
      (currentIndex < (state?.queue.length ?? 0) - 1 ||
        (!!state?.autoplay?.enabled &&
          (!!state.autoplay.upcoming.length || !!state.autoplay.pending))),
  };
}

/**
 * Secondary timing for what plays: "ends 21:42" in clock time; nothing for live media, without a length or once
 * it has ended. The duration clock keeps a paused item's end time moving.
 */
export function useEndTime(state: ClientSessionState | null | undefined) {
  const playbackClock = usePlaybackClock();
  useDurationClock();
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  if (
    !state ||
    !current ||
    (!["playing", "paused"].includes(state.player.status) &&
      !(state.player.status === "loading" && state.player.buffering))
  )
    return undefined;
  if (current.endless || isRadio(current)) return undefined;
  const length = playbackClock.duration || current.duration || 0;
  return length
    ? `ends ${formatEndTime((length - playbackClock.position) / (state.player.speed || 1))}`
    : undefined;
}

// Video.js's slider drops a drag without onDragEnd when it unmounts mid-drag; release it so later seeks still send.
function ReleaseDragOnUnmount({ media }: { media: unknown }) {
  useEffect(
    () => () => {
      if (media instanceof CouchMedia) media.scrub(false);
    },
    [media],
  );
  return null;
}

/**
 * Position, the timeline and "−3:24 ends 20:59", only where a timeline means something: media that seeks,
 * or has a length to seek through once loaded (the slider stays, disabled, meanwhile). Live media that
 * can't seek shows nothing: no bar, no position, no total. A hovering pointer reads the time under it.
 * Video.js's TimeSlider and Time read the CouchMedia that CouchPlayer attaches; a drag sends one seek on release.
 */
export function PlaybackTimeline({
  state,
  connected,
  pageFirst = false,
  compact = false,
  said = false,
  className,
}: Omit<Props, "run"> & {
  pageFirst?: boolean;
  compact?: boolean;
  /** Says what is left in words, "2:14 left, ends 19:09", as the side player does. */
  said?: boolean;
  className?: string;
}) {
  const playbackClock = usePlaybackClock();
  const media = useMedia();
  const player = state.player;
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const { seekable, transportReady } = playbackCapabilities(state, connected);
  if (!current || !playbackControls(state).seek) return null;
  const live = current.endless || isRadio(current);
  const length = playbackClock.duration || current.duration || 0;
  const remaining = (length - playbackClock.position) / (player.speed || 1);
  const canSeek = seekable && !!playbackClock.duration;
  if (!canSeek && (live || !length)) return null;
  const chapters =
    player.chapters?.filter(
      (chapter) => chapter.position > 0 && chapter.position < (playbackClock.duration ?? 0),
    ) ?? [];
  const chapter = player.chapters?.findLast((item) => item.position <= playbackClock.position);
  const disabled = !transportReady || !canSeek;
  const scrub = (active: boolean) => {
    if (media instanceof CouchMedia) media.scrub(active);
  };
  return (
    <div className={cn("grid gap-1", compact && "player-timeline", className)}>
      <div className="relative">
        <TimeSlider.Root
          data-slot="slider"
          data-playback-seek
          label="Playback position"
          step={10}
          largeStep={60}
          disabled={disabled}
          className="group/slider relative flex h-6 w-full cursor-pointer items-center touch:min-h-11 select-none data-disabled:cursor-default data-disabled:opacity-50"
          onDragStart={() => scrub(true)}
          onDragEnd={() => scrub(false)}
          onKeyDownCapture={(event) => {
            // Down leaves the timeline for Play/Pause, as on a TV remote, rather than seeking back.
            if (event.key !== "ArrowDown" || event.altKey || event.ctrlKey || event.metaKey) return;
            const play = event.currentTarget
              .closest(".player-page")
              ?.querySelector<HTMLElement>("[data-play-button]:not(:disabled)");
            if (!play) return;
            event.preventDefault();
            event.stopPropagation();
            play.focus();
          }}
        >
          <TimeSlider.Track
            data-slot="slider-track"
            className="relative h-1 w-full rounded-full bg-muted"
          >
            {canSeek && (
              <TimeSlider.Buffer
                data-slot="slider-buffered"
                className="absolute inset-y-0 left-0 w-(--media-slider-buffer) rounded-full bg-foreground/35"
              />
            )}
            <TimeSlider.Fill
              data-slot="slider-range"
              className="absolute inset-y-0 left-0 w-(--media-slider-fill) rounded-full bg-primary"
            />
          </TimeSlider.Track>
          <TimeSlider.Thumb
            data-slot="slider-thumb"
            data-page-first={pageFirst || undefined}
            className="absolute left-(--media-slider-fill) block size-3 -translate-x-1/2 rounded-full border border-ring bg-foreground ring-ring/30 after:absolute after:-inset-2 group-not-data-disabled/slider:group-hover/slider:ring-2 focus-visible:ring-2 focus-visible:outline-hidden"
          />
          <TimeSlider.Preview
            data-timeline-preview
            aria-hidden="true"
            className="bottom-[calc(50%+.5rem)] rounded-sm bg-background text-center text-meta tabular-nums"
            render={(props, slider) => (
              <div {...props} hidden={disabled || (!slider.pointing && !slider.dragging)} />
            )}
          >
            {/* The pointer's time, in seconds, picks the preview frame Core serves for this Playback. */}
            <TimeSlider.Value
              type="pointer"
              format={String}
              render={(props, slider) => {
                const time =
                  disabled || (!slider.pointing && !slider.dragging)
                    ? null
                    : Number(props.children);
                return (
                  <div>
                    {player.playbackId && (
                      <PlaybackThumbnail playbackId={player.playbackId} time={time} />
                    )}
                    <output
                      {...props}
                      data-hover-time={time === null ? undefined : ""}
                      className="block px-1.5 py-0.5"
                    >
                      {time === null ? null : formatDuration(Math.round(time))}
                    </output>
                  </div>
                );
              }}
            />
          </TimeSlider.Preview>
        </TimeSlider.Root>
        <ReleaseDragOnUnmount media={media} />
        {/* Marks over the track, outside the slider: Video.js restyles the slider's whole subtree on every pointer move. */}
        {canSeek && chapters.length > 0 && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2",
              disabled && "opacity-50",
            )}
          >
            {chapters.map((item) => (
              <span
                key={item.position}
                data-chapter-tick
                className="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 bg-background"
                style={{ left: `${(item.position / playbackClock.duration!) * 100}%` }}
              />
            ))}
          </div>
        )}
      </div>
      <div
        data-time-labels
        className="flex justify-between gap-4 text-sm tabular-nums text-muted-foreground"
      >
        <span className="min-w-0 truncate">
          <Time.Value type="current" className="text-foreground" />
          {chapter && (
            <span data-current-chapter className="ml-3">
              {chapter.title}
            </span>
          )}
        </span>
        <span className="shrink-0">
          {!live && length ? (
            said ? (
              <>
                <Time.Value type="remaining" negativeSign="" /> left,
                <span data-end-time> ends {formatEndTime(remaining)}</span>
              </>
            ) : (
              <>
                <Time.Value type="remaining" negativeSign="−" />
                <span data-end-time> ends {formatEndTime(remaining)}</span>
              </>
            )
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** "23:13 / 25:27", where the timeline shows: the full player's row says it beside Volume. */
export function PlaybackTime({
  state,
  className,
}: {
  state: ClientSessionState;
  className?: string;
}) {
  const playbackClock = usePlaybackClock();
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  if (!current || !playbackControls(state).seek) return null;
  const length = playbackClock.duration || current.duration || 0;
  if (current.endless || isRadio(current) || !length) return null;
  return (
    <span data-player-time className={cn("text-sm whitespace-nowrap tabular-nums", className)}>
      <Time.Value type="current" /> / <Time.Value type="duration" />
    </span>
  );
}

const slotLabel = (button: { ended: boolean; paused: boolean }, failed: boolean) =>
  failed ? "Try again" : button.ended ? "Replay" : button.paused ? "Play" : "Pause";

/**
 * Play/Pause, Stop and Next, each in its slot for every kind of media: the band, Now playing and the remote pad,
 * the same ghost icons everywhere (`icon-lg`: a 1.25rem glyph); each place sets only the target's size.
 * The first slot is Replay once ended, Try again after an error, else Play or Pause (disabled for live media that can't pause).
 * With `pageFirst`, a page change's first key lands on the first enabled slot. Keys and the timeline seek.
 * Now playing and the full player (`quiet`) read Play/Pause, Next, then Stop, as YouTube's and Twitch's players lead
 * with Play and Next. Every one is an icon of one size, named by its label and tooltip.
 */
export function PlaybackTransport({
  state,
  connected,
  run,
  pageFirst = false,
  className,
  participation = true,
  quiet = false,
  next: skip = true,
  onLeft,
}: Props & {
  pageFirst?: boolean;
  className?: string;
  participation?: boolean;
  quiet?: boolean;
  /** Next, left out where the place is short (a phone's dock keeps it for its sheet and the full player). */
  next?: boolean;
  /** Leaving Live audio closes the player that showed it. */
  onLeft?: () => void;
}) {
  const player = state.player;
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const { available, transportReady, pausable, stoppable, nextReady, hasNext, programme } =
    playbackCapabilities(state, connected);
  if (livePlayback(state))
    return participation ? (
      <LiveParticipation
        key={state.playback}
        state={state}
        connected={connected}
        run={run}
        pageFirst={pageFirst}
        quiet={quiet}
        onLeft={onLeft}
        className={className}
      />
    ) : null;
  const ended = player.status === "ended" && !!current,
    failed =
      (player.status === "error" ||
        (player.status === "loading" && state.radioRetry?.retryAt != null)) &&
      !!current;
  const enabled = [
    ended || failed ? available && programme : transportReady && pausable,
    stoppable,
    nextReady && hasNext,
  ];
  const first = (slot: number) => (pageFirst && enabled.indexOf(true) === slot) || undefined;
  const stop = (
    <Button
      data-page-first={first(1)}
      variant="ghost"
      size="icon-lg"
      className={transportInk}
      aria-label="Stop"
      title="Stop"
      disabled={!enabled[1]}
      onClick={() => void run({ type: "stop" })}
    >
      <Square aria-hidden="true" className="fill-current" />
    </Button>
  );
  const next = (
    <Button
      data-page-first={first(2)}
      variant="ghost"
      size="icon-lg"
      className={transportInk}
      aria-label="Next"
      title="Next"
      disabled={!enabled[2]}
      onClick={() => {
        if (player.playbackId) void run({ type: "next", playbackId: player.playbackId });
      }}
    >
      <SkipForward aria-hidden="true" className="fill-current" />
    </Button>
  );
  return (
    <div
      className={cn("flex shrink-0 items-center gap-0.5", className)}
      role="group"
      aria-label="Playback controls"
    >
      {/* A browser that needs a gesture before it plays sound asks for one here, in Play's place (#644). */}
      <TapToHear pageFirst={first(0)}>
        {/* Video.js's own Play button: CouchMedia sends Play, Pause, Replay and Try again to Core. */}
        <PlayButton
          disabled={!enabled[0]}
          label={(button) => slotLabel(button, failed)}
          render={(props, button) => (
            <Button
              {...props}
              data-page-first={first(0)}
              data-play-button
              variant="ghost"
              size="icon-lg"
              className={transportInk}
              title={slotLabel(button, failed)}
              disabled={!enabled[0]}
            >
              {button.ended || failed ? (
                <RotateCcw aria-hidden="true" />
              ) : button.paused ? (
                <Play aria-hidden="true" className="fill-current" />
              ) : (
                <Pause aria-hidden="true" className="fill-current" />
              )}
            </Button>
          )}
        />
      </TapToHear>
      {/* A share follows its source: nothing to skip. */}
      {quiet ? skip && !current?.liveSourceId && next : stop}
      {quiet ? stop : skip && !current?.liveSourceId && next}
    </div>
  );
}

/**
 * Audience membership is local; leaving never pauses or stops the source. Leaving closes the player here, and its message
 * offers Join again. While the browser waits for a tap, Tap to hear takes Join's place, with Leave beside it. `quiet`
 * (Now playing's sizes) keeps the buttons; the side player and the dock say the rest in their own lines.
 */
export function LiveParticipation({
  state,
  connected,
  run,
  pageFirst,
  quiet = false,
  onLeft,
  className,
}: Props & { pageFirst?: boolean; quiet?: boolean; onLeft?: () => void; className?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const controls = playbackControls(state);
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const source = state.liveSources?.find((item) => item.id === playback?.liveSourceId);
  const receiving = controls.leave;
  const publisher = !!source && heldOutOf(source) === deviceId();
  const output = state.outputs?.find((output) => output.deviceId === deviceId());
  const error = receiving ? output?.error || state.player.error : null;
  const waiting = useWaitingForTap() && receiving;
  if (!source || publisher) return null;
  const label = receiving ? "Leave" : "Join";
  const join = () => void run({ type: "playLive", sourceId: source.id, deviceId: deviceId() });
  return (
    <div
      data-live-participation
      className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}
    >
      {!quiet && (
        <span className="text-sm text-muted-foreground">
          <LiveClock startedAt={source.startedAt} />
        </span>
      )}
      {waiting && (
        <Button
          data-page-first={pageFirst || undefined}
          className="h-(--player-target) rounded-full px-5"
          onClick={hear}
        >
          Tap to hear
        </Button>
      )}
      <Button
        data-page-first={(!waiting && pageFirst) || undefined}
        variant={waiting ? "ghost" : "default"}
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        className={cn(
          "aria-disabled:opacity-50",
          !waiting && "h-(--player-target) rounded-full px-5",
        )}
        disabled={!connected || (receiving && !state.player.playbackId)}
        onClick={async () => {
          if (busy.current || (receiving && !state.player.playbackId)) return;
          busy.current = true;
          setPending(true);
          setFailed(false);
          try {
            const done = await run(
              receiving
                ? { type: "leave", playbackId: state.player.playbackId! }
                : { type: "playLive", sourceId: source.id, deviceId: deviceId() },
            );
            setFailed(!done);
            if (done && receiving) {
              leftLive(liveTitle(source), join);
              onLeft?.();
            }
          } catch {
            setFailed(true);
          } finally {
            busy.current = false;
            setPending(false);
          }
        }}
      >
        {pending ? (receiving ? "Leaving…" : "Joining…") : label}
      </Button>
      <span
        role="status"
        className={cn(
          "min-w-0 text-sm text-muted-foreground empty:hidden [overflow-wrap:anywhere]",
          (pending || quiet) && "sr-only",
        )}
      >
        {pending
          ? receiving
            ? "Leaving…"
            : "Joining…"
          : receiving && !error
            ? !connected
              ? "Reconnecting…"
              : waiting
                ? "Sound is waiting for a tap."
                : state.player.status === "playing" && !state.player.buffering
                  ? "Listening"
                  : "Waiting for audio…"
            : ""}
      </span>
      {(error || failed) &&
        (quiet ? (
          <span role="alert" className="min-w-0 truncate text-xs text-muted-foreground">
            {error || `Couldn't ${receiving ? "leave" : "join"}. Try again.`}
          </span>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              {error || `Couldn't ${receiving ? "leave" : "join"}. Try again.`}
            </AlertDescription>
          </Alert>
        ))}
    </div>
  );
}

/**
 * Whether the controlled Devices are muted: every one in the controlled Playback's sound, else the controlled Device.
 * Like Core's Volume, it reads only the sound this device may control while there is any, since that is what Mute moves.
 */
export function muted(state: ClientSessionState | null | undefined) {
  if (livePlayback(state))
    return state?.devices?.find((device) => device.id === deviceId())?.muted ?? false;
  const sounding = new Set(
    state?.outputs?.filter((output) => output.sound).map((output) => output.deviceId),
  );
  if (!sounding.size) sounding.add(state?.controlling ?? deviceId());
  const devices = state?.devices?.filter((device) => sounding.has(device.id)) ?? [],
    moved = devices.filter((device) => device.id === deviceId() || device.sharing?.audio === true);
  const read = moved.length ? moved : devices;
  return read.length > 0 && read.every((device) => device.muted);
}

/** The controlled Devices' volume: the loudest one this device may control, as Core reports it; moving it scales those. */
export function PlaybackVolume({
  state,
  connected,
  run,
  showSlider = true,
  showValue = true,
  className,
  targetDeviceId,
}: Props & {
  showSlider?: boolean;
  showValue?: boolean;
  className?: string;
  targetDeviceId?: string;
}) {
  const { available, audioReady } = playbackCapabilities(state, connected);
  const target = targetDeviceId ?? (livePlayback(state) ? deviceId() : undefined);
  const device = state.devices?.find((item) => item.id === target);
  const silent = device?.muted ?? muted(state);
  const level = device?.volume ?? state.player.volume;
  const ready = target ? connected && !!device?.online : available && audioReady;
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2", showSlider && "min-w-40 flex-1", className)}
      data-volume
      role="group"
      aria-label="Volume"
    >
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={silent ? "Unmute" : "Mute"}
        title={silent ? "Unmute" : "Mute"}
        disabled={!ready}
        onClick={() =>
          void run({ type: "mute", muted: !silent, ...(target ? { deviceId: target } : {}) })
        }
      >
        {silent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </Button>
      {showSlider && (
        <RangeControl
          label={livePlayback(state) && !targetDeviceId ? "Your volume" : "Volume"}
          value={level}
          max={100}
          disabled={!ready}
          // A remote's press moves Volume 2, fine enough for a level between quiet and loud.
          keyboardStep={isTvPresentation() ? 2 : 1}
          onCommit={(volume) =>
            run({ type: "volume", volume, ...(target ? { deviceId: target } : {}) })
          }
        />
      )}
      {/* Its number reads like each device fader's, with no "%". */}
      {showValue && (
        <span className="w-[3ch] shrink-0 text-right tabular-nums">
          {!target && state.systemAudio?.volume === null ? "—" : Math.round(level)}
        </span>
      )}
    </div>
  );
}

/**
 * Where a player control's panel opens (Volume, Where it plays, the gear's menu): from its own button, growing up from
 * the button's outer edge (its right edge in the right half of the screen, its left edge in the left), so the panel
 * is plainly that button's. In the band, the capsule and the dock it clears their whole row, timeline included. Read
 * as the panel opens.
 */
export function toolPanel(trigger: HTMLElement | null): {
  side: "top" | "right" | "left";
  align: "start" | "end";
  sideOffset?: number;
} {
  if (!trigger) return { side: "top", align: "end" };
  const at = trigger.getBoundingClientRect(),
    align = at.left + at.width / 2 < window.innerWidth / 2 ? "start" : "end",
    row = trigger.closest<HTMLElement>("[data-player-band], [data-now-playing]");
  if (!row) return { side: "top", align };
  // The side player stands the window's height at one edge (Player side): its panels open past its inner edge, over
  // the page, level with the control's top.
  if (row.matches('[data-size="side"]')) {
    const panel = row.getBoundingClientRect();
    return panel.left > window.innerWidth / 2
      ? { side: "left", align: "start", sideOffset: at.left - panel.left + 12 }
      : { side: "right", align: "start", sideOffset: panel.right - at.right + 12 };
  }
  // The full share fills the window: its panels hang just above their buttons.
  if (row.matches('[data-size="full"]')) return { side: "top", align, sideOffset: 8 };
  return { side: "top", align, sideOffset: at.top - row.getBoundingClientRect().top + 8 };
}

/** The band's volume for Live audio: a speaker that opens the slider and Mute in a Popover. */
/** Whether this device shares the Live audio it looks at: its own sound is the source, with no volume to set here. */
export function sharesLive(state: ClientSessionState) {
  const sourceId = state.playbacks?.find(
    (playback) => playback.id === state.playback,
  )?.liveSourceId;
  return !!state.liveSources?.some(
    (source) =>
      source.id === sourceId && source.intent === "live" && heldOutOf(source) === deviceId(),
  );
}

export function VolumeButton({ state, connected, run, className }: Props & { className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  // Controlled, so it places itself as it opens (toolPanel).
  const [open, setOpen] = useState(false);
  const tv = isTvPresentation();
  if (sharesLive(state)) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="icon-lg"
          className={className}
          aria-label="Volume"
          title="Volume"
        >
          {muted(state) ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          {...toolPanel(trigger.current)}
          aria-label="Volume controls"
          className="w-72"
          // A remote opens Volume on its level, the slider already taking Left and Right, rather than on Mute.
          onOpenAutoFocus={(event) => {
            const slider =
              tv && event.target instanceof HTMLElement
                ? event.target.querySelector<HTMLElement>('[role="slider"]')
                : null;
            if (!slider) return;
            event.preventDefault();
            slider.focus();
            adjust(slider);
          }}
        >
          <PlaybackVolume state={state} connected={connected} run={run} />
        </PopoverContent>
      )}
    </Popover>
  );
}
