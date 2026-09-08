import { Button } from "@/components/ui/button";
import type { SessionState } from "../shared/protocol";
import { HistoryPanel, type HistoryPlayback } from "./HistoryPanel";
import type { Credentials } from "./session";
import { WatchingProfile } from "./WatchingProfile";

export function BrowseHome({ state, credentials, connected, canPlay, playing, active, onBrowse, onPlay }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  playing: boolean;
  active: boolean;
  onBrowse: (section: string) => void;
  onPlay: HistoryPlayback;
}) {
  return <section className="space-y-6 p-5" aria-label="Browse and resume">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">What would you like to play?</h1>
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Watching as</span><WatchingProfile origin={credentials.origin} token={credentials.token} connected={connected} profile={state?.activeProfile} playing={playing} version={state?.libraryVersion ?? 0} /></div>
    </div>
    <HistoryPanel key={state?.activeProfile.id} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} version={state?.libraryVersion ?? 0} onPlay={onPlay} continueOnly active={active} />
    <nav className="space-y-3" aria-label="Browse media">
      <h2>Find something to play</h2>
      <div className="flex flex-wrap gap-3">{["Search", "For later", "Library", "Online", "Guide", "Radio", "Jellyfin"].map(name => <Button key={name} variant={name === "Search" ? "default" : "outline"} className="min-h-12" onClick={() => onBrowse(name)}>{name}</Button>)}</div>
    </nav>
  </section>;
}
