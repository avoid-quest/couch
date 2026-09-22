import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Action, PlayerState, SessionState } from "../../shared/protocol";
import type { Credentials } from "@/session/session";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./MediaArtwork";
import { Icon } from "./Icon";
import { PlaybackSettings } from "./PlaybackSettings";
import { playbackCapabilities, PlaybackTimeline, PlaybackTransport, PlaybackVolume } from "./PlaybackTransport";
import { cn } from "cn";
import { useOptionalShell } from "@/sections/shell/shell-context";

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
  const { tvPresentation } = useOptionalShell() ?? { tvPresentation: false };
  const volume = state && <PlaybackVolume state={state} connected={connected} run={run} />;
  const settings = player && state?.preferences && <PlaybackSettings entry={current} player={player} ready={transportReady} connected={connected} credentials={credentials} preferences={state.preferences} profile={state.activeProfile} onCommand={run} />;

  return <div className={cn("player-controls space-y-6", session && "session-playback")}>
    {!session && player && player.status !== "playing" && <div className="now-heading">
      <Badge variant="secondary" className="playback-status">{state?.radioRetry && player.status === "loading" ? "Reconnecting" : playbackLabels[player.status]}</Badge>
    </div>}
    {session && hasMedia && (current.artworkId || artwork) ? (
      <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center">
        <div className={cn("aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:w-[38%]", radio && "session-radio-art")}>{current.artworkId
          ? <AuthArtwork className="size-full! rounded-none" origin={credentials.origin} token={credentials.token} id={current.artworkId} video={!radio} />
          : <MediaArtwork key={artwork} thumbnail={artwork} title={current.title} />}</div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="media-title" title={current?.title}>{current.title}</h1>
          <p className="source-label">{sourceLabel(current.source)} · <span className="playback-status">{!connected ? "Reconnecting" : state?.radioRetry && player?.status === "loading" ? "Reconnecting" : player ? playbackLabels[player.status] : "Connecting"}</span>{current.live && " · LIVE"}</p>
          {programme && <figure className="radio-programme">
            <figcaption className={cn("text-muted-foreground", session && tvPresentation && "text-lg")}>Programme: {programme.title}{programme.description && <p className="radio-programme-description mt-1 line-clamp-2">{programme.description}</p>}{!tvPresentation && programme.programmeUrl && <small><a href={programme.programmeUrl} target="_blank" rel="noreferrer">Programme details</a></small>}</figcaption>
          </figure>}
        </div>
      </div>
    ) : <>
      <h1 className="media-title" title={current?.title}>{current?.title || (session ? "What would you like to play?" : "Nothing playing")}</h1>
      <p className="source-label">{!connected ? "Reconnecting to the selected playback host. You can still browse." : player?.status === "unavailable" ? `Playback is unavailable on ${state?.installationName || "the selected host"}.` : "Search or paste a link, or play something you saved."}</p>
      {programme && <figure className="radio-programme">
        {!tvPresentation && programme.artworkUrl && <MediaArtwork key={programme.artworkUrl} thumbnail={programme.artworkUrl} title={programme.title} />}
        <figcaption className="text-sm text-muted-foreground">Programme: {programme.title}{programme.description && <p className="radio-programme-description mt-1 line-clamp-2">{programme.description}</p>}{!tvPresentation && programme.programmeUrl && <small><a href={programme.programmeUrl} target="_blank" rel="noreferrer">Programme details</a></small>}</figcaption>
      </figure>}
      {radio && player?.nowPlaying && !tvPresentation && <p className="radio-now-playing" role="status">{[player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" · ")}</p>}
    </>}
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
      {session ? <div className="session-volume-row">{volume}{onRemote && !tvPresentation && <Button variant="outline" className="session-remote-button" onClick={onRemote}><Icon name="remote" />Remote</Button>}</div> : volume}
    </div>}
    {state?.progressError && <Alert variant="destructive" className="playback-error"><AlertDescription>{state.progressError}</AlertDescription></Alert>}
    {!session && !hasMedia && <div className="player-settings">{settings}</div>}
  </div>;
}
