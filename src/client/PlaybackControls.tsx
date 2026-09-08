import { ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Action, PlayerState, SessionState } from "../shared/protocol";
import type { Credentials } from "./session";
import { Icon } from "./Icon";
import { PlaybackSettings } from "./PlaybackSettings";
import { RangeControl } from "./RangeControl";
import { WatchingProfile } from "./WatchingProfile";

const playbackLabels: Record<PlayerState["status"], string> = {
  unavailable: "No player", idle: "Ready", loading: "Loading…", playing: "Playing",
  paused: "Paused", ended: "Finished", error: "Playback error",
};

function time(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(value % 60).padStart(2, "0")}`;
}

function sourceLabel(source: string) {
  try {
    if (source.startsWith("web:")) return new URL(source.slice(4)).host;
    const url = new URL(source);
    if (url.protocol === "file:") return "Local file";
    if (url.protocol === "library:") return "Your library";
    if (url.protocol === "jellyfin:") return "Jellyfin";
    if (url.protocol === "radio:") return "Radio playlist";
    return url.host || "Media";
  } catch { return "Media"; }
}

export function PlaybackControls({ state, credentials, connected, run, onExpand }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  onExpand?: () => void;
}) {
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  const available = connected && !!player && player.status !== "unavailable";
  const active = !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status);
  const transportReady = available && !!player?.playbackId && ["playing", "paused"].includes(player.status);
  const radio = current?.kind === "radio" || current?.source.startsWith("radio:");

  return <div className="player-controls">
    <div className="now-heading">
      <p className="eyebrow">Now playing</p>
      <Badge variant="secondary" className="playback-status">{state?.radioRetry && player?.status === "loading" ? "Reconnecting" : player ? playbackLabels[player.status] : "Connecting"}</Badge>
    </div>
    <h1 className="media-title" title={current?.title}>{current?.title || "Nothing playing"}</h1>
    <p className="source-label">{current ? sourceLabel(current.source) : "Choose something to play on your TV."}</p>
    {radio && player?.nowPlaying && <p className="radio-now-playing" role="status">{[player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" · ")}</p>}
    {state?.radioRetry && ["loading", "error"].includes(player?.status ?? "") && <div className="radio-retry" role="status">
      <p>{player?.status === "loading" ? `Reconnecting, attempt ${state.radioRetry.attempt} of ${state.radioRetry.maximum}. Stop cancels reconnecting.` : `Could not reconnect after ${state.radioRetry.maximum} attempts.`}</p>
      {player?.status === "error" && current && <Button variant="outline" disabled={!available} onClick={() => void run({ type: "play", entryId: current.id })}>Try again</Button>}
    </div>}
    {state?.webRetry && <div className="radio-retry" role="status">
      <p>Checking the expired stream. Recovery is limited to one attempt. Stop cancels recovery.</p>
      {player?.playbackId && <Button variant="outline" disabled={!available} onClick={() => void run({ type: "pause", playbackId: player.playbackId!, paused: !state.webRetry!.paused })}>{state.webRetry.paused ? "Resume after recovery" : "Stay paused after recovery"}</Button>}
    </div>}
    {player?.error && player.status !== "unavailable" && <p className="playback-error" role="alert">{player.error}</p>}
    <div className="seek-control" hidden={!current}>
      <RangeControl key={player?.playbackId || "idle"} label="Playback position" value={player?.position || 0} max={player?.duration || 1} showValue={false}
        disabled={!transportReady || !player?.seekable || !player.duration}
        onCommit={async position => { if (player?.playbackId) await run({ type: "seek", playbackId: player.playbackId, position }); }} />
      <div className="time-labels"><span>{time(player?.position || 0)}</span><span>{current?.live ? "LIVE" : player?.duration || current?.duration ? time(player?.duration || current?.duration || 0) : transportReady ? "LIVE" : "0:00"}</span></div>
    </div>
    <div className="transport-row">
      <div className="transport-buttons">
        <Button size="icon" className="play-button" aria-label={player?.status === "playing" ? "Pause" : "Resume"} disabled={!transportReady}
          onClick={() => { if (player?.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: player.status === "playing" }); }}><Icon name={player?.status === "playing" ? "pause" : "play"} /></Button>
        <Button variant="ghost" size="icon" className="icon-button" aria-label="Next in queue" disabled={!transportReady}
          onClick={() => { if (player?.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><Icon name="next" /></Button>
        <Button variant="ghost" size="icon" className="icon-button" aria-label="Stop playback" disabled={!available || !active}
          onClick={() => void run({ type: "stop" })}><Icon name="stop" /></Button>
        {onExpand && <Button variant="ghost" size="icon" className="playback-expand" aria-label="Open remote controls" onClick={onExpand}><ChevronUp /></Button>}
      </div>
      <div className="volume-control"><Icon name="volume" /><RangeControl label="Volume" value={player?.volume ?? 100} max={100} disabled={!available}
        onCommit={async volume => { await run({ type: "volume", volume }); }} /><span>{Math.round(player?.volume ?? 100)}%</span></div>
    </div>
    {state?.progressError && <p className="playback-error" role="alert">{state.progressError}</p>}
    <div className="player-settings">
      {player && state?.preferences && <PlaybackSettings player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />}
      <WatchingProfile origin={credentials.origin} token={credentials.token} connected={connected} profile={state?.activeProfile} playing={active} version={state?.libraryVersion ?? 0} />
    </div>
  </div>;
}
