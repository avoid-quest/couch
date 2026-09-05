import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Action, ConnectionInfo, NavigationKey } from "../shared/protocol";
import { createId, useSession, type Credentials } from "./session";
import { knownConnection } from "./connection";
import { JellyfinPanel } from "./JellyfinPanel";
import { LibraryPanel } from "./LibraryPanel";
import { PlaybackControls } from "./PlaybackControls";
import { RemotePad } from "./RemotePad";
import { useTvPresentation } from "./useTvPresentation";
import { RadioPanel } from "./RadioPanel";
import { MediaArtwork, ProviderPanel } from "./ProviderPanel";
import { Icon } from "./Icon";
import { VideoStage } from "./VideoStage";
import { QueuePanel } from "./QueuePanel";
import { Settings } from "./Settings";
import { useVideoQualityPreference } from "./video-quality";
import { AuthArtwork } from "./AuthArtwork";
import { applyTvNavigation, useNavigation } from "./navigation";
import { Gamepad2, LayoutGrid, House, SlidersHorizontal, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  const [section, setSection] = useState("Queue");
  const [sourcesRequest, setSourcesRequest] = useState(0);
  const [remoteMode, setRemoteMode] = useState<"browse" | "control">("browse");
  const [pairingOpen, setPairingOpen] = useState(false);
  const [visited, setVisited] = useState(new Set(["Queue"]));
  const changeSection = (name: string) => { setSection(name); setVisited(previous => new Set([...previous, name])); };
  const navigation = useRef<(key: NavigationKey) => void>(() => {});
  const { state, status, details, identity, pairingRequired, reachable, connected, command, reconnect } = useSession(credentials, key => navigation.current(key), nativeHost ? undefined : origin => setCredentials(current => current ? { ...current, origin } : null));
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
    if (!nativeHost && remoteMode === "control") { setRemoteMode("browse"); return; }
    if (section !== "Queue") {
      changeSection("Queue");
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-source="Queue"]')?.focus());
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

  const player = state?.player;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const available = connected && !!player && player.status !== "unavailable";
  const active = !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status);
  const statusLabel = booting ? "Starting player" : {
    connecting: "Connecting", syncing: "Getting current state", connected: player?.status === "unavailable" ? "Player unavailable" : "Connected", reconnecting: "Reconnecting", "server-unavailable": "Server unavailable", "pairing-required": credentials ? "Pairing required" : "Not paired", "connection-rejected": "Connection rejected",
  }[status];

  return (
    <div className={`app-shell ${nativeHost ? `tv-shell${tv.browsing ? " tv-browsing" : ""}${tv.controlsVisible ? " tv-controls-visible" : ""}` : `remote-shell remote-${remoteMode}`}`}>

      <main id="main">
        {error && <div className="notice error-notice" role="alert"><span>{error}</span><Button variant="ghost" size="icon" className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" /></Button></div>}
        {nativeHost && <VideoStage active={active} title={current?.title || "Your media"}
          audioOnly={current?.kind === "radio" || !!player?.tracks?.some(track => track.kind === "audio") && !player.tracks.some(track => track.kind === "video" && track.selected)}
          subtitle={player?.nowPlaying ? [player.nowPlaying.artist, player.nowPlaying.title].filter(Boolean).join(" · ") : undefined}
          artwork={current?.artworkId && credentials ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={current.artworkId} /> : current?.thumbnail ? <MediaArtwork thumbnail={current.thumbnail} title={current.title} /> : undefined} />}
        <div className={nativeHost ? "tv-browser" : "remote-browser"} hidden={nativeHost && !tv.browsing} data-tv-navigation-scope={nativeHost && tv.browsing ? "" : undefined}>
      <header className="app-header">
        <a className="brand" href="#main" aria-label="Couch, go to player" onClick={() => nativeHost ? tv.openHome() : setRemoteMode("browse")}><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>couch<span className="brand-light">.avoid.quest</span></span></a>
        <div className="header-status">
          {nativeHost && credentials && <Button variant="ghost" aria-label="Show TV controls" onClick={() => tv.showControls({ keyboard: true, fromHome: true })}><SlidersHorizontal aria-hidden="true" />Controls</Button>}
          {host && <Button variant="outline" className="pair-shortcut" onClick={() => setPairingOpen(true)}>Pair a remote <strong>{host.pairingCode}</strong></Button>}
          <span className={`connection-dot ${connected ? "online" : ""}`} /><span role="status">{statusLabel}</span>
          {(!nativeHost || state) && <Settings libraryVersion={state?.libraryVersion ?? 0} sourcesRequest={sourcesRequest} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={player?.status ?? details?.player} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} initialOpen={nativeHost && state?.administratorClaimed === false} />}
        </div>
        {!nativeHost && credentials && <nav className="mode-switch" aria-label="Controller views">
          <Button variant="ghost" aria-pressed={remoteMode === "browse"} onClick={() => setRemoteMode("browse")}><LayoutGrid aria-hidden="true" />Browse</Button>
          <Button variant="ghost" aria-pressed={remoteMode === "control"} onClick={() => setRemoteMode("control")}><Gamepad2 aria-hidden="true" />Remote</Button>
        </nav>}
      </header>

        {nativeHost && current && active && <div className="tv-home-intro">
          <Button variant="outline" className="tv-home-now" aria-label="Show playback" onClick={tv.closeBrowser}><span>{current.title}</span><span className="text-muted-foreground">Return to playback</span><ArrowUpRight aria-hidden="true" /></Button>
        </div>}



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
              {!nativeHost && <aside className="remote-controller" aria-label="Playback controls">
                <PlaybackControls state={state} credentials={credentials} connected={connected} run={run} onExpand={() => setRemoteMode("control")} />
                <RemotePad connected={connected} onNavigate={key => run({ type: "navigate", key })} />
              </aside>}

              <Tabs value={section} onValueChange={changeSection} className="media-browser">
                <TabsList className="source-nav" aria-label="Media sources">
                  {["Queue", "Online", "Library", "Radio", "Jellyfin"].map(name => <TabsTrigger key={name} value={name} data-source={name}>{name}{name === "Queue" && !!state?.queue.length && <Badge variant="secondary" className="source-count">{state.queue.length}</Badge>}</TabsTrigger>)}
                </TabsList>
                <TabsContent value="Queue" forceMount hidden={section !== "Queue"}>
                  <QueuePanel defaultQuality={videoQualityPreference.quality} state={state} credentials={credentials} connected={connected} available={available} nativeHost={nativeHost} run={run} />
                </TabsContent>
                {visited.has("Online") && <TabsContent value="Online" forceMount hidden={section !== "Online"}><ProviderPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.providerVersion ?? 0} defaultQuality={videoQualityPreference.quality} onEnqueue={(item, playNow, quality) =>
                  run({ type: "enqueueWeb", entryId: createId(), url: item.url, title: item.title, thumbnail: item.thumbnail, ...(quality ? { quality } : {}), playNow })
                } onEnqueueAlbum={(provider, url, playNow) => run({ type: "enqueueProviderAlbum", provider, url, playNow })} /></TabsContent>}
                {visited.has("Library") && <TabsContent value="Library" forceMount hidden={section !== "Library"}><LibraryPanel onManage={() => setSourcesRequest(value => value + 1)} origin={credentials.origin} token={credentials.token} canPlay={available} host={nativeHost} connected={connected} version={state?.libraryVersion ?? 0} onQueueAlbum={(albumId, playNow) => run({ type: "enqueueAlbum", albumId, playNow })} onEnqueue={(itemId, options) => enqueueCatalog("enqueueLibrary", itemId, options)} onPlayHistory={(item, options) => {
                  if (item.libraryItemId) return enqueueCatalog("enqueueLibrary", item.libraryItemId, { playNow: true, ...options });
                  if (item.queueEntryId) return run({ type: "play", entryId: item.queueEntryId, ...options });
                  setError("Open this local file on the TV again to resume it.");
                  return Promise.resolve(false);
                }} /></TabsContent>}
                {visited.has("Radio") && <TabsContent value="Radio" forceMount hidden={section !== "Radio"}><RadioPanel host={nativeHost} onManage={() => setSourcesRequest(value => value + 1)} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.radioVersion ?? 0} onEnqueue={(station, playNow) => run(station.sourceId ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow } : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow })} /></TabsContent>}
                {visited.has("Jellyfin") && <TabsContent value="Jellyfin" forceMount hidden={section !== "Jellyfin"}><JellyfinPanel onManage={() => setSourcesRequest(value => value + 1)} origin={credentials.origin} token={credentials.token} canPlay={available} host={nativeHost} connected={connected} version={state?.jellyfinVersion ?? 0} onEnqueue={(itemId, options) => enqueueCatalog("enqueueJellyfin", itemId, options)} /></TabsContent>}
              </Tabs>
            </div>

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
