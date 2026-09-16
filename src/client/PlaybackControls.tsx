import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Action, PlayerState, SessionState } from "../shared/protocol";
import type { Credentials } from "./session/session";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";
import { Icon } from "./Icon";
import { PlaybackSettings } from "./PlaybackSettings";
import { playbackCapabilities, PlaybackTimeline, PlaybackTransport, PlaybackVolume } from "./PlaybackTransport";

const playbackLabels: Record<PlayerState["status"], string> = {
  unavailable: "No player", idle: "Ready", loading: "Loading…", playing: "Playing",
  paused: "Paused", ended: "Finished", error: "Playback error",
};

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
  const { available, audioReady, transportReady } = playbackCapabilities(state, connected);
  const radio = current?.kind === "radio" || current?.source.startsWith("radio:");
  const hasMedia = !!current;
  const programme = connected && radio && state?.radioProgramme?.playbackId === player?.playbackId ? state?.radioProgramme : null;
  const artwork = programme?.artworkUrl || current?.thumbnail;
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
    {current && state?.playedBy && <p className="source-label">Started from {state.playedBy.name}</p>}
    {programme && <figure className="radio-programme">
      {!session && programme.artworkUrl && <MediaArtwork key={programme.artworkUrl} thumbnail={programme.artworkUrl} title={programme.title} />}
      <figcaption>Programme: {programme.title}{programme.description && <p className="radio-programme-description">{programme.description}</p>}<small>{programme.programmeUrl ? <a href={programme.programmeUrl} target="_blank" rel="noreferrer">Programme on radio.avoid.quest</a> : "via radio.avoid.quest"}</small></figcaption>
    </figure>}
    {radio && player?.nowPlaying && <p className="radio-now-playing" role="status">{[player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" · ")}</p>}
    {state?.radioRetry && ["loading", "error"].includes(player?.status ?? "") && <Alert className="radio-retry" role="status"><AlertDescription>
      <p>{player?.status === "loading" ? `Reconnecting, attempt ${state.radioRetry.attempt} of ${state.radioRetry.maximum}. Stop cancels reconnecting.` : `Could not reconnect after ${state.radioRetry.maximum} attempts.`}</p>
      {player?.status === "error" && current && <Button variant="outline" disabled={!available} onClick={() => void run({ type: "play", entryId: current.id })}>Try again</Button>}
    </AlertDescription></Alert>}
    {state?.webRetry && <div className="radio-retry" role="status">
      <p>Checking the expired stream. Recovery is limited to one attempt. Stop cancels recovery.</p>
      {player?.playbackId && <Button variant="outline" disabled={!available} onClick={() => void run({ type: "pause", playbackId: player.playbackId!, paused: !state.webRetry!.paused })}>{state.webRetry.paused ? "Resume after recovery" : "Stay paused after recovery"}</Button>}
    </div>}
    {state?.systemAudio?.error && <Alert variant="destructive"><AlertDescription>{state.systemAudio.error}</AlertDescription></Alert>}
    {player?.status === "error" && current && state?.systemAudio && <Button disabled={!available || !audioReady} onClick={() => void run({ type: "play", entryId: current.id })}>Resume playback</Button>}
    {player?.error && player.status !== "unavailable" && <Alert variant="destructive" className="playback-error"><AlertDescription>{player.error}</AlertDescription></Alert>}
    {state && <PlaybackTimeline state={state} connected={connected} run={run} />}
    {hasMedia && <div className="transport-row">
      {state && <PlaybackTransport state={state} credentials={credentials} connected={connected} run={run} onExpand={onExpand} />}
      {session ? <div className="session-volume-row">{volume}{onRemote && <Button variant="outline" className="session-remote-button" onClick={onRemote}><Icon name="remote" />Remote</Button>}</div> : volume}
    </div>}
    {state?.progressError && <Alert variant="destructive" className="playback-error"><AlertDescription>{state.progressError}</AlertDescription></Alert>}
    {!session && !hasMedia && <div className="player-settings">{settings}</div>}
  </div>;
}
