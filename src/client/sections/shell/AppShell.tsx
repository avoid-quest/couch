import { defaultStringifySearch, Link, Outlet, useLocation, useMatches, useRouter } from "@tanstack/react-router";
import { Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type PropsWithChildren, type ReactNode, type RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookmarkIcon, CompassIcon, HouseIcon, Keyboard, SettingsIcon, TvIcon, X, type LucideIcon } from "lucide-react";
import { providerShape, type ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import type { HistoryPlayback } from "@/sections/home/HomePage";
import { DigitalClock } from "@/components/DigitalClock";
import { CouchMark } from "@/components/CouchMark";
import { playOnQuery } from "@/components/PlayOn";
import { LocalSharingPrompt, useLocalSetupPending, usePlaybackDevice, useRememberCouchName, useShellReady } from "@/sections/shell/PlaybackDevice";
import { CouchSwitch } from "@/sections/shell/CouchSwitch";
import { errorText, useSessionGate } from "@/session/session-context";
import { NowPlayingBar, useBottomBar } from "./NowPlayingBar";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { HeaderSearch } from "./HeaderSearch";
import { TvAppearancePreview } from "./TvAppearancePreview";
import { readSearchState, searchLocation, type SearchRouteState } from "@/search";
import type { SearchScope } from "@/search-palette";
import { createId } from "@/session/session";
import { knownConnections } from "@/session/connection";
import { discoverPaths, pathForSection, sectionForPath } from "../../../shared/page-paths";
import { settingsPageForPath, settingsPagePath, settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { apiSend } from "@/api/client";
import { useIdleCursor } from "@/useIdleCursor";
import { useNavigation } from "@/navigation";
import { collectionLocation, DetailFocusRestoration, useDetailNavigation } from "@/detail-navigation";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { dismiss, waitingForTap } from "@/toasts";
import { deviceName, offline, TRY_AGAIN } from "@/copy";
import { ShellContext } from "./shell-context";
import { readRadioRecents, writeRadioRecents } from "./radio-recents";
import { PairForm } from "./PairForm";
import { TvPairing } from "./TvPairing";
import { Onboarding } from "./Onboarding";
import { StatusLine } from "./StatusLine";
import { LiveSharingStatus } from "./LiveSharingStatus";
import { useNativeWindowTitle } from "@/native-window-title";
import { useMediaSession } from "@/session/media-session";
import { hear, onBlocked } from "@/session/renderer";
import { deviceId, showsPicture, useLocalDeviceName } from "@/session/device-id";

// The sections in tab order, with their icons in the phone tab bar. Search is the header's field, not a tab.
const sections: [string, LucideIcon][] = [["Home", HouseIcon], ["Discover", CompassIcon], ["Saved", BookmarkIcon], ["Remote", TvIcon], ["Settings", SettingsIcon]];
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
  const { nativeHost, credentials, state, status, details, connected, run, booting, setError, videoQualityPreference, playerTarget } = useSessionGate();
  const router = useRouter();
  const detailNavigation = useDetailNavigation();
  const location = useLocation();
  const section = sectionForPath(location.pathname, location.searchStr) ?? "Home";
  const playerTransition = !useSyncExternalStore(subscribeReducedMotion, reducedMotion);
  const settingsSection = settingsPageForPath(location.pathname);
  const rememberedSearch = useRef<SearchRouteState>({ query: "", source: "All" });
  if (location.pathname === "/search") rememberedSearch.current = readSearchState(location.searchStr);
  const lastBrowsePath = useRef("/");
  if (section !== "Now") lastBrowsePath.current = location.pathname + location.searchStr;
  useEffect(() => {
    if (section === "Now" && !playerTarget && state && !state.currentEntryId && location.search.queue !== true) router.history.replace(lastBrowsePath.current);
  }, [section, playerTarget?.id, state?.currentEntryId, state?.queue.length, !!state, location.search.queue, router]);
  const installationId = credentials?.installationId ?? details?.installationId;
  const [recentRadio, setRecentRadio] = useState<{ installationId: string | null; stations: RadioStation[] }>({ installationId: null, stations: [] });
  useEffect(() => { setRecentRadio({ installationId: installationId ?? null, stations: installationId ? readRadioRecents(installationId) : [] }); }, [installationId]);

  // The app window titles itself with what's playing (useNativeWindowTitle).
  useEffect(() => {
    if (nativeHost) return;
    document.title = settingsSection ? `${settingsPages[settingsSection].label} · Settings · Couch` : section === "Now" || section === "Home" ? "Couch" : `${section} · Couch`;
  }, [nativeHost, section, settingsSection]);

  const at = location.pathname + location.searchStr;
  const changePage = (name: string) => {
    // Big-picture behavior: while playing, any navigation opens the browsing
    // layer over the player instead of floating the controls above the page.
    const to = name === "Search" ? searchLocation(rememberedSearch.current) : pathForSection(name);
    if (to !== at) {
      if (name === "Now") {
        if (section === "Now") void router.navigate({ href: to, replace: true, state: previous => previous });
        else detailNavigation.open(to, undefined, playerTransition);
      }
      else if (playerTransition && section === "Now") void router.navigate({ href: to, viewTransition: true });
      else router.history.push(to);
    }
  };
  const changeSection = changePage;
  // `types` name the view transition, so its CSS can pick what travels (index.css: couch-play).
  const openPlayer = (panel?: "queue", targetDeviceId = playerTarget?.id, types?: string[]) => {
    const href = `/now${defaultStringifySearch({ queue: panel === "queue" || undefined, targetDeviceId })}`;
    if (playerTarget && targetDeviceId === playerTarget.id) void router.navigate({ href, replace: true, state: location.state });
    else if (targetDeviceId) detailNavigation.open(href, section === "Remote" && panel === "queue" ? '[data-remote-page] button[aria-label="Up next"]' : undefined);
    else if (section === "Now") void router.navigate({ href, replace: true, state: previous => previous });
    else detailNavigation.open(href, undefined, playerTransition && (types ? { types } : true));
  };
  // An explicit Play opens its picture once. Initial sync, Next and transport reloads keep the page.
  const picture = showsPicture(state) ? state?.playback : null;
  const pictured = !!picture && !state?.playbacks?.find(playback => playback.id === state.playback)?.audioOnly;
  const presentation = state?.presentationId;
  const shownPicture = useRef<{ picture?: string | null; presentation?: string | null; settled: boolean } | null>(null);
  useEffect(() => {
    if (!state) { shownPicture.current = null; return; }
    const before = shownPicture.current;
    if (!before) { shownPicture.current = { picture, presentation, settled: true }; return; }
    if (before.presentation !== presentation) shownPicture.current = { picture: before.picture, presentation, settled: !presentation };
    const current = shownPicture.current!;
    const newlySelected = picture && picture !== current.picture;
    const explicitlyStarted = !!state.playedBy && !current.settled;
    // Consume audio-only starts too: a retry can temporarily clear their media flags.
    if (explicitlyStarted) current.settled = true;
    // A Details page's artwork travels into the player its Play opened.
    if (pictured && current.settled && (newlySelected || explicitlyStarted) && section !== "Now") openPlayer(undefined, undefined, ["couch-play"]);
    current.picture = picture;
  }, [picture, presentation, pictured, !!state?.playedBy, !!state]);
  // The header's field, which the player hides: from there, its page comes back first.
  const focusSearch = () => {
    const focus = () => { const field = document.getElementById("media-search") as HTMLInputElement | null; field?.focus(); field?.select(); };
    if (section === "Now") void router.navigate({ href: lastBrowsePath.current }).then(focus);
    else focus();
  };
  // A source without a home scopes the header's field to itself, so there is one search field, not two.
  const [searchScope, setSearchScope] = useState<SearchScope | null>(null);
  const scopeSearch = (source: string) => { setSearchScope({ source }); focusSearch(); };
  const leavePlayer = () => {
    detailNavigation.back(playerTarget ? "/remote" : lastBrowsePath.current);
  };
  const changeSettingsSection = (page: SettingsPage | null) => {
    const to = settingsPagePath(page);
    if (to !== location.pathname) router.history.push(to);
  };
  const changeSearch = (state: SearchRouteState) => {
    const to = searchLocation(state);
    if (to !== at) router.history.replace(to);
  };
  useNavigation(() => {
    // A detail page, and Discover's own pages (every station, every channel), go back to what opened them.
    if (["/collection", "/item", ...discoverPaths].includes(location.pathname)) { detailNavigation.back(pathForSection(section)); return; }
    if (section === "Now") leavePlayer();
    else if (section !== "Home") changeSection("Home");
  });

  const enqueueProvider = (item: ProviderItem, playNow: boolean, deviceId?: string, quality = videoQualityPreference.quality) =>
    run({ type: "enqueueProvider", provider: item.provider, url: item.url, shape: providerShape(item), title: item.title, thumbnail: item.thumbnail, ...(item.collection ? { collection: item.collection } : {}), ...(["bandcamp", "soundcloud"].includes(item.provider) ? {} : { quality }), playNow, deviceId });
  const enqueueRadio = (station: RadioStation, playNow: boolean, deviceId?: string) => {
    const owner = installationId;
    const result = run(station.sourceId
      ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow, deviceId }
      : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow, deviceId });
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
    mutationFn: ({ mediaId, on, ...body }: { mediaId: string; on?: string; fromStart: boolean; profileId: string }) => apiSend(credentials!, `/api/progress/${encodeURIComponent(mediaId)}/play${playOnQuery(on)}`, body, "POST", 35_000),
  });
  const playHistory: HistoryPlayback = async (item, options) => {
    if (item.playable && credentials && state) {
      setError(null);
      try { await playProgress.mutateAsync({ mediaId: item.mediaId, on: options.on, fromStart: options.fromStart === true, profileId: state.activeProfile.id }); return true; }
      catch (reason) { setError(errorText(reason)); return false; }
    }
    // Only REST history plays carry Play on, so items that are only in the queue offer plain Play.
    if (item.queueEntryId) return run({ type: "play", entryId: item.queueEntryId, fromStart: options.fromStart });
    setError("Couldn't play. It's no longer available.");
    return Promise.resolve(false);
  };

  const player = state?.player;
  const programme = connected ? state?.radioProgramme : null;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const available = connected && !!player && player.status !== "unavailable";
  const active = !!player?.playbackId && ["loading", "playing", "paused"].includes(player.status);
  // Terse, stable labels for the header's screen-reader status and the Couch switch.
  const statusLabel = booting ? "Starting" : {
    connecting: "Connecting", syncing: "Syncing", connected: player?.status === "unavailable" ? "Player unavailable" : "Connected", reconnecting: "Reconnecting", "server-unavailable": "Server unavailable", "pairing-required": credentials ? "Pairing required" : "Not paired", "connection-rejected": "Access refused", "build-mismatch": "Couch updated",
  }[status];

  return {
    // The shell only renders routes inside the paired branch; pages can rely
    // on credentials being set.
    credentials: credentials!, section, settingsSection, statusLabel, available, active, programme, current, playerBackLabel: sectionForPath(...lastBrowsePath.current.split("?") as [string, string?]) ?? "Home", recentRadio: recentRadio.installationId === installationId ? recentRadio.stations : [],
    changeSection, openPlayer, leavePlayer, focusSearch, changeSearch, changeSettingsSection, searchScope, setSearchScope, scopeSearch,
    openProvider,
    enqueueProvider, enqueueRadio, playHistory,
    sectionUrl: (name: string) => name === "Search" ? searchLocation(rememberedSearch.current) : pathForSection(name),
  };
}

class ShellErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  override render() {
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
  // Mount Sonner's listener before the bridge replays a pending audio-unlock notice.
  return <ShellErrorBoundary><DetailFocusRestoration /><ShellContext.Provider value={shell}><ShellChrome><Outlet /></ShellChrome></ShellContext.Provider><MediaSessionBridge /></ShellErrorBoundary>;
}

function MediaSessionBridge() { useMediaSession(); useTapToHear(); return null; }

// A browser that needs a gesture before it plays sound asks for one on its own screen (#644).
function useTapToHear() {
  useEffect(() => {
    const unsubscribe = onBlocked(blocked => {
      if (blocked) waitingForTap(hear);
      else dismiss("tap-to-hear");
    });
    return () => { unsubscribe(); dismiss("tap-to-hear"); };
  }, []);
}

const isOffline = (status: string) => status === "server-unavailable" || status === "reconnecting";

// Connection and player state as one quiet line; red only for errors that need a decision. Offline is the header's
// (HeaderOffline) while Couch reconnects on its own; the line stays for the app pointed at another Couch, which offers
// to try again or use this computer.
function ConnectionStatus({ paired }: { paired: boolean }) {
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
  if (isOffline(status)) return paired && !remoteApp ? null : <StatusLine busy actions={recovery}>{offline(name)}</StatusLine>;
  if (!credentials || status === "pairing-required") return null;
  if (!connected) return null;
  if (state?.player.status === "unavailable" && state.player.error) return <StatusLine>{state.player.error}</StatusLine>;
  return null;
}

// Unpaired, the page stands alone: no header, its own mark and title the only brand, and the window drags by it. The
// header's Couch switch becomes one line under the description, where there is somewhere else to go: the app (this
// computer or another), or a browser that knew a Couch before. The TV picks its Couch in Settings, as when paired.
function PairingPage({ status }: { status: ReactNode }) {
  const { nativeHost, localHost, tvPresentation, credentials, details, booting, retryHost, connected } = useSessionGate();
  const { statusLabel } = useShell();
  const [typing, setTyping] = useState(false);
  const device = usePlaybackDevice();
  const origin = credentials?.origin ?? device?.address ?? location.origin;
  const switchable = !tvPresentation && (nativeHost || !!credentials || knownConnections().some(item => item.origin !== origin));
  const couch = switchable && <span className="mt-1 flex flex-wrap items-baseline gap-x-3"><span className="min-w-0 break-all">{localHost ? "This computer" : new URL(origin).host}</span><CouchSwitch inline credentials={credentials} connected={connected} status={statusLabel} installationName={details?.name} /></span>;
  if (localHost) return <Onboarding title="Starting Couch" description={couch || undefined}>
    {status}
    {booting ? <StatusLine busy>Starting…</StatusLine> : <><p className="text-sm text-muted-foreground">Couldn't start Couch on this computer. If it keeps failing, restart this computer.</p><Button className="self-start" onClick={retryHost}>{TRY_AGAIN}</Button></>}
  </Onboarding>;
  const replaced = !!credentials?.installationId && !!details?.installationId && credentials.installationId !== details.installationId;
  const name = deviceName(details?.name);
  const lost = credentials && <Alert variant="destructive"><AlertDescription>{replaced ? "A different Couch is at this address. Pair again." : "This device was removed. Pair again."}</AlertDescription></Alert>;
  // A TV shows a code a phone approves; typing the host's code with a remote stays one press away.
  if (tvPresentation && !typing) return <TvPairing status={<>{status}{lost}</>} onEnterCode={() => setTyping(true)} />;
  return <Onboarding title={`Pair with ${details?.name ?? new URL(origin).host}`} description={<>On {name}, choose Pair a device, then enter the code it shows.{couch}</>}>
    {status}
    {lost}
    <PairForm />
    {tvPresentation && <Button variant="ghost" data-back className="-ml-3 self-start" onClick={() => setTyping(false)}>Scan with a phone instead</Button>}
  </Onboarding>;
}

export function ShellChrome({ children }: PropsWithChildren) {
  const shell = useShell();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { pathname } = useLocation();
  const { nativeHost, localHost, tvPresentation, credentials, state, details, pairingRequired, connected, run, error, setError } = useSessionGate();
  useNativeWindowTitle(nativeHost, state, connected, details?.name);
  const { section, statusLabel, active, current } = shell;
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
  const paired = !!credentials && !pairingRequired;
  // This computer's Couch has started once its Core answered with a connection; until
  // then the shell shows Starting… or Couldn't start Couch (PairingPage).
  useShellReady(!localHost || paired);
  // The URL can move before the presented route. Keep the shell's bar in
  // step with the page, including view-transition snapshots.
  const playerVisible = useMatches({ select: matches => matches.some(match => match.routeId === "/now") });
  const remoteVisible = useMatches({ select: matches => matches.some(match => match.routeId === "/remote") });
  // Home's top item is what plays, with its own transport, whenever something does.
  const onPlayer = paired && playerVisible;
  useIdleCursor(tvPresentation && !onPlayer);
  const installationName = state?.installationName ?? details?.name;
  const localName = useLocalDeviceName();
  const tvName = localName ?? state?.devices?.find(device => device.id === deviceId())?.name ?? installationName;
  useRememberCouchName(installationName);
  const nowPlaying = !!current && (active || player?.status === "error" || player?.status === "ended") && !playerVisible && !remoteVisible;
  // The footer holds the now-playing bar and the phone tab bar; its height is --bottom-bar.
  const footer = useRef<HTMLDivElement>(null);
  useBottomBar(footer, paired && !setupPending);
  const header = useRef<HTMLElement>(null);
  useTopBar(header, paired && !setupPending);

  const status = <><ConnectionStatus paired={paired} />{error && section !== "Remote" && <ErrorAlert error={error} onDismiss={() => setError(null)} />}</>;

  if (setupPending) return <div className="app-shell drag-region flex flex-col bg-background"><LocalSharingPrompt credentials={credentials} /></div>;

  return (
    <div className={cn("app-shell flex flex-col bg-background", tvPresentation && "tv-shell", !paired && "drag-region")}>
      <main id="main" className="flex flex-1 flex-col">
        {tvPresentation && state?.appearance && <TvAppearancePreview appearance={state.appearance} credentials={credentials} connected={connected} />}
        <div className="tv-browser flex flex-1 flex-col" data-tv-navigation-scope={tvPresentation ? "" : undefined}>
          <span role="status" className="sr-only">{statusLabel}</span>
          {/* One header on every screen, the TV's: the Couch switch at the left (the TV names itself there),
              the tabs centred, then search and the clock at the right. It stays at the top on a solid ground while the page
              scrolls under it; Up from a page's first row reaches it on the TV. Phones keep the switch and search,
              with their tabs in the bottom bar and Settings last. Unpaired there is none: the pairing page stands alone. */}
          {paired && <header ref={header} hidden={onPlayer} className="app-header group/header drag-region window-controls-inset sticky top-0 z-30 grid min-h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)_minmax(14rem,22rem)] items-center gap-x-8 bg-background px-(--gutter) py-3 motion-safe:transition-colors motion-safe:duration-200 touch:flex touch:gap-x-3 tv:grid tv:gap-x-8 tv:max-lg:grid-cols-[minmax(0,1fr)_auto]">
            {/* On a phone the open search takes the whole row. */}
            <div className="flex min-w-0 items-center touch:group-has-[[data-search-open]]/header:hidden tv:group-has-[[data-search-open]]/header:flex">
              {/* The TV has no Couch switch: its Couch choice lives in Settings → This device. */}
              {tvPresentation ? <span className="flex min-w-0 items-center gap-2 text-base text-muted-foreground"><CouchMark connected={connected} /><span className="truncate">{deviceName(tvName)}</span></span> : <CouchSwitch key={pathname} credentials={credentials} connected={connected} status={statusLabel} installationName={installationName} />}
            </div>
            {/* Phones keep the sections in the bottom tab bar, for thumb reach; a narrow TV has no touch, so it keeps them here. */}
            <SectionTabs className="flex min-w-0 items-center gap-1 touch:hidden tv:flex tv:max-lg:col-span-2 tv:max-lg:row-start-2 tv:max-lg:justify-center" />
            {/* While sharing, keep a readable query and let this column use the spare room beside the Couch name. On a
                phone the search gives way instead, so the Couch name stays readable beside Stop sharing. */}
            <div data-app-status className="group/header-status col-start-3 flex min-w-0 items-center justify-end gap-1 has-[[data-live-sharing]]:min-w-min touch:flex-1 tv:max-lg:col-start-2 tv:max-lg:row-start-1">
              <HeaderOffline />
              <LiveSharingStatus header />
              <HeaderSearch className="min-w-0 flex-1 sm:group-has-[[data-live-sharing]]/header-status:min-w-44 tv:max-w-64 tv:has-[[data-search-token]]:max-w-88 tv:max-lg:min-w-44" />
              {/* Only a keyboard can use its shortcuts. Remote's keys drive the TV, so there it keeps its place unseen and the field doesn't move. */}
              {!tvPresentation && <Button variant="ghost" size="icon" className={cn("touch:hidden", section === "Remote" && "invisible")} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}><Keyboard aria-hidden="true" /></Button>}
              <DigitalClock className="ml-3 hidden text-base text-muted-foreground tv:inline" />
            </div>
          </header>}
          {paired && !onPlayer && <div className="grid gap-3 px-(--gutter) pb-3 empty:hidden">{status}</div>}
          {onPlayer && error && <div className="window-controls-inset fixed inset-x-0 top-0 z-40 bg-background px-(--gutter) py-3"><ErrorAlert error={error} onDismiss={() => setError(null)} /></div>}
          {!paired ? <PairingPage status={status} /> : <>
            {!tvPresentation && section !== "Remote" && <KeyboardShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />}
            {/* Cached routes appear immediately; the player keeps its separate band transition. The page is its own layer,
                so artwork's light (AmbientLight) lies under its content and over the shell's black. */}
            <div className={cn("isolate min-w-0 flex-1", !onPlayer && "px-(--gutter) pt-8 pb-12")}>{children}</div>
            {/* Fixed, not sticky: Chromium centres a focused control that sits inside the page's scroll padding, which
                the footer itself fills, so focus in a sticky footer scrolled the page beneath it by hundreds of pixels. */}
            <div ref={footer} className={cn("app-footer fixed inset-x-0 bottom-0 z-20", onPlayer && "hidden")}>
              {nowPlaying && state && <NowPlayingBar state={state} connected={connected} run={run} onOpen={shell.openPlayer} />}
              <SectionTabs bar className="hidden bg-background touch:flex tv:hidden" />
            </div>
          </>}
          {/* Inside the TV's navigation scope, so a remote reaches a toast's action (navigation.ts). */}
          <Toaster tvPresentation={tvPresentation} />
        </div>
      </main>
    </div>
  );
}

/**
 * Offline, the header's right cluster says so before the search, as sharing does: a Spinner and "Reconnecting…" (the
 * Spinner alone on a phone). The tabs keep their place, and the hollow mark and the shell's status region say it too.
 */
function HeaderOffline() {
  const { nativeHost, localHost, status } = useSessionGate();
  if (!isOffline(status) || (nativeHost && !localHost)) return null;
  return <span data-header-offline className="mr-3 flex shrink-0 items-center gap-2 text-sm text-muted-foreground tv:text-base">
    <Spinner role="presentation" aria-hidden="true" aria-label={undefined} className="size-3.5" />
    <span aria-hidden="true" className="max-sm:hidden">Reconnecting…</span>
  </span>;
}

/** Publishes the sticky header's height as --top-bar, which the page's scroll padding clears (index.css), as --bottom-bar does below. */
function useTopBar(ref: RefObject<HTMLElement | null>, shown: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shown) return;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => root.setProperty("--top-bar", `${element.offsetHeight}px`));
    observer.observe(element, { box: "border-box" });
    return () => { observer.disconnect(); root.removeProperty("--top-bar"); };
  }, [ref, shown]);
}

// The sections as tabs: text in the header on the TV and wide screens, icons over labels in the phone tab bar (`bar`),
// with Settings last. Remote shows on a device that can drive a TV while the Couch has one.
function SectionTabs({ bar = false, className }: { bar?: boolean; className?: string }) {
  const { section, sectionUrl } = useShell();
  const { tvPresentation, state } = useSessionGate();
  // A TV that's off still has its Remote.
  const remote = !tvPresentation && !!state?.devices?.some(device => device.tv);
  return <nav data-app-nav aria-label="Main navigation" className={className}>
    {sections.filter(([name]) => name !== "Remote" || remote).map(([name, Icon]) => <Button key={name} asChild variant="ghost" className={cn("relative border-0 font-normal text-muted-foreground aria-[current=page]:text-foreground after:absolute after:left-1/2 after:h-0.5 after:-translate-x-1/2 after:bg-current after:opacity-0 aria-[current=page]:after:opacity-100", bar ? "h-auto min-h-16 min-w-0 flex-1 flex-col gap-1 px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] rounded-none text-caption after:top-0 after:w-6" : "min-h-11 min-w-11 px-3 text-base after:bottom-1 after:w-4")}>
      <Link to={sectionUrl(name)} aria-current={section === name ? "page" : undefined}>{bar && <Icon aria-hidden="true" className="size-5" />}{name}</Link>
    </Button>)}
  </nav>;
}

function ErrorAlert({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}><X aria-hidden="true" /></Button></AlertAction></Alert>;
}
