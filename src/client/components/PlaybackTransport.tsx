import { useSessionGate } from "@/session/session-context";
import { usePlaybackClock } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { Pause, Play, RotateCcw, RotateCw, SkipForward, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Action } from "../../shared/protocol";
import type { Credentials } from "@/session/session";
import { deviceName } from "@/copy";
import { cn } from "@/lib/utils";
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
    audioReady: !state?.systemAudio || state.systemAudio.volume !== null || state.systemAudio.volumeWritable === false && !state.systemAudio.error,
    transportReady: available && !!player?.playbackId && ["playing", "paused"].includes(player.status),
    seekable: !!player?.seekable,
    pausable: !live || !!player?.seekable,
    hasNext: currentIndex >= 0 && currentIndex < (state?.queue.length ?? 0) - 1,
  };
}

export function PlaybackTimeline({ state, connected, run, pageFirst = false, compact = false }: Props & { pageFirst?: boolean; compact?: boolean }) {
  const playbackClock = usePlaybackClock();
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { seekable, transportReady } = playbackCapabilities(state, connected);
  if (!current) return null;
  const length = playbackClock.duration || current.duration || 0;
  const remaining = (length - playbackClock.position) / (player.speed || 1);
  const chapters = player.chapters?.filter(chapter => chapter.position > 0 && chapter.position < (playbackClock.duration ?? 0)) ?? [];
  const chapter = player.chapters?.findLast(item => item.position <= playbackClock.position);
  return <div className={cn("grid gap-1", compact && "player-timeline")}>
    {seekable && playbackClock.duration ? <div className="relative"><RangeControl key={player.playbackId || "idle"} label="Playback position" value={playbackClock.position || 0} max={playbackClock.duration} showValue={false} keyboardStep={10} pageFirst={pageFirst} disabled={!transportReady}
      onCommit={async position => player.playbackId ? run({ type: "seek", playbackId: player.playbackId, position }) : false} />{chapters.map(item => <span key={item.position} data-chapter-tick aria-hidden="true" className="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 bg-background" style={{ left: `${item.position / playbackClock.duration! * 100}%` }} />)}</div> : null}
    <div data-time-labels className="flex justify-between gap-4 text-sm tabular-nums text-muted-foreground">
      <span className="min-w-0 truncate"><span className="text-foreground">{formatDuration(playbackClock.position || 0)}</span>{chapter && <span data-current-chapter className="ml-3">{chapter.title}</span>}</span>
      {length ? <span className="shrink-0">−{formatDuration(remaining)}<span data-end-time> ends {formatEndTime(remaining)}</span></span> : null}
    </div>
  </div>;
}

const seekLabel = <span aria-hidden="true" className="text-xs leading-none">10</span>;

export function PlaybackTransport({ state, credentials, connected, run, showSettings = true, pageFirst = false, prominent = false }: Props & { credentials: Credentials; showSettings?: boolean; pageFirst?: boolean; prominent?: boolean }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { available, active, transportReady, seekable, pausable, hasNext } = playbackCapabilities(state, connected);
  const playing = player.status === "playing";
  const { seekBy } = useSessionGate();
  return <div className={cn("flex items-center gap-0.5", prominent && "player-transport gap-1")} role="group" aria-label="Playback controls">
    {seekable && <Button variant="ghost" size="icon-lg" className={cn("flex-col gap-0", prominent && "player-seek size-11")} aria-label="Back 10 seconds" title="Back 10 seconds" disabled={!transportReady} onClick={() => seekBy(-10)}><RotateCcw aria-hidden="true" className="size-4" />{seekLabel}</Button>}
    {pausable && <Button data-page-first={pageFirst || undefined} data-play-button variant="ghost" size="icon-lg" className={prominent ? "size-12 touch:size-11 [&_svg]:size-6" : undefined} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} disabled={!transportReady}
      onClick={() => { if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: playing }); }}>{playing ? <Pause aria-hidden="true" className="fill-current" /> : <Play aria-hidden="true" className="fill-current" />}</Button>}
    {(!prominent || !pausable) && <Button data-play-button={prominent || undefined} data-page-first={prominent && pageFirst || undefined} variant="ghost" size="icon-lg" className={prominent ? "size-12 touch:size-11 [&_svg]:size-6" : undefined} aria-label="Stop" title="Stop" disabled={!available || !active} onClick={() => void run({ type: "stop" })}><Square aria-hidden="true" className="fill-current" /></Button>}
    {seekable && <Button variant="ghost" size="icon-lg" className={cn("flex-col gap-0", prominent && "player-seek size-11")} aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={!transportReady} onClick={() => seekBy(10)}><RotateCw aria-hidden="true" className="size-4" />{seekLabel}</Button>}
    {hasNext && <Button variant="ghost" size="icon-lg" className={prominent ? "size-11 [&_svg]:size-5" : undefined} aria-label="Next" title="Next" disabled={!transportReady}
      onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><SkipForward aria-hidden="true" className="fill-current" /></Button>}
    {showSettings && state.preferences && <PlaybackSettings entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}
  </div>;
}

export function PlaybackVolume({ state, connected, run, showSlider = true, showValue = true, className }: Props & { showSlider?: boolean; showValue?: boolean; className?: string }) {
  const { available, audioReady } = playbackCapabilities(state, connected);
  const target = deviceName(state.installationName);
  const muted = state.systemAudio?.muted;
  return <div className={cn("flex min-w-0 items-center gap-2", showSlider && "min-w-40 flex-1", className)} role="group" aria-label={`${target} volume`}>
    {state.systemAudio ? <Button variant="ghost" size="icon-lg" aria-label={`${muted ? "Unmute" : "Mute"} ${target}`} title={`${muted ? "Unmute" : "Mute"} ${target}`} disabled={!available || !audioReady || state.systemAudio.muteWritable === false} onClick={() => void run({ type: "mute", muted: !muted })}>{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button> : <Volume2 aria-hidden="true" className="size-4 shrink-0" />}
    {showSlider && <RangeControl label="Volume" value={state.player.volume} max={100} disabled={!available || !audioReady || state.systemAudio?.volumeWritable === false} onCommit={volume => run({ type: "volume", volume })} />}
    {showValue && <span className="text-sm tabular-nums">{state.systemAudio?.volume === null ? "—" : `${Math.round(state.player.volume)}%`}</span>}
  </div>;
}
