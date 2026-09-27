import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Action, ConnectionInfo, Domain, NavigationKey, SessionState } from "../../shared/protocol";
import { acknowledgeFrontend, apiSend, ApiError } from "../api/client";
import { applyTvNavigation } from "../navigation";
import { isNativeHost, isTvPresentation } from "./native-context";
import { forgetConnection } from "./connection";
import { pairingCodeFromHash } from "./pairing-link";
import { useSession, type Credentials } from "./session";
import { useDeviceAudio } from "./device-audio";
import { clientDeviceName } from "./device-name";
import { useInterfaceSize } from "../interface-size";
import { useUpdateActivity } from "../update-activity";
import { useVideoQualityPreference } from "../video-quality";
import { usePlaybackDevice } from "../sections/shell/PlaybackDevice";
import { desktopClientProtocol } from "../../shared/desktop-protocol";
import { applyUndo, undoPlan } from "./undo";
import { PlaybackClockContext } from "./playback-clock";
import { SessionGateContext } from "./gate-context";

const tokenKey = "couch.remote-token";
const installationKey = "couch.remote-installation-id";
const nativeHost = isNativeHost();
const tvPresentation = isTvPresentation();
let cacheSequence = 0;

const pairingKey = (origin: string) => `couch.pairing:${origin}`;
function storedCredentials(selectedOrigin?: string): Credentials | null {
  try {
    if (nativeHost) {
      if (!selectedOrigin) return null;
      const value = JSON.parse(localStorage.getItem(pairingKey(selectedOrigin)) ?? "null") as { token?: string; installationId?: string } | null;
      return value?.token && value.installationId ? { origin: selectedOrigin, token: value.token, installationId: value.installationId } : null;
    }
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
  deviceAudio: ReturnType<typeof useDeviceAudio>;
  assignDevices: (deviceIds: string[], takeover?: boolean) => Promise<boolean>;
  newPlayback: (deviceId: string) => Promise<boolean>;
  activateDeviceAudio: () => Promise<boolean>;
  setDeviceVolume: (deviceId: string, volume: number, muted: boolean) => Promise<boolean>;
  queryClient: QueryClient;
  nativeHost: boolean;
  localHost: boolean;
  nativeReceiver: boolean;
  tvPresentation: boolean;
  credentials: Credentials | null;
  setCredentials: (credentials: Credentials | null) => void;
  host: ConnectionInfo | null;
  retryHost: () => void;
  booting: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  run: (action: Action) => Promise<boolean>;
  seekBy: (seconds: number) => Promise<boolean>;
  offerUndo: (text: string, undo: () => Promise<void>, duration?: number) => void;
  // Pairing origin for a new remote, and the code from a scanned pairing link.
  pairingOrigin: string;
  linkedPairingCode: string;
  savePairing: (credentials: Required<Credentials>) => void;
  unpair: () => void;
  videoQualityPreference: ReturnType<typeof useVideoQualityPreference>;
  remoteControlEnabled: boolean;
};

export function useSessionGate(): SessionGateValue {
  const value = useContext(SessionGateContext);
  if (!value) throw new Error("useSessionGate must be used inside SessionGate.");
  return value;
}

export function useOptionalSessionGate(): SessionGateValue | null {
  return useContext(SessionGateContext);
}

export function SessionGate({ children }: PropsWithChildren) {
  const device = usePlaybackDevice();
  const localHost = nativeHost && device?.mode === "local";
  const nativeReceiver = nativeHost && device?.mode === "remote";
  const selectedOrigin = nativeHost && device?.mode === "remote" ? device.address ?? undefined : undefined;
  const [credentials, setCredentials] = useState<Credentials | null>(() => storedCredentials(selectedOrigin));
  const [host, setHost] = useState<ConnectionInfo | null>(null);
  const [hostAttempt, setHostAttempt] = useState(0);
  const [booting, setBooting] = useState(localHost);
  const [error, setError] = useState<string | null>(null);
  const [linkedPairingCode] = useState(() => nativeHost ? "" : pairingCodeFromHash(location.hash));
  const videoQualityPreference = useVideoQualityPreference();

  useEffect(() => { if (linkedPairingCode) history.replaceState(history.state, "", location.pathname + location.search); }, []);

  function handleNavigation(key: NavigationKey) {
    if (!tvPresentation) return;
    document.documentElement.setAttribute("data-keyboard", "");
    if (key !== "home" && key !== "info") { requestAnimationFrame(() => applyTvNavigation(key)); return; }
    dispatchTvRoute(key);
  }

  const { playbackId, selectPlayback, scopedCredentials, rendererTargetId, rendererAttached, audioActivationRequired, setDeviceAudioReady, playHere, clock, readObservation, state, status, details, identity, playerStatus, pairingRequired, reachable, connected, command, reconnect } = useSession(credentials, handleNavigation, selectedOrigin, selectedOrigin ? desktopClientProtocol : undefined, nativeReceiver);
  const localDeviceId = rendererTargetId ?? (localHost ? "native" : null);
  const deviceAudio = useDeviceAudio({ credentials, rendererTargetId: localDeviceId, enabled: (rendererAttached || localHost && connected) && !!credentials && !pairingRequired,
    name: clientDeviceName(identity?.controller?.name), onReady: setDeviceAudioReady });
  const activateDeviceAudio = useCallback(() => {
    // The SDK unlock must precede every await and must not resume direct media.
    return deviceAudio.activateFromGesture();
  }, [deviceAudio.activateFromGesture]);
  // A cache belongs to one authenticated connection/authority, never to storage.
  // The new provider is selected during render, before old responses can become
  // visible under new credentials. Cleanup cancels the retired queries; its
  // detached client cannot populate the replacement client even if I/O ignores abort.
  // Local/loopback reachability comes from the session, not the browser's offline
  // indicator. Disconnected reads are disabled/cancelled below, never queued for replay.
  const cacheOwner = [playbackId, credentials?.origin, credentials?.token, credentials?.installationId, details?.installationId, pairingRequired, identity?.authority, identity?.controller?.id] as const;
  const cacheRef = useRef<{ owner: typeof cacheOwner; id: number; client: QueryClient } | null>(null);
  if (!cacheRef.current || cacheRef.current.owner.some((value, index) => value !== cacheOwner[index])) cacheRef.current = { owner: cacheOwner, id: ++cacheSequence, client: new QueryClient({ defaultOptions: {
    queries: { networkMode: "always", retry: 1, refetchOnWindowFocus: false },
    mutations: { networkMode: "always", retry: false },
  } }) };
  const cache = cacheRef.current;
  const queryClient = cache.client;
  useLayoutEffect(() => () => queryClient.clear(), [queryClient]);
  useUpdateActivity(credentials, connected);
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

  useInterfaceSize(tvPresentation, state?.appearance);

  useEffect(() => {
    if (!localHost || !credentials) return;
    const stop = new AbortController();
    void (async () => {
      for (let attempt = 0; attempt < 5 && !stop.signal.aborted; attempt++) {
        try { await acknowledgeFrontend(credentials, stop.signal, 2_000); return; }
        catch (reason) { if (reason instanceof ApiError && reason.status === 404) return; /* A trial stays closed until this loaded asset identity is received. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    })();
    return () => stop.abort();
  }, [localHost, credentials]);

  useEffect(() => {
    if (!localHost) return;
    const listener = listen<string[]>("connection-addresses", event => setHost(current => current ? { ...current, urls: event.payload } : current));
    return () => { void listener.then(stop => stop()); };
  }, [localHost]);

  useEffect(() => {
    document.body.classList.toggle("native-host", nativeHost);
    document.body.classList.toggle("tv-presentation", tvPresentation);
    if (!localHost) return;
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
  }, [localHost, hostAttempt, setCredentials]);

  useEffect(() => {
    if (!tvPresentation) return;
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

  const currentCredentials = useRef(scopedCredentials);
  const commandAttempt = useRef(0);
  const undoToast = useRef<string | number | null>(null);
  currentCredentials.current = scopedCredentials;

  const dismissUndo = useCallback(() => {
    if (undoToast.current !== null) toast.dismiss(undoToast.current);
    undoToast.current = null;
  }, []);
  useEffect(() => { dismissUndo(); return dismissUndo; }, [credentials?.origin, credentials?.token, credentials?.installationId, playbackId, dismissUndo]);

  const offerUndo = useCallback((text: string, undo: () => Promise<void>, duration = 6_000) => {
    dismissUndo();
    const owner = currentCredentials.current;
    const id = toast(text, { duration, onDismiss: () => { if (undoToast.current === id) undoToast.current = null; }, action: { label: "Undo", onClick: () => {
      undoToast.current = null;
      if (!owner || owner !== currentCredentials.current) return;
      setError(null);
      undo().catch(reason => { if (owner === currentCredentials.current) setError(errorText(reason)); });
    } } });
    undoToast.current = id;
  }, [dismissUndo]);

  const assignDevices = useCallback(async (deviceIds: string[], takeover = false) => {
    const owner = currentCredentials.current;
    if (localDeviceId && deviceIds.includes(localDeviceId)) void activateDeviceAudio();
    try { await command({ type: "assignDevices", deviceIds, ...(takeover ? { takeover: true as const } : {}) }); return owner === currentCredentials.current; }
    catch (reason) { if (owner === currentCredentials.current) setError(errorText(reason)); return false; }
  }, [command, localDeviceId, activateDeviceAudio]);

  const newPlayback = useCallback(async (deviceId: string) => {
    const owner = currentCredentials.current;
    if (!owner) return false;
    if (deviceId === localDeviceId) void activateDeviceAudio();
    try {
      const created = await apiSend<{ id: string }>(owner, "/api/playbacks", { deviceId });
      if (owner !== currentCredentials.current || !created.id) return false;
      selectPlayback(created.id);
      return true;
    } catch (reason) { if (owner === currentCredentials.current) setError(errorText(reason)); return false; }
  }, [localDeviceId, activateDeviceAudio, selectPlayback]);

  const setDeviceVolume = useCallback(async (deviceId: string, volume: number, muted: boolean) => {
    const owner = currentCredentials.current;
    try { await command({ type: "deviceVolume", deviceId, volume, muted }); return owner === currentCredentials.current; }
    catch (reason) { if (owner === currentCredentials.current) setError(errorText(reason)); return false; }
  }, [command]);

  const run = useCallback(async (action: Action) => {
    const owner = currentCredentials.current;
    const current = () => owner === currentCredentials.current;
    const started = performance.now();
    const before = readObservation();
    dismissUndo();
    const attempt = ++commandAttempt.current;
    setError(null);
    try {
      const startsPlayback = action.type === "play" || "playNow" in action && action.playNow === true;
      const localSelected = !!localDeviceId && (before?.deviceIds?.includes(localDeviceId) || !before?.deviceIds?.length);
      if (localSelected && (startsPlayback || action.type === "pause" && !action.paused)) { playHere(); if (before?.deviceIds?.length) void activateDeviceAudio(); }
      if (startsPlayback && before && !(before.deviceIds?.length ?? 0) && localDeviceId) {
        if (!await assignDevices([localDeviceId]) || !current()) return false;
      }
      await command(action);
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
          offerUndo(confirmed.text, () => applyUndo(confirmed, command, readObservation), remaining);
        }
      }
      return current();
    } catch (reason) {
      if (current() && attempt === commandAttempt.current) setError(errorText(reason));
      return false;
    }
  }, [command, dismissUndo, offerUndo, readObservation, localDeviceId, assignDevices, playHere, activateDeviceAudio]);

  const seekBy = useCallback((seconds: number) => {
    const player = readObservation()?.player;
    return player?.playbackId && player.seekable && ["playing", "paused"].includes(player.status)
      ? run({ type: "seek", playbackId: player.playbackId, position: Math.max(player.seekRange?.start ?? 0, Math.min(player.seekRange?.end ?? player.duration ?? Infinity, player.position + seconds)) })
      : Promise.resolve(false);
  }, [readObservation, run]);

  const savePairing = useCallback((value: Required<Credentials>) => {
    try {
      if (selectedOrigin) localStorage.setItem(pairingKey(value.origin), JSON.stringify({ token: value.token, installationId: value.installationId }));
      else { localStorage.setItem(tokenKey, value.token); localStorage.setItem(installationKey, value.installationId); }
    } catch { /* Pairing still works for this tab. */ }
    setCredentials(value);
  }, [selectedOrigin]);

  const unpair = useCallback(() => {
    try {
      if (selectedOrigin) localStorage.removeItem(pairingKey(selectedOrigin));
      else { localStorage.removeItem(tokenKey); localStorage.removeItem(installationKey); localStorage.removeItem("modern-kodi.remote-token"); }
    } catch { /* Storage may be disabled. */ }
    forgetConnection(selectedOrigin ?? location.origin);
    setCredentials(null);
    setError(null);
  }, [selectedOrigin]);

  const retryHost = useCallback(() => setHostAttempt(attempt => attempt + 1), []);
  const pairingOrigin = credentials?.origin ?? selectedOrigin ?? location.origin;
  const value = useMemo<SessionGateValue>(() => ({
    deviceAudio, assignDevices, newPlayback, activateDeviceAudio, setDeviceVolume,
    playbackId, selectPlayback, scopedCredentials, rendererTargetId, rendererAttached, audioActivationRequired, setDeviceAudioReady, playHere, queryClient, nativeHost, localHost, nativeReceiver, tvPresentation, credentials: scopedCredentials, setCredentials, host, retryHost, booting, error, setError, command,
    state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, seekBy, offerUndo, reconnect,
    pairingOrigin, linkedPairingCode, savePairing, unpair, videoQualityPreference, remoteControlEnabled,
  }), [deviceAudio, assignDevices, newPlayback, activateDeviceAudio, setDeviceVolume, playbackId, selectPlayback, scopedCredentials, rendererTargetId, rendererAttached, audioActivationRequired, setDeviceAudioReady, playHere, queryClient, localHost, nativeReceiver, credentials, host, retryHost, booting, error, command, state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, seekBy, offerUndo, reconnect, pairingOrigin, linkedPairingCode, savePairing, unpair, videoQualityPreference, remoteControlEnabled]);
  return <PlaybackClockContext.Provider value={clock}><SessionGateContext.Provider value={value}><QueryClientProvider key={cache.id} client={queryClient}>{children}</QueryClientProvider></SessionGateContext.Provider></PlaybackClockContext.Provider>;
}
