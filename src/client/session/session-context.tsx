import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Action, ConnectionInfo, NavigationKey, SessionState } from "../../shared/protocol";
import { loadedBuild } from "../../shared/build";
import { applyTvNavigation, useNavigation } from "../navigation";
import { isNativeHost, isTvPresentation } from "./native-context";
import { pairingCodeFromHash } from "./pairing-link";
import { useSession, type Credentials } from "./session";
import { useIdleCursor } from "../useIdleCursor";
import { useInterfaceSize } from "../interface-size";
import { useTvPresentation } from "../useTvPresentation";
import { useUpdateActivity } from "../update-activity";
import { useVideoQualityPreference } from "../video-quality";
import { usePlaybackDevice } from "../sections/shell/PlaybackDevice";
import { desktopClientProtocol } from "../../shared/desktop-protocol";
import { applyUndo, undoPlan, type UndoPlan } from "./undo";

const tokenKey = "couch.remote-token";
const installationKey = "couch.remote-installation-id";
const remoteNameKey = "couch.remote-name";
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

function storedRemoteName() {
  try { return localStorage.getItem(remoteNameKey) || "My remote"; } catch { return "My remote"; }
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type SessionBag = ReturnType<typeof useSession>;

type SessionGateValue = SessionBag & {
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
  undoNotice: { id: number; text: string } | null;
  undoAction: () => Promise<void>;
  dismissUndo: () => void;
  offerUndo: (text: string, undo: () => Promise<void>, duration?: number) => void;
  pair: (event: { preventDefault: () => void }) => Promise<void>;
  unpair: () => void;
  pairing: boolean;
  pairingCode: string;
  setPairingCode: (code: string) => void;
  remoteName: string;
  setRemoteName: (name: string) => void;
  videoQualityPreference: ReturnType<typeof useVideoQualityPreference>;
  remoteControlEnabled: boolean;
  setRemoteControlEnabled: (enabled: boolean) => void;
  tv: ReturnType<typeof useTvPresentation>;
  registerBackHandler: (handler: () => void) => void;
};

const SessionGateContext = createContext<SessionGateValue | null>(null);

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
  const selectedOrigin = nativeHost && device?.mode === "remote" ? device.address ?? undefined : undefined;
  const [credentials, saveCredentials] = useState<Credentials | null>(() => storedCredentials(selectedOrigin));
  const [host, setHost] = useState<ConnectionInfo | null>(null);
  const [hostAttempt, setHostAttempt] = useState(0);
  const [booting, setBooting] = useState(localHost);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState(() => nativeHost ? "" : pairingCodeFromHash(location.hash));
  const [remoteName, setRemoteName] = useState(storedRemoteName);
  const [pairing, setPairing] = useState(false);
  const [remoteControlEnabled, setRemoteControlEnabled] = useState(false);
  const backHandler = useRef<() => void>(() => {});
  const pairingOperation = useRef<AbortController | null>(null);
  const videoQualityPreference = useVideoQualityPreference();
  const setCredentials = useCallback((value: Credentials | null) => {
    pairingOperation.current?.abort();
    pairingOperation.current = null;
    setPairing(false);
    saveCredentials(value);
  }, []);
  useEffect(() => () => pairingOperation.current?.abort(), []);

  useEffect(() => { if (!nativeHost && pairingCodeFromHash(location.hash)) history.replaceState(history.state, "", location.pathname + location.search); }, []);
  useEffect(() => { try { localStorage.setItem(remoteNameKey, remoteName); } catch { /* Pairing still works without remembering the name. */ } }, [remoteName]);

  function handleNavigation(key: NavigationKey) {
    if (!tvPresentation) return;
    document.documentElement.setAttribute("data-keyboard", "");
    if (nativeHost) {
      if (key === "home" || key === "info") window.dispatchEvent(new Event(`couch-${key}`));
      else requestAnimationFrame(() => applyTvNavigation(key));
      return;
    }
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

  const { state, status, details, identity, playerStatus, pairingRequired, reachable, connected, command, reconnect } = useSession(credentials, handleNavigation, selectedOrigin, selectedOrigin ? desktopClientProtocol : undefined);
  // A cache belongs to one authenticated connection/authority, never to storage.
  // The new provider is selected during render, before old responses can become
  // visible under new credentials. Cleanup cancels the retired queries; its
  // detached client cannot populate the replacement client even if I/O ignores abort.
  // Local/loopback reachability comes from the session, not the browser's offline
  // indicator. Disconnected reads are disabled/cancelled below, never queued for replay.
  const cacheOwner = [credentials?.origin, credentials?.token, credentials?.installationId, details?.installationId, pairingRequired, identity?.authority, identity?.controller?.id] as const;
  const cacheRef = useRef<{ owner: typeof cacheOwner; id: number; client: QueryClient } | null>(null);
  if (!cacheRef.current || cacheRef.current.owner.some((value, index) => value !== cacheOwner[index])) cacheRef.current = { owner: cacheOwner, id: ++cacheSequence, client: new QueryClient({ defaultOptions: {
    queries: { networkMode: "always", retry: 1, refetchOnWindowFocus: false },
    mutations: { networkMode: "always", retry: false },
  } }) };
  const cache = cacheRef.current;
  const queryClient = cache.client;
  useLayoutEffect(() => () => queryClient.clear(), [queryClient]);
  useUpdateActivity(credentials, connected);
  useEffect(() => setRemoteControlEnabled(details?.remoteControlEnabled === true), [details?.remoteControlEnabled]);

  // Session snapshots invalidate Query directly. The first snapshot after a
  // reconnect revalidates everything, including counters reset by server restart.
  const revisions = useRef<{ client: QueryClient; state: SessionState } | null>(null);
  useEffect(() => {
    if (!connected || !state) {
      revisions.current = null;
      void queryClient.cancelQueries();
      return;
    }
    const previous = revisions.current;
    if (!previous || previous.client !== queryClient) void queryClient.invalidateQueries();
    else {
      const domains = { library: "library", radio: "radio", iptv: "iptv", provider: "providers", jellyfin: "jellyfin", playlist: "playlists", forLater: "for-later", controller: "controllers" } as const;
      for (const [domain, key] of Object.entries(domains)) {
        const field = `${domain}Version` as `${keyof typeof domains}Version`;
        if ((state[field] ?? 0) !== (previous.state[field] ?? 0)) void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
    revisions.current = { client: queryClient, state };
  }, [state, connected, queryClient]);

  useInterfaceSize(tvPresentation, state?.appearance);
  const tv = useTvPresentation({ enabled: tvPresentation && !nativeHost, presentationId: state?.presentationId, playbackId: state?.player.playbackId ?? null, phase: state?.player.status });
  useIdleCursor(tvPresentation);
  useNavigation(() => {
    if (tvPresentation && !nativeHost && tv.dismissLayer()) return;
    backHandler.current();
  });

  useEffect(() => {
    if (!localHost || !credentials) return;
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

  const currentCredentials = useRef(credentials);
  const commandAttempt = useRef(0);
  const currentState = useRef(state);
  const undoPlanRef = useRef<{ plan: UndoPlan } | { undo: () => Promise<void> } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoNotice, setUndoNotice] = useState<{ id: number; text: string } | null>(null);
  currentCredentials.current = credentials;
  currentState.current = state;

  const dismissUndo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    undoPlanRef.current = null;
    setUndoNotice(null);
  };
  useEffect(() => { dismissUndo(); return () => { if (undoTimer.current) clearTimeout(undoTimer.current); }; }, [credentials?.origin, credentials?.token, credentials?.installationId]);

  const undoAction = async () => {
    const pending = undoPlanRef.current;
    dismissUndo();
    if (!pending || !credentials || credentials !== currentCredentials.current) return;
    setError(null);
    try { if ("plan" in pending) await applyUndo(pending.plan, command, () => currentState.current); else await pending.undo(); }
    catch (reason) { if (credentials === currentCredentials.current) setError(errorText(reason)); }
  };

  const offerUndo = (text: string, undo: () => Promise<void>, duration = 6_000) => {
    dismissUndo();
    const id = ++commandAttempt.current;
    undoPlanRef.current = { undo };
    setUndoNotice({ id, text });
    undoTimer.current = setTimeout(dismissUndo, duration);
  };

  const run = async (action: Action) => {
    if (credentials !== currentCredentials.current) return false;
    const before = currentState.current;
    dismissUndo();
    const attempt = ++commandAttempt.current;
    setError(null);
    try {
      await command(action);
      if (before && credentials === currentCredentials.current && attempt === commandAttempt.current) {
        const undoable = action.type === "remove" || !!before.currentEntryId && (action.type === "stop" || action.type === "play" && action.entryId !== before.currentEntryId || "playNow" in action && action.playNow);
        let plan = undoable && currentState.current && undoPlan(action, before, currentState.current);
        for (let tries = 0; undoable && !plan && tries < 20 && credentials === currentCredentials.current && attempt === commandAttempt.current; tries++) {
          await new Promise(resolve => setTimeout(resolve, 25));
          plan = currentState.current && undoPlan(action, before, currentState.current);
        }
        if (plan && credentials === currentCredentials.current && attempt === commandAttempt.current) {
          undoPlanRef.current = { plan };
          setUndoNotice({ id: attempt, text: plan.text });
          undoTimer.current = setTimeout(dismissUndo, 8_000);
        }
      }
      return credentials === currentCredentials.current;
    } catch (reason) {
      if (credentials === currentCredentials.current && attempt === commandAttempt.current) setError(errorText(reason));
      return false;
    }
  };

  const pair = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    pairingOperation.current?.abort();
    const operation = new AbortController();
    pairingOperation.current = operation;
    const current = () => pairingOperation.current === operation && !operation.signal.aborted && credentials === currentCredentials.current;
    setPairing(true);
    setError(null);
    try {
      const origin = credentials?.origin ?? selectedOrigin ?? location.origin;
      const response = await fetch(`${origin}/api/pair`, {
        method: "POST",
        signal: AbortSignal.any([operation.signal, AbortSignal.timeout(8_000)]),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairingCode.trim(), name: remoteName.trim() }),
      });
      const result = await response.json() as { token?: string; installationId?: string; error?: string };
      if (!current()) return;
      if (!response.ok || !result.token || !result.installationId) throw new Error(response.status === 401 ? "That code is no longer valid. Scan the QR again or enter the code currently shown on the playback computer." : result.error || "Could not pair with the player.");
      try {
        if (selectedOrigin) localStorage.setItem(pairingKey(origin), JSON.stringify({ token: result.token, installationId: result.installationId }));
        else { localStorage.setItem(tokenKey, result.token); localStorage.setItem(installationKey, result.installationId); }
      } catch { /* Pairing still works for this tab. */ }
      setCredentials({ origin, token: result.token, installationId: result.installationId });
      setPairingCode("");
    } catch (reason) {
      if (current()) setError(`${errorText(reason)} Check that your device and playback computer are on the same network, then try Connect again.`);
    } finally {
      if (pairingOperation.current === operation) { pairingOperation.current = null; setPairing(false); }
    }
  };

  const unpair = () => {
    try {
      if (selectedOrigin) localStorage.removeItem(pairingKey(selectedOrigin));
      else { localStorage.removeItem(tokenKey); localStorage.removeItem(installationKey); localStorage.removeItem("modern-kodi.remote-token"); }
    } catch { /* Storage may be disabled. */ }
    setCredentials(null);
    setError(null);
  };

  const value: SessionGateValue = {
    queryClient, nativeHost, localHost, tvPresentation, credentials, setCredentials, host, retryHost: () => setHostAttempt(attempt => attempt + 1), booting, error, setError, command,
    state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, undoNotice, undoAction, dismissUndo, offerUndo, reconnect, pair, unpair,
    pairing, pairingCode, setPairingCode, remoteName, setRemoteName, videoQualityPreference, remoteControlEnabled, setRemoteControlEnabled,
    tv, registerBackHandler: handler => { backHandler.current = handler; },
  };
  return <SessionGateContext.Provider value={value}><QueryClientProvider key={cache.id} client={queryClient}>{children}</QueryClientProvider></SessionGateContext.Provider>;
}
