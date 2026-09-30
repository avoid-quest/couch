import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Action, ConnectionInfo, Domain, NavigationKey, SessionState } from "../../shared/protocol";
import { applyTvNavigation } from "../navigation";
import { couchApp, isNativeHost, isTvPresentation } from "./native-context";
import { forgetConnection } from "./connection";
import { pairingCodeFromHash } from "./pairing-link";
import { useSession, type Credentials } from "./session";
import { useInterfaceSize } from "../interface-size";
import { useVideoQualityPreference } from "../video-quality";
import { usePlaybackDevice } from "../sections/shell/PlaybackDevice";
import { applyUndo, undoPlan } from "./undo";
import { PlaybackClockContext } from "./playback-clock";
import { SessionGateContext } from "./gate-context";
import { announcePlay, deviceId, saveLocalDeviceName, useLocalDeviceName } from "./device-id";
import { apiSend } from "../api/client";

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
  // In Full mode this page is this computer's Core and connects as its host.
  const localHost = nativeHost && device?.mode === "local";
  const [credentials, setCredentials] = useState<Credentials | null>(() => localHost ? null : storedCredentials());
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

  const { clock, readObservation, state, status, details, identity, playerStatus, pairingRequired, reachable, connected, command, reconnect } = useSession(credentials, handleNavigation);
  const localName = useLocalDeviceName();
  const ownName = state?.devices?.find(device => device.id === deviceId())?.name;
  const lastName = useRef<{ token: string; server: string; local: string | null } | null>(null);
  useEffect(() => {
    if (!connected || !credentials || !ownName) { lastName.current = null; return; }
    if (localHost && !device?.localSetupComplete) return;
    const previous = lastName.current;
    const hostRenamed = localHost && previous?.token === credentials.token && previous.server !== ownName && previous.local === localName;
    lastName.current = { token: credentials.token, server: ownName, local: localName };
    // Migrate an existing name once; a live administrator rename also updates the host's identity.
    if (!localName || hostRenamed && localName !== ownName) void saveLocalDeviceName(ownName).catch(reason => setError(errorText(reason)));
    else if (localName !== ownName) void apiSend(credentials, `/api/devices/${deviceId()}/name`, { name: localName }).catch(reason => setError(errorText(reason)));
  }, [connected, credentials, ownName, localName, localHost, device?.localSetupComplete]);
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

  useInterfaceSize(tvPresentation, state?.appearance);

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
  const undoToast = useRef<string | number | null>(null);
  currentCredentials.current = credentials;

  const dismissUndo = useCallback(() => {
    if (undoToast.current !== null) toast.dismiss(undoToast.current);
    undoToast.current = null;
  }, []);
  useEffect(() => { dismissUndo(); return dismissUndo; }, [credentials?.origin, credentials?.token, credentials?.installationId, dismissUndo]);

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

  const run = useCallback(async (action: Action) => {
    const owner = currentCredentials.current;
    const current = () => owner === currentCredentials.current;
    const started = performance.now();
    const before = readObservation();
    dismissUndo();
    const attempt = ++commandAttempt.current;
    setError(null);
    try {
      await command(action);
      if ((action.type === "enqueue" || action.type === "enqueueProvider" || action.type === "enqueueRadio" || action.type === "enqueueWeb") && action.playNow && current()) announcePlay(readObservation(), action.deviceId);
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
  }, [command, dismissUndo, offerUndo, readObservation]);

  const seekBy = useCallback((seconds: number) => {
    const player = readObservation()?.player;
    return player?.playbackId && player.seekable && ["playing", "paused"].includes(player.status)
      ? run({ type: "seek", playbackId: player.playbackId, position: Math.max(0, Math.min(player.duration ?? Infinity, player.position + seconds)) })
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
    state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, seekBy, offerUndo, reconnect,
    pairingOrigin, linkedPairingCode, savePairing, unpair, videoQualityPreference, remoteControlEnabled,
  }), [queryClient, localHost, credentials, host, retryHost, booting, error, command, state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, seekBy, offerUndo, reconnect, pairingOrigin, linkedPairingCode, savePairing, unpair, videoQualityPreference, remoteControlEnabled]);
  return <PlaybackClockContext.Provider value={clock}><SessionGateContext.Provider value={value}><QueryClientProvider key={cache.id} client={queryClient}>{children}</QueryClientProvider></SessionGateContext.Provider></PlaybackClockContext.Provider>;
}
