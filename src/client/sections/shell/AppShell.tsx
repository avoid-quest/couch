import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Component, createContext, useContext, useEffect, useRef, useState, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import type { HistoryPlayback } from "@/components/HistoryPanel";
import type { Action } from "../../../shared/protocol";
import type { PlaylistSource } from "../../../shared/playlists";
import { AuthArtwork } from "@/components/AuthArtwork";
import { DigitalClock } from "@/components/DigitalClock";
import { Icon } from "@/components/Icon";
import { MediaArtwork } from "@/components/MediaArtwork";
import { ProviderPanel } from "@/components/ProviderPanel";
import { RemotePad } from "@/components/RemotePad";
import { PairingDialog } from "@/components/PairingDialog";
import { LocalSharingPrompt, PlaybackDevice } from "@/sections/shell/PlaybackDevice";
import { PlaybackControls } from "@/components/PlaybackControls";
import { PlaybackStatus } from "@/sections/shell/PlaybackStatus";
import { SourceSetupDialog } from "@/components/SourceSetupDialog";
import { errorText, useSessionGate } from "@/session/session-context";
import { SessionBar } from "@/components/SessionBar";
import { TvAppearancePreview } from "./TvAppearancePreview";
import { VideoStage } from "@/sections/shell/VideoStage";
import { readSearchState, searchLocation, type SearchRouteState } from "@/search";
import { createId } from "@/session/session";
import { pathForSection, sectionForPath } from "../../../shared/page-paths";
import { settingsPageForPath, settingsPagePath, settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Bookmark, Compass, House, Settings2, CirclePlay } from "lucide-react";

const radioHistoryKey = "couch.radio-recents";
const radioHistory = (): RadioStation[] => { try { return JSON.parse(localStorage.getItem(radioHistoryKey) ?? "[]") as RadioStation[]; } catch { return []; } };
const navItems: { name: string; label: string; icon: typeof House }[] = [
  { name: "Now", label: "Now", icon: CirclePlay },
  { name: "Find", label: "Find", icon: Compass },
  { name: "Saved", label: "Saved", icon: Bookmark },
  { name: "Settings", label: "Settings", icon: Settings2 },
];

type ShellValue = ReturnType<typeof useShellValue>;

const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside the app shell.");
  return value;
}

function useShellValue() {
  const gate = useSessionGate();
  const { nativeHost, credentials, state, status, details, identity, playerStatus: connectionPlayerStatus, pairingRequired, connected, run, unpair, host, booting, error, setError, tv, registerBackHandler, videoQualityPreference, remoteControlEnabled, setRemoteControlEnabled } = gate;
  const router = useRouter();
  const location = useLocation();
  const section = sectionForPath(location.pathname) ?? "Now";
  const settingsSection = settingsPageForPath(location.pathname) ?? (section === "Settings" ? "playback" : null);
  const rememberedSearch = useRef<SearchRouteState>({ query: "", source: "All" });
  if (section === "Find") rememberedSearch.current = readSearchState(location.searchStr);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [setupSource, setSetupSource] = useState<"folders" | "jellyfin" | "radio" | "iptv" | "streaming-community">("jellyfin");
  const openSources = (source: typeof setupSource = "jellyfin") => { setSetupSource(source); setSourcesOpen(true); };
  const [recentRadio, setRecentRadio] = useState<RadioStation[]>(radioHistory);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [onlineRequest, setOnlineRequest] = useState<{ item: ProviderItem; revision: number } | null>(null);
  const playCredentials = useRef(credentials);
  const playAttempt = useRef(0);
  playCredentials.current = credentials;
  useEffect(() => { setOnlineRequest(null); setSourcesOpen(false); }, [credentials?.origin, credentials?.token]);

  useEffect(() => {
    document.title = settingsSection ? `${settingsPages[settingsSection].label} · Settings · Couch` : section === "Now" ? "Couch" : `${section} · Couch`;
  }, [section, settingsSection]);

  const back = () => {
    if (router.history.canGoBack()) router.history.back();
    else router.history.push("/");
  };
  const at = location.pathname + location.searchStr;
  const changePage = (name: string) => {
    const to = name === "Find" ? searchLocation(rememberedSearch.current) : pathForSection(name);
    if (to !== at) router.history.push(to);
  };
  const changeSection = (name: string) => {
    if (name === "Remote") { setRemoteOpen(true); return; }
    changePage(name);
  };
  const browseSection = (name: string) => {
    const destination = name === "Home" || name === "Search" || name === "Browse" || name === "Queue" ? "Now" : name === "For later" ? "Saved" : "Find";
    changeSection(destination);
  };
  const changeSettingsSection = (page: SettingsPage | null) => {
    const to = settingsPagePath(page);
    if (to !== location.pathname) router.history.push(to);
  };
  const gotoSearch = (state: SearchRouteState) => {
    const to = searchLocation(state);
    if (to !== at) router.history.push(to);
  };
  const changeSearch = (state: SearchRouteState) => {
    const to = searchLocation(state);
    if (to !== at) router.history.replace(to);
  };
  useEffect(() => {
    registerBackHandler(() => {
      if (remoteOpen) { setRemoteOpen(false); return; }
      if (section !== "Now") back();
    });
  });

  const enqueueProvider = (item: ProviderItem, playNow: boolean, quality = videoQualityPreference.quality) =>
    run({ type: "enqueueWeb", entryId: createId(), url: item.url, title: item.title, thumbnail: item.thumbnail, ...(item.provider === "bandcamp" ? {} : { quality }), playNow });
  const saveProviderPlaylist = async (provider: PlaylistSource["provider"], url: string) => {
    if (!credentials) throw new Error("Could not save the playlist. Check the TV connection.");
    const response = await fetch(`${credentials.origin}/api/playlists`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: { provider, url } }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => { throw new Error("Could not save the playlist. Check the TV connection."); });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "Could not save the playlist.");
    }
    return true;
  };
  const enqueueRadio = (station: RadioStation, playNow: boolean) => {
    const result = run(station.sourceId
      ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow }
      : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow });
    // Recents record what actually played, not what was queued or attempted.
    if (playNow) void result.then(ok => {
      if (!ok) return;
      setRecentRadio(current => {
        const next = [station, ...current.filter(entry => entry.id !== station.id)].slice(0, 8);
        try { localStorage.setItem(radioHistoryKey, JSON.stringify(next)); } catch { /* Recents are best-effort. */ }
        return next;
      });
    });
    return result;
  };
  const openProvider = (item: ProviderItem) => {
    setOnlineRequest(previous => ({ item, revision: (previous?.revision ?? 0) + 1 }));
    browseSection("Online");
  };
  const enqueueCatalog = (type: "enqueueLibrary" | "enqueueJellyfin", itemId: string, options?: { playNow?: boolean; fromStart?: boolean }) =>
    run({ type, itemId, entryId: createId(), ...options });

  const playHistory: HistoryPlayback = async (item, options) => {
    if (item.playable && credentials && state) {
      if (credentials !== playCredentials.current) return false;
      const attempt = ++playAttempt.current;
      setError(null);
      try {
        const response = await fetch(`${credentials.origin}/api/progress/${encodeURIComponent(item.mediaId)}/play`, {
          method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fromStart: options.fromStart === true, profileId: state.activeProfile.id }),
          signal: AbortSignal.timeout(35_000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not play this item.");
        return credentials === playCredentials.current;
      } catch (reason) {
        if (credentials === playCredentials.current && attempt === playAttempt.current) setError(errorText(reason));
        return false;
      }
    }
    if (item.libraryItemId) return enqueueCatalog("enqueueLibrary", item.libraryItemId, { playNow: true, ...options });
    if (item.queueEntryId) return run({ type: "play", entryId: item.queueEntryId, ...options });
    setError("This saved source is no longer available.");
    return Promise.resolve(false);
  };

  const player = state?.player;
  const programme = connected ? state?.radioProgramme : null;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const available = connected && !!player && player.status !== "unavailable";
  const active = !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status);
  const statusLabel = booting ? "Starting player" : {
    connecting: "Connecting", syncing: "Getting current state", connected: player?.status === "unavailable" ? "Player unavailable" : "Connected", reconnecting: "Reconnecting", "server-unavailable": "Server unavailable", "pairing-required": credentials ? "Pairing required" : "Not paired", "connection-rejected": "Connection rejected", "build-mismatch": "Refresh this page to load the TV’s current version",
  }[status];

  return {
    // The shell only renders routes inside the paired branch; pages can rely
    // on credentials being set.
    ...gate, credentials: credentials!, section, settingsSection, statusLabel, available, active, programme, current, recentRadio,
    changeSection, browseSection, back, gotoSearch, changeSearch, changeSettingsSection,
    openSources, openProvider, setRemoteOpen, setPairingOpen, setSourcesOpen,
    enqueueProvider, enqueueRadio, enqueueCatalog, saveProviderPlaylist, playHistory,
    remoteOpen, pairingOpen, onlineRequest, setupSource, sourcesOpen,
    closeOnlineRequest: () => setOnlineRequest(null),
    sectionUrl: (name: string) => name === "Find" ? searchLocation(rememberedSearch.current) : pathForSection(name),
  };
}

class ShellErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-shell couch-shell remote-shell"><main id="main">
        <div className="notice error-notice" role="alert"><span>{this.state.error.message}</span><Button onClick={() => this.setState({ error: null })}>Try again</Button></div>
      </main></div>
    );
  }
}

export function AppShell({ children }: PropsWithChildren) {
  const shell = useShellValue();
  return <ShellErrorBoundary><ShellContext.Provider value={shell}><ShellChrome>{children}</ShellChrome></ShellContext.Provider></ShellErrorBoundary>;
}

function ShellChrome({ children }: PropsWithChildren) {
  const shell = useShell();
  const { nativeHost, credentials, state, status, details, identity, playerStatus: connectionPlayerStatus, pairingRequired, reachable, connected, run, reconnect, unpair, host, booting, error, setError, tv, videoQualityPreference, remoteControlEnabled, setRemoteControlEnabled } = shell;
  const { section, statusLabel, available, active, programme, current } = shell;
  const { pairing, pairingCode, setPairingCode, remoteName, setRemoteName, pair } = shell;
  const { setupSource, sourcesOpen, setSourcesOpen } = shell;
  const player = state?.player;

  return (
    <div className={`app-shell couch-shell ${nativeHost ? `tv-shell${tv.browsing ? " tv-browsing" : ""}${tv.controlsVisible ? " tv-controls-visible" : ""}` : "remote-shell"}`}>

      <main id="main">
        {nativeHost && state?.appearance && <TvAppearancePreview appearance={state.appearance} credentials={credentials} connected={connected} />}
        {error && <div className="notice error-notice" role="alert"><span>{error}</span><Button variant="ghost" size="icon" className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" /></Button></div>}
        {nativeHost && <VideoStage active={active} title={current?.title || "Your media"}
          audioOnly={current?.kind === "radio" || !!player?.tracks?.some(track => track.kind === "audio") && !player.tracks.some(track => track.kind === "video" && track.selected)}
          subtitle={[programme ? `Programme: ${programme.title}` : null, player?.nowPlaying ? [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" · ") : null].filter(Boolean).join(" · ") || undefined}
          artwork={programme?.artworkUrl ? <MediaArtwork key={programme.artworkUrl} thumbnail={programme.artworkUrl} title={programme.title} /> : current?.artworkId && credentials ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : current?.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : undefined} />}
        <div className={nativeHost ? "tv-browser" : "remote-browser"} hidden={nativeHost && !tv.browsing} data-tv-navigation-scope={nativeHost && tv.browsing ? "" : undefined}>
      <header className="app-header">
        <Link className="brand" to="/" aria-label="Couch, go home" onClick={() => { if (nativeHost) tv.openHome(); }}>couch<span className="brand-dot" aria-hidden="true" /></Link>
        <div className="header-status">
          {nativeHost ? <PlaybackDevice /> : <PlaybackStatus credentials={credentials} connected={connected} status={statusLabel} installationName={state?.installationName ?? details?.name} />}
          {host && remoteControlEnabled && <Button variant="ghost" className="pair-shortcut" onClick={() => shell.setPairingOpen(true)}>Pair a remote <strong>{host.pairingCode}</strong></Button>}
          <span role="status" className={connected ? "sr-only" : undefined}>{statusLabel}</span>
          {credentials && !pairingRequired && !nativeHost && <Link className="controller-name" to="/settings/connection" aria-label={identity?.controller ? `Device: ${identity.controller.name}` : "Connection"} title={identity?.controller ? `${identity.controller.name} · ${identity.controller.role === "administrator" ? "Administrator" : "Controller"}` : undefined}>{identity?.controller?.name || "Connection"}</Link>}
          {credentials && !pairingRequired && !nativeHost && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Remote" onClick={() => shell.setRemoteOpen(true)}><Icon name="remote" /></Button></TooltipTrigger><TooltipContent>Remote</TooltipContent></Tooltip>}
          <DigitalClock />
        </div>
      </header>

        {!credentials || pairingRequired ? (
          <Card className="pair-card">
            <div className="pair-icon"><Icon name="screen" /></div>
            <p className="eyebrow">{nativeHost ? "Your media center" : "Play on another computer"}</p>
            <h1>{nativeHost ? "Starting your player" : "Connect to Couch"}</h1>
            {!nativeHost && credentials && <p role="alert">{credentials.installationId && details?.installationId && credentials.installationId !== details.installationId ? "A different Couch installation is using this address. Check the playback computer and pair again." : "Couch rejected this remote's pairing. Pair again to restore access."}</p>}
            <p className="muted">{nativeHost ? "The local player and your remotes connect here." : "Scan the QR or enter the code shown on the playback computer."}</p>
            {nativeHost ? <Button disabled={booting} className="primary-button" onClick={shell.retryHost}>{booting ? "Starting…" : "Try again"}</Button> : (
              <form onSubmit={pair} className="pair-form">
                <Label htmlFor="remote-name">Device name</Label>
                <Input id="remote-name" autoFocus={!!pairingCode} autoComplete="off" maxLength={60} value={remoteName} onChange={event => setRemoteName(event.target.value)} required />
               <Label htmlFor="pairing-code">Pairing code</Label>
                <InputOTP id="pairing-code" aria-label="Pairing code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoFocus={!pairingCode} value={pairingCode} onChange={setPairingCode}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} /><InputOTPSlot index={1} /><InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
                <Button className="primary-button" disabled={pairing || pairingCode.length !== 6 || !remoteName.trim()}>{pairing ? "Connecting…" : "Connect"}</Button>
              </form>
            )}
          </Card>
        ) : (
          <>
            {!connected && <p className="notice" role="status">Connecting to the player. Controls will return when the current state arrives.</p>}
            {player?.status === "unavailable" && <p className="notice">{player.error || "The TV player is unavailable. You can still prepare the queue."}</p>}
            <div className="workspace">
              <nav className="primary-nav" aria-label="Main navigation">
                {navItems.map(({ name, label, icon: NavIcon }) => <Button key={name} asChild variant="ghost"><Link to={name === "Find" ? shell.sectionUrl(name) : pathForSection(name)} data-source={name} aria-current={section === name ? "page" : undefined}><NavIcon aria-hidden="true" /><span>{label}</span></Link></Button>)}
              </nav>
              <div className="media-browser">
                {children}
              </div>
            </div>
            <SourceSetupDialog localOnly={nativeHost} source={setupSource} open={sourcesOpen} onOpenChange={setSourcesOpen} credentials={credentials} connected={connected} canManage={nativeHost || identity?.authority === "administrator"} />
            {current && (active || player?.status === "error") && section !== "Now" && <SessionBar state={state} credentials={credentials} connected={connected} run={run} onOpen={() => shell.changeSection("Now")} onRemote={nativeHost ? undefined : () => shell.setRemoteOpen(true)} />}
            {/* Saved provider collections open here: Find stays search-first, and
                Open gives the collection its own browsable trail. */}
            <Dialog open={shell.onlineRequest !== null} onOpenChange={open => { if (!open) shell.closeOnlineRequest(); }}>
              <DialogContent className="max-w-3xl">
                <DialogHeader><DialogTitle>{shell.onlineRequest?.item.title ?? "Saved source"}</DialogTitle><DialogDescription>Browse this saved source.</DialogDescription></DialogHeader>
                {shell.onlineRequest && <ProviderPanel key={shell.onlineRequest.revision} showHeading={false} active initialItem={shell.onlineRequest.item} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.providerVersion ?? 0} defaultQuality={videoQualityPreference.quality} onPlayHistory={shell.playHistory} onEnqueue={shell.enqueueProvider} onEnqueuePlaylist={(url, playNow, quality) => run({ type: "enqueueProviderPlaylist", provider: "youtube", url, playNow, ...(quality ? { quality } : {}) })} onEnqueueAlbum={(provider, url, playNow) => run({ type: "enqueueProviderAlbum", provider, url, playNow })} onSavePlaylist={shell.saveProviderPlaylist} />}
              </DialogContent>
            </Dialog>
            <Dialog open={shell.remoteOpen} onOpenChange={shell.setRemoteOpen}><DialogContent><DialogHeader><DialogTitle>TV remote</DialogTitle><DialogDescription>Control the TV screen with directional buttons.</DialogDescription></DialogHeader><RemotePad connected={connected} onNavigate={key => run({type:"navigate", key})} /></DialogContent></Dialog>
          </>
        )}
        </div>
        {nativeHost && credentials && <section className="tv-playback-controls" hidden={tv.browsing || !tv.controlsVisible} data-tv-navigation-scope={!tv.browsing && tv.controlsVisible ? "" : undefined} aria-label="Player">
          <div className="tv-watch-actions"><Button variant="secondary" aria-label="Show TV home" onClick={() => tv.openHome()}><House aria-hidden="true" />Home</Button><Button variant="secondary" aria-label="Hide playback controls" onClick={() => tv.dismissLayer()}>Back to watching</Button></div>
          <PlaybackControls state={state} credentials={credentials} connected={connected} run={run} />
        </section>}
        {nativeHost && credentials && <LocalSharingPrompt onRemoteControlChange={setRemoteControlEnabled} credentials={credentials} />}
        {host && remoteControlEnabled && <PairingDialog host={host} connected={connected} open={shell.pairingOpen} onOpenChange={shell.setPairingOpen} />}

      </main>

    </div>
  );
}
