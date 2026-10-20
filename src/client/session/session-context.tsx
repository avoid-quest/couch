import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Action, ConnectionInfo, Domain, NavigationKey, SessionState } from "../../shared/protocol";
import { applyTvNavigation } from "../navigation";
import { couchApp, isNativeHost } from "./native-context";
import { isTvPresentation } from "./presentation";
import { forgetConnection } from "./connection";
import { pairingCodeFromHash } from "./pairing-link";
import { useSession, type Credentials } from "./session";
import { useInterfaceSize } from "../interface-size";
import { useVideoQualityPreference } from "../video-quality";
import { playingOnDevice, useScreenWakeLock } from "../screen-wake-lock";
import { usePlaybackDevice } from "../sections/shell/PlaybackDevice";
import { choosesHere } from "./where-it-plays";
import { applyUndo, undoPlan } from "./undo";
import { PlaybackClockContext } from "./playback-clock";
import { SessionGateContext } from "./gate-context";
import { announcePlay, deviceId, loadLocalDeviceName, saveLocalDeviceName, useLocalDeviceName } from "./device-id";
import { apiSend } from "../api/client";
import { dismissAll, dismissUndo, queued, undoable } from "../toasts";

const tokenKey = "couch.remote-token";
const installationKey = "couch.remote-installation-id";
const nativeHost = isNativeHost();
const tvPresentation = isTvPresentation();
let cacheSequence = 0;

function storedCredentials(): Credentials | null {
  try {
    const token = localStorage.getItem(tokenKey) ?? localStorage.getItem("modern-kodi.remote-token");
    if (token) { localStorage.setItem(tokenKey, token); localStorage.removeItem("modern-kodi.remote-token"); }
    const installationId = localStorage.getItem(installationKey);
    return token && installationId ? { origin: location.origin, token, installationId } : null;
  } catch {
    return null;
  }
}

export function dispatchTvRoute(key: "home" | "info") {
  const dispatch = (remaining: number) => {
    const portals = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-slot="popover-content"]';
    const open = [...document.querySelectorAll<HTMLElement>(portals)].some(element => element.getAttribute("data-state") !== "closed" && element.getClientRects().length > 0);
    if (open && remaining > 0) { applyTvNavigation("back"); requestAnimationFrame(() => dispatch(remaining - 1)); }
    else window.dispatchEvent(new Event(`couch-${key}`));
  };
  dispatch(3);
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type SessionBag = Omit<ReturnType<typeof useSession>, "clock" | "readObservation">;

export type SessionGateValue = SessionBag & {
  queryClient: QueryClient;
  nativeHost: boolean;
  localHost: boolean;
  tvPresentation: boolean;
  credentials: Credentials | null;
  setCredentials: (credentials: Credentials | null) => void;
  host: ConnectionInfo | null;
  retryHost: () => void;
  booting: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  run: (action: Action, targetDeviceId?: string) => Promise<boolean>;
  queue: <T>(title: string, work: () => Promise<T>) => Promise<T>;
  seekBy: (seconds: number, targetDeviceId?: string) => Promise<boolean>;
  offerUndo: (text: string, undo: () => Promise<void>, duration?: number) => void;
  // Pairing origin for a new remote, and the code from a scanned pairing link.
  pairingOrigin: string;
  linkedPairingCode: string;
  savePairing: (credentials: Required<Credentials>) => void;
  unpair: () => void;
  videoQualityPreference: ReturnType<typeof useVideoQualityPreference>;
  screenWakeLock: ReturnType<typeof useScreenWakeLock>;
  remoteControlEnabled: boolean;
  playerTarget?: { id: string; status: string };
  // The request to choose where a shared source plays that was last closed. It outlives the player
  // surfaces, so moving between the now-playing bar and Now Playing does not reopen it.
  dismissedChooser: string | null;
  dismissChooser: (request: string) => void;
  // This window's own request after Play on a source's publisher, unless Core asks everyone (choosesHere).
  requestedChooser: string | null;
};

export function useSessionGate(): SessionGateValue {
  const value = useContext(SessionGateContext);
  if (!value) throw new Error("useSessionGate must be used inside SessionGate.");
  return value;
}

export function useOptionalSessionGate(): SessionGateValue | null {
  return useContext(SessionGateContext);
}

// upNext opens Up next for a confirmed Queue; main.tsx owns the router that does it.
export function SessionGate({ children, upNext }: PropsWithChildren<{ upNext: (targetDeviceId?: string) => void }>) {
  const device = usePlaybackDevice();
  // In Full mode this page is this computer's Core and connects as its host.
  const localHost = nativeHost && device?.mode === "local";
  const [credentials, setCredentials] = useState<Credentials | null>(() => localHost ? null : storedCredentials());
  const [host, setHost] = useState<ConnectionInfo | null>(null);
  const [hostAttempt, setHostAttempt] = useState(0);
  const [booting, setBooting] = useState(localHost);
  const [error, setError] = useState<string | null>(null);
  const [linkedPairingCode] = useState(() => nativeHost ? "" : pairingCodeFromHash(location.hash));
  const videoQualityPreference = useVideoQualityPreference();
  const [dismissedChooser, setDismissedChooser] = useState<string | null>(null);
  const [requestedChooser, setRequestedChooser] = useState<string | null>(null);
  const chooserRequests = useRef(0);
  // Closing Where it plays answers this window's request too.
  const dismissChooser = useCallback((request: string) => { setDismissedChooser(request); setRequestedChooser(null); }, []);

  useEffect(() => { if (linkedPairingCode) history.replaceState(history.state, "", location.pathname + location.search); }, []);

  function handleNavigation(key: NavigationKey) {
    if (!tvPresentation) return;
    document.documentElement.setAttribute("data-keyboard", "");
    if (key !== "home" && key !== "info") { requestAnimationFrame(() => applyTvNavigation(key)); return; }
    dispatchTvRoute(key);
  }

  const { clock, readObservation, state, status, details, identity, playerStatus, pairingRequired, reachable, connected, command, reconnect, startLive, endLive, liveAudioInputs, localLiveSourceId } = useSession(credentials, handleNavigation);
  const screenWakeLock = useScreenWakeLock(!nativeHost && connected && playingOnDevice(state?.playbacks, deviceId()));
  const localName = useLocalDeviceName();
  const ownName = state?.devices?.find(device => device.id === deviceId())?.name;
  useEffect(() => {
    if (!connected || !credentials || !ownName) return;
    // The host's name is this app's installation name: reread it after an administrator renames it.
    // Elsewhere an unnamed device adopts its pairing name; a named one gives the Couch its name.
    if (localHost) void loadLocalDeviceName().catch(reason => setError(errorText(reason)));
    else if (!localName) void saveLocalDeviceName(ownName).catch(reason => setError(errorText(reason)));
    else if (localName !== ownName) void apiSend(credentials, `/api/devices/${deviceId()}/name`, { name: localName }).catch(reason => setError(errorText(reason)));
  }, [connected, credentials, ownName, localName, localHost]);
  // A cache belongs to one authenticated connection/authority, never to storage.
  // The new provider is selected during render, before old responses can become
  // visible under new credentials. Cleanup cancels the retired queries; its
  // detached client cannot populate the replacement client even if I/O ignores abort.
  // Local/loopback reachability comes from the session, not the browser's offline
  // indicator. Disconnected reads are disabled/cancelled below, never queued for replay.
  const cacheOwner = [credentials?.origin, credentials?.token, credentials?.installationId, details?.installationId, pairingRequired, identity?.authority, identity?.device?.id] as const;
  const cacheRef = useRef<{ owner: typeof cacheOwner; id: number; client: QueryClient } | null>(null);
  if (!cacheRef.current || cacheRef.current.owner.some((value, index) => value !== cacheOwner[index])) cacheRef.current = { owner: cacheOwner, id: ++cacheSequence, client: new QueryClient({ defaultOptions: {
    queries: { networkMode: "always", retry: 1, refetchOnWindowFocus: false },
    mutations: { networkMode: "always", retry: false },
  } }) };
  const cache = cacheRef.current;
  const queryClient = cache.client;
  useLayoutEffect(() => () => queryClient.clear(), [queryClient]);
  const remoteControlEnabled = details?.remoteControlEnabled === true;

  // Session snapshots invalidate Query directly: each changed domain revision
  // refetches its query-key root. The first snapshot after a reconnect
  // revalidates everything, including revisions reset by a server restart.
  const revisions = useRef<{ client: QueryClient; versions: SessionState["versions"] } | null>(null);
  const versions = state?.versions;
  useEffect(() => {
    if (!connected || !state) {
      revisions.current = null;
      void queryClient.cancelQueries();
      return;
    }
    const previous = revisions.current;
    if (!previous || previous.client !== queryClient) void queryClient.invalidateQueries();
    else for (const domain of Object.keys({ ...previous.versions, ...versions }) as Domain[]) {
      if (versions?.[domain] !== previous.versions?.[domain]) {
        // invalidateQueries only cancels refetches that already have data. A
        // first read begun before this revision is stale too.
        void queryClient.cancelQueries({ queryKey: [domain] });
        void queryClient.invalidateQueries({ queryKey: [domain] });
      }
    }
    revisions.current = { client: queryClient, versions };
  }, [versions, connected, !!state, queryClient]);

  useInterfaceSize(state?.appearance);

  useEffect(() => {
    if (localHost) return couchApp!.onAddresses(urls => setHost(current => current ? { ...current, urls } : current));
  }, [localHost]);

  useEffect(() => {
    document.body.classList.toggle("native-host", nativeHost);
    document.body.classList.toggle("tv-presentation", tvPresentation);
    if (!localHost) return;
    let disposed = false;
    setBooting(true);
    void couchApp!.connection().then((info) => {
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
  }, [localHost, hostAttempt, setCredentials]);

  const currentCredentials = useRef(credentials);
  const commandAttempt = useRef(0);
  currentCredentials.current = credentials;

  useEffect(() => { dismissAll(); setRequestedChooser(null); return dismissAll; }, [credentials?.origin, credentials?.token, credentials?.installationId]);
  // A request belongs to the playback it was made for; viewing another one retires it.
  useEffect(() => setRequestedChooser(request => request?.startsWith(`${state?.playback}:`) ? request : null), [state?.playback]);

  const offerUndo = useCallback((text: string, undo: () => Promise<void>, duration?: number) => {
    const owner = currentCredentials.current;
    undoable(text, () => {
      if (!owner || owner !== currentCredentials.current) return;
      setError(null);
      undo().catch(reason => { if (owner === currentCredentials.current) setError(errorText(reason)); });
    }, duration);
  }, []);

  // Confirm the requesting action, including REST callers, under its original connection and target.
  const queue = useCallback(async <T,>(title: string | (() => string | undefined), work: () => Promise<T>, attempt = ++commandAttempt.current, targetDeviceId?: string) => {
    const owner = currentCredentials.current;
    const before = readObservation();
    const result = await work();
    const after = readObservation();
    if (result !== false && result !== null && owner && owner === currentCredentials.current && attempt === commandAttempt.current && before && after && after.controlling === before.controlling) {
      const label = typeof title === "function" ? title() : title;
      queued(label, () => upNext(targetDeviceId));
    }
    return result;
  }, [readObservation, upNext]);

  const run = useCallback(async (action: Action, targetDeviceId?: string) => {
    const owner = currentCredentials.current;
    const current = () => owner === currentCredentials.current;
    const started = performance.now();
    const before = readObservation();
    dismissUndo();
    const attempt = ++commandAttempt.current;
    setError(null);
    try {
      if ((action.type === "enqueue" || action.type === "enqueueProvider" || action.type === "enqueueRadio" || action.type === "enqueueWeb") && !action.playNow || action.type === "playLive" && action.playNow === false) {
        await queue(() => {
          const entries = readObservation()?.queue ?? [];
          if (action.type === "enqueue") return entries.find(entry => entry.id === action.entry.id)?.title ?? action.entry.title;
          if (action.type === "enqueueRadio" || action.type === "enqueueWeb") return entries.find(entry => entry.id === action.entryId)?.title;
          if (action.type === "playLive") return entries.find(entry => entry.liveSourceId === action.sourceId)?.title;
          const matching = entries.filter(entry => entry.source === `web:${action.url}` && !before?.queue.some(previous => previous.id === entry.id));
          return action.title ?? (matching.length === 1 ? matching[0]?.title : undefined);
        }, () => command(action, targetDeviceId), attempt, targetDeviceId);
      } else {
        await command(action, targetDeviceId);
        if (current() && ((action.type === "enqueue" || action.type === "enqueueProvider" || action.type === "enqueueRadio" || action.type === "enqueueWeb") && action.playNow || action.type === "playLive" && action.playNow !== false)) announcePlay(readObservation(), action.deviceId);
        const after = readObservation();
        if (current() && attempt === commandAttempt.current && choosesHere(action, before, after)) setRequestedChooser(`${after!.playback}:here:${++chooserRequests.current}`);
      }
      if (before && current() && attempt === commandAttempt.current) {
        const undoable = action.type === "remove" || !!before.currentEntryId && action.type === "stop";
        let after = readObservation();
        let plan = undoable && after && undoPlan(action, before, after);
        for (let tries = 0; undoable && !plan && tries < 20 && current() && attempt === commandAttempt.current; tries++) {
          await new Promise(resolve => setTimeout(resolve, 25));
          after = readObservation();
          plan = after && undoPlan(action, before, after);
        }
        const remaining = 6_000 - (performance.now() - started);
        if (plan && remaining > 0 && current() && attempt === commandAttempt.current) {
          const confirmed = plan;
          offerUndo(confirmed.text, () => applyUndo(confirmed, action => command(action, targetDeviceId), readObservation), remaining);
        }
      }
      return current();
    } catch (reason) {
      if (current() && attempt === commandAttempt.current) setError(errorText(reason));
      return false;
    }
  }, [command, offerUndo, queue, readObservation]);

  const seekBy = useCallback((seconds: number, targetDeviceId?: string) => {
    const player = readObservation()?.player;
    return player?.playbackId && player.seekable && ["playing", "paused"].includes(player.status)
      ? run({ type: "seek", playbackId: player.playbackId, position: Math.max(0, Math.min(player.duration ?? Infinity, player.position + seconds)) }, targetDeviceId)
      : Promise.resolve(false);
  }, [readObservation, run]);

  const savePairing = useCallback((value: Required<Credentials>) => {
    try {
      localStorage.setItem(tokenKey, value.token); localStorage.setItem(installationKey, value.installationId);
    } catch { /* Pairing still works for this tab. */ }
    setCredentials(value);
  }, []);

  const unpair = useCallback(() => {
    try {
      localStorage.removeItem(tokenKey); localStorage.removeItem(installationKey); localStorage.removeItem("modern-kodi.remote-token");
    } catch { /* Storage may be disabled. */ }
    forgetConnection(location.origin);
    setCredentials(null);
    setError(null);
  }, []);

  const retryHost = useCallback(() => setHostAttempt(attempt => attempt + 1), []);
  const pairingOrigin = credentials?.origin ?? location.origin;
  const value = useMemo<SessionGateValue>(() => ({
    queryClient, nativeHost, localHost, tvPresentation, credentials, setCredentials, host, retryHost, booting, error, setError, command,
    state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, queue, seekBy, offerUndo, reconnect, startLive, endLive, liveAudioInputs, localLiveSourceId,
    pairingOrigin, linkedPairingCode, savePairing, unpair, videoQualityPreference, screenWakeLock, remoteControlEnabled, dismissedChooser, dismissChooser, requestedChooser,
  }), [queryClient, localHost, credentials, host, retryHost, booting, error, command, state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, queue, seekBy, offerUndo, reconnect, startLive, endLive, liveAudioInputs, localLiveSourceId, pairingOrigin, linkedPairingCode, savePairing, unpair, videoQualityPreference, screenWakeLock, remoteControlEnabled, dismissedChooser, dismissChooser, requestedChooser]);
  return <PlaybackClockContext.Provider value={clock}><SessionGateContext.Provider value={value}><QueryClientProvider key={cache.id} client={queryClient}>{children}</QueryClientProvider></SessionGateContext.Provider></PlaybackClockContext.Provider>;
}
