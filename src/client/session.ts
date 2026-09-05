import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, ClientMessage, NavigationKey, ServerMessage, SessionState } from "../shared/protocol";
import type { ConnectionDetails, ControllerIdentity } from "../shared/controllers";
import { knownConnection, rememberConnection } from "./connection";

export type Credentials = { origin: string; token: string };
export type ConnectionStatus = "connecting" | "syncing" | "connected" | "reconnecting" | "server-unavailable" | "pairing-required" | "connection-rejected";
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

// getRandomValues also works on the plain HTTP origins used by LAN remotes.
export function createId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useSession(credentials: Credentials | null, onNavigation?: (key: NavigationKey) => void, onOrigin?: (origin: string) => void) {
  const navigation = useRef(onNavigation);
  navigation.current = onNavigation;
  const changeOrigin = useRef(onOrigin);
  changeOrigin.current = onOrigin;
  const [details, setDetails] = useState<ConnectionDetails | null>(() => knownConnection()?.details ?? null);
  const [publicPlayer, setPublicPlayer] = useState<ConnectionDetails["player"]>();
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
    setPublicPlayer(undefined);
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
    const pairingRequired = () => { authenticate = false; ready.current = false; setState(null); setPublicPlayer(undefined); setIdentity(null); setCredentialRejected(true); setStatus("pairing-required"); rejectPending(); void connect(); };
    const connect = async () => {
      if (disposed) return;
      if (authenticate) setStatus(attempt ? "reconnecting" : "connecting");
      const cached = knownConnection();
      const origins = [...new Set([credentials?.origin ?? cached?.origin ?? location.origin, ...(credentials && !changeOrigin.current ? [] : cached?.details.urls ?? [])])];
      let origin: string | undefined;
      for (const candidate of origins) {
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]);
          if (authenticate && credentials) {
            const response = await fetch(`${candidate}/api/controllers/me`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal });
            if (disposed) return;
            if (response.status === 401) { pairingRequired(); return; }
            if (response.status === 403) { setStatus("connection-rejected"); return; }
            if (!response.ok) throw new Error("Server unavailable");
            const caller = await response.json() as ControllerIdentity;
            if (disposed) return;
            setIdentity(caller);
            setCredentialRejected(false);
          }
          const response = await fetch(`${candidate}/api/connection`, { signal });
          if (!response.ok) throw new Error("Server unavailable");
          const next = await response.json() as ConnectionDetails;
          if (disposed) return;
          setDetails(next);
          setPublicPlayer(next.player);
          rememberConnection(candidate, next);
          origin = candidate;
          break;
        } catch { if (disposed) return; }
      }
      if (!origin) { setStatus("server-unavailable"); retryLater(); return; }
      if (!authenticate || !credentials) { setStatus("pairing-required"); attempt = 0; retry = setTimeout(() => void connect(), 5_000); return; }
      if (origin !== credentials.origin && changeOrigin.current) { changeOrigin.current(origin); return; }
      const url = new URL("/api/ws", origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("token", credentials.token);
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
          navigation.current?.(message.key);
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
  }, [credentials?.origin, credentials?.token, reconnectAttempt]);

  useEffect(() => { setIdentity(null); setCredentialRejected(false); }, [credentials?.token]);

  useEffect(() => {
    if (!state || !details || !credentials) return;
    const next = { ...details, name: state.installationName ?? details.name, player: state.player.status };
    setDetails(next);
    rememberConnection(credentials.origin, next);
  }, [state?.installationName, state?.player.status, credentials?.origin]);

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
  }, [credentials?.origin, credentials?.token, status, state?.controllerVersion]);

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
      }, action.type === "enqueueProviderAlbum" ? 35_000 : 8_000);
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

  return { state, status, details, identity, playerStatus: status === "connected" ? state?.player.status : status === "pairing-required" ? publicPlayer : undefined, pairingRequired: !credentials || credentialRejected, reachable: status === "connected" || status === "pairing-required" || status === "connection-rejected", connected: status === "connected" && !!credentials, command, reconnect };
}
