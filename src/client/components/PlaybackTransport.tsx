import { liveListenerStatus } from "@/session/live-listener/status";
import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Pause, Play, RotateCcw, SkipForward, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Action } from "../../shared/protocol";
import { isRadio } from "../../shared/radio";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { formatDuration, formatEndTime } from "@/time-format";
import { RangeControl } from "./RangeControl";
import { useDurationClock } from "./DurationBar";
import { useBufferedEnd } from "@/session/buffered";
import { livePlayback, playbackControls } from "@/session/playback-controls";

type Props = { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean> };

// Fade the completed glyph: translucent fill and stroke would overlap into a bright contour.
const transportInk = "text-foreground active:text-foreground [&_svg]:opacity-80 motion-safe:[&_svg]:transition-opacity motion-safe:[&_svg]:duration-150 hover:[&_svg]:opacity-100 active:[&_svg]:opacity-60 focus-visible:[&_svg]:opacity-100 focus-visible:[&_svg]:duration-0";

export function playbackCapabilities(state: ClientSessionState | null, connected: boolean) {
  const controls = playbackControls(state);
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  const live = current?.live || isRadio(current);
  const available = connected && !!player && player.status !== "unavailable";
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  return {
    available,
    active: !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status),
    // Stop clears whatever is current: loading or playing, paused, finished or failed.
    stoppable: controls.programme && available && !!current && !!player && ["loading", "playing", "paused", "ended", "error"].includes(player.status),
    audioReady: !state?.systemAudio || state.systemAudio.volume !== null,
    // A stall mid-watch (a seek, too) reports "loading" with buffering: the item has started, as in Core's session.
    transportReady: available && !!player?.playbackId && (["playing", "paused"].includes(player.status) || player.status === "loading" && player.buffering === true),
    nextReady: controls.programme && controls.queue && available && !!player?.playbackId && ["loading", "playing", "paused", "ended", "error"].includes(player.status),
    seekable: controls.seek && !!player?.seekable,
    // Paused live media resumes, so it offers Play rather than a disabled Pause.
    pausable: controls.programme && (!live || !!player?.seekable || player?.status === "paused"),
    programme: controls.programme,
    hasNext: currentIndex >= 0 && (currentIndex < (state?.queue.length ?? 0) - 1 || !!state?.autoplay?.enabled && (!!state.autoplay.upcoming.length || !!state.autoplay.pending)),
  };
}

/**
 * Secondary timing for what plays: "ends 21:42" in clock time; nothing for live media, without a length or once
 * it has ended. The duration clock keeps a paused item's end time moving.
 */
export function useEndTime(state: ClientSessionState | null | undefined) {
  const playbackClock = usePlaybackClock();
  useDurationClock();
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  if (!state || !current || !["playing", "paused"].includes(state.player.status) && !(state.player.status === "loading" && state.player.buffering)) return undefined;
  if (current.live || isRadio(current)) return undefined;
  const length = playbackClock.duration || current.duration || 0;
  return length ? `ends ${formatEndTime((length - playbackClock.position) / (state.player.speed || 1))}` : undefined;
}

/**
 * Position, the timeline and "−3:24 ends 20:59", only where a timeline means something: media that seeks,
 * or has a length to seek through once loaded (the slider stays, disabled, meanwhile). Live media that
 * can't seek shows nothing: no bar, no position, no total. A hovering pointer reads the time under it.
 */
export function PlaybackTimeline({ state, connected, run, pageFirst = false, compact = false, className }: Props & { pageFirst?: boolean; compact?: boolean; className?: string }) {
  const playbackClock = usePlaybackClock();
  const player = state.player;
  const buffered = useBufferedEnd(player.playbackId);
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { seekable, transportReady } = playbackCapabilities(state, connected);
  if (!current || !playbackControls(state).seek) return null;
  const live = current.live || isRadio(current);
  const length = playbackClock.duration || current.duration || 0;
  const remaining = (length - playbackClock.position) / (player.speed || 1);
  const canSeek = seekable && !!playbackClock.duration;
  if (!canSeek && (live || !length)) return null;
  const chapters = player.chapters?.filter(chapter => chapter.position > 0 && chapter.position < (playbackClock.duration ?? 0)) ?? [];
  const chapter = player.chapters?.findLast(item => item.position <= playbackClock.position);
  const max = canSeek ? playbackClock.duration! : length;
  const disabled = !transportReady || !canSeek;
  return <div className={cn("grid gap-1", compact && "player-timeline", className)}>
    <TimelineHover max={max} disabled={disabled}><RangeControl key={player.playbackId || "idle"} label="Playback position" value={playbackClock.position || 0} max={max} showValue={false} keyboardStep={10} pageFirst={pageFirst} disabled={disabled} buffered={canSeek ? buffered : null}
      onCommit={async position => player.playbackId ? run({ type: "seek", playbackId: player.playbackId, position }) : false} />{canSeek && chapters.map(item => <span key={item.position} data-chapter-tick aria-hidden="true" className="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 bg-background" style={{ left: `${item.position / playbackClock.duration! * 100}%` }} />)}
    </TimelineHover>
    <div data-time-labels className="flex justify-between gap-4 text-sm tabular-nums text-muted-foreground">
      <span className="min-w-0 truncate"><span className="text-foreground">{formatDuration(playbackClock.position || 0)}</span>{chapter && <span data-current-chapter className="ml-3">{chapter.title}</span>}</span>
      <span className="shrink-0">{!live && length ? <>−{formatDuration(remaining)}<span data-end-time> ends {formatEndTime(remaining)}</span></> : null}</span>
    </div>
  </div>;
}

// Pointer previews own their state so moving over the bar doesn't render its slider, chapters or playback labels.
function TimelineHover({ max, disabled, children }: { max: number; disabled: boolean; children: ReactNode }) {
  const [hover, setHover] = useState<number | null>(null);
  const track = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType === "touch") return;
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (width) setHover(Math.min(1, Math.max(0, (event.clientX - left) / width)));
  };
  return <div className="relative @container" onPointerMove={track} onPointerLeave={() => setHover(null)}>
    {children}
    {/* Keep the preview above the handle and inside either end of the bar (100cqw). */}
    {hover !== null && !disabled && <span data-hover-time aria-hidden="true" className="pointer-events-none absolute bottom-[calc(50%+.5rem)] left-0 rounded-sm bg-background px-1.5 py-0.5 text-meta tabular-nums tv:hidden" style={{ translate: `clamp(0px, calc(${hover} * 100cqw - 50%), calc(100cqw - 100%))` }}>{formatDuration(Math.round(hover * max))}</span>}
  </div>;
}

/**
 * Play/Pause, Stop and Next, each in its slot for every kind of media: the band, the now-playing bar, Home's hero and the remote pad,
 * the same ghost icons everywhere (`icon-lg`: a 1.25rem glyph); each place sets only the target's size.
 * The first slot is Replay once ended, Try again after an error, else Play or Pause (disabled for live media that can't pause).
 * With `pageFirst`, a page change's first key lands on the first enabled slot. Keys and the timeline seek.
 * `moreClassName` styles Stop and Next, which the now-playing bar hides on phones.
 */
export function PlaybackTransport({ state, connected, run, pageFirst = false, className, moreClassName, participation = true }: Props & { pageFirst?: boolean; className?: string; moreClassName?: string; participation?: boolean }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { available, transportReady, pausable, stoppable, nextReady, hasNext, programme } = playbackCapabilities(state, connected);
  if (livePlayback(state)) return participation ? <LiveParticipation state={state} connected={connected} run={run} pageFirst={pageFirst} className={className} /> : null;
  const playing = player.status === "playing";
  const ended = player.status === "ended" && !!current, failed = (player.status === "error" || player.status === "loading" && state.radioRetry?.retryAt != null) && !!current;
  const pause = playing || !pausable;
  const label = ended ? "Replay" : failed ? "Try again" : pause ? "Pause" : "Play";
  const enabled = [ended || failed ? available && programme : transportReady && pausable, stoppable, nextReady && hasNext];
  const first = (slot: number) => pageFirst && enabled.indexOf(true) === slot || undefined;
  return <div className={cn("flex shrink-0 items-center gap-0.5", className)} role="group" aria-label="Playback controls">
    <Button data-page-first={first(0)} data-play-button variant="ghost" size="icon-lg" className={transportInk} aria-label={label} title={label} disabled={!enabled[0]}
      onClick={() => { if ((ended || failed) && current) void run({ type: "play", entryId: current.id, fromStart: ended }); else if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>
      {ended || failed ? <RotateCcw aria-hidden="true" /> : pause ? <Pause aria-hidden="true" className="fill-current" /> : <Play aria-hidden="true" className="fill-current" />}
    </Button>
    <Button data-page-first={first(1)} variant="ghost" size="icon-lg" className={cn(transportInk, moreClassName)} aria-label="Stop" title="Stop" disabled={!enabled[1]} onClick={() => void run({ type: "stop" })}><Square aria-hidden="true" className="fill-current" /></Button>
    <Button data-page-first={first(2)} variant="ghost" size="icon-lg" className={cn(transportInk, moreClassName)} aria-label="Next" title="Next" disabled={!enabled[2]}
      onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><SkipForward aria-hidden="true" className="fill-current" /></Button>
  </div>;
}

/** Audience membership is local; leaving never pauses or stops the source. */
export function LiveParticipation({ state, connected, run, pageFirst, className }: Props & { pageFirst?: boolean; className?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const controls = playbackControls(state);
  const playback = state.playbacks?.find(item => item.id === state.playback);
  const source = state.liveSources?.find(item => item.id === (playback?.liveSourceId ?? state.liveReception?.sourceId));
  const receiving = controls.leave;
  const publisher = source?.deviceId === deviceId();
  const output = state.outputs?.find(output => output.deviceId === deviceId());
  const error = output?.error || state.player.error;
  const local = state.liveReception?.sourceId === source?.id ? state.liveReception : undefined;
  const listenerStatus = liveListenerStatus(output?.liveListener, local);
  if (!source || publisher) return null;
  const label = receiving ? "Leave" : failed ? "Try joining again" : "Join";
  return <div data-live-participation className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
    <Button data-page-first={pageFirst || undefined} disabled={!connected || pending || receiving && !state.player.playbackId} onClick={async () => {
      if (busy.current || receiving && !state.player.playbackId) return;
      busy.current = true; setPending(true); setFailed(false);
      try { setFailed(!await run(receiving ? { type: "leave", playbackId: state.player.playbackId! } : { type: "playLive", sourceId: source.id, deviceId: deviceId() })); }
      catch { setFailed(true); }
      finally { busy.current = false; setPending(false); }
    }}>{pending ? receiving ? "Leaving…" : "Joining…" : label}</Button>
    {(receiving || local?.status.state === "removed") && !error && <span role="status" className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{!connected ? "Reconnecting…" : listenerStatus || (state.player.status === "playing" && !state.player.buffering ? "Listening" : "Waiting for audio…")}</span>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {failed && <p role="alert" className="text-sm text-destructive">Couldn't {receiving ? "leave" : "join"}. Check this device's connection and audio output, then try again.</p>}
  </div>;
}

/**
 * Whether the controlled Devices are muted: every one in the controlled Playback's sound, else the controlled Device.
 * Like Core's Volume, it reads only the sound this device may control while there is any, since that is what Mute moves.
 */
export function muted(state: ClientSessionState | null | undefined) {
  if (livePlayback(state)) return state?.devices?.find(device => device.id === deviceId())?.muted ?? false;
  const sounding = new Set(state?.outputs?.filter(output => output.sound).map(output => output.deviceId));
  if (!sounding.size) sounding.add(state?.controlling ?? deviceId());
  const devices = state?.devices?.filter(device => sounding.has(device.id)) ?? [], moved = devices.filter(device => device.id === deviceId() || device.sharing?.audio === true);
  const read = moved.length ? moved : devices;
  return read.length > 0 && read.every(device => device.muted);
}

/** The controlled Devices' volume: the loudest one this device may control, as Core reports it; moving it scales those. */
export function PlaybackVolume({ state, connected, run, showSlider = true, showValue = true, className, targetDeviceId }: Props & { showSlider?: boolean; showValue?: boolean; className?: string; targetDeviceId?: string }) {
  const { available, audioReady } = playbackCapabilities(state, connected);
  const target = targetDeviceId ?? (livePlayback(state) ? deviceId() : undefined);
  const device = state.devices?.find(item => item.id === target);
  const silent = device?.muted ?? muted(state);
  const level = device?.volume ?? state.player.volume;
  const ready = target ? connected && !!device?.online : available && audioReady;
  return <div className={cn("flex min-w-0 items-center gap-2", showSlider && "min-w-40 flex-1", className)} data-volume role="group" aria-label="Volume">
    <Button variant="ghost" size="icon-lg" aria-label={silent ? "Unmute" : "Mute"} title={silent ? "Unmute" : "Mute"} disabled={!ready} onClick={() => void run({ type: "mute", muted: !silent, ...target ? { deviceId: target } : {} })}>{silent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
    {showSlider && <RangeControl label={livePlayback(state) && !targetDeviceId ? "Your volume" : "Volume"} value={level} max={100} disabled={!ready} onCommit={volume => run({ type: "volume", volume, ...target ? { deviceId: target } : {} })} />}
    {/* Its number reads like each device fader's, with no "%". */}
    {showValue && <span className="w-[3ch] shrink-0 text-right tabular-nums">{!target && state.systemAudio?.volume === null ? "—" : Math.round(level)}</span>}
  </div>;
}

/**
 * Where the band's and the now-playing bar's panels open (Volume, Where it plays, the gear's menu): above the whole row,
 * clear of its timeline, and ending at the tools' right edge (the gutter, as Up next does) whichever tool opened them,
 * so they line up as one family. Elsewhere a panel just sits above its trigger. Read as the panel opens.
 */
export function toolPanel(trigger: HTMLElement | null): { side: "top"; align: "end"; sideOffset?: number; alignOffset?: number } {
  const tools = trigger?.closest<HTMLElement>("[data-player-tools], [data-bar-tools]"), row = tools?.closest<HTMLElement>("[data-player-band], [data-now-playing]");
  if (!trigger || !tools || !row) return { side: "top", align: "end" };
  const at = trigger.getBoundingClientRect(), group = tools.getBoundingClientRect();
  // The group pulls back past the gutter (-mr-2.5) so its last glyph lines up with the time; its margin box ends at the gutter.
  return { side: "top", align: "end", sideOffset: at.top - row.getBoundingClientRect().top + 8, alignOffset: at.right - group.right - parseFloat(getComputedStyle(tools).marginRight) };
}

/** The band's and now-playing bar's volume: a speaker that opens the slider and Mute in a Popover, so the dock stays icons. */
export function VolumeButton({ state, connected, run, className }: Props & { className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  // Controlled, so it places itself as it opens (toolPanel).
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button ref={trigger} variant="ghost" size="icon-lg" className={className} aria-label="Volume" title="Volume">{muted(state) ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button></PopoverTrigger>
    {open && <PopoverContent {...toolPanel(trigger.current)} aria-label="Volume controls" className="w-72"><PlaybackVolume state={state} connected={connected} run={run} /></PopoverContent>}
  </Popover>;
}
