import { useUpdateActivity } from "./update-activity";
import { loadedBuild } from "../shared/build";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Action, ConnectionInfo, NavigationKey } from "../shared/protocol";
import type { ProviderItem } from "../shared/providers";
import type { RadioStation } from "../shared/radio";
import { createId, useSession, type Credentials } from "./session";
import { knownConnection } from "./connection";
import { BrowseHome } from "./BrowseHome";
import { SavedSection } from "./SavedSection";
import { SessionHome } from "./SessionHome";
import { WatchingProfile } from "./WatchingProfile";
import { SessionBar } from "./SessionBar";
import type { HistoryPlayback } from "./HistoryPanel";
import { SearchPanel } from "./SearchPanel";
import { JellyfinPanel } from "./JellyfinPanel";
import { LibraryPanel } from "./LibraryPanel";
import { PlaybackControls } from "./PlaybackControls";
import { RemotePad } from "./RemotePad";
import { useTvPresentation } from "./useTvPresentation";
import { RadioPanel } from "./RadioPanel";
import { GuidePanel } from "./GuidePanel";
import { MediaArtwork, ProviderPanel } from "./ProviderPanel";
import { Icon } from "./Icon";
import { VideoStage } from "./VideoStage";
import { QueuePanel } from "./QueuePanel";
import { Settings } from "./Settings";
import { useVideoQualityPreference } from "./video-quality";
import { useInterfaceSize } from "./interface-size";
import { TvAppearancePreview } from "./AppearanceSettings";
import { AuthArtwork } from "./AuthArtwork";
import { applyTvNavigation, useNavigation } from "./navigation";
import { House, Search, Bookmark, ListMusic, Settings2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from "@/components/ui/dialog";

const tokenKey = "couch.remote-token";
const nativeHost = isTauri();

function storedCredentials(): Credentials | null {
  if (nativeHost) return null;
  try {
    const token = localStorage.getItem(tokenKey) ?? localStorage.getItem("modern-kodi.remote-token");
    if (token) { localStorage.setItem(tokenKey, token); localStorage.removeItem("modern-kodi.remote-token"); }
    return token ? { origin: knownConnection()?.origin ?? location.origin, token } : null;
  } catch {
    return null;
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(storedCredentials);
  const [host, setHost] = useState<ConnectionInfo | null>(null);
  const [hostAttempt, setHostAttempt] = useState(0);
  const [booting, setBooting] = useState(nativeHost);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [remoteName, setRemoteName] = useState("My remote");
  const [pairing, setPairing] = useState(false);
  const videoQualityPreference = useVideoQualityPreference();
  const homeSection = "Home";
  const [section, setSection] = useState(homeSection);
  const [sourcesRequest, setSourcesRequest] = useState(0);
  const [onlineRequest, setOnlineRequest] = useState<{ item: ProviderItem; revision: number } | null>(null);
  useEffect(() => setOnlineRequest(null), [credentials?.origin, credentials?.token]);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [visited, setVisited] = useState(new Set([homeSection]));
  const shortcutFocus = useRef<string | null>(null);
  const changeSection = (name: string) => {
    if (name === "Remote") { setRemoteOpen(true); return; }
    const destination = name === "For later" ? "Saved" : name;
    shortcutFocus.current = null; setSection(destination); setVisited(previous => new Set([...previous, destination]));
  };
  const browseSection = (name: string) => { changeSection(name); shortcutFocus.current = name === "For later" ? "Saved" : name; };
  useLayoutEffect(() => {
    if (shortcutFocus.current !== section) return;
    shortcutFocus.current = null;
    const tab = document.querySelector<HTMLButtonElement>(`[data-source="${section}"]`);
    const target = tab ?? document.querySelector<HTMLElement>(`[data-page="${section}"] button:not(:disabled), [data-page="${section}"] input:not(:disabled), .browse-back`);
    if (target && !target.closest("[hidden]")) target.focus({ preventScroll: true });
  }, [section]);
  const navigation = useRef<(key: NavigationKey) => void>(() => {});
  const { state, status, details, identity, playerStatus: connectionPlayerStatus, pairingRequired, reachable, connected, command, reconnect } = useSession(credentials, key => navigation.current(key), nativeHost ? undefined : origin => setCredentials(current => current ? { ...current, origin } : null));
  useUpdateActivity(credentials, connected);
  useEffect(() => {
    if (!nativeHost || !credentials) return;
    const stop = new AbortController();
    void (async () => {
      for (let attempt = 0; attempt < 5 && !stop.signal.aborted; attempt++) {
        try {
          const response = await fetch(`${credentials.origin}/api/maintenance/frontend`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ build: loadedBuild }), signal: AbortSignal.any([stop.signal, AbortSignal.timeout(2_000)]) });
          if (response.ok || response.status === 404) return;
        } catch { /* A trial stays closed until this loaded asset identity is received. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    })();
    return () => stop.abort();
  }, [credentials]);
  useInterfaceSize(nativeHost, state?.appearance);
  const tv = useTvPresentation({ enabled: nativeHost, playbackId: state?.player.playbackId ?? null, phase: state?.player.status });
  navigation.current = key => {
    if (!nativeHost) return;
    document.documentElement.setAttribute("data-keyboard", "");
    if (key === "home") {
      const goHome = (remaining: number) => {
        if (document.querySelector('[role="dialog"], [role="listbox"], [data-slot="popover-content"]') && remaining) {
          applyTvNavigation("back");
          requestAnimationFrame(() => goHome(remaining - 1));
        } else tv.openHome();
      };
      goHome(3);
      return;
    }
    if (key === "info") { tv.showControls({ keyboard: true, fromHome: true }); return; }
    if (!tv.browsing && key !== "back") {
      tv.showControls({ keyboard: true });
      if (!tv.controlsVisible) return;
    }
    requestAnimationFrame(() => applyTvNavigation(key));
  };
  useNavigation(() => {
    if (nativeHost && tv.dismissLayer()) return;
    if (remoteOpen) { setRemoteOpen(false); return; }
    if (section !== homeSection) {
      changeSection(homeSection);
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-source="${homeSection}"]`)?.focus());
    }
  });
  const currentCredentials = useRef(credentials);
  const commandAttempt = useRef(0);
  currentCredentials.current = credentials;

  useEffect(() => {
    document.body.classList.toggle("native-host", nativeHost);
    if (!nativeHost) return;
    let disposed = false;
    setBooting(true);
    void invoke<ConnectionInfo>("connection_info").then((info) => {
      if (disposed) return;
      setHost(info);
      setCredentials({ origin: info.origin, token: info.token });
      setError(null);
    }).catch((reason) => {
      if (!disposed) setError(errorText(reason));
    }).finally(() => {
      if (!disposed) setBooting(false);
    });
    return () => { disposed = true; };
  }, [hostAttempt]);

  useEffect(() => {
    if (!nativeHost) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const value = await appWindow.isFullscreen();
        if (!disposed && !value) await appWindow.setFullscreen(true);
      } catch (reason) {
        if (!disposed) setError(errorText(reason));
      }
    };
    void refresh();
    void appWindow.onResized(() => void refresh()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((reason) => { if (!disposed) setError(errorText(reason)); });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const run = async (action: Action) => {
    if (credentials !== currentCredentials.current) return false;
    const attempt = ++commandAttempt.current;
    setError(null);
    try {
      await command(action);
      return credentials === currentCredentials.current;
    } catch (reason) {
      if (credentials === currentCredentials.current && attempt === commandAttempt.current) setError(errorText(reason));
      return false;
    }
  };

  const enqueueProvider = (item: ProviderItem, playNow: boolean, quality = videoQualityPreference.quality) =>
    run({ type: "enqueueWeb", entryId: createId(), url: item.url, title: item.title, thumbnail: item.thumbnail, ...(item.provider === "bandcamp" ? {} : { quality }), playNow });
  const enqueueRadio = (station: RadioStation, playNow: boolean) => run(station.sourceId
    ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow }
    : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow });
  const openProvider = (item: ProviderItem) => {
    setOnlineRequest(previous => ({ item, revision: (previous?.revision ?? 0) + 1 }));
    browseSection("Online");
  };

  const pair = async (event: FormEvent) => {
    event.preventDefault();
    setPairing(true);
    setError(null);
    try {
      const origin = credentials?.origin ?? knownConnection()?.origin ?? location.origin;
      const response = await fetch(`${origin}/api/pair`, {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairingCode.trim(), name: remoteName.trim() }),
      });
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) throw new Error(result.error || "Could not pair with the player.");
      try { localStorage.setItem(tokenKey, result.token); } catch { /* Pairing still works for this tab. */ }
      setCredentials({ origin, token: result.token });
      setPairingCode("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPairing(false);
    }
  };

  const unpair = () => {
    try { localStorage.removeItem(tokenKey); localStorage.removeItem("modern-kodi.remote-token"); } catch { /* Storage may be disabled. */ }
    setCredentials(null);
    setError(null);
  };

  const enqueueCatalog = (type: "enqueueLibrary" | "enqueueJellyfin", itemId: string, options?: { playNow?: boolean; fromStart?: boolean }) =>
    run({ type, itemId, entryId: createId(), ...options });

  const playHistory: HistoryPlayback = (item, options) => {
    if (item.libraryItemId) return enqueueCatalog("enqueueLibrary", item.libraryItemId, { playNow: true, ...options });
    if (item.queueEntryId) return run({ type: "play", entryId: item.queueEntryId, ...options });
    setError("Open this local file on the TV again to resume it.");
    return Promise.resolve(false);
  };

  const player = state?.player;
  const programme = connected ? state?.radioProgramme : null;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const cursorIndex = state?.queue.findIndex(entry => entry.id === (state.currentEntryId ?? state.queueCursorEntryId)) ?? -1;
  const upcomingCount = Math.max(0, (state?.queue.length ?? 0) - cursorIndex - 1);
  const available = connected && !!player && player.status !== "unavailable";
  const active = !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status);
  const statusLabel = booting ? "Starting player" : {
    connecting: "Connecting", syncing: "Getting current state", connected: player?.status === "unavailable" ? "Player unavailable" : "Connected", reconnecting: "Reconnecting", "server-unavailable": "Server unavailable", "pairing-required": credentials ? "Pairing required" : "Not paired", "connection-rejected": "Connection rejected", "build-mismatch": "Refresh this page to load the TV’s current version",
  }[status];

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
        <a className="brand" href="#main" aria-label="Couch, go home" onClick={() => { changeSection(homeSection); if (nativeHost) tv.openHome(); }}>couch<span className="brand-dot" aria-hidden="true" /></a>
        <span className="tv-name">{state?.installationName || details?.name || "Your TV"}</span>
        <div className="header-status">
          {host && <Button variant="ghost" className="pair-shortcut" onClick={() => setPairingOpen(true)}>Pair a remote <strong>{host.pairingCode}</strong></Button>}
          <span role="status" className={connected ? "sr-only" : undefined}>{statusLabel}</span>
          {credentials && !pairingRequired && <WatchingProfile caption origin={credentials.origin} token={credentials.token} connected={connected} profile={state?.activeProfile} playing={active} version={state?.libraryVersion ?? 0} />}
          {(!credentials || pairingRequired) && <Settings setupStep={state?.setupStep} libraryVersion={state?.libraryVersion ?? 0} sourcesRequest={sourcesRequest} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={connectionPlayerStatus} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} appearance={state?.appearance} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} />}
        </div>
      </header>

        {!credentials || pairingRequired ? (
          <Card className="pair-card">
            <div className="pair-icon"><Icon name="screen" /></div>
            <p className="eyebrow">{nativeHost ? "Your media center" : "One screen. A shared queue."}</p>
            <h1>{nativeHost ? "Starting your player" : "Connect to your TV"}</h1>
            {!nativeHost && credentials && <p role="alert">The TV rejected this browser's credential. Pair again to restore access.</p>}
            <p className="muted">{nativeHost ? "The local player and your remotes connect here." : "Enter the pairing code shown on the TV. This device becomes a remote for the same player."}</p>
            {nativeHost ? <Button disabled={booting} className="primary-button" onClick={() => setHostAttempt((attempt) => attempt + 1)}>{booting ? "Starting…" : "Try again"}</Button> : (
              <form onSubmit={pair} className="pair-form">
                <Label htmlFor="remote-name">Remote name</Label>
                <Input id="remote-name" autoComplete="off" maxLength={60} value={remoteName} onChange={event => setRemoteName(event.target.value)} required />
                <Label htmlFor="pairing-code">Pairing code</Label>
                <Input id="pairing-code" className="code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" placeholder="000000" value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, ""))} required autoFocus />
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
                {([{name:"Home", label:"Home", icon:House}, {name:"Search", label:"Search", icon:Search}, {name:"Saved", label:"Saved", icon:Bookmark}, {name:"Queue", label:"Up next", icon:ListMusic}, {name:"Settings", label:"Settings", icon:Settings2}]).map(({name,label,icon:NavIcon}) => <Button key={name} variant="ghost" data-source={name} aria-current={(section === name || name === "Home" && !["Search","Saved","Queue","Settings"].includes(section)) ? "page" : undefined} onClick={() => changeSection(name)}><NavIcon aria-hidden="true" /><span>{label}</span>{name === "Queue" && upcomingCount > 0 && <span className="nav-count">{upcomingCount}</span>}</Button>)}
              </nav>
              <div className="media-browser">
                {!["Home","Search","Saved","Queue","Settings"].includes(section) && <Button className="browse-back" variant="ghost" onClick={() => changeSection("Home")}><ArrowLeft aria-hidden="true" />Home</Button>}
                {visited.has("Browse") && <section data-page="Browse" hidden={section !== "Browse"}><h1 className="page-title">Browse sources</h1><nav className="browse-source-list" aria-label="Browse media">{["Library","Online","Guide","Radio","Jellyfin"].map(name => <Button key={name} variant="outline" onClick={() => browseSection(name)}>{name}</Button>)}</nav></section>}
                {visited.has("Home") && <section data-page="Home" hidden={section !== "Home"}>{nativeHost ? <BrowseHome state={state} credentials={credentials} connected={connected} canPlay={available} playing={active} active={section === "Home" && tv.browsing} onBrowse={browseSection} onPlay={playHistory} onAdd={item => item.libraryItemId ? enqueueCatalog("enqueueLibrary", item.libraryItemId) : Promise.resolve(false)} /> : <SessionHome state={state} credentials={credentials} connected={connected} run={run} onBrowse={browseSection} onPlay={playHistory} active={section === "Home"} />}</section>}
                <section data-page="Queue" hidden={section !== "Queue"}>
                  <QueuePanel defaultQuality={videoQualityPreference.quality} state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} run={run} />
                </section>
                {visited.has("Search") && <section data-page="Search" hidden={section !== "Search"}><SearchPanel onCommand={run} providerVersion={state?.providerVersion ?? 0} radioVersion={state?.radioVersion ?? 0} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={section === "Search" && (!nativeHost || tv.browsing)} libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} onBrowse={changeSection} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} /></section>}
                {visited.has("Saved") && <section data-page="Saved" hidden={section !== "Saved"}><SavedSection state={state} credentials={credentials} connected={connected} canPlay={available} onPlay={playHistory} active={section === "Saved"} onBrowse={browseSection} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} /></section>}
                <section data-page="Settings" hidden={section !== "Settings"}><Settings inline active={section === "Settings"} onOpenRequest={() => changeSection("Settings")} setupStep={state?.setupStep} libraryVersion={state?.libraryVersion ?? 0} sourcesRequest={sourcesRequest} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={connectionPlayerStatus} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} appearance={state?.appearance} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} /></section>
                {visited.has("Guide") && <section data-page="Guide" hidden={section !== "Guide"}><GuidePanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} host={nativeHost} version={state?.iptvVersion ?? 0} recordingsVersion={state?.recordingsVersion ?? 0} controllerVersion={state?.controllerVersion ?? 0} currentSource={state?.queue.find(entry => entry.id === state.currentEntryId)?.source} onGoLive={() => { if (state?.player.playbackId) void run({ type: "goLive", playbackId: state.player.playbackId }); }} active={section === "Guide"} /></section>}
                {visited.has("Online") && <section data-page="Online" hidden={section !== "Online"}><ProviderPanel key={`${credentials.origin}:${credentials.token}:${onlineRequest?.revision ?? 0}`} initialItem={onlineRequest?.item} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.providerVersion ?? 0} defaultQuality={videoQualityPreference.quality} onEnqueue={enqueueProvider} onEnqueueAlbum={(provider, url, playNow) => run({ type: "enqueueProviderAlbum", provider, url, playNow })} /></section>}
                {visited.has("Library") && <section data-page="Library" hidden={section !== "Library"}><LibraryPanel canManage={nativeHost || identity?.authority === "administrator"} onManage={() => setSourcesRequest(value => value + 1)} origin={credentials.origin} token={credentials.token} canPlay={available} host={nativeHost} connected={connected} version={state?.libraryVersion ?? 0} onQueueAlbum={(albumId, playNow) => run({ type: "enqueueAlbum", albumId, playNow })} onEnqueue={(itemId, options) => enqueueCatalog("enqueueLibrary", itemId, options)} onPlayHistory={playHistory} /></section>}
                {visited.has("Radio") && <section data-page="Radio" hidden={section !== "Radio"}><RadioPanel host={nativeHost} onManage={() => setSourcesRequest(value => value + 1)} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.radioVersion ?? 0} onEnqueue={enqueueRadio} /></section>}
                {visited.has("Jellyfin") && <section data-page="Jellyfin" hidden={section !== "Jellyfin"}><JellyfinPanel onManage={() => setSourcesRequest(value => value + 1)} origin={credentials.origin} token={credentials.token} canPlay={available} host={nativeHost} connected={connected} version={state?.jellyfinVersion ?? 0} onEnqueue={(itemId, options) => enqueueCatalog("enqueueJellyfin", itemId, options)} /></section>}
              </div>
            </div>
            {current && active && (nativeHost || section !== "Home") && <SessionBar state={state} credentials={credentials} connected={connected} run={run} onOpen={() => nativeHost ? tv.closeBrowser() : changeSection("Home")} />}
            <Dialog open={remoteOpen} onOpenChange={setRemoteOpen}><DialogContent><DialogHeader><DialogTitle>TV remote</DialogTitle><DialogDescription>Control the TV screen with directional buttons.</DialogDescription></DialogHeader><RemotePad connected={connected} onNavigate={key => run({type:"navigate", key})} /></DialogContent></Dialog>
          </>
        )}
        </div>
        {nativeHost && credentials && <section className="tv-playback-controls" hidden={tv.browsing || !tv.controlsVisible} data-tv-navigation-scope={!tv.browsing && tv.controlsVisible ? "" : undefined} aria-label="Player">
          <div className="tv-watch-actions"><Button variant="secondary" aria-label="Show TV home" onClick={tv.openHome}><House aria-hidden="true" />Home</Button><Button variant="secondary" aria-label="Hide playback controls" onClick={() => tv.dismissLayer()}>Back to watching</Button></div>
          <PlaybackControls state={state} credentials={credentials} connected={connected} run={run} />
        </section>}
            {host && <Dialog open={pairingOpen} onOpenChange={setPairingOpen}>
              <DialogContent className="pairing-panel" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".pair-shortcut")?.focus(); }}>
                <DialogHeader><DialogTitle id="remotes-title">Connect a phone or laptop</DialogTitle><DialogDescription>Open an address on the same network and enter the code. Each device controls this TV and keeps its own browsing.</DialogDescription></DialogHeader>
                <ul className="address-list">{host.urls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
                <div className="pairing-display"><span>Pairing code</span><strong>{host.pairingCode}</strong></div>
              </DialogContent>
            </Dialog>}

      </main>

    </div>
  );
}
