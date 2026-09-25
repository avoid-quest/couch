import type { CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Action, SessionState } from "../../../shared/protocol";
import { formatDuration, formatEndTime } from "@/time-format";

export function MiniPlayer({ state, connected, run, onOpen, localHost }: { state: SessionState; connected: boolean; run: (action: Action) => Promise<boolean>; onOpen: () => void; localHost: boolean }) {
  const player = state.player;
  const current = state.queue.find(entry => entry.id === state.currentEntryId);
  if (!current || !player.playbackId) return null;
  const paused = player.status === "paused";
  const remaining = Math.max(0, (player.duration ?? current.duration ?? 0) - player.position) / (player.speed || 1);
  return <footer className="mini-player" style={{ "--mini-progress": `${player.duration ? player.position / player.duration * 100 : 0}%` } as CSSProperties} aria-label="Current playback">
    <Button variant="ghost" size="icon" aria-label={paused ? "Play" : "Pause"} disabled={!connected || !["playing", "paused"].includes(player.status)} onClick={() => void run({ type: "pause", playbackId: player.playbackId!, paused: !paused })}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</Button>
    <strong title={current.title}>{current.title}</strong>
    <span>{current.live ? "Live" : player.duration || current.duration ? `${formatDuration(player.position)} / ${formatDuration(player.duration ?? current.duration ?? 0)}, ends ${formatEndTime(remaining)}` : "Loading"}</span>
    {localHost && <div className="mini-player-volume"><Button variant="ghost" aria-label="Volume down" disabled={!connected} onClick={() => void run({ type: "volume", volume: Math.max(0, player.volume - 5) })}>−</Button><span>Volume {Math.round(player.volume)}</span><Button variant="ghost" aria-label="Volume up" disabled={!connected} onClick={() => void run({ type: "volume", volume: Math.min(100, player.volume + 5) })}>+</Button></div>}
    <Button variant="ghost" className="mini-player-resume" onClick={onOpen}>Resume</Button>
  </footer>;
}
