import { buildKey, loadedBuild } from "../../shared/build";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Action, ClientMessage, NavigationKey, ServerMessage, SessionState } from "../../shared/protocol";
import type { ConnectionDetails, ControllerIdentity } from "../../shared/controllers";
import { knownConnection, rememberConnection } from "./connection";

export type Credentials = { origin: string; token: string; installationId?: string };
export type ConnectionStatus = "connecting" | "syncing" | "connected" | "reconnecting" | "server-unavailable" | "pairing-required" | "connection-rejected" | "build-mismatch";
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

// getRandomValues also works on the plain HTTP origins used by LAN remotes.
export function createId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useSession(credentials: Credentials | null, onNavigation?: (key: NavigationKey) => void) {
  const navigate = useEffectEvent((key: NavigationKey) => onNavigation?.(key));
  const [connectionDetails, setConnectionDetails] = useState(knownConnection);
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
  const [credentialRejected, setCredentialRejected] = useState(false);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socket = useRef<WebSocket | null>(null);
  const ready = useRef(false);
  const pending = useRef(new Map<string, Pending>());
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    setState(null);
    setIdentity(null);
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
        request.reject(new Error("Connection lost. Check the current state before retrying."));
      }
      pending.current.clear();
    };

    const retryLater = () => { retry = setTimeout(() => void connect(), Math.min(500 * 2 ** attempt++, 8_000)); };
    const pairingRequired = () => { authenticate = false; ready.current = false; setState(null); setIdentity(null); setCredentialRejected(true); setStatus("pairing-required"); rejectPending(); void connect(); };
    const connect = async () => {
      if (disposed) return;
      if (authenticate) setStatus(attempt ? "reconnecting" : "connecting");
      // A remembered pairing belongs to this origin. Advertised aliases are
      // address guidance, not permission to send a credential elsewhere.
      const origin = credentials?.origin ?? location.origin;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]);
        const response = await fetch(`${origin}/api/connection`, { signal });
        if (!response.ok) throw new Error("Server unavailable");
        const next = await response.json() as ConnectionDetails;
        if (disposed) return;
        setConnectionDetails({ origin, details: next });
        if (authenticate && credentials?.installationId && next.installationId !== credentials.installationId) { pairingRequired(); return; }
        if (authenticate && credentials) {
          const asset = buildKey(loadedBuild);
          if (asset) {
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
      if (asset) url.searchParams.set("build", asset);
      const connection = new WebSocket(url);
      socket.current = connection;
      const isCurrent = () => !disposed && socket.current === connection;
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
          clearTimeout(handshake);
          attempt = 0;
          ready.current = true;
          setState(message.state);
          setStatus("connected");
        } else if (message.type === "navigation") {
          navigate(message.key);
        } else if (message.type === "result") {
          const request = pending.current.get(message.requestId);
          if (!request) return;
          clearTimeout(request.timer);
          pending.current.delete(message.requestId);
          if (message.ok) request.resolve();
          else request.reject(new Error(message.error || "The player could not complete this command."));
        }
      };
      connection.onerror = () => connection.close();
      connection.onclose = event => {
        if (!isCurrent()) return;
        clearTimeout(handshake);
        ready.current = false;
        rejectPending();
        if (event.code === 4001) { pairingRequired(); return; }
        setStatus("reconnecting");
        retryLater();
      };
    };

    void connect();
    return () => {
      disposed = true;
      controller.abort();
      ready.current = false;
      clearTimeout(retry);
      clearTimeout(handshake);
      rejectPending();
      socket.current?.close();
      socket.current = null;
    };
  }, [credentials?.origin, credentials?.token, credentials?.installationId, reconnectAttempt]);

  const origin = credentials?.origin ?? location.origin;
  const publicDetails = connectionDetails?.origin === origin ? connectionDetails.details : null;
  const installationName = state?.installationName;
  const player = state?.player.status;
  const details = useMemo(() => publicDetails ? { ...publicDetails, name: installationName ?? publicDetails.name, player: player ?? publicDetails.player } : null, [publicDetails, installationName, player]);

  useEffect(() => {
    if (details) rememberConnection(origin, details);
  }, [origin, details]);

  useEffect(() => {
    if (status !== "connected" || !credentials) return;
    const controller = new AbortController();
    void fetch(`${credentials.origin}/api/controllers/me`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: controller.signal }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.status === 401) { socket.current?.close(4001, "Pair again"); return; }
      if (!response.ok) return;
      const caller = await response.json() as ControllerIdentity;
      if (!controller.signal.aborted) setIdentity(caller);
    }).catch(() => {});
    return () => controller.abort();
  }, [credentials?.origin, credentials?.token, credentials?.installationId, status, state?.controllerVersion]);

  const reconnect = useCallback(() => {
    ready.current = false;
    setStatus("reconnecting");
    setReconnectAttempt(attempt => attempt + 1);
  }, []);

  const command = useCallback((action: Action) => {
    const connection = socket.current;
    if (!ready.current || connection?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Wait for the player to reconnect before using controls."));
    }
    return new Promise<void>((resolve, reject) => {
      const requestId = createId();
      const timer = setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("No confirmation received. Check the current state before retrying."));
      }, (action.type === "enqueueProviderAlbum" || action.type === "enqueueProviderPlaylist" || (action.type === "enqueueProvider" && action.shape === "playlist") || action.type === "videoQuality") ? 35_000 : 8_000);
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
  }, []);

  return { state, status, details, identity, playerStatus: status === "connected" ? state?.player.status : status === "pairing-required" ? publicDetails?.player : undefined, pairingRequired: !credentials || credentialRejected, reachable: status === "connected" || status === "pairing-required" || status === "connection-rejected", connected: status === "connected" && !!credentials, command, reconnect };
}
