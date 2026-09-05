import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, ClientMessage, NavigationKey, ServerMessage, SessionState } from "../shared/protocol";

export type Credentials = { origin: string; token: string };
export type ConnectionStatus = "connecting" | "syncing" | "connected" | "reconnecting";
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

// getRandomValues also works on the plain HTTP origins used by LAN remotes.
export function createId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useSession(credentials: Credentials | null, onNavigation?: (key: NavigationKey) => void) {
  const navigation = useRef(onNavigation);
  navigation.current = onNavigation;
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socket = useRef<WebSocket | null>(null);
  const ready = useRef(false);
  const pending = useRef(new Map<string, Pending>());

  useEffect(() => {
    setState(null);
    ready.current = false;
    if (!credentials) return;
    let disposed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let handshake: ReturnType<typeof setTimeout> | undefined;

    const rejectPending = () => {
      for (const request of pending.current.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Connection lost. Check the current state before retrying."));
      }
      pending.current.clear();
    };

    const connect = () => {
      if (disposed) return;
      setStatus(attempt ? "reconnecting" : "connecting");
      const url = new URL("/api/ws", credentials.origin);
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
      connection.onclose = () => {
        if (!isCurrent()) return;
        clearTimeout(handshake);
        ready.current = false;
        rejectPending();
        setStatus("reconnecting");
        retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, 8_000));
      };
    };

    connect();
    return () => {
      disposed = true;
      ready.current = false;
      clearTimeout(retry);
      clearTimeout(handshake);
      rejectPending();
      socket.current?.close();
      socket.current = null;
    };
  }, [credentials?.origin, credentials?.token]);

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
      }, 8_000);
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

  return { state, status, connected: status === "connected" && !!credentials, command };
}
