import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
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

type Props = { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean> };

export function playbackCapabilities(state: ClientSessionState | null, connected: boolean) {
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  const live = current?.live || isRadio(current);
  const available = connected && !!player && player.status !== "unavailable";
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  return {
    available,
    active: !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status),
    // Stop clears whatever is current: loading or playing, paused, finished or failed.
    stoppable: available && !!current && !!player && ["loading", "playing", "paused", "ended", "error"].includes(player.status),
    audioReady: !state?.systemAudio || state.systemAudio.volume !== null,
    // A stall mid-watch (a seek, too) reports "loading" with buffering: the item has started, as in Core's session.
    transportReady: available && !!player?.playbackId && (["playing", "paused"].includes(player.status) || player.status === "loading" && player.buffering === true),
    nextReady: available && !!player?.playbackId && ["playing", "paused", "ended"].includes(player.status),
    seekable: !!player?.seekable,
    // Paused live media resumes, so it offers Play rather than a disabled Pause.
    pausable: !live || !!player?.seekable || player?.status === "paused",
    hasNext: currentIndex >= 0 && (currentIndex < (state?.queue.length ?? 0) - 1 || !!state?.autoplay?.enabled && (!!state.autoplay.next || !!state.autoplay.pending)),
  };
}

/**
 * The departures board's line for what plays: "ends 21:42" in clock time, or "Live" for live media; nothing without
 * a length or once it has ended. The duration clock keeps a paused item's end time moving.
 */
export function useEndTime(state: ClientSessionState | null | undefined) {
  const playbackClock = usePlaybackClock();
  useDurationClock();
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  if (!state || !current || state.player.status === "ended") return undefined;
  if (current.live || isRadio(current)) return "Live";
  const length = playbackClock.duration || current.duration || 0;
  return length ? `ends ${formatEndTime((length - playbackClock.position) / (state.player.speed || 1))}` : undefined;
}

/**
 * Position, the timeline and "−3:24 ends 20:59", only where a timeline means something: media that seeks,
 * or has a length to seek through once loaded (the slider stays, disabled, meanwhile). Live media that
 * can't seek reads "Live" alone: no bar, no position, no total.
 */
export function PlaybackTimeline({ state, connected, run, pageFirst = false, compact = false, className }: Props & { pageFirst?: boolean; compact?: boolean; className?: string }) {
  const playbackClock = usePlaybackClock();
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { seekable, transportReady } = playbackCapabilities(state, connected);
  if (!current) return null;
  const live = current.live || isRadio(current);
  const length = playbackClock.duration || current.duration || 0;
  const remaining = (length - playbackClock.position) / (player.speed || 1);
  const canSeek = seekable && !!playbackClock.duration;
  if (!canSeek && (live || !length)) return live ? <span data-live className={cn("text-sm text-muted-foreground", className)}>Live</span> : null;
  const chapters = player.chapters?.filter(chapter => chapter.position > 0 && chapter.position < (playbackClock.duration ?? 0)) ?? [];
  const chapter = player.chapters?.findLast(item => item.position <= playbackClock.position);
  return <div className={cn("grid gap-1", compact && "player-timeline", className)}>
    <div className="relative"><RangeControl key={player.playbackId || "idle"} label="Playback position" value={playbackClock.position || 0} max={canSeek ? playbackClock.duration! : length} showValue={false} keyboardStep={10} pageFirst={pageFirst} disabled={!transportReady || !canSeek}
      onCommit={async position => player.playbackId ? run({ type: "seek", playbackId: player.playbackId, position }) : false} />{canSeek && chapters.map(item => <span key={item.position} data-chapter-tick aria-hidden="true" className="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 bg-background" style={{ left: `${item.position / playbackClock.duration! * 100}%` }} />)}</div>
    <div data-time-labels className="flex justify-between gap-4 text-sm tabular-nums text-muted-foreground">
      <span className="min-w-0 truncate"><span className="text-foreground">{formatDuration(playbackClock.position || 0)}</span>{chapter && <span data-current-chapter className="ml-3">{chapter.title}</span>}</span>
      <span className="shrink-0">{live ? <span data-live>Live</span> : length ? <>−{formatDuration(remaining)}<span data-end-time> ends {formatEndTime(remaining)}</span></> : null}</span>
    </div>
  </div>;
}

/**
 * Play/Pause, Stop and Next, each in its slot for every kind of media: the band (`prominent`, larger), the now-playing bar and the remote pad.
 * The first slot is Replay once ended, Try again after an error, else Play or Pause (disabled for live media that can't pause).
 * With `pageFirst`, a page change's first key lands on the first enabled slot. Keys and the timeline seek.
 * `moreClassName` styles Stop and Next, which the now-playing bar hides on phones.
 */
export function PlaybackTransport({ state, connected, run, pageFirst = false, prominent = false, moreClassName }: Props & { pageFirst?: boolean; prominent?: boolean; moreClassName?: string }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { available, transportReady, pausable, stoppable, nextReady, hasNext } = playbackCapabilities(state, connected);
  const playing = player.status === "playing";
  const ended = player.status === "ended" && !!current, failed = player.status === "error" && !!current;
  const pause = playing || !pausable;
  const label = ended ? "Replay" : failed ? "Try again" : pause ? "Pause" : "Play";
  const enabled = [ended || failed ? available : transportReady && pausable, stoppable, nextReady && hasNext];
  const first = (slot: number) => pageFirst && enabled.indexOf(true) === slot || undefined;
  const size = cn(prominent && "size-11 [&_svg]:size-5", moreClassName);
  return <div className={cn("flex shrink-0 items-center gap-0.5", prominent && "player-transport")} role="group" aria-label="Playback controls">
    <Button data-page-first={first(0)} data-play-button variant="ghost" size="icon-lg" className={prominent ? "size-12 touch:size-11 [&_svg]:size-6" : undefined} aria-label={label} title={label} disabled={!enabled[0]}
      onClick={() => { if ((ended || failed) && current) void run({ type: "play", entryId: current.id, fromStart: ended }); else if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>
      {ended ? <RotateCcw aria-hidden="true" /> : pause ? <Pause aria-hidden="true" className="fill-current" /> : <Play aria-hidden="true" className="fill-current" />}
    </Button>
    <Button data-page-first={first(1)} variant="ghost" size="icon-lg" className={size} aria-label="Stop" title="Stop" disabled={!enabled[1]} onClick={() => void run({ type: "stop" })}><Square aria-hidden="true" className="fill-current" /></Button>
    <Button data-page-first={first(2)} variant="ghost" size="icon-lg" className={size} aria-label="Next" title="Next" disabled={!enabled[2]}
      onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><SkipForward aria-hidden="true" className="fill-current" /></Button>
  </div>;
}

/**
 * Whether the controlled Devices are muted: every one in the controlled Playback's sound, else the controlled Device.
 * Like Core's Volume, it reads only the sound this device may control while there is any, since that is what Mute moves.
 */
export function muted(state: ClientSessionState | null | undefined) {
  const sounding = new Set(state?.outputs?.filter(output => output.sound).map(output => output.deviceId));
  if (!sounding.size) sounding.add(state?.controlling ?? deviceId());
  const devices = state?.devices?.filter(device => sounding.has(device.id)) ?? [], moved = devices.filter(device => device.id === deviceId() || device.sharing?.audio === true);
  const read = moved.length ? moved : devices;
  return read.length > 0 && read.every(device => device.muted);
}

/** The controlled Devices' volume: the loudest one this device may control, as Core reports it; moving it scales those. */
export function PlaybackVolume({ state, connected, run, showSlider = true, showValue = true, className }: Props & { showSlider?: boolean; showValue?: boolean; className?: string }) {
  const { available, audioReady } = playbackCapabilities(state, connected);
  const silent = muted(state);
  return <div className={cn("flex min-w-0 items-center gap-2", showSlider && "min-w-40 flex-1", className)} data-volume role="group" aria-label="Volume">
    <Button variant="ghost" size="icon-lg" aria-label={silent ? "Unmute" : "Mute"} title={silent ? "Unmute" : "Mute"} disabled={!available || !audioReady} onClick={() => void run({ type: "mute", muted: !silent })}>{silent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
    {showSlider && <RangeControl label="Volume" value={state.player.volume} max={100} disabled={!available || !audioReady} onCommit={volume => run({ type: "volume", volume })} />}
    {/* Its number reads like each device fader's, with no "%". */}
    {showValue && <span className="w-[3ch] shrink-0 text-right tabular-nums">{state.systemAudio?.volume === null ? "—" : Math.round(state.player.volume)}</span>}
  </div>;
}

/** The band's and now-playing bar's volume: a speaker that opens the slider and Mute in a Popover, so the dock stays icons. */
export function VolumeButton({ state, connected, run, className }: Props & { className?: string }) {
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-lg" className={className} aria-label="Volume" title="Volume">{muted(state) ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button></PopoverTrigger>
    <PopoverContent side="top" align="end" aria-label="Volume controls" className="w-64"><PlaybackVolume state={state} connected={connected} run={run} /></PopoverContent>
  </Popover>;
}
