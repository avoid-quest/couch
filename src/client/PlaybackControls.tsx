import { ChevronUp, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Action, PlayerState, SessionState } from "../shared/protocol";
import type { Credentials } from "./session";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";
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

export function sourceLabel(source: string) {
  try {
    if (source.startsWith("web:")) return new URL(source.slice(4)).host;
    const url = new URL(source);
    if (url.protocol === "file:") return "Local file";
    if (url.protocol === "library:") return "Your library";
    if (url.protocol === "jellyfin:") return "Jellyfin";
    if (url.protocol === "iptv:") return "TV guide";
    if (url.protocol === "radio:") return "Radio playlist";
    return url.host || "Media";
  } catch { return "Media"; }
}

export function PlaybackControls({ state, credentials, connected, run, onExpand, onRemote, presentation = "default" }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  onExpand?: () => void;
  onRemote?: () => void;
  presentation?: "default" | "session";
}) {
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  const available = connected && !!player && player.status !== "unavailable";
  const active = !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status);
  const audioReady = !state?.systemAudio || state.systemAudio.volume !== null;
  const transportReady = available && !!player?.playbackId && ["playing", "paused"].includes(player.status);
  const radio = current?.kind === "radio" || current?.source.startsWith("radio:");
  const seekable = !!player?.seekable && !current?.live;
  const currentIndex = state?.queue.findIndex(entry => entry.id === state.currentEntryId) ?? -1;
  const hasNext = currentIndex >= 0 && currentIndex < (state?.queue.length ?? 0) - 1;
  const hasMedia = !!current;
  const artwork = connected && radio ? state?.radioProgramme?.artworkUrl || current?.thumbnail : current?.thumbnail;
  const seekBy = (seconds: number) => {
    if (player?.playbackId && transportReady && seekable) void run({ type: "seek", playbackId: player.playbackId, position: Math.max(0, Math.min(player.duration ?? Infinity, player.position + seconds)) });
  };

  const session = presentation === "session";
  const stop = <Button variant="ghost" size="icon" className="icon-button" aria-label="Stop playback" title="Stop playback" disabled={!available || !active}
    onClick={() => void run({ type: "stop" })}><Icon name="stop" /></Button>;
  const volume = <div className="volume-control">
    {state?.systemAudio ? <Button variant="ghost" size="icon" className="icon-button" aria-label={state.systemAudio.muted ? "Unmute TV" : "Mute TV"} title={state.systemAudio.muted ? "Unmute TV" : "Mute TV"} disabled={!available || !audioReady} onClick={() => void run({ type: "mute", muted: !state.systemAudio!.muted })}>{state.systemAudio.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button> : <Volume2 aria-hidden="true" />}
    <RangeControl label="Volume" value={player?.volume ?? 100} max={100} disabled={!available || !audioReady}
      onCommit={volume => run({ type: "volume", volume })} /><span>{audioReady ? `${Math.round(player?.volume ?? 100)}%` : "Unknown"}</span>
  </div>;
  const settings = player && state?.preferences && <PlaybackSettings entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />;

  return <div className={`player-controls${session ? " session-playback" : ""}`}>
    {!session && <div className="now-heading">
      <p className="eyebrow">Now playing</p>
      <Badge variant="secondary" className="playback-status">{state?.radioRetry && player?.status === "loading" ? "Reconnecting" : player ? playbackLabels[player.status] : "Connecting"}</Badge>
    </div>}
    {session && hasMedia && (current.artworkId || artwork) && <div className={`session-current-art${radio ? " session-radio-art" : ""}`}>{current.artworkId
      ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} video={!radio} />
      : <MediaArtwork key={artwork} thumbnail={artwork} title={current.title} />}</div>}
    <h1 className="media-title" title={current?.title}>{current?.title || (session ? "What would you like to play?" : "Nothing playing")}</h1>
    <p className="source-label">{current ? <>{sourceLabel(current.source)}{session && <> · <span className="playback-status">{!connected ? "Reconnecting" : state?.radioRetry && player?.status === "loading" ? "Reconnecting" : player ? playbackLabels[player.status] : "Connecting"}</span>{current.live && " · LIVE"}</>}</> : !connected ? "Reconnecting to your TV. You can still browse." : player?.status === "unavailable" ? "Your TV player is offline. Browse now and play when it reconnects." : "Search your sources, pick something saved, or keep watching."}</p>
    {connected && radio && state?.radioProgramme && <figure className="radio-programme">
      {!session && state.radioProgramme.artworkUrl && <MediaArtwork key={state.radioProgramme.artworkUrl} thumbnail={state.radioProgramme.artworkUrl} title={state.radioProgramme.title} />}
      <figcaption>Programme: {state.radioProgramme.title}<small>via radio.avoid.quest</small></figcaption>
    </figure>}
    {radio && player?.nowPlaying && <p className="radio-now-playing" role="status">{[player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" · ")}</p>}
    {state?.radioRetry && ["loading", "error"].includes(player?.status ?? "") && <div className="radio-retry" role="status">
      <p>{player?.status === "loading" ? `Reconnecting, attempt ${state.radioRetry.attempt} of ${state.radioRetry.maximum}. Stop cancels reconnecting.` : `Could not reconnect after ${state.radioRetry.maximum} attempts.`}</p>
      {player?.status === "error" && current && <Button variant="outline" disabled={!available} onClick={() => void run({ type: "play", entryId: current.id })}>Try again</Button>}
    </div>}
    {state?.webRetry && <div className="radio-retry" role="status">
      <p>Checking the expired stream. Recovery is limited to one attempt. Stop cancels recovery.</p>
      {player?.playbackId && <Button variant="outline" disabled={!available} onClick={() => void run({ type: "pause", playbackId: player.playbackId!, paused: !state.webRetry!.paused })}>{state.webRetry.paused ? "Resume after recovery" : "Stay paused after recovery"}</Button>}
    </div>}
    {state?.systemAudio?.error && <p role="alert">{state.systemAudio.error}</p>}
    {player?.status === "error" && current && state?.systemAudio && <Button disabled={!available || !audioReady} onClick={() => void run({ type: "play", entryId: current.id })}>Resume playback</Button>}
    {player?.error && player.status !== "unavailable" && <p className="playback-error" role="alert">{player.error}</p>}
    {hasMedia && seekable && <div className="seek-control">
      {player?.duration ? <RangeControl key={player.playbackId || "idle"} label="Playback position" value={player.position || 0} max={player.duration} showValue={false}
        disabled={!transportReady}
        onCommit={async position => { if (!player.playbackId) return false; return run({ type: "seek", playbackId: player.playbackId, position }); }} /> : null}
      <div className="time-labels"><span>{time(player?.position || 0)}</span><span>{player?.duration || current?.duration ? time(player?.duration || current?.duration || 0) : ""}</span></div>
    </div>}
    {hasMedia && <div className="transport-row">
      <div className="transport-buttons" role="group" aria-label="Playback controls">
        {seekable && <Button variant="ghost" size="icon" className="icon-button flex-col gap-0" aria-label="Seek backward 10 seconds" title="Back 10 seconds" disabled={!transportReady} onClick={() => seekBy(-10)}><RotateCcw aria-hidden="true" /><span aria-hidden="true" className="text-[10px] leading-none">10</span></Button>}
        <Button size="icon" className="play-button" aria-label={player?.status === "playing" ? "Pause" : "Resume"} title={player?.status === "playing" ? "Pause" : "Resume"} disabled={!transportReady}
          onClick={() => { if (player?.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: player.status === "playing" }); }}><Icon name={player?.status === "playing" ? "pause" : "play"} /></Button>
        {seekable && <Button variant="ghost" size="icon" className="icon-button flex-col gap-0" aria-label="Seek forward 10 seconds" title="Forward 10 seconds" disabled={!transportReady} onClick={() => seekBy(10)}><RotateCw aria-hidden="true" /><span aria-hidden="true" className="text-[10px] leading-none">10</span></Button>}
        {hasNext && <Button variant="ghost" size="icon" className="icon-button" aria-label="Next in queue" title="Next in queue" disabled={!transportReady}
          onClick={() => { if (player?.playbackId) void run({ type: "next", playbackId: player.playbackId }); }}><Icon name="next" /></Button>}
        {stop}
        {settings}
        {onExpand && <Button variant="ghost" size="icon" className="playback-expand" aria-label="Open remote controls" onClick={onExpand}><ChevronUp aria-hidden="true" /></Button>}
      </div>
      {session ? <div className="session-volume-row">{volume}{onRemote && <Button variant="outline" className="session-remote-button" onClick={onRemote}><Icon name="remote" />Remote</Button>}</div> : volume}
    </div>}
    {state?.progressError && <p className="playback-error" role="alert">{state.progressError}</p>}
    {!session && <div className="player-settings">{!hasMedia && settings}<WatchingProfile origin={credentials.origin} token={credentials.token} connected={connected} profile={state?.activeProfile} playing={active} version={state?.libraryVersion ?? 0} /></div>}
  </div>;
}
