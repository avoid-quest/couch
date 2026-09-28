import { buildKey, loadedBuild } from "../../shared/build";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Action, ClientMessage, NavigationKey, ServerMessage, SessionState } from "../../shared/protocol";
import type { ConnectionDetails, ControllerIdentity } from "../../shared/controllers";
import { emptyPlaybackClock, type PlaybackClock } from "./playback-clock";
import { knownConnection, rememberConnection } from "./connection";

export type ClientPlayerState = Omit<SessionState["player"], "position" | "duration">;
export type ClientSessionState = Omit<SessionState, "player"> & { player: ClientPlayerState };

export type Credentials = { origin: string; token: string; installationId?: string };
export type ConnectionStatus = "connecting" | "syncing" | "connected" | "reconnecting" | "server-unavailable" | "pairing-required" | "sharing-disabled" | "connection-rejected" | "build-mismatch" | "protocol-mismatch";
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const sameCredentials = (a: Credentials | null, b: Credentials | null) => a?.origin === b?.origin && a?.token === b?.token && a?.installationId === b?.installationId;

// getRandomValues also works on the plain HTTP origins used by LAN remotes.
export function createId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useSession(credentials: Credentials | null, onNavigation?: (key: NavigationKey) => void, selectedOrigin?: string, desktopProtocol?: number) {
  const navigate = useEffectEvent((key: NavigationKey) => onNavigation?.(key));
  const [connectionDetails, setConnectionDetails] = useState(knownConnection);
  const [owner, setOwner] = useState(credentials);
  const currentCredentials = useRef(credentials);
  currentCredentials.current = credentials;
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
  const [credentialRejected, setCredentialRejected] = useState(false);
  const [state, setState] = useState<ClientSessionState | null>(null);
  const observation = useRef<SessionState | null>(null);
  const [clock, setClock] = useState<PlaybackClock>(emptyPlaybackClock);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socket = useRef<WebSocket | null>(null);
  const socketCredentials = useRef<Credentials | null>(null);
  const ready = useRef(false);
  const pending = useRef(new Map<string, Pending>());
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    setState(null);
    observation.current = null;
    setClock(emptyPlaybackClock);
    // Rechecking the same connection does not discard its browsing cache.
    // Replacement credentials must not expose the old identity while effects run.
    if (!sameCredentials(owner, credentials)) setIdentity(null);
    setOwner(credentials);
    setCredentialRejected(false);
    ready.current = false;
    let disposed = false;
    const controller = new AbortController();
    let attempt = 0;
    let authenticate = !!credentials;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let handshake: ReturnType<typeof setTimeout> | undefined;

    const rejectPending = () => {
      for (const request of pending.current.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Connection lost. Try again."));
      }
      pending.current.clear();
    };

    const retryLater = () => { retry = setTimeout(() => void connect(), Math.min(500 * 2 ** attempt++, 8_000)); };
    const pairingRequired = () => { authenticate = false; ready.current = false; observation.current = null; setClock(emptyPlaybackClock); setState(null); setIdentity(null); setCredentialRejected(true); setStatus("pairing-required"); rejectPending(); void connect(); };
    const connect = async () => {
      if (disposed) return;
      clearTimeout(retry);
      retry = undefined;
      if (authenticate) setStatus(attempt ? "reconnecting" : "connecting");
      // A remembered pairing belongs to this origin. Advertised aliases are
      // address guidance, not permission to send a credential elsewhere.
      const origin = credentials?.origin ?? selectedOrigin ?? location.origin;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]);
        const response = await fetch(`${origin}/api/connection`, { signal, redirect: "error" });
        if (!response.ok) throw new Error("Server unavailable");
        const next = await response.json() as ConnectionDetails;
        if (disposed) return;
        setConnectionDetails({ origin, details: next });
        if (desktopProtocol && next.desktopClientProtocol !== desktopProtocol) { setStatus("protocol-mismatch"); setState(null); setIdentity(null); return; }
        if (desktopProtocol && next.remoteControlEnabled === false) { setStatus("sharing-disabled"); setState(null); setIdentity(null); retry = setTimeout(() => void connect(), 5_000); return; }
        if (authenticate && credentials?.installationId && next.installationId !== credentials.installationId) { pairingRequired(); return; }
        if (authenticate && credentials) {
          const asset = buildKey(loadedBuild);
          if (asset && !desktopProtocol) {
            const response = await fetch(`${origin}/api/build`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal });
            if (disposed) return;
            if (response.status === 401) { pairingRequired(); return; }
            if (response.status === 403) { setStatus("connection-rejected"); return; }
            if (!response.ok) throw new Error("Server unavailable");
            const current = buildKey(await response.json());
            if (disposed) return;
            if (current !== asset) {
              setStatus("build-mismatch");
              try {
                const key = `couch.asset-refresh:${origin}`;
                if (current && sessionStorage.getItem(key) !== current) {
                  sessionStorage.setItem(key, current);
                  location.reload();
                }
              } catch { /* Keep the refresh prompt when browser storage is unavailable. */ }
              return;
            }
            try { sessionStorage.removeItem(`couch.asset-refresh:${origin}`); } catch { /* Storage is optional after the build matches. */ }
          }
          const response = await fetch(`${origin}/api/controllers/me`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal });
          if (disposed) return;
          if (response.status === 401) { pairingRequired(); return; }
          if (response.status === 403) { setStatus("connection-rejected"); return; }
          if (!response.ok) throw new Error("Server unavailable");
          const caller = await response.json() as ControllerIdentity;
          if (disposed) return;
          setIdentity(caller);
          setCredentialRejected(false);
        }
      } catch {
        if (!disposed) { setStatus("server-unavailable"); retryLater(); }
        return;
      }
      if (!authenticate || !credentials) { setStatus("pairing-required"); attempt = 0; retry = setTimeout(() => void connect(), 5_000); return; }
      const url = new URL("/api/ws", origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("token", credentials.token);
      const asset = buildKey(loadedBuild);
      if (asset && !desktopProtocol) url.searchParams.set("build", asset);
      if (desktopProtocol) url.searchParams.set("clientProtocol", String(desktopProtocol));
      const connection = new WebSocket(url);
      let baseline = false;
      socket.current = connection;
      socketCredentials.current = credentials;
      const isCurrent = () => !disposed && socket.current === connection && sameCredentials(credentials, currentCredentials.current);
      handshake = setTimeout(() => connection.close(), 8_000);

      connection.onopen = () => {
        if (isCurrent()) setStatus("syncing");
      };
      connection.onmessage = (event: MessageEvent<string>) => {
        if (!isCurrent()) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          connection.close(4002, "Invalid response");
          return;
        }
        if (message.type === "state") {
          baseline = true;
          clearTimeout(handshake);
          attempt = 0;
          ready.current = true;
          observation.current = message.state;
          const { position, duration, ...player } = message.state.player;
          setState({ ...message.state, player });
          setClock({ playbackId: player.playbackId, position, duration });
          setStatus("connected");
        } else if (message.type === "clock") {
          if (!(message.playbackId === null || typeof message.playbackId === "string")
            || typeof message.position !== "number" || !Number.isFinite(message.position)
            || !(message.duration === null || typeof message.duration === "number" && Number.isFinite(message.duration))) {
            connection.close(4002, "Invalid response");
            return;
          }
          if (!baseline) return;
          const previous = observation.current;
          if (previous?.player.playbackId !== message.playbackId) return;
          observation.current = { ...previous, player: { ...previous.player, position: message.position, duration: message.duration } };
          setClock({ playbackId: message.playbackId, position: message.position, duration: message.duration });
        } else if (message.type === "navigation") {
          navigate(message.key);
        } else if (message.type === "result") {
          const request = pending.current.get(message.requestId);
          if (!request) return;
          clearTimeout(request.timer);
          pending.current.delete(message.requestId);
          if (message.ok) request.resolve();
          else request.reject(new Error(message.error || "Couch couldn't do that."));
        }
      };
      connection.onerror = () => connection.close();
      connection.onclose = event => {
        if (!isCurrent()) return;
        // Retire the socket now, not only on effect cleanup or replacement.
        // Captured callbacks from a closed/revoked connection must stay stale.
        socket.current = null;
        socketCredentials.current = null;
        clearTimeout(handshake);
        ready.current = false;
        observation.current = null;
        setClock(emptyPlaybackClock);
        rejectPending();
        if (event.code === 4001) { pairingRequired(); return; }
        setStatus("reconnecting");
        retryLater();
      };
    };

    const wake = (event: Event) => {
      // Only advance a queued disconnected retry. Closing a healthy socket also
      // cancels its Controller's Bluetooth operation and pending commands.
      if (disposed || !authenticate || !credentials || !sameCredentials(credentials, currentCredentials.current) || retry === undefined || document.visibilityState !== "visible") return;
      if (event.type === "pageshow" && !(event as PageTransitionEvent).persisted) return;
      void connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("online", wake);
    void connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
      controller.abort();
      ready.current = false;
      clearTimeout(retry);
      clearTimeout(handshake);
      rejectPending();
      socket.current?.close();
      socket.current = null;
      socketCredentials.current = null;
    };
  }, [credentials?.origin, credentials?.token, credentials?.installationId, selectedOrigin, desktopProtocol, reconnectAttempt]);

  const current = sameCredentials(owner, credentials);
  const snapshot = current ? state : null;
  const connectionStatus: ConnectionStatus = current ? status : credentials ? "connecting" : "pairing-required";
  const origin = credentials?.origin ?? selectedOrigin ?? location.origin;
  const publicDetails = connectionDetails?.origin === origin ? connectionDetails.details : null;
  const installationName = snapshot?.installationName;
  const player = snapshot?.player.status;
  const details = useMemo(() => publicDetails ? { ...publicDetails, name: installationName ?? publicDetails.name, player: player ?? publicDetails.player } : null, [publicDetails, installationName, player]);

  useEffect(() => {
    if (credentials && details) rememberConnection(origin, details);
  }, [origin, details, !!credentials]);

  useEffect(() => {
    // A new origin/installation must pass public discovery before sending its
    // credential, even in the render between replacement and effect cleanup.
    if (!current || status !== "connected" || !credentials) return;
    const controller = new AbortController();
    void (async () => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]);
      const discovery = await fetch(`${credentials.origin}/api/connection`, { signal, redirect: "error" });
      if (!discovery.ok) return;
      const next = await discovery.json() as ConnectionDetails;
      if (controller.signal.aborted || !sameCredentials(credentials, currentCredentials.current)) return;
      setConnectionDetails({ origin: credentials.origin, details: next });
      if (credentials.installationId && next.installationId !== credentials.installationId) { socket.current?.close(4001, "Pair again"); return; }
      const response = await fetch(`${credentials.origin}/api/controllers/me`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal });
      if (controller.signal.aborted) return;
      if (response.status === 401) { socket.current?.close(4001, "Pair again"); return; }
      if (!response.ok) return;
      const caller = await response.json() as ControllerIdentity;
      if (!controller.signal.aborted && sameCredentials(credentials, currentCredentials.current)) setIdentity(caller);
    })().catch(() => {});
    return () => controller.abort();
  }, [credentials?.origin, credentials?.token, credentials?.installationId, current, status, state?.versions?.controllers]);

  // Command/Undo readers see observations synchronously, before React commits a tick.
  const readObservation = useCallback(() => sameCredentials(credentials, currentCredentials.current) && sameCredentials(credentials, socketCredentials.current) && ready.current ? observation.current : null, [credentials?.origin, credentials?.token, credentials?.installationId]);

  const reconnect = useCallback(() => {
    ready.current = false;
    setStatus("reconnecting");
    setReconnectAttempt(attempt => attempt + 1);
  }, []);

  const command = useCallback((action: Action) => {
    const connection = socket.current;
    if (!sameCredentials(credentials, currentCredentials.current) || !sameCredentials(credentials, socketCredentials.current) || !ready.current || connection?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Reconnecting. Try again in a moment."));
    }
    return new Promise<void>((resolve, reject) => {
      const requestId = createId();
      const timer = setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("No reply from Couch. Check before retrying."));
      }, ((action.type === "enqueueProvider" && action.shape === "playlist") || action.type === "videoQuality") ? 35_000 : 8_000);
      pending.current.set(requestId, { resolve, reject, timer });
      const message: ClientMessage = { type: "command", requestId, action };
      try {
        connection.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        pending.current.delete(requestId);
        reject(error);
      }
    });
  }, [credentials?.origin, credentials?.token, credentials?.installationId]);

  return { clock: current && connectionStatus === "connected" ? clock : emptyPlaybackClock, readObservation, state: snapshot, status: connectionStatus, details, identity: current ? identity : null, playerStatus: connectionStatus === "connected" ? snapshot?.player.status : connectionStatus === "pairing-required" ? publicDetails?.player : undefined, pairingRequired: !credentials || current && credentialRejected, reachable: connectionStatus === "connected" || connectionStatus === "pairing-required" || connectionStatus === "sharing-disabled" || connectionStatus === "connection-rejected", connected: connectionStatus === "connected" && !!credentials, command, reconnect };
}
