import { Link } from "react-router";
import { usePageRoute } from "./routes";
import { useUpdateActivity } from "./update-activity";
import { loadedBuild } from "../shared/build";
import { invoke } from "@tauri-apps/api/core";
import { isNativeHost } from "./native-context";
import { PlaybackDevice, LocalSharingPrompt } from "./PlaybackDevice";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Action, ConnectionInfo, NavigationKey } from "../shared/protocol";
import type { ProviderId, ProviderItem } from "../shared/providers";
import type { RadioStation } from "../shared/radio";
import { createId, useSession, type Credentials } from "./session";
import { BrowseHome } from "./BrowseHome";
import { SavedSection } from "./SavedSection";
import { AvoidRadioHome } from "./AvoidRadioHome";
import { SourceSetupDialog } from "./SourceSetupDialog";
import { NowPlaying } from "./NowPlaying";
import { pairingCodeFromHash } from "./pairing-link";
import { PairingDialog } from "./PairingDialog";
import "./device-header.css";
import { MediaLibrary } from "./MediaLibrary";
import { DigitalClock } from "./DigitalClock";
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
import { House, Bookmark, ListMusic, Settings2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from "@/components/ui/dialog";

const tokenKey = "couch.remote-token";
const installationKey = "couch.remote-installation-id";
const nativeHost = isNativeHost();

function storedCredentials(): Credentials | null {
  if (nativeHost) return null;
  try {
    const token = localStorage.getItem(tokenKey) ?? localStorage.getItem("modern-kodi.remote-token");
    if (token) { localStorage.setItem(tokenKey, token); localStorage.removeItem("modern-kodi.remote-token"); }
    const installationId = localStorage.getItem(installationKey);
    return token && installationId ? { origin: location.origin, token, installationId } : null;
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
  const [pairingCode, setPairingCode] = useState(() => nativeHost ? "" : pairingCodeFromHash(location.hash));
  useEffect(() => { if (!nativeHost && pairingCodeFromHash(location.hash)) history.replaceState(history.state, "", location.pathname + location.search); }, []);
  const [remoteName, setRemoteName] = useState("My remote");
  const [pairing, setPairing] = useState(false);
  const videoQualityPreference = useVideoQualityPreference();
  const homeSection = "Home";
  const { section, visited, sectionUrl, changePage, back, searchState, changeSearch, settingsSection, changeSettingsSection } = usePageRoute();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [setupSource, setSetupSource] = useState<"folders" | "jellyfin" | "radio" | "iptv" | "streaming-community">("jellyfin");
  const openSources = (source: typeof setupSource = "jellyfin") => { setSetupSource(source); setSourcesOpen(true); };
  const [remoteControlEnabled, setRemoteControlEnabled] = useState(false);
  const [homeQuery, setHomeQuery] = useState(searchState.query);
  useEffect(() => setHomeQuery(searchState.query), [searchState.query]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("youtube");
  const [providerRequest, setProviderRequest] = useState(0);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const playbackTrigger = useRef<HTMLElement | null>(null);
  const browsingScroll = useRef(0);
  const showNowPlaying = () => {
    playbackTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    browsingScroll.current = (document.querySelector(".tv-browser") ?? document.scrollingElement)?.scrollTop ?? 0;
    setNowPlayingOpen(true);
    requestAnimationFrame(() => {
      const container = document.querySelector(".tv-browser") ?? document.scrollingElement;
      if (container) container.scrollTop = 0;
    });
  };
  const closeNowPlaying = () => {
    setNowPlayingOpen(false);
    requestAnimationFrame(() => {
      const container = document.querySelector(".tv-browser") ?? document.scrollingElement;
      if (container) container.scrollTop = browsingScroll.current;
      const target = playbackTrigger.current?.isConnected ? playbackTrigger.current : document.querySelector<HTMLElement>(".session-bar-open") ?? document.querySelector<HTMLElement>('.primary-nav [aria-current="page"]');
      target?.focus({ preventScroll: true });
    });
  };
  const [onlineRequest, setOnlineRequest] = useState<{ item: ProviderItem; revision: number } | null>(null);
  useEffect(() => { setOnlineRequest(null); setSourcesOpen(false); setNowPlayingOpen(false); }, [credentials?.origin, credentials?.token]);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const shortcutFocus = useRef<string | null>(null);
  const changeSection = (name: string) => {
    setNowPlayingOpen(false);
    if (name === "Remote") { setRemoteOpen(true); return; }
    const destination = name === "For later" ? "Saved" : name;
    shortcutFocus.current = null; changePage(destination);
  };
  const browseSection = (name: string) => { changeSection(name); shortcutFocus.current = name === "For later" ? "Saved" : name; };
  useLayoutEffect(() => {
    if (shortcutFocus.current !== section && !document.activeElement?.closest("[hidden]")) return;
    shortcutFocus.current = null;
    const tab = document.querySelector<HTMLElement>(`[data-source="${section}"]`);
    const target = tab ?? document.querySelector<HTMLElement>(`[data-page="${section}"] button:not(:disabled), [data-page="${section}"] input:not(:disabled), .browse-back`);
    if (target && !target.closest("[hidden]")) target.focus({ preventScroll: true });
  }, [section]);
  const { state, status, details, identity, playerStatus: connectionPlayerStatus, pairingRequired, reachable, connected, command, reconnect } = useSession(credentials, handleNavigation);
  useUpdateActivity(credentials, connected);
  useEffect(() => setRemoteControlEnabled(details?.remoteControlEnabled === true), [details?.remoteControlEnabled]);
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
  const tv = useTvPresentation({ enabled: nativeHost, presentationId: state?.presentationId, playbackId: state?.player.playbackId ?? null, phase: state?.player.status });
  function handleNavigation(key: NavigationKey) {
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
  }
  useNavigation(() => {
    if (nowPlayingOpen) { closeNowPlaying(); return; }
    if (nativeHost && tv.dismissLayer()) return;
    if (remoteOpen) { setRemoteOpen(false); return; }
    if (section !== homeSection) {
      back();
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
      const origin = credentials?.origin ?? location.origin;
      const response = await fetch(`${origin}/api/pair`, {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairingCode.trim(), name: remoteName.trim() }),
      });
      const result = await response.json() as { token?: string; installationId?: string; error?: string };
      if (!response.ok || !result.token || !result.installationId) throw new Error(response.status === 401 ? "That code is no longer valid. Scan the QR again or enter the code currently shown on the playback computer." : result.error || "Could not pair with the player.");
      try { localStorage.setItem(tokenKey, result.token); localStorage.setItem(installationKey, result.installationId); } catch { /* Pairing still works for this tab. */ }
      setCredentials({ origin, token: result.token, installationId: result.installationId });
      setPairingCode("");
    } catch (reason) {
      setError(`${errorText(reason)} Check that your device and playback computer are on the same network, then try Connect again.`);
    } finally {
      setPairing(false);
    }
  };

  const unpair = () => {
    try { localStorage.removeItem(tokenKey); localStorage.removeItem(installationKey); localStorage.removeItem("modern-kodi.remote-token"); } catch { /* Storage may be disabled. */ }
    setCredentials(null);
    setError(null);
  };

  const enqueueCatalog = (type: "enqueueLibrary" | "enqueueJellyfin", itemId: string, options?: { playNow?: boolean; fromStart?: boolean }) =>
    run({ type, itemId, entryId: createId(), ...options });

  const playHistory: HistoryPlayback = async (item, options) => {
    if (item.playable && credentials && state) {
      if (credentials !== currentCredentials.current) return false;
      const attempt = ++commandAttempt.current;
      setError(null);
      try {
        const response = await fetch(`${credentials.origin}/api/progress/${encodeURIComponent(item.mediaId)}/play`, {
          method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fromStart: options.fromStart === true, profileId: state.activeProfile.id }),
          signal: AbortSignal.timeout(35_000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not play this item.");
        return credentials === currentCredentials.current;
      } catch (reason) {
        if (credentials === currentCredentials.current && attempt === commandAttempt.current) setError(errorText(reason));
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
        <Link className="brand" to="/" aria-label="Couch, go home" onClick={() => { setNowPlayingOpen(false); if (nativeHost) tv.openHome(); }}>couch<span className="brand-dot" aria-hidden="true" /></Link>
        <div className="header-status">
          {nativeHost ? <PlaybackDevice /> : <span className="text-sm text-muted-foreground" aria-label={`Playback on ${state?.installationName ?? details?.name ?? "Couch"}`}>Play on {state?.installationName ?? details?.name ?? "Couch"}</span>}
          {host && remoteControlEnabled && <Button variant="ghost" className="pair-shortcut" onClick={() => setPairingOpen(true)}>Pair a remote <strong>{host.pairingCode}</strong></Button>}
          <span role="status" className={connected ? "sr-only" : undefined}>{statusLabel}</span>
          {credentials && !pairingRequired && !nativeHost && <Link className="controller-name" to="/settings/connection" onClick={() => setNowPlayingOpen(false)} aria-label={identity?.controller ? `Device: ${identity.controller.name}` : "Connection"} title={identity?.controller ? `${identity.controller.name} · ${identity.controller.role === "administrator" ? "Administrator" : "Controller"}` : undefined}>{identity?.controller?.name || "Connection"}</Link>}
          {(!credentials || pairingRequired) && <Settings libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={connectionPlayerStatus} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} appearance={state?.appearance} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} />}
          {credentials && !pairingRequired && !nativeHost && <Button variant="ghost" size="icon" aria-label="Remote" title="Remote" onClick={() => setRemoteOpen(true)}><Icon name="remote" /></Button>}
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
            {nativeHost ? <Button disabled={booting} className="primary-button" onClick={() => setHostAttempt((attempt) => attempt + 1)}>{booting ? "Starting…" : "Try again"}</Button> : (
              <form onSubmit={pair} className="pair-form">
                <Label htmlFor="remote-name">Device name</Label>
                <Input id="remote-name" autoFocus={!!pairingCode} autoComplete="off" maxLength={60} value={remoteName} onChange={event => setRemoteName(event.target.value)} required />
                <Label htmlFor="pairing-code">Pairing code</Label>
                <Input id="pairing-code" className="code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" placeholder="000000" value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, ""))} required autoFocus={!pairingCode} />
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
                {([{name:"Home", label:"Home", icon:House}, {name:"Saved", label:"Saved", icon:Bookmark}, {name:"Queue", label:"Up next", icon:ListMusic}, {name:"Settings", label:"Settings", icon:Settings2}]).map(({name,label,icon:NavIcon}) => <Button key={name} asChild variant="ghost"><Link to={sectionUrl(name)} onClick={() => setNowPlayingOpen(false)} data-source={name} aria-current={(section === name || name === "Home" && !["Saved","Queue","Settings"].includes(section)) ? "page" : undefined}><NavIcon aria-hidden="true" /><span>{label}</span>{name === "Queue" && upcomingCount > 0 && <span className="nav-count">{upcomingCount}</span>}</Link></Button>)}
              </nav>
              <div className="media-browser">
                {nowPlayingOpen && <NowPlaying state={state} credentials={credentials} connected={connected} run={run} onBack={closeNowPlaying} onBrowse={browseSection} onRemote={nativeHost ? undefined : () => setRemoteOpen(true)} />}
                <div hidden={nowPlayingOpen}>
                {!["Home","Saved","Queue","Settings"].includes(section) && <Button className="browse-back" variant="ghost" onClick={() => changeSection("Home")}><ArrowLeft aria-hidden="true" />Home</Button>}
                <section data-page="Home" hidden={section !== "Home"} className="space-y-6">
                  <h1 className="page-title">Find something to play</h1>
                  <SearchPanel draftQuery={homeQuery} onManageSources={openSources} searchState={searchState} onSearchChange={changeSearch} onQueryChange={setHomeQuery} onCommand={run} providerVersion={state?.providerVersion ?? 0} radioVersion={state?.radioVersion ?? 0} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={section === "Home" && !nowPlayingOpen && (!nativeHost || tv.browsing)} libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} onBrowse={changeSection} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
                  <div hidden={!!homeQuery.trim()} className="space-y-6">
                    <AvoidRadioHome origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.radioVersion ?? 0} onEnqueue={enqueueRadio} onBrowse={() => browseSection("Radio")} active={section === "Home" && !nowPlayingOpen && !homeQuery.trim() && (!nativeHost || tv.browsing)} currentStationId={current?.source.startsWith("radio:") ? current.source.slice(6) : undefined} />
                    <BrowseHome state={state} credentials={credentials} connected={connected} canPlay={available} playing={active} active={section === "Home" && !nowPlayingOpen && !homeQuery.trim() && (!nativeHost || tv.browsing)} onBrowse={browseSection} onProvider={provider => { setSelectedProvider(provider); setProviderRequest(value => value + 1); setOnlineRequest(null); browseSection("Online"); }} onAddSource={() => openSources()} onPlay={playHistory} onAdd={item => item.libraryItemId ? enqueueCatalog("enqueueLibrary", item.libraryItemId) : Promise.resolve(false)} />
                  </div>
                </section>
                <section data-page="Queue" hidden={section !== "Queue"}>
                  <QueuePanel defaultQuality={videoQualityPreference.quality} state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} run={run} />
                </section>
                {(visited.has("Saved") || section === "Saved") && <section data-page="Saved" hidden={section !== "Saved"}><SavedSection state={state} credentials={credentials} connected={connected} canPlay={available} active={section === "Saved" && !nowPlayingOpen} onBrowse={browseSection} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} /></section>}
                <section data-page="Settings" hidden={section !== "Settings"}><Settings onRemoteControlChange={setRemoteControlEnabled} inline section={settingsSection} onSectionChange={changeSettingsSection} active={section === "Settings"} onOpenRequest={() => changeSection("Settings")} libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={connectionPlayerStatus} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} appearance={state?.appearance} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} /></section>
                {(visited.has("Guide") || section === "Guide") && <section data-page="Guide" hidden={section !== "Guide"}><GuidePanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} host={nativeHost} version={state?.iptvVersion ?? 0} recordingsVersion={state?.recordingsVersion ?? 0} controllerVersion={state?.controllerVersion ?? 0} currentSource={state?.queue.find(entry => entry.id === state.currentEntryId)?.source} onGoLive={() => { if (state?.player.playbackId) void run({ type: "goLive", playbackId: state.player.playbackId }); }} active={section === "Guide" && !nowPlayingOpen} /></section>}
                {(visited.has("Online") || section === "Online") && <section data-page="Online" hidden={section !== "Online"}><ProviderPanel active={section === "Online" && !nowPlayingOpen && (!nativeHost || tv.browsing)} historyVersion={state?.libraryVersion ?? 0} onPlayHistory={playHistory} key={`${credentials.origin}:${credentials.token}:${providerRequest}:${onlineRequest?.revision ?? 0}`} initialProvider={selectedProvider} initialItem={onlineRequest?.item} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.providerVersion ?? 0} defaultQuality={videoQualityPreference.quality} onEnqueue={enqueueProvider} onEnqueuePlaylist={(url, playNow, quality) => run({ type: "enqueueProviderPlaylist", provider: "youtube", url, playNow, quality })} onEnqueueAlbum={(provider, url, playNow) => run({ type: "enqueueProviderAlbum", provider, url, playNow })} /></section>}
                {(visited.has("Library") || section === "Library") && <section data-page="Library" hidden={section !== "Library"}><MediaLibrary active={section === "Library" && !nowPlayingOpen && (!nativeHost || tv.browsing)} historyVersion={state?.libraryVersion ?? 0} onPlayHistory={playHistory} onBrowse={browseSection} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.providerVersion ?? 0} defaultQuality={videoQualityPreference.quality} onEnqueue={enqueueProvider} onEnqueuePlaylist={(url, playNow, quality) => run({ type: "enqueueProviderPlaylist", provider: "youtube", url, playNow, quality })} onEnqueueAlbum={(provider, url, playNow) => run({ type: "enqueueProviderAlbum", provider, url, playNow })} /></section>}
                {(visited.has("Files") || section === "Files") && <section data-page="Files" hidden={section !== "Files"}><LibraryPanel canManage={nativeHost || identity?.authority === "administrator"} onManage={() => openSources("folders")} origin={credentials.origin} token={credentials.token} canPlay={available} host={nativeHost} connected={connected} version={state?.libraryVersion ?? 0} onQueueAlbum={(albumId, playNow) => run({ type: "enqueueAlbum", albumId, playNow })} onEnqueue={(itemId, options) => enqueueCatalog("enqueueLibrary", itemId, options)} /></section>}
                {(visited.has("Radio") || section === "Radio") && <section data-page="Radio" hidden={section !== "Radio"}><RadioPanel active={section === "Radio" && !nowPlayingOpen && (!nativeHost || tv.browsing)} currentStationId={current?.source.startsWith("radio:") ? current.source.slice(6) : undefined} host={nativeHost} onManage={() => openSources("radio")} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.radioVersion ?? 0} onEnqueue={enqueueRadio} /></section>}
                {(visited.has("Jellyfin") || section === "Jellyfin") && <section data-page="Jellyfin" hidden={section !== "Jellyfin"}><JellyfinPanel onManage={() => openSources("jellyfin")} origin={credentials.origin} token={credentials.token} canPlay={available} host={nativeHost} connected={connected} version={state?.jellyfinVersion ?? 0} onEnqueue={(itemId, options) => enqueueCatalog("enqueueJellyfin", itemId, options)} /></section>}
                </div>
              </div>
            </div>
            <SourceSetupDialog iptvVersion={state?.iptvVersion ?? 0} controllerVersion={state?.controllerVersion ?? 0} localOnly={nativeHost} source={setupSource} open={sourcesOpen} onOpenChange={setSourcesOpen} credentials={credentials} connected={connected} canManage={nativeHost || identity?.authority === "administrator"} version={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} libraryVersion={state?.libraryVersion ?? 0} />
            {current && (active || player?.status === "error") && !nowPlayingOpen && <SessionBar state={state} credentials={credentials} connected={connected} run={run} onOpen={showNowPlaying} onRemote={nativeHost ? undefined : () => setRemoteOpen(true)} />}
            <Dialog open={remoteOpen} onOpenChange={setRemoteOpen}><DialogContent><DialogHeader><DialogTitle>TV remote</DialogTitle><DialogDescription>Control the TV screen with directional buttons.</DialogDescription></DialogHeader><RemotePad connected={connected} onNavigate={key => run({type:"navigate", key})} /></DialogContent></Dialog>
          </>
        )}
        </div>
        {nativeHost && credentials && <section className="tv-playback-controls" hidden={tv.browsing || !tv.controlsVisible} data-tv-navigation-scope={!tv.browsing && tv.controlsVisible ? "" : undefined} aria-label="Player">
          <div className="tv-watch-actions"><Button variant="secondary" aria-label="Show TV home" onClick={tv.openHome}><House aria-hidden="true" />Home</Button><Button variant="secondary" aria-label="Hide playback controls" onClick={() => tv.dismissLayer()}>Back to watching</Button></div>
          <PlaybackControls state={state} credentials={credentials} connected={connected} run={run} />
        </section>}
        {nativeHost && credentials && <LocalSharingPrompt onRemoteControlChange={setRemoteControlEnabled} credentials={credentials} />}
        {host && remoteControlEnabled && <PairingDialog host={host} connected={connected} open={pairingOpen} onOpenChange={setPairingOpen} />}

      </main>

    </div>
  );
}
