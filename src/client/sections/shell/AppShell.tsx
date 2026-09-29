import { Link, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type PropsWithChildren } from "react";
import { useMutation } from "@tanstack/react-query";
import { Keyboard, ListMusic, Tv, X } from "lucide-react";
import { providerShape, type ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import type { HistoryPlayback } from "@/sections/home/HomePage";
import { DigitalClock } from "@/components/DigitalClock";
import { RemotePad } from "@/components/RemotePad";
import { PairingDialog } from "@/components/PairingDialog";
import { LocalSharingPrompt, PlaybackDevice, useLocalSetupPending, usePlaybackDevice } from "@/sections/shell/PlaybackDevice";
import { PlaybackStatus } from "@/sections/shell/PlaybackStatus";
import { SourceSetupDialog } from "@/components/SourceSetupDialog";
import { errorText, useSessionGate } from "@/session/session-context";
import { MiniPlayer } from "./MiniPlayer";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { TvAppearancePreview } from "./TvAppearancePreview";
import { readSearchState, searchLocation, type SearchRouteState } from "@/search";
import { createId } from "@/session/session";
import { pathForSection, sectionForPath } from "../../../shared/page-paths";
import { settingsPageForPath, settingsPagePath, settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiSend } from "@/api/client";
import { useIdleCursor } from "@/useIdleCursor";
import { useNavigation } from "@/navigation";
import { collectionLocation, DetailFocusRestoration, useDetailNavigation } from "@/detail-navigation";
import { cn } from "cn";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { deviceName, offline, TRY_AGAIN } from "@/copy";
import { ShellContext } from "./shell-context";
import { readRadioRecents, writeRadioRecents } from "./radio-recents";
import { PairForm } from "./PairForm";
import { Onboarding } from "./Onboarding";
import { StatusLine } from "./StatusLine";
import { useNativeWindowTitle } from "@/native-window-title";
import { useMediaSession } from "@/session/media-session";
import { hear, onBlocked } from "@/session/renderer";
import { showsPicture } from "@/session/device-id";

const navItems = ["Home", "Find", "Saved", "Settings"];
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const reducedMotion = () => window.matchMedia(reducedMotionQuery).matches;
function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export type ShellValue = ReturnType<typeof useShellValue>;
export { useShell, useOptionalShell } from "./shell-context";
import { useShell } from "./shell-context";

function useShellValue() {
  const { credentials, state, status, details, connected, run, booting, setError, videoQualityPreference, remoteControlEnabled } = useSessionGate();
  const router = useRouter();
  const detailNavigation = useDetailNavigation();
  const location = useLocation();
  const section = sectionForPath(location.pathname) ?? "Home";
  const playerTransition = !useSyncExternalStore(subscribeReducedMotion, reducedMotion);
  const settingsSection = settingsPageForPath(location.pathname) ?? (section === "Settings" ? "playback" : null);
  const rememberedSearch = useRef<SearchRouteState>({ query: "", source: "All" });
  if (location.pathname === "/find") rememberedSearch.current = readSearchState(location.searchStr);
  const lastBrowsePath = useRef("/");
  if (section !== "Now") lastBrowsePath.current = location.pathname + location.searchStr;
  useEffect(() => {
    if (section === "Now" && state && !state.currentEntryId && location.search.queue !== true) router.history.replace(lastBrowsePath.current);
  }, [section, state?.currentEntryId, state?.queue.length, !!state, location.search.queue, router]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [setupSource, setSetupSource] = useState<"radio" | "iptv" | "streaming-community">("iptv");
  const openSources = (source: typeof setupSource = "iptv") => { setSetupSource(source); setSourcesOpen(true); };
  const installationId = credentials?.installationId ?? details?.installationId;
  const [recentRadio, setRecentRadio] = useState<{ installationId: string | null; stations: RadioStation[] }>({ installationId: null, stations: [] });
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [pairingRequested, setPairingOpen] = useState(false);
  const pairingOpen = pairingRequested && remoteControlEnabled;
  useEffect(() => { setSourcesOpen(false); }, [credentials?.origin, credentials?.token]);
  useEffect(() => { setRecentRadio({ installationId: installationId ?? null, stations: installationId ? readRadioRecents(installationId) : [] }); }, [installationId]);

  useEffect(() => {
    document.title = settingsSection ? `${settingsPages[settingsSection].label} · Settings · Couch` : section === "Now" || section === "Home" ? "Couch" : `${section} · Couch`;
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
  const openPlayer = (panel?: "queue") => {
    void router.navigate({ href: panel === "queue" ? "/now?queue=true" : "/now", viewTransition: playerTransition });
  };
  // A screen that starts showing a Playback's picture, as after Send to, opens the player (#644 ticket 9).
  const picture = showsPicture(state) ? state?.playback : null;
  const shownPicture = useRef(picture);
  useEffect(() => {
    if (picture && picture !== shownPicture.current && section !== "Now") openPlayer();
    shownPicture.current = picture;
  }, [picture]);
  const focusSearch = () => {
    void router.navigate({ href: searchLocation(rememberedSearch.current) }).then(() => document.getElementById("media-search")?.focus());
  };
  const leavePlayer = () => {
    if (playerTransition) void router.navigate({ href: lastBrowsePath.current, viewTransition: true });
    else router.history.push(lastBrowsePath.current);
  };
  const browseSection = (name: string) => {
    const destination = name === "Home" || name === "Queue" ? "Home" : name === "For later" ? "Saved" : "Find";
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
  useNavigation(() => {
    if (remoteOpen) { setRemoteOpen(false); return; }
    if (location.pathname === "/collection" || location.pathname === "/item") { detailNavigation.back("/find"); return; }
    if (section === "Now") leavePlayer();
    else if (section === "Find" && readSearchState(location.searchStr).query) changeSearch({ query: "", source: "All" });
    else if (section !== "Home") changeSection("Home");
    else if (state?.currentEntryId) changeSection("Now");
  });

  const enqueueProvider = (item: ProviderItem, playNow: boolean, quality = videoQualityPreference.quality) =>
    run({ type: "enqueueProvider", provider: item.provider, url: item.url, shape: providerShape(item), title: item.title, thumbnail: item.thumbnail, ...(item.collection ? { collection: item.collection } : {}), ...(item.provider === "bandcamp" ? {} : { quality }), playNow });
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
  const openProvider = (item: ProviderItem, focusSelector?: string) => detailNavigation.open(collectionLocation(item), focusSelector);

  const playProgress = useMutation({
    mutationFn: ({ mediaId, ...body }: { mediaId: string; fromStart: boolean; profileId: string }) => apiSend(credentials!, `/api/progress/${encodeURIComponent(mediaId)}/play`, body, "POST", 35_000),
  });
  const playHistory: HistoryPlayback = async (item, options) => {
    if (item.playable && credentials && state) {
      setError(null);
      try { await playProgress.mutateAsync({ mediaId: item.mediaId, fromStart: options.fromStart === true, profileId: state.activeProfile.id }); return true; }
      catch (reason) { setError(errorText(reason)); return false; }
    }
    if (item.queueEntryId) return run({ type: "play", entryId: item.queueEntryId, ...options });
    setError("Couldn't play. It's no longer available.");
    return Promise.resolve(false);
  };

  const player = state?.player;
  const programme = connected ? state?.radioProgramme : null;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const available = connected && !!player && player.status !== "unavailable";
  const active = !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status);
  // Terse, stable labels for the header's screen-reader status and the Play on popover.
  const statusLabel = booting ? "Starting" : {
    connecting: "Connecting", syncing: "Syncing", connected: player?.status === "unavailable" ? "Player unavailable" : "Connected", reconnecting: "Reconnecting", "server-unavailable": "Server unavailable", "pairing-required": credentials ? "Pairing required" : "Not paired", "connection-rejected": "Access refused", "build-mismatch": "Couch updated",
  }[status];

  return {
    // The shell only renders routes inside the paired branch; pages can rely
    // on credentials being set.
    credentials: credentials!, section, settingsSection, statusLabel, available, active, programme, current, playerBackLabel: sectionForPath(lastBrowsePath.current.split("?")[0]!) ?? "Home", recentRadio: recentRadio.installationId === installationId ? recentRadio.stations : [],
    changeSection, openPlayer, leavePlayer, focusSearch, browseSection, gotoSearch, changeSearch, changeSettingsSection,
    openSources, openProvider, setRemoteOpen, setPairingOpen, setSourcesOpen,
    enqueueProvider, enqueueRadio, playHistory,
    remoteOpen, pairingOpen, setupSource, sourcesOpen,
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
      <main id="main" className="px-(--gutter) py-6">
        <Alert variant="destructive"><AlertDescription>{this.state.error.message}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => this.setState({ error: null })}>{TRY_AGAIN}</Button></AlertAction></Alert>
      </main>
    );
  }
}

export function AppShell() {
  const shell = useShellValue();
  return <ShellErrorBoundary><DetailFocusRestoration /><MediaSessionBridge /><ShellContext.Provider value={shell}><ShellChrome><Outlet /></ShellChrome></ShellContext.Provider></ShellErrorBoundary>;
}

function MediaSessionBridge() { useMediaSession(); useTapToHear(); return null; }

// A browser that needs a gesture before it plays sound asks for one on its own screen (#644).
function useTapToHear() {
  useEffect(() => onBlocked(blocked => {
    if (blocked) toast("Sound is waiting for a tap", { id: "tap-to-hear", duration: Infinity, action: { label: "Tap to hear", onClick: hear } });
    else toast.dismiss("tap-to-hear");
  }), []);
}

// Connection and player state as one quiet line; red only for errors that need a decision.
function ConnectionStatus() {
  const { nativeHost, localHost, state, status, details, credentials, connected, reconnect } = useSessionGate();
  const device = usePlaybackDevice();
  const remoteApp = nativeHost && !localHost;
  const name = deviceName(state?.installationName ?? details?.name ?? (remoteApp && device?.address ? device.address.replace(/^https?:\/\//i, "") : undefined));
  const recovery = remoteApp && <>
    <Button variant="ghost" size="sm" onClick={reconnect}>{TRY_AGAIN}</Button>
    <Button variant="ghost" size="sm" onClick={() => void device?.choose("local")}>Use this computer</Button>
  </>;
  if (status === "connection-rejected") return <Alert variant="destructive"><AlertDescription>{name} refused this address. Open Couch at the address it shows.</AlertDescription></Alert>;
  if (status === "build-mismatch") return <StatusLine actions={<Button variant="ghost" size="sm" onClick={() => location.reload()}>{TRY_AGAIN}</Button>}>{name} was updated.</StatusLine>;
  if (status === "server-unavailable" || status === "reconnecting") return <StatusLine busy actions={recovery}>{offline(name)}</StatusLine>;
  if (!credentials || status === "pairing-required") return null;
  if (!connected) return null;
  if (state?.player.status === "unavailable" && state.player.error) return <StatusLine>{state.player.error}</StatusLine>;
  return null;
}

function PairingPage() {
  const { localHost, credentials, details, booting, retryHost, status } = useSessionGate();
  const device = usePlaybackDevice();
  if (localHost) return <Onboarding title="Starting Couch">
    {booting ? <StatusLine busy>Starting…</StatusLine> : <><p className="text-sm text-muted-foreground">Couldn't start Couch on this computer. If it keeps failing, restart this computer.</p><Button className="self-start" onClick={retryHost}>{TRY_AGAIN}</Button></>}
  </Onboarding>;
  const origin = credentials?.origin ?? device?.address ?? location.origin;
  const replaced = !!credentials?.installationId && !!details?.installationId && credentials.installationId !== details.installationId;
  const name = deviceName(details?.name);
  return <Onboarding title={`Pair with ${details?.name ?? new URL(origin).host}`} description={`On ${name}, choose Pair a device, then enter the code it shows.`}>
    {credentials && <Alert variant="destructive"><AlertDescription>{replaced ? "A different Couch is at this address. Pair again." : "This device was removed. Pair again."}</AlertDescription></Alert>}
    <PairForm />
  </Onboarding>;
}

export function ShellChrome({ children }: PropsWithChildren) {
  const shell = useShell();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { pathname } = useLocation();
  const { nativeHost, localHost, tvPresentation, credentials, state, details, identity, pairingRequired, connected, run, host, error, setError, remoteControlEnabled } = useSessionGate();
  useNativeWindowTitle(nativeHost, state, connected, details?.name);
  const { section, statusLabel, active, current } = shell;
  const { setupSource, sourcesOpen, setSourcesOpen } = shell;
  const setupPending = useLocalSetupPending(credentials);
  useEffect(() => {
    if (!tvPresentation) return;
    const onHome = () => shell.changeSection("Home");
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
    if (identity && state.activity.actor.deviceId !== (identity.device?.id ?? "host")) {
      activityToast.current = `activity-${state.activity.id}`;
      toast(state.activity.text, { id: activityToast.current, duration: 6_000 });
    }
  }, [state?.activity?.id, identity?.device?.id]);
  const pairingRef = useRef<HTMLButtonElement>(null);
  const paired = !!credentials && !pairingRequired;
  // The player is full-bleed: its band replaces the header and status line.
  const onPlayer = paired && section === "Now";
  useIdleCursor(tvPresentation && !onPlayer);
  const installationName = state?.installationName ?? details?.name;
  const miniPlayer = !!current && (active || player?.status === "error" || player?.status === "ended") && section !== "Now";

  if (setupPending) return <div className="app-shell flex flex-col bg-background"><LocalSharingPrompt credentials={credentials} /></div>;

  return (
    <div className={cn("app-shell flex flex-col bg-background", tvPresentation && "tv-shell")}>
      <main id="main" className="flex flex-1 flex-col">
        {tvPresentation && state?.appearance && <TvAppearancePreview appearance={state.appearance} credentials={credentials} connected={connected} />}
        <div className="tv-browser flex flex-1 flex-col" data-tv-navigation-scope={tvPresentation ? "" : undefined}>
          <header className={cn("app-header sticky top-0 z-30 flex h-14 shrink-0 flex-nowrap items-center gap-2 bg-background px-(--gutter) py-0 max-[359px]:has-[.tv-remote-shortcut]:h-auto max-[359px]:has-[.tv-remote-shortcut]:flex-wrap max-[359px]:has-[.tv-remote-shortcut]:py-1.5", onPlayer && "hidden")}>
            {/* Unpaired, every page is the pairing page, so the sections would lead nowhere (#644 ticket 12). */}
            {paired && <nav data-app-nav aria-label="Main navigation" className="-ml-2.5 flex shrink-0 items-center">
              {navItems.map(name => <Button key={name} asChild variant="ghost" className="rounded-none border-x-0 border-t-0 border-b-2 border-transparent px-2.5 text-base font-normal text-muted-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground max-sm:px-1.5 max-sm:text-sm">
                <Link to={name === "Find" ? shell.sectionUrl(name) : pathForSection(name)} aria-current={section === name ? "page" : undefined}>{name}</Link>
              </Button>)}
            </nav>}
            <div data-app-status className="ml-auto flex min-w-0 items-center justify-end gap-1">
              {/* On a phone the mini player's own Up next is on screen, so the header's goes and leaves room for the status (#644 ticket 12). */}
              {paired && !!state?.queue.length && <Button variant="ghost" className={cn("shrink-0 touch:min-w-11", miniPlayer && "max-sm:hidden")} aria-label="Up next" title="Up next" onClick={() => shell.openPlayer("queue")}><ListMusic aria-hidden="true" /><span className="max-sm:hidden">Up next</span></Button>}
              {!nativeHost && <PlaybackStatus key={pathname} credentials={credentials} connected={connected} status={statusLabel} installationName={installationName} localHost={localHost} state={state} run={run} />}
              {nativeHost && <PlaybackDevice key={pathname} credentials={credentials} connected={connected} installationName={installationName} state={state} run={run} />}
              {host && remoteControlEnabled && <Button ref={pairingRef} variant="ghost" className="pair-shortcut max-sm:hidden" onClick={() => shell.setPairingOpen(true)}>Pair a device</Button>}
              {paired && !tvPresentation && details?.tvPresentation && <Button variant="ghost" size="icon" className="tv-remote-shortcut sm:hidden" aria-label="TV remote" onClick={() => shell.setRemoteOpen(true)}><Tv aria-hidden="true" /></Button>}
              <span role="status" className="sr-only">{statusLabel}</span>
              {paired && !tvPresentation && <Button variant="ghost" size="icon" className="max-sm:hidden" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}><Keyboard aria-hidden="true" /></Button>}
              <DigitalClock className="ml-2 max-sm:hidden" />
            </div>
          </header>
          {!onPlayer && <div className="grid gap-3 px-(--gutter) pb-3 empty:hidden"><ConnectionStatus />{error && <ErrorAlert error={error} onDismiss={() => setError(null)} />}</div>}
          {onPlayer && error && <div className="fixed inset-x-0 top-0 z-40 bg-background px-(--gutter) py-3"><ErrorAlert error={error} onDismiss={() => setError(null)} /></div>}
          {!paired ? <PairingPage /> : <>
            {!tvPresentation && <KeyboardShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />}
            <div className={cn("min-w-0 flex-1", !onPlayer && "px-(--gutter) pb-12")}>{children}</div>
            <SourceSetupDialog localOnly={localHost} source={setupSource} open={sourcesOpen} onOpenChange={setSourcesOpen} credentials={credentials} connected={connected} canManage={localHost || identity?.authority === "administrator"} />
            {miniPlayer && state && <MiniPlayer state={state} connected={connected} run={run} onOpen={shell.openPlayer} />}
            <Dialog open={shell.remoteOpen} onOpenChange={shell.setRemoteOpen}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>TV remote</DialogTitle></DialogHeader><RemotePad connected={connected} onNavigate={key => run({ type: "navigate", key })} run={run} state={state} credentials={credentials} /></DialogContent></Dialog>
          </>}
        </div>
        <Toaster />
        {host && remoteControlEnabled && <PairingDialog credentials={host} urls={host.urls} connected={connected} open={shell.pairingOpen} onOpenChange={shell.setPairingOpen} openerRef={pairingRef} />}
      </main>
    </div>
  );
}

function ErrorAlert({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}><X aria-hidden="true" /></Button></AlertAction></Alert>;
}
