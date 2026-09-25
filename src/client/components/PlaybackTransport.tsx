import { ChevronUp, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Action, SessionState } from "../../shared/protocol";
import type { Credentials } from "@/session/session";
import { Icon } from "./Icon";
import { formatDuration, formatEndTime } from "@/time-format";
import { PlaybackSettings } from "./PlaybackSettings";
import { RangeControl } from "./RangeControl";

type Props = { state: SessionState; connected: boolean; run: (action: Action) => Promise<boolean> };

export function playbackCapabilities(state: SessionState | null, connected: boolean) {
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

export function PlaybackTimeline({ state, connected, run, pageFirst = false }: Props & { pageFirst?: boolean }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { seekable, transportReady } = playbackCapabilities(state, connected);
  if (!current) return null;
  const chapters = player.chapters?.filter(chapter => chapter.position > 0 && chapter.position < (player.duration ?? 0)) ?? [];
  const chapter = player.chapters?.findLast(item => item.position <= player.position);
  return <div className="seek-control playback-timeline">
    {seekable && player.duration ? <div className="relative"><RangeControl key={player.playbackId || "idle"} label="Playback position" value={player.position || 0} max={player.duration} showValue={false} keyboardStep={10} pageFirst={pageFirst} disabled={!transportReady}
      onCommit={async position => player.playbackId ? run({ type: "seek", playbackId: player.playbackId, position }) : false} />{chapters.map(item => <span key={item.position} data-chapter-tick aria-hidden="true" className="pointer-events-none absolute top-1/2 z-10 h-1 w-1 -translate-x-1/2 -translate-y-1/2 bg-background" style={{ left: `${item.position / player.duration! * 100}%` }} />)}</div> : null}
    <div className="time-labels"><span>{formatDuration(player.position || 0)}{chapter && <span className="ml-3 text-muted-foreground">{chapter.title}</span>}</span><span>{player.duration || current.duration ? <><span className="timeline-total">{formatDuration(player.duration || current.duration || 0)}</span><span className="timeline-end">−{formatDuration(((player.duration || current.duration || 0) - player.position) / (player.speed || 1))} ends {formatEndTime(((player.duration || current.duration || 0) - player.position) / (player.speed || 1))}</span></> : ""}</span></div>
  </div>;
}

export function PlaybackTransport({ state, credentials, connected, run, compact = false, onExpand, showSettings = true, pageFirst = false }: Props & { credentials: Credentials; compact?: boolean; onExpand?: () => void; showSettings?: boolean; pageFirst?: boolean }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  const { available, active, transportReady, seekable, pausable, hasNext } = playbackCapabilities(state, connected);
  const seekBy = (seconds: number) => {
    if (player.playbackId && transportReady && seekable) void run({ type: "seek", playbackId: player.playbackId, position: Math.max(0, Math.min(player.duration ?? Infinity, player.position + seconds)) });
  };
  return <div className={`transport-buttons${compact ? " session-bar-controls" : ""}`} role="group" aria-label="Playback controls">
    {seekable && <Button variant="ghost" size="icon" className="icon-button transport-back flex-col gap-0" aria-label="Seek backward 10 seconds" title="Back 10 seconds" disabled={!transportReady} onClick={() => seekBy(-10)}><RotateCcw aria-hidden="true" /><span aria-hidden="true" className="text-[10px] leading-none">10</span></Button>}
    {pausable && <Button data-page-first={pageFirst || undefined} size="icon" className="play-button" aria-label={player.status === "playing" ? "Pause" : "Resume"} title={player.status === "playing" ? "Pause" : "Resume"} disabled={!transportReady}
      onClick={() => { if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: player.status === "playing" }); }}><Icon name={player.status === "playing" ? "pause" : "play"} /></Button>}
    {seekable && <Button variant="ghost" size="icon" className="icon-button transport-forward flex-col gap-0" aria-label="Seek forward 10 seconds" title="Forward 10 seconds" disabled={!transportReady} onClick={() => seekBy(10)}><RotateCw aria-hidden="true" /><span aria-hidden="true" className="text-[10px] leading-none">10</span></Button>}
    {hasNext && <Button variant="ghost" size="icon" className="icon-button transport-next" aria-label="Next in queue" title="Next in queue" disabled={!transportReady}
      onClick={() => { if (player.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><Icon name="next" /></Button>}
    <Button variant="ghost" size="icon" className="icon-button transport-stop" aria-label="Stop playback" title="Stop playback" disabled={!available || !active} onClick={() => void run({ type: "stop" })}><Icon name="stop" /></Button>
    {showSettings && state.preferences && <PlaybackSettings entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}
    {onExpand && <Button variant="ghost" size="icon" className="playback-expand" aria-label="Open remote controls" onClick={onExpand}><ChevronUp aria-hidden="true" /></Button>}
  </div>;
}

export function PlaybackVolume({ state, connected, run, showSlider = true }: Props & { showSlider?: boolean }) {
  const { available, audioReady } = playbackCapabilities(state, connected);
  const target = state.installationName || "Playback host";
  return <div className="volume-control" role="group" aria-label={`${target} volume`}>
    {state.systemAudio ? <Button variant="ghost" size="icon" className="icon-button" aria-label={`${state.systemAudio.muted ? "Unmute" : "Mute"} ${target}`} title={`${state.systemAudio.muted ? "Unmute" : "Mute"} ${target}`} disabled={!available || !audioReady || state.systemAudio.muteWritable === false} onClick={() => void run({ type: "mute", muted: !state.systemAudio!.muted })}>{state.systemAudio.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button> : <Volume2 aria-hidden="true" />}
    {showSlider && <RangeControl label="Volume" value={state.player.volume} max={100} disabled={!available || !audioReady || state.systemAudio?.volumeWritable === false} onCommit={volume => run({ type: "volume", volume })} />}
    <span>{state.systemAudio?.volume === null ? "Unknown" : `${Math.round(state.player.volume)}%`}</span>
  </div>;
}
