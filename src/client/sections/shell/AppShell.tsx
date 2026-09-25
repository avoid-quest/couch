import { Link, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { Component, useEffect, useRef, useState, type ErrorInfo, type PropsWithChildren } from "react";
import { providerShape, type ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import type { HistoryPlayback } from "@/components/HistoryPanel";
import type { Action } from "../../../shared/protocol";
import { DigitalClock } from "@/components/DigitalClock";
import { Icon } from "@/components/Icon";
import { ProviderPanel } from "@/components/ProviderPanel";
import { RemotePad } from "@/components/RemotePad";
import { PairingDialog } from "@/components/PairingDialog";
import { InstallationUpdates, LocalSharingPrompt, PlaybackDevice, usePlaybackDevice } from "@/sections/shell/PlaybackDevice";
import { PlaybackStatus } from "@/sections/shell/PlaybackStatus";
import { SourceSetupDialog } from "@/components/SourceSetupDialog";
import { errorText, useSessionGate } from "@/session/session-context";
import { MiniPlayer } from "./MiniPlayer";
import { TvAppearancePreview } from "./TvAppearancePreview";
import { readSearchState, searchLocation, type SearchRouteState } from "@/search";
import { createId } from "@/session/session";
import { pathForSection, sectionForPath } from "../../../shared/page-paths";
import { settingsPageForPath, settingsPagePath, settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { buildInfo } from "../../../shared/build";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { cn } from "cn";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ShellContext } from "./shell-context";
import { readRadioRecents, writeRadioRecents } from "./radio-recents";

const navItems = [{ name: "Now", label: "Up next" }, { name: "Find", label: "Find" }, { name: "Saved", label: "Saved" }, { name: "Settings", label: "Settings" }];

export type ShellValue = ReturnType<typeof useShellValue>;
export { useShell, useOptionalShell } from "./shell-context";
import { useShell } from "./shell-context";

function useShellValue() {
  const gate = useSessionGate();
  const { credentials, state, status, details, identity, connected, run, booting, setError, registerBackHandler, videoQualityPreference, remoteControlEnabled } = gate;
  const router = useRouter();
  const location = useLocation();
  const section = sectionForPath(location.pathname) ?? "Now";
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const playerTransition = !reducedMotion;
  const settingsSection = settingsPageForPath(location.pathname) ?? (section === "Settings" ? "playback" : null);
  const rememberedSearch = useRef<SearchRouteState>({ query: "", source: "All" });
  if (section === "Find") rememberedSearch.current = readSearchState(location.searchStr);
  const lastBrowsePath = useRef("/find");
  if (section !== "Now") lastBrowsePath.current = location.pathname + location.searchStr;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [setupSource, setSetupSource] = useState<"folders" | "jellyfin" | "radio" | "iptv" | "streaming-community">("jellyfin");
  const openSources = (source: typeof setupSource = "jellyfin") => { setSetupSource(source); setSourcesOpen(true); };
  const installationId = credentials?.installationId ?? details?.installationId;
  const [recentRadio, setRecentRadio] = useState<{ installationId: string | null; stations: RadioStation[] }>({ installationId: null, stations: [] });
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  useEffect(() => { if (!remoteControlEnabled) setPairingOpen(false); }, [remoteControlEnabled]);
  const [onlineRequest, setOnlineRequest] = useState<{ item: ProviderItem; revision: number } | null>(null);
  const playCredentials = useRef(credentials);
  const playAttempt = useRef(0);
  playCredentials.current = credentials;
  useEffect(() => { setOnlineRequest(null); setSourcesOpen(false); }, [credentials?.origin, credentials?.token]);
  useEffect(() => { setRecentRadio({ installationId: installationId ?? null, stations: installationId ? readRadioRecents(installationId) : [] }); }, [installationId]);

  useEffect(() => {
    document.title = settingsSection ? `${settingsPages[settingsSection].label} · Settings · Couch` : section === "Now" ? "Couch" : `${section} · Couch`;
  }, [section, settingsSection]);

  const at = location.pathname + location.searchStr;
  const changePage = (name: string) => {
    // Big-picture behavior: while playing, any navigation opens the browsing
    // layer over the player instead of floating the controls above the page.
    const to = name === "Find" ? searchLocation(rememberedSearch.current) : pathForSection(name);
    if (to !== at) {
      if (playerTransition && (section === "Now" || name === "Now")) void router.navigate({ href: to, viewTransition: true });
      else router.history.push(to);
    }
  };
  const changeSection = (name: string) => {
    if (name === "Remote") { setRemoteOpen(true); return; }
    changePage(name);
  };
  const leavePlayer = () => {
    if (playerTransition) void router.navigate({ href: lastBrowsePath.current, viewTransition: true });
    else router.history.push(lastBrowsePath.current);
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
      if (section === "Now") leavePlayer();
      else if (section === "Find" && readSearchState(location.searchStr).query) changeSearch({ query: "", source: "All" });
      else if (section === "Find" && state?.currentEntryId) changeSection("Now");
      else changeSection("Find");
    });
  });

  const enqueueProvider = (item: ProviderItem, playNow: boolean, quality = videoQualityPreference.quality) =>
    run({ type: "enqueueProvider", provider: item.provider, url: item.url, shape: providerShape(item), title: item.title, thumbnail: item.thumbnail, ...(item.provider === "bandcamp" ? {} : { quality }), playNow });
  const enqueueRadio = (station: RadioStation, playNow: boolean) => {
    const owner = installationId;
    const result = run(station.sourceId
      ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow }
      : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow });
    // Recents record what actually played, not what was queued or attempted.
    if (playNow) void result.then(ok => {
      if (!ok || !owner) return;
      setRecentRadio(current => {
        const next = [station, ...(current.installationId === owner ? current.stations : readRadioRecents(owner)).filter(entry => entry.id !== station.id)].slice(0, 8);
        writeRadioRecents(owner, next);
        return { installationId: owner, stations: next };
      });
    });
    return result;
  };
  const openProvider = (item: ProviderItem) => {
    setOnlineRequest(previous => ({ item, revision: (previous?.revision ?? 0) + 1 }));
    browseSection("Online");
  };
  const enqueueCatalog = (type: "enqueueLibrary" | "enqueueJellyfin", itemId: string, options?: { playNow?: boolean; fromStart?: boolean; placement?: "next" }) =>
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
    connecting: "Connecting", syncing: "Getting current state", connected: player?.status === "unavailable" ? "Player unavailable" : "Connected", reconnecting: "Reconnecting", "server-unavailable": "Server unavailable", "pairing-required": credentials ? "Pairing required" : "Not paired", "connection-rejected": "Connection rejected", "build-mismatch": "Refresh this page to load the selected host's current version", "protocol-mismatch": "Update this app or the selected Couch for protocol compatibility",
  }[status];

  return {
    // The shell only renders routes inside the paired branch; pages can rely
    // on credentials being set.
    ...gate, credentials: credentials!, section, settingsSection, statusLabel, available, active, programme, current, playerBackLabel: sectionForPath(lastBrowsePath.current) ?? "Find", recentRadio: recentRadio.installationId === installationId ? recentRadio.stations : [],
    changeSection, leavePlayer, browseSection, gotoSearch, changeSearch, changeSettingsSection,
    openSources, openProvider, setRemoteOpen, setPairingOpen, setSourcesOpen,
    enqueueProvider, enqueueRadio, enqueueCatalog, playHistory,
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
      <div className="app-shell"><main id="main">
        <div className="notice error-notice" role="alert"><span>{this.state.error.message}</span><Button onClick={() => this.setState({ error: null })}>Try again</Button></div>
      </main></div>
    );
  }
}

export function AppShell() {
  const shell = useShellValue();
  return <ShellErrorBoundary><ShellContext.Provider value={shell}><ShellChrome><Outlet /></ShellChrome></ShellContext.Provider></ShellErrorBoundary>;
}

export function ShellChrome({ children }: PropsWithChildren) {
  const shell = useShell();
  const device = usePlaybackDevice();
  const { nativeHost, localHost, tvPresentation, credentials, state, status, details, identity, pairingRequired, connected, run, reconnect, host, booting, error, setError, videoQualityPreference, remoteControlEnabled, setRemoteControlEnabled } = shell;
  const { undoNotice, undoAction, dismissUndo } = shell;
  const { section, statusLabel, available, active, current } = shell;
  const { pairing, pairingCode, setPairingCode, remoteName, setRemoteName, pair } = shell;
  const { setupSource, sourcesOpen, setSourcesOpen } = shell;
  useEffect(() => {
    if (!tvPresentation) return;
    const onHome = () => shell.changeSection("Find");
    const onInfo = () => shell.changeSection("Now");
    window.addEventListener("couch-home", onHome);
    window.addEventListener("couch-info", onInfo);
    return () => { window.removeEventListener("couch-home", onHome); window.removeEventListener("couch-info", onInfo); };
  }, [tvPresentation, section]);
  const player = state?.player;
  const activityToast = useRef<string | null>(null);
  useEffect(() => {
    if (!state?.activity) return;
    if (activityToast.current) toast.dismiss(activityToast.current);
    activityToast.current = null;
    if (state.activity.actor.deviceId !== identity?.controller?.id) {
      activityToast.current = `activity-${state.activity.id}`;
      toast(state.activity.text, { id: activityToast.current, duration: 6_000 });
    }
  }, [state?.activity?.id, identity?.controller?.id]);
  useEffect(() => {
    if (!undoNotice) return;
    const id = `undo-${undoNotice.id}`;
    toast(undoNotice.text, { id, duration: 6_000, action: { label: "Undo", onClick: () => void undoAction() }, onDismiss: dismissUndo });
    return () => { toast.dismiss(id); };
  }, [undoNotice?.id]);
  const pairingRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={cn("app-shell", tvPresentation && "tv-shell [&_svg]:stroke-[1.5] [&_.icon-button]:min-h-11 [&_.icon-button]:min-w-11 [&_.icon-button_svg]:size-6")}>

      <main id="main">
        {tvPresentation && state?.appearance && <TvAppearancePreview appearance={state.appearance} credentials={credentials} connected={connected} />}
        {error && <div className="notice error-notice" role="alert"><span>{error}</span><Button variant="ghost" size="icon" className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" /></Button></div>}
        <div className="tv-browser" data-tv-navigation-scope={tvPresentation ? "" : undefined}>
      <header className="app-header">
        <nav className="section-nav" aria-label="Main navigation">{navItems.map(({ name, label }) => <Button key={name} asChild variant="ghost"><Link to={name === "Find" ? shell.sectionUrl(name) : pathForSection(name)} aria-current={section === name ? "page" : undefined}>{label}</Link></Button>)}</nav>
        <div className="header-status">
          {(!nativeHost || tvPresentation) && <PlaybackStatus credentials={credentials} connected={connected} status={statusLabel} installationName={state?.installationName ?? details?.name} localHost={localHost} state={state} run={run} />}
          {nativeHost && !tvPresentation && <PlaybackDevice credentials={credentials} connected={connected} installationName={state?.installationName ?? details?.name} state={state} run={run} />}
          {nativeHost && !localHost && !tvPresentation && <InstallationUpdates />}
          {host && remoteControlEnabled && <Button ref={pairingRef} variant="ghost" className="pair-shortcut" aria-label="Pair a remote" onClick={() => shell.setPairingOpen(true)}>Pair a remote</Button>}
          <span role="status" className={connected ? "sr-only" : undefined}>{statusLabel}</span>
          {credentials && !pairingRequired && !tvPresentation && details?.tvPresentation && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="hidden max-[700px]:inline-flex" aria-label="Remote" onClick={() => shell.setRemoteOpen(true)}><Icon name="remote" /></Button></TooltipTrigger><TooltipContent>Remote</TooltipContent></Tooltip>}
          <DigitalClock />
        </div>
      </header>

        {!credentials || pairingRequired ? (
          <Card className="pair-card">
            <div className="pair-icon"><Icon name="screen" /></div>
            {localHost && <p className="eyebrow">Your media center</p>}
            <h1>{localHost ? "Starting your player" : `Pair with ${new URL(credentials?.origin ?? device?.address ?? location.origin).host}`}</h1>
            {!localHost && credentials && <p role="alert">{credentials.installationId && details?.installationId && credentials.installationId !== details.installationId ? "A different Couch installation is using this address. Check the playback computer and pair again." : "Couch rejected this remote's pairing. Pair again to restore access."}</p>}
            <p className="muted">{localHost ? "The local player and your remotes connect here." : "Open Pair a remote on that Couch and type the code it shows."}</p>
            {localHost ? <Button disabled={booting} className="primary-button" onClick={shell.retryHost}>{booting ? "Starting…" : "Try again"}</Button> : status === "protocol-mismatch" ? <p role="alert">This playback computer uses an incompatible desktop protocol. Update this app or the playback computer, or choose another address.</p> : (
              <form onSubmit={pair} className="pair-form">
                <Label htmlFor="remote-name">Device name</Label>
                <Input id="remote-name" autoFocus={!!pairingCode} autoComplete="off" maxLength={60} value={remoteName} onChange={event => setRemoteName(event.target.value)} required />
               <Label htmlFor="pairing-code">Pairing code</Label>
                <InputOTP id="pairing-code" aria-label="Pairing code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoFocus={!pairingCode} value={pairingCode} onChange={setPairingCode} containerClassName="w-full [&_[data-slot=input-otp-group]]:flex-1 [&_[data-slot=input-otp-group]]:justify-center [&_[data-slot=input-otp-group]]:gap-1.5 [&_[data-slot=input-otp-slot]]:h-14 [&_[data-slot=input-otp-slot]]:w-14 [&_[data-slot=input-otp-slot]]:rounded-lg [&_[data-slot=input-otp-slot]]:text-2xl">
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
            {!connected && <div className="notice" role="status">{status === "server-unavailable" || status === "reconnecting" ? `Reconnecting to ${state?.installationName ?? details?.name ?? new URL(credentials.origin).host}. Browsing and the queue come back when it answers.` : status === "protocol-mismatch" ? "This app and the selected Couch use incompatible desktop protocols. Update either installation or choose another address." : "Connecting to the player."}{nativeHost && !localHost && !device?.error && (status === "server-unavailable" || status === "protocol-mismatch") && <span className="ml-3 inline-flex gap-2"><Button variant="outline" size="sm" onClick={reconnect}>Retry</Button>{!buildInfo.clientOnly && <Button variant="outline" size="sm" onClick={() => void device?.choose("local")}>Use this computer</Button>}</span>}</div>}
            {player?.status === "unavailable" && <p className="notice" role="alert">{player.error || `Playback is unavailable on ${state?.installationName || "this computer"}. Browsing and the queue still work.`}</p>}
            <div className="workspace">
              <div className="media-browser">
                {children}
              </div>
            </div>
            <SourceSetupDialog localOnly={localHost} source={setupSource} open={sourcesOpen} onOpenChange={setSourcesOpen} credentials={credentials} connected={connected} canManage={localHost || identity?.authority === "administrator"} />
            {current && (active || player?.status === "error") && section !== "Now" && state && <MiniPlayer state={state} connected={connected} run={run} localHost={localHost} onOpen={() => shell.changeSection("Now")} />}
            {/* Saved provider collections open here: Find stays search-first, and
                Open gives the collection its own browsable trail. */}
            <Dialog open={shell.onlineRequest !== null} onOpenChange={open => { if (!open) shell.closeOnlineRequest(); }}>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader><DialogTitle>{shell.onlineRequest?.item.title ?? "Saved source"}</DialogTitle><DialogDescription>Browse this saved source.</DialogDescription></DialogHeader>
                {shell.onlineRequest && <ProviderPanel key={shell.onlineRequest.revision} showHeading={false} active initialItem={shell.onlineRequest.item} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.providerVersion ?? 0} defaultQuality={videoQualityPreference.quality} onPlayHistory={shell.playHistory} onEnqueue={shell.enqueueProvider} />}
              </DialogContent>
            </Dialog>
            <Dialog open={shell.remoteOpen} onOpenChange={shell.setRemoteOpen}><DialogContent><DialogHeader><DialogTitle>TV remote</DialogTitle><DialogDescription>Control the TV screen with directional buttons.</DialogDescription></DialogHeader><RemotePad connected={connected} onNavigate={key => run({type:"navigate", key})} run={run} state={state} credentials={credentials} /></DialogContent></Dialog>
          </>
        )}
        </div>
        <Toaster position="bottom-left" closeButton offset={{ left: "var(--shell-gutter)", bottom: current ? section === "Now" ? "16rem" : "calc(var(--shell-footer) + 1rem)" : "1rem" }} />
        {localHost && credentials && <LocalSharingPrompt onRemoteControlChange={setRemoteControlEnabled} credentials={credentials} />}
        {host && remoteControlEnabled && <PairingDialog credentials={host} urls={host.urls} connected={connected} open={shell.pairingOpen} onOpenChange={shell.setPairingOpen} openerRef={pairingRef} />}

      </main>

    </div>
  );
}
