import { Link } from "react-router";
import { usePageRoute } from "./routes";
import { useUpdateActivity } from "./update-activity";
import { loadedBuild } from "../shared/build";
import { listen } from "@tauri-apps/api/event";
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
import { useIdleCursor } from "./useIdleCursor";
import { RadioPanel } from "./RadioPanel";
import { GuidePanel } from "./GuidePanel";
import { MediaArtwork, ProviderPanel } from "./ProviderPanel";
import { Icon } from "./Icon";
import { VideoStage } from "./VideoStage";
import { QueuePanel } from "./QueuePanel";
import { Settings } from "./Settings";
import { PlaybackStatus } from "./PlaybackStatus";
import { LiveNow } from "./LiveNow";
import { HistoryPanel } from "./HistoryPanel";
import { ForLaterSection } from "./ForLaterSection";
import { SavedFavorites } from "./SavedFavorites";
import { useVideoQualityPreference } from "./video-quality";
import { useInterfaceSize } from "./interface-size";
import { TvAppearancePreview } from "./AppearanceSettings";
import { AuthArtwork } from "./AuthArtwork";
import { applyTvNavigation, useNavigation } from "./navigation";
import { House, Bookmark, Settings2, ArrowLeft, ChevronRight, CirclePlay, Compass, Search } from "lucide-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from "@/components/ui/dialog";

const tokenKey = "couch.remote-token";
const installationKey = "couch.remote-installation-id";
const nativeHost = isNativeHost();
const radioHistoryKey = "couch.radio-recents";
const radioHistory = (): RadioStation[] => { try { return JSON.parse(localStorage.getItem(radioHistoryKey) ?? "[]") as RadioStation[]; } catch { return []; } };
const navItems: { name: string; label: string; icon: typeof House }[] = [
  { name: "Now", label: "Now", icon: CirclePlay },
  { name: "Find", label: "Find", icon: Compass },
  { name: "Saved", label: "Saved", icon: Bookmark },
  { name: "Settings", label: "Settings", icon: Settings2 },
];


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
  const homeSection = "Now";
  const { section, visited, sectionUrl, changePage, back, searchState, changeSearch, gotoSearch, settingsSection, changeSettingsSection } = usePageRoute();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [recentRadio, setRecentRadio] = useState<RadioStation[]>(radioHistory);
  const [setupSource, setSetupSource] = useState<"folders" | "jellyfin" | "radio" | "iptv" | "streaming-community">("jellyfin");
  const openSources = (source: typeof setupSource = "jellyfin") => { setSetupSource(source); setSourcesOpen(true); };
  const [remoteControlEnabled, setRemoteControlEnabled] = useState(false);
  const [homeQuery, setHomeQuery] = useState(searchState.query);
  const [nowDraft, setNowDraft] = useState("");
  useEffect(() => setHomeQuery(searchState.query), [searchState.query]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("youtube");
  const [providerRequest, setProviderRequest] = useState(0);
  const [onlineRequest, setOnlineRequest] = useState<{ item: ProviderItem; revision: number } | null>(null);
  useEffect(() => { setOnlineRequest(null); setSourcesOpen(false); }, [credentials?.origin, credentials?.token]);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const shortcutFocus = useRef<string | null>(null);
  const changeSection = (name: string) => {
    if (name === "Remote") { setRemoteOpen(true); return; }
    const destination = name === "For later" ? "Saved" : name;
    shortcutFocus.current = null; changePage(destination);
  };
  const browseSection = (name: string) => {
    const destination = name === "Home" || name === "Search" || name === "Browse" || name === "Queue" ? "Now" : name === "For later" ? "Saved" : "Find";
    changeSection(destination);
  };
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
  useIdleCursor(nativeHost);
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
    if (!nativeHost) return;
    const listener = listen<string[]>("connection-addresses", event => setHost(current => current ? { ...current, urls: event.payload } : current));
    return () => { void listener.then(stop => stop()); };
  }, []);

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
        <Link className="brand" to="/" aria-label="Couch, go home" onClick={() => { if (nativeHost) tv.openHome(); }}>couch<span className="brand-dot" aria-hidden="true" /></Link>
        <div className="header-status">
          {nativeHost ? <PlaybackDevice /> : <PlaybackStatus credentials={credentials} connected={connected} status={statusLabel} installationName={state?.installationName ?? details?.name} />}
          {host && remoteControlEnabled && <Button variant="ghost" className="pair-shortcut" onClick={() => setPairingOpen(true)}>Pair a remote <strong>{host.pairingCode}</strong></Button>}
          <span role="status" className={connected ? "sr-only" : undefined}>{statusLabel}</span>
          {credentials && !pairingRequired && !nativeHost && <Link className="controller-name" to="/settings/connection" aria-label={identity?.controller ? `Device: ${identity.controller.name}` : "Connection"} title={identity?.controller ? `${identity.controller.name} · ${identity.controller.role === "administrator" ? "Administrator" : "Controller"}` : undefined}>{identity?.controller?.name || "Connection"}</Link>}
          {(!credentials || pairingRequired) && <Settings libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={connectionPlayerStatus} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} appearance={state?.appearance} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} />}
          {credentials && !pairingRequired && !nativeHost && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Remote" onClick={() => setRemoteOpen(true)}><Icon name="remote" /></Button></TooltipTrigger><TooltipContent>Remote</TooltipContent></Tooltip>}
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
                {navItems.map(({ name, label, icon: NavIcon }) => <Button key={name} asChild variant="ghost"><Link to={sectionUrl(name)} data-source={name} aria-current={section === name ? "page" : undefined}><NavIcon aria-hidden="true" /><span>{label}</span></Link></Button>)}
              </nav>
              <div className="media-browser">
                <section data-page="Now" hidden={section !== "Now"} className="space-y-6">
                  <form role="search" aria-label="Search or paste a link" className="now-search" onSubmit={event => { event.preventDefault(); const query = nowDraft.trim(); if (!query) return; setNowDraft(""); gotoSearch({ query, source: "All" }); }}>
                    <Search aria-hidden="true" /><Input id="now-search" aria-label="Search or paste a link" placeholder="Search or paste a link" maxLength={4096} value={nowDraft} onChange={event => setNowDraft(event.target.value)} />
                  </form>
                  <NowPlaying embedded state={state} credentials={credentials} connected={connected} run={run} onBrowse={browseSection} onRemote={nativeHost ? undefined : () => setRemoteOpen(true)} active={section === "Now" && (!nativeHost || tv.browsing)} />
                  <HistoryPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.libraryVersion ?? 0} onPlay={playHistory} active={section === "Now" && (!nativeHost || tv.browsing)} />
                  <LiveNow rail limit={8} heading="Live radio" origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.radioVersion ?? 0} onEnqueue={enqueueRadio} active={section === "Now" && (!nativeHost || tv.browsing)} />
                </section>
                {(visited.has("Find") || section === "Find") && <section data-page="Find" hidden={section !== "Find"}>
                  <SearchPanel draftQuery={homeQuery} onManageSources={openSources} searchState={searchState} onSearchChange={changeSearch} onQueryChange={setHomeQuery} onCommand={run} providerVersion={state?.providerVersion ?? 0} radioVersion={state?.radioVersion ?? 0} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={section === "Find" && (!nativeHost || tv.browsing)} libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} onBrowse={browseSection} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
                  <div hidden={!!homeQuery.trim()}>
                    <BrowseHome state={state} credentials={credentials} connected={connected} canPlay={available} playing={active} active={section === "Find" && !homeQuery.trim() && (!nativeHost || tv.browsing)} onBrowse={browseSection} onAddSource={() => openSources()} onPlay={playHistory} onAdd={item => item.libraryItemId ? enqueueCatalog("enqueueLibrary", item.libraryItemId) : Promise.resolve(false)} recentRadio={recentRadio} onRadio={station => enqueueRadio(station, true)} />
                  </div>
                </section>}
                {(visited.has("Saved") || section === "Saved") && <section data-page="Saved" hidden={section !== "Saved"}><SavedSection state={state} credentials={credentials} connected={connected} canPlay={available} active={section === "Saved"} onBrowse={browseSection} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} /></section>}
                <section data-page="Settings" hidden={section !== "Settings"}><Settings onRemoteControlChange={setRemoteControlEnabled} inline section={settingsSection} onSectionChange={changeSettingsSection} active={section === "Settings"} onOpenRequest={() => changeSection("Settings")} libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={connectionPlayerStatus} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} appearance={state?.appearance} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} /></section>
              </div>
            </div>
            <SourceSetupDialog iptvVersion={state?.iptvVersion ?? 0} controllerVersion={state?.controllerVersion ?? 0} localOnly={nativeHost} source={setupSource} open={sourcesOpen} onOpenChange={setSourcesOpen} credentials={credentials} connected={connected} canManage={nativeHost || identity?.authority === "administrator"} version={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} libraryVersion={state?.libraryVersion ?? 0} />
            {current && (active || player?.status === "error") && section !== "Now" && <SessionBar state={state} credentials={credentials} connected={connected} run={run} onOpen={() => changeSection("Now")} onRemote={nativeHost ? undefined : () => setRemoteOpen(true)} />}
            {/* Saved provider collections open here: Find stays search-first, and
                Open gives the collection its own browsable trail. */}
            <Dialog open={onlineRequest !== null} onOpenChange={open => { if (!open) setOnlineRequest(null); }}>
              <DialogContent className="max-w-3xl">
                <DialogHeader><DialogTitle>{onlineRequest?.item.title ?? "Saved source"}</DialogTitle><DialogDescription>Browse this saved source.</DialogDescription></DialogHeader>
                {onlineRequest && <ProviderPanel key={onlineRequest.revision} showHeading={false} active initialItem={onlineRequest.item} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.providerVersion ?? 0} defaultQuality={videoQualityPreference.quality} onPlayHistory={playHistory} onEnqueue={enqueueProvider} onEnqueuePlaylist={(url, playNow, quality) => run({ type: "enqueueProviderPlaylist", provider: "youtube", url, playNow, ...(quality ? { quality } : {}) })} onEnqueueAlbum={(provider, url, playNow) => run({ type: "enqueueProviderAlbum", provider, url, playNow })} />}
              </DialogContent>
            </Dialog>
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
