import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Progress } from "@/components/ui/progress";
import type { Action, SessionState } from "../../../shared/protocol";
import { formatDuration, formatEndTime } from "@/time-format";

export function MiniPlayer({ state, connected, run, onOpen, localHost }: { state: SessionState; connected: boolean; run: (action: Action) => Promise<boolean>; onOpen: () => void; localHost: boolean }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current) return null;
  const paused = player.status === "paused";
  const remaining = Math.max(0, (player.duration ?? current.duration ?? 0) - player.position) / (player.speed || 1);
  const status = !connected ? `Reconnecting to ${state.installationName || "Couch"}` : player.status === "error" ? `Can't play ${current.title}` : current.live ? "Live" : player.duration || current.duration ? `${formatDuration(player.position)} / ${formatDuration(player.duration ?? current.duration ?? 0)}, ends ${formatEndTime(remaining)}` : "Loading";
  return <footer className="mini-player" aria-label="Current playback">
    <Progress value={player.duration ? player.position / player.duration * 100 : 0} aria-label="Playback progress" className="absolute inset-x-0 top-0 h-px rounded-none bg-transparent [&_[data-slot=progress-indicator]]:bg-white" />
    <Button variant="ghost" size="icon" aria-label={paused ? "Play" : "Pause"} disabled={!connected || !player.playbackId || !["playing", "paused"].includes(player.status)} onClick={() => { if (player.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: !paused }); }}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</Button>
    <strong title={current.title}>{current.title}</strong>
    <span role="status">{status}</span>
    {localHost && <ButtonGroup className="mini-player-volume" aria-label="Volume"><Button variant="ghost" aria-label="Volume down" disabled={!connected} onClick={() => void run({ type: "volume", volume: Math.max(0, player.volume - 5) })}>−</Button><ButtonGroupText>Volume {Math.round(player.volume)}</ButtonGroupText><Button variant="ghost" aria-label="Volume up" disabled={!connected} onClick={() => void run({ type: "volume", volume: Math.min(100, player.volume + 5) })}>+</Button></ButtonGroup>}
    <Button variant="ghost" className="mini-player-resume" onClick={onOpen}>Resume</Button>
  </footer>;
}
