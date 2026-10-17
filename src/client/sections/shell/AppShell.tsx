import { defaultStringifySearch, Link, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type PropsWithChildren, type RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookmarkIcon, CompassIcon, HouseIcon, Keyboard, SettingsIcon, TvIcon, X, type LucideIcon } from "lucide-react";
import { providerShape, type ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import type { HistoryPlayback } from "@/sections/home/HomePage";
import { CouchMark } from "@/components/CouchMark";
import { DigitalClock } from "@/components/DigitalClock";
import { playOnQuery } from "@/components/PlayOn";
import { LocalSharingPrompt, useLocalSetupPending, usePlaybackDevice, useRememberCouchName } from "@/sections/shell/PlaybackDevice";
import { CouchSwitch } from "@/sections/shell/CouchSwitch";
import { errorText, useSessionGate } from "@/session/session-context";
import { NowPlayingBar, useBottomBar } from "./NowPlayingBar";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { HeaderSearch } from "./HeaderSearch";
import { TvAppearancePreview } from "./TvAppearancePreview";
import { readSearchState, searchLocation, type SearchRouteState } from "@/search";
import { createId } from "@/session/session";
import { discoverPaths, pathForSection, sectionForPath } from "../../../shared/page-paths";
import { settingsPageForPath, settingsPagePath, settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { apiSend } from "@/api/client";
import { useIdleCursor } from "@/useIdleCursor";
import { useNavigation } from "@/navigation";
import { collectionLocation, DetailFocusRestoration, useDetailNavigation } from "@/detail-navigation";
import { cn } from "cn";
import { Toaster } from "@/components/ui/sonner";
import { activity, dismiss, waitingForTap } from "@/toasts";
import { deviceName, offline, TRY_AGAIN } from "@/copy";
import { ShellContext } from "./shell-context";
import { readRadioRecents, writeRadioRecents } from "./radio-recents";
import { PairForm } from "./PairForm";
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
  const settingsSection = settingsPageForPath(location.pathname) ?? (section === "Settings" ? "general" : null);
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
  const openPlayer = (panel?: "queue", targetDeviceId = playerTarget?.id) => {
    const href = `/now${defaultStringifySearch({ queue: panel === "queue" || undefined, targetDeviceId })}`;
    if (playerTarget && targetDeviceId === playerTarget.id) void router.navigate({ href, replace: true, state: location.state });
    else if (targetDeviceId) detailNavigation.open(href, section === "Remote" && panel === "queue" ? '[data-remote-page] button[aria-label="Up next"]' : undefined);
    else if (section === "Now") void router.navigate({ href, replace: true, state: previous => previous });
    else detailNavigation.open(href, undefined, playerTransition);
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
    if (pictured && current.settled && (newlySelected || explicitlyStarted) && section !== "Now") openPlayer();
    current.picture = picture;
  }, [picture, presentation, pictured, !!state?.playedBy, !!state]);
  // The header's field, which the player hides: from there, its page comes back first.
  const focusSearch = () => {
    const focus = () => { const field = document.getElementById("media-search") as HTMLInputElement | null; field?.focus(); field?.select(); };
    if (section === "Now") void router.navigate({ href: lastBrowsePath.current }).then(focus);
    else focus();
  };
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
    changeSection, openPlayer, leavePlayer, focusSearch, changeSearch, changeSettingsSection,
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
  return <ShellErrorBoundary><DetailFocusRestoration /><MediaSessionBridge /><ShellContext.Provider value={shell}><ShellChrome><Outlet /></ShellChrome></ShellContext.Provider></ShellErrorBoundary>;
}

function MediaSessionBridge() { useMediaSession(); useTapToHear(); return null; }

// A browser that needs a gesture before it plays sound asks for one on its own screen (#644).
function useTapToHear() {
  useEffect(() => onBlocked(blocked => {
    if (blocked) waitingForTap(hear);
    else dismiss("tap-to-hear");
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
  const { localHost, credentials, details, booting, retryHost } = useSessionGate();
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
  const { nativeHost, tvPresentation, credentials, state, details, identity, pairingRequired, connected, run, error, setError } = useSessionGate();
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
  // Another device's activity replaces the last; this device's own retires it.
  useEffect(() => {
    if (!state?.activity) return;
    if (identity && state.activity.actor.deviceId !== (identity.device?.id ?? "host")) activity(state.activity.text);
    else dismiss("activity");
  }, [state?.activity?.id, identity?.device?.id]);
  const paired = !!credentials && !pairingRequired;
  // The player is full-bleed: its band replaces the header and status line.
  const onPlayer = paired && section === "Now";
  useIdleCursor(tvPresentation && !onPlayer);
  const installationName = state?.installationName ?? details?.name;
  const localName = useLocalDeviceName();
  const tvName = localName ?? state?.devices?.find(device => device.id === deviceId())?.name ?? installationName;
  useRememberCouchName(installationName);
  const nowPlaying = !!current && (active || player?.status === "error" || player?.status === "ended") && !["Now", "Remote"].includes(section);
  // The footer holds the now-playing bar and the phone tab bar; its height is --bottom-bar.
  const footer = useRef<HTMLDivElement>(null);
  useBottomBar(footer, paired && !setupPending);
  const header = useRef<HTMLElement>(null);
  useTopBar(header, !setupPending);

  if (setupPending) return <div className="app-shell drag-region flex flex-col bg-background"><LocalSharingPrompt credentials={credentials} /></div>;

  return (
    <div className={cn("app-shell flex flex-col bg-background", tvPresentation && "tv-shell")}>
      <main id="main" className="flex flex-1 flex-col">
        {tvPresentation && state?.appearance && <TvAppearancePreview appearance={state.appearance} credentials={credentials} connected={connected} />}
        <div className="tv-browser flex flex-1 flex-col" data-tv-navigation-scope={tvPresentation ? "" : undefined}>
          {/* One header on every screen, the TV's: Couch's mark and the Couch switch at the left (the TV names itself there),
              the tabs centred, then search and the clock at the right. It stays at the top on a solid ground while the page
              scrolls under it; Up from a page's first row reaches it on the TV. Phones keep the mark, the switch, search
              and a Settings gear; their tabs are the bottom bar. */}
          <header ref={header} hidden={onPlayer} className="app-header drag-region window-controls-inset sticky top-0 z-30 grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-x-4 bg-background px-(--gutter) py-1.5 touch:flex tv:grid">
            <div className="flex min-w-0 items-center">
              <CouchMark className="h-5 shrink-0" />
              {/* The TV has no Couch switch: its Couch choice lives in Settings → Couch connection. */}
              {tvPresentation ? <span className="min-w-0 truncate px-2.5 text-base text-muted-foreground">{deviceName(tvName)}</span> : <CouchSwitch key={pathname} credentials={credentials} connected={connected} status={statusLabel} installationName={installationName} />}
            </div>
            {/* Unpaired, every page is the pairing page, so the sections would lead nowhere (#644 ticket 12). Phones keep
                them in the bottom tab bar, for thumb reach; a narrow TV has no touch, so it keeps them here. */}
            {paired && <SectionTabs className="flex min-w-0 items-center touch:hidden tv:flex" />}
            <div data-app-status className="col-start-3 flex min-w-0 items-center justify-end gap-1 touch:flex-1">
              <LiveSharingStatus />
              <span role="status" className="sr-only">{statusLabel}</span>
              {paired && <HeaderSearch className="min-w-0 max-w-64 flex-1" />}
              {/* Only a keyboard can use its shortcuts. */}
              {paired && !tvPresentation && section !== "Remote" && <Button variant="ghost" size="icon" className="touch:hidden" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}><Keyboard aria-hidden="true" /></Button>}
              {/* Phones open Settings from where the clock is: the tab bar keeps the sections people browse. */}
              {paired && !tvPresentation && <Button asChild variant="ghost" size="icon" className="hidden touch:inline-flex"><Link to="/settings" aria-label="Settings" title="Settings" aria-current={section === "Settings" ? "page" : undefined}><SettingsIcon aria-hidden="true" /></Link></Button>}
              <DigitalClock className="ml-2 touch:hidden tv:inline" />
            </div>
          </header>
          {!onPlayer && <div className="grid gap-3 px-(--gutter) pb-3 empty:hidden"><ConnectionStatus />{error && section !== "Remote" && <ErrorAlert error={error} onDismiss={() => setError(null)} />}</div>}
          {onPlayer && error && <div className="window-controls-inset fixed inset-x-0 top-0 z-40 bg-background px-(--gutter) py-3"><ErrorAlert error={error} onDismiss={() => setError(null)} /></div>}
          {!paired ? <PairingPage /> : <>
            {!tvPresentation && section !== "Remote" && <KeyboardShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />}
            {/* A page fades in as it arrives: a new route mounts a new root, which starts transparent. A query or a page of its
                own (Settings' pages, Saved's tabs) keeps the root and doesn't fade. The player arrives as the band grows. */}
            <div className={cn("min-w-0 flex-1", !onPlayer && "px-(--gutter) pt-6 pb-12 motion-safe:*:transition-opacity motion-safe:*:duration-200 motion-safe:*:starting:opacity-0")}>{children}</div>
            <div ref={footer} className={cn("app-footer sticky bottom-0 z-20", onPlayer && "hidden")}>
              {nowPlaying && state && <NowPlayingBar state={state} connected={connected} run={run} onOpen={shell.openPlayer} />}
              <SectionTabs bar className="hidden border-t bg-background touch:flex tv:hidden" />
            </div>
          </>}
          {/* Inside the TV's navigation scope, so a remote reaches a toast's action (navigation.ts). */}
          <Toaster />
        </div>
      </main>
    </div>
  );
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
// where Settings is the top bar's gear. Remote shows on a device that can drive a TV while the Couch has one.
function SectionTabs({ bar = false, className }: { bar?: boolean; className?: string }) {
  const { section, sectionUrl } = useShell();
  const { tvPresentation, state } = useSessionGate();
  const remote = !tvPresentation && !!state?.devices?.some(device => device.tv);
  return <nav data-app-nav aria-label="Main navigation" className={className}>
    {sections.filter(([name]) => name === "Remote" ? remote : !bar || name !== "Settings").map(([name, Icon]) => <Button key={name} asChild variant="ghost" className={cn("rounded-none border-x-0 border-t-0 border-b-2 border-transparent font-normal text-muted-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground", bar ? "h-auto min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 py-1.5 text-xs" : "min-h-11 min-w-11 px-2.5 text-base")}>
      <Link to={sectionUrl(name)} aria-current={section === name ? "page" : undefined}>{bar && <Icon aria-hidden="true" className="size-5" />}{name}</Link>
    </Button>)}
  </nav>;
}

function ErrorAlert({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}><X aria-hidden="true" /></Button></AlertAction></Alert>;
}
