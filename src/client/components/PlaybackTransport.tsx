import { useSessionGate } from "@/session/session-context";
import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { Pause, Play, RotateCcw, RotateCw, SkipForward, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Action } from "../../shared/protocol";
import type { Credentials } from "@/session/session";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { formatDuration, formatEndTime } from "@/time-format";
import { PlaybackSettings } from "./PlaybackSettings";
import { RangeControl } from "./RangeControl";

type Props = { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean> };

export function playbackCapabilities(state: ClientSessionState | null, connected: boolean) {
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  const live = current?.live || current?.kind === "radio" || current?.source.startsWith("radio:");
  const available = connected && !!player && player.status !== "unavailable";
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  return {
    available,
    active: !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status),
    audioReady: !state?.systemAudio || state.systemAudio.volume !== null,
    // A stall mid-watch (a seek, too) reports "loading" with buffering: the item has started, as in Core's session.
    transportReady: available && !!player?.playbackId && (["playing", "paused"].includes(player.status) || player.status === "loading" && player.buffering === true),
    nextReady: available && !!player?.playbackId && ["playing", "paused", "ended"].includes(player.status),
    seekable: !!player?.seekable,
    // Paused live media resumes, so it offers Play rather than Stop.
    pausable: !live || !!player?.seekable || player?.status === "paused",
    hasNext: currentIndex >= 0 && (currentIndex < (state?.queue.length ?? 0) - 1 || !!state?.autoplay?.enabled && (!!state.autoplay.next || !!state.autoplay.pending)),
  };
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
  const live = current.live || current.kind === "radio" || current.source.startsWith("radio:");
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
      <span className="shrink-0">{live ? "Live" : length ? <>−{formatDuration(remaining)}<span data-end-time> ends {formatEndTime(remaining)}</span></> : null}</span>
    </div>
  </div>;
}

/** The transport's first slot: Replay once ended, Try again after an error, Stop for live media that can't pause (with `stop`), else Play or Pause. */
export function PlayButton({ state, connected, run, stop: canStop = true, pageFirst = false, className }: Props & { stop?: boolean; pageFirst?: boolean; className?: string }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { available, active, transportReady, pausable } = playbackCapabilities(state, connected);
  const playing = player.status === "playing";
  const ended = player.status === "ended" && !!current, failed = player.status === "error" && !!current;
  const stop = canStop && !pausable && !ended && !failed;
  const label = ended ? "Replay" : failed ? "Try again" : stop ? "Stop" : playing ? "Pause" : "Play";
  return <Button data-page-first={pageFirst || undefined} data-play-button variant="ghost" size="icon-lg" className={className} aria-label={label} title={label} disabled={stop ? !available || !active : ended || failed ? !available : !transportReady}
    onClick={() => { if (stop) void run({ type: "stop" }); else if ((ended || failed) && current) void run({ type: "play", entryId: current.id, fromStart: ended }); else if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>
    {ended ? <RotateCcw aria-hidden="true" /> : stop ? <Square aria-hidden="true" className="fill-current" /> : playing ? <Pause aria-hidden="true" className="fill-current" /> : <Play aria-hidden="true" className="fill-current" />}
  </Button>;
}

const seekLabel = <span aria-hidden="true" className="text-xs leading-none">10</span>;

/** The band's (`prominent`) transport is Play/Pause and Next alone, as keys and the timeline seek; the remote pad adds Stop and ±10 s. */
export function PlaybackTransport({ state, credentials, connected, run, showSettings = true, pageFirst = false, prominent = false }: Props & { credentials: Credentials; showSettings?: boolean; pageFirst?: boolean; prominent?: boolean }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { available, active, transportReady, nextReady, seekable, pausable, hasNext } = playbackCapabilities(state, connected);
  const ended = player.status === "ended" && !!current;
  const { seekBy } = useSessionGate();
  return <div className={cn("flex items-center gap-0.5", prominent && "player-transport gap-1")} role="group" aria-label="Playback controls">
    {!prominent && seekable && <Button variant="ghost" size="icon-lg" className="flex-col gap-0" aria-label="Back 10 seconds" title="Back 10 seconds" disabled={!transportReady || !seekable} onClick={() => seekBy(-10)}><RotateCcw aria-hidden="true" className="size-4" />{seekLabel}</Button>}
    {(prominent || pausable || ended) && <PlayButton state={state} connected={connected} run={run} stop={prominent} pageFirst={pageFirst} className={prominent ? "size-12 touch:size-11 [&_svg]:size-6" : undefined} />}
    {!prominent && <Button variant="ghost" size="icon-lg" aria-label="Stop" title="Stop" disabled={!available || !active} onClick={() => void run({ type: "stop" })}><Square aria-hidden="true" className="fill-current" /></Button>}
    {!prominent && seekable && <Button variant="ghost" size="icon-lg" className="flex-col gap-0" aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={!transportReady || !seekable} onClick={() => seekBy(10)}><RotateCw aria-hidden="true" className="size-4" />{seekLabel}</Button>}
    {(prominent || hasNext) && <Button variant="ghost" size="icon-lg" className={prominent ? "size-11 [&_svg]:size-5" : undefined} aria-label="Next" title="Next" disabled={!nextReady || !hasNext}
      onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><SkipForward aria-hidden="true" className="fill-current" /></Button>}
    {showSettings && state.preferences && <PlaybackSettings entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}
  </div>;
}

/** Whether the controlled Devices are muted: every one in the controlled Playback's sound, else the controlled Device. */
export function muted(state: ClientSessionState | null | undefined) {
  const sounding = new Set(state?.outputs?.filter(output => output.sound).map(output => output.deviceId));
  if (!sounding.size) sounding.add(state?.controlling ?? deviceId());
  const devices = state?.devices?.filter(device => sounding.has(device.id)) ?? [];
  return devices.length > 0 && devices.every(device => device.muted);
}

/** The controlled Devices' volume: the loudest one's, as Core reports it; moving it scales them all. */
export function PlaybackVolume({ state, connected, run, showSlider = true, showValue = true, className }: Props & { showSlider?: boolean; showValue?: boolean; className?: string }) {
  const { available, audioReady } = playbackCapabilities(state, connected);
  const silent = muted(state);
  return <div className={cn("flex min-w-0 items-center gap-2", showSlider && "min-w-40 flex-1", className)} data-volume role="group" aria-label="Volume">
    <Button variant="ghost" size="icon-lg" aria-label={silent ? "Unmute" : "Mute"} title={silent ? "Unmute" : "Mute"} disabled={!available || !audioReady} onClick={() => void run({ type: "mute", muted: !silent })}>{silent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
    {showSlider && <RangeControl label="Volume" value={state.player.volume} max={100} disabled={!available || !audioReady} onCommit={volume => run({ type: "volume", volume })} />}
    {showValue && <span className="text-sm tabular-nums">{state.systemAudio?.volume === null ? "—" : `${Math.round(state.player.volume)}%`}</span>}
  </div>;
}

/** The band's and mini player's volume: a speaker that opens the slider and Mute in a Popover, so the dock stays icons. */
export function VolumeButton({ state, connected, run, className }: Props & { className?: string }) {
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-lg" className={className} aria-label="Volume" title="Volume">{muted(state) ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button></PopoverTrigger>
    <PopoverContent side="top" align="end" aria-label="Volume controls" className="w-64"><PlaybackVolume state={state} connected={connected} run={run} /></PopoverContent>
  </Popover>;
}
