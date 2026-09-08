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
import { playbackCapabilities, PlaybackTransport, PlaybackVolume } from "./PlaybackTransport";

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
  const { available, active, audioReady, transportReady, seekable } = playbackCapabilities(state, connected);
  const radio = current?.kind === "radio" || current?.source.startsWith("radio:");
  const hasMedia = !!current;
  const artwork = connected && radio ? state?.radioProgramme?.artworkUrl || current?.thumbnail : current?.thumbnail;
  const session = presentation === "session";
  const volume = state && <PlaybackVolume state={state} connected={connected} run={run} />;
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
      {state && <PlaybackTransport state={state} credentials={credentials} connected={connected} run={run} onExpand={onExpand} />}
      {session ? <div className="session-volume-row">{volume}{onRemote && <Button variant="outline" className="session-remote-button" onClick={onRemote}><Icon name="remote" />Remote</Button>}</div> : volume}
    </div>}
    {state?.progressError && <p className="playback-error" role="alert">{state.progressError}</p>}
    {!session && <div className="player-settings">{!hasMedia && settings}<WatchingProfile origin={credentials.origin} token={credentials.token} connected={connected} profile={state?.activeProfile} playing={active} version={state?.libraryVersion ?? 0} /></div>}
  </div>;
}
