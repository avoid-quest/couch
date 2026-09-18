import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Action, ConnectionInfo, NavigationKey } from "../../shared/protocol";
import { loadedBuild } from "../../shared/build";
import { applyTvNavigation, useNavigation } from "../navigation";
import { isNativeHost } from "./native-context";
import { pairingCodeFromHash } from "./pairing-link";
import { useSession, type Credentials } from "./session";
import { useIdleCursor } from "../useIdleCursor";
import { useInterfaceSize } from "../interface-size";
import { useTvPresentation } from "../useTvPresentation";
import { useUpdateActivity } from "../update-activity";
import { useVideoQualityPreference } from "../video-quality";

const tokenKey = "couch.remote-token";
const installationKey = "couch.remote-installation-id";
const remoteNameKey = "couch.remote-name";
const nativeHost = isNativeHost();

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

function storedRemoteName() {
  try { return localStorage.getItem(remoteNameKey) || "My remote"; } catch { return "My remote"; }
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type SessionBag = ReturnType<typeof useSession>;

type SessionGateValue = SessionBag & {
  nativeHost: boolean;
  credentials: Credentials | null;
  setCredentials: (credentials: Credentials | null) => void;
  host: ConnectionInfo | null;
  retryHost: () => void;
  booting: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  run: (action: Action) => Promise<boolean>;
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

export function SessionGate({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = useState<Credentials | null>(storedCredentials);
  const [host, setHost] = useState<ConnectionInfo | null>(null);
  const [hostAttempt, setHostAttempt] = useState(0);
  const [booting, setBooting] = useState(nativeHost);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState(() => nativeHost ? "" : pairingCodeFromHash(location.hash));
  const [remoteName, setRemoteName] = useState(storedRemoteName);
  const [pairing, setPairing] = useState(false);
  const [remoteControlEnabled, setRemoteControlEnabled] = useState(false);
  const backHandler = useRef<() => void>(() => {});
  const videoQualityPreference = useVideoQualityPreference();

  useEffect(() => { if (!nativeHost && pairingCodeFromHash(location.hash)) history.replaceState(history.state, "", location.pathname + location.search); }, []);
  useEffect(() => { try { localStorage.setItem(remoteNameKey, remoteName); } catch { /* Pairing still works without remembering the name. */ } }, [remoteName]);

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

  const { state, status, details, identity, playerStatus, pairingRequired, reachable, connected, command, reconnect } = useSession(credentials, handleNavigation);
  useUpdateActivity(credentials, connected);
  useEffect(() => setRemoteControlEnabled(details?.remoteControlEnabled === true), [details?.remoteControlEnabled]);

  // Socket events replace the old version-prop drilling: when the server
  // bumps a revision, the matching Query cache is invalidated and readers
  // refetch. Sections opt in by reading through api/ queryOptions instead of
  // receiving version props.
  const revisions = useRef({ library: 0, radio: 0, iptv: 0, recordings: 0, provider: 0, jellyfin: 0, playlist: 0, forLater: 0, controller: 0 });
  useEffect(() => {
    if (!state) return;
    const changed = (current: number | undefined, previous: number) => current !== undefined && current !== previous;
    const invalidate = (key: string[]) => { void queryClient.invalidateQueries({ queryKey: key }); };
    if (changed(state.libraryVersion, revisions.current.library)) invalidate(["library"]);
    if (changed(state.radioVersion, revisions.current.radio)) invalidate(["radio"]);
    if (changed(state.iptvVersion, revisions.current.iptv)) invalidate(["iptv"]);
    if (changed(state.recordingsVersion, revisions.current.recordings)) invalidate(["recordings"]);
    if (changed(state.providerVersion, revisions.current.provider)) invalidate(["providers"]);
    if (changed(state.jellyfinVersion, revisions.current.jellyfin)) invalidate(["jellyfin"]);
    if (changed(state.playlistVersion, revisions.current.playlist)) invalidate(["playlists"]);
    if (changed(state.forLaterVersion, revisions.current.forLater)) invalidate(["for-later"]);
    if (changed(state.controllerVersion, revisions.current.controller)) invalidate(["controllers"]);
    revisions.current = { library: state.libraryVersion ?? 0, radio: state.radioVersion ?? 0, iptv: state.iptvVersion ?? 0, recordings: state.recordingsVersion ?? 0, provider: state.providerVersion ?? 0, jellyfin: state.jellyfinVersion ?? 0, playlist: state.playlistVersion ?? 0, forLater: state.forLaterVersion ?? 0, controller: state.controllerVersion ?? 0 };
  }, [state, queryClient]);

  useInterfaceSize(nativeHost, state?.appearance);
  const tv = useTvPresentation({ enabled: nativeHost, presentationId: state?.presentationId, playbackId: state?.player.playbackId ?? null, phase: state?.player.status });
  useIdleCursor(nativeHost);
  useNavigation(() => {
    if (nativeHost && tv.dismissLayer()) return;
    backHandler.current();
  });

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

  const currentCredentials = useRef(credentials);
  const commandAttempt = useRef(0);
  currentCredentials.current = credentials;

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

  const pair = async (event: { preventDefault: () => void }) => {
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

  const value: SessionGateValue = {
    nativeHost, credentials, setCredentials, host, retryHost: () => setHostAttempt(attempt => attempt + 1), booting, error, setError, command,
    state, status, details, identity, playerStatus, pairingRequired, reachable, connected, run, reconnect, pair, unpair,
    pairing, pairingCode, setPairingCode, remoteName, setRemoteName, videoQualityPreference, remoteControlEnabled, setRemoteControlEnabled,
    tv, registerBackHandler: handler => { backHandler.current = handler; },
  };
  return <SessionGateContext.Provider value={value}>{children}</SessionGateContext.Provider>;
}
