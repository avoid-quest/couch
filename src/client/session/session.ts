import { dismissPlaybackFeedback, failed, notice } from "../toasts";
import { buildKey, loadedBuild } from "../../shared/build";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Action, ClientMessage, NavigationKey, PlayerMessage, ServerMessage, SessionState } from "../../shared/protocol";
import type { ConnectionDetails, DeviceIdentity } from "../../shared/devices";
import { emptyPlaybackClock, type PlaybackClock } from "./playback-clock";
import { knownConnection, rememberConnection } from "./connection";
import { connectRenderer, play, playsVp9, waitForTap } from "./renderer";
import { createLiveListener, type ListenerState } from "./live-listener/listener";
import { readOutputBufferPreference } from "../audio-settings";
import { outputLatencyHint } from "../../shared/audio-settings";
import { listen } from "./sendspin";
import { deviceId, loadLocalDeviceSharing, localDeviceSharing, subscribeDeviceIdentity } from "./device-id";
import type { DeviceSharing } from "../../shared/device-sharing";
import { connectRemoteText } from "../remote-text";
import { couchApp } from "./native-context";
import { isTvPresentation } from "./presentation";
import { createLiveSession } from "./live";
import { replyDeadline } from "./reply-deadline";
import type { LiveSelection, LiveVideoQuality } from "../../shared/live-input";

export type ClientPlayerState = Omit<SessionState["player"], "position" | "duration">;
export type LiveReception = { sourceId: string; status: ListenerState; httpsAddress: string };
export type ClientSessionState = Omit<SessionState, "player"> & { player: ClientPlayerState; liveReception?: LiveReception };

export type Credentials = { origin: string; token: string; installationId?: string };
export type ConnectionStatus = "connecting" | "syncing" | "connected" | "reconnecting" | "server-unavailable" | "pairing-required" | "connection-rejected" | "build-mismatch";
type Pending = { resolve: () => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };
const sameCredentials = (a: Credentials | null, b: Credentials | null) => a?.origin === b?.origin && a?.token === b?.token && a?.installationId === b?.installationId;

// getRandomValues works in any context, secure or not.
export function createId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useSession(credentials: Credentials | null, onNavigation?: (key: NavigationKey) => void) {
  const navigate = useEffectEvent((key: NavigationKey) => onNavigation?.(key));
  const [connectionDetails, setConnectionDetails] = useState(knownConnection);
  const [owner, setOwner] = useState(credentials);
  const currentCredentials = useRef(credentials);
  currentCredentials.current = credentials;
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [credentialRejected, setCredentialRejected] = useState(false);
  const [state, setState] = useState<ClientSessionState | null>(null);
  const observation = useRef<SessionState | null>(null);
  const [liveReception, setLiveReception] = useState<LiveReception>();
  const [clock, setClock] = useState<PlaybackClock>(emptyPlaybackClock);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socket = useRef<WebSocket | null>(null);
  const socketCredentials = useRef<Credentials | null>(null);
  const ready = useRef(false);
  const pending = useRef(new Map<string, Pending>());
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const live = useRef<ReturnType<typeof createLiveSession> | null>(null);
  const [localLiveSourceId, setLocalLiveSourceId] = useState<string | null>(null);

  const command = useCallback((action: Action, targetDeviceId?: string) => {
    const connection = socket.current;
    if (!sameCredentials(credentials, currentCredentials.current) || !sameCredentials(credentials, socketCredentials.current) || !ready.current || connection?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Reconnecting. Try again in a moment."));
    }
    return new Promise<void>((resolve, reject) => {
      const requestId = createId();
      const deadline = replyDeadline(action);
      const timer = deadline === undefined ? undefined : setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("No reply from Couch. Check before retrying."));
      }, deadline);
      pending.current.set(requestId, { resolve, reject, timer });
      const message: ClientMessage = { type: "command", requestId, action, ...(targetDeviceId ? { targetDeviceId } : {}) };
      try {
        connection.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        pending.current.delete(requestId);
        reject(error);
      }
    });
  }, [credentials?.origin, credentials?.token, credentials?.installationId]);

  useEffect(() => {
    setLiveReception(undefined);
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
    let textInput: ReturnType<typeof connectRemoteText> | undefined;
    let stopRendering: (() => void) | undefined;
    let rendererStatus: SessionState["player"]["status"] = "idle";
    let syncedStatus: SessionState["player"]["status"] = "idle";
    let publishing = false;
    let listener: ReturnType<typeof createLiveListener> | undefined, listeningSource: string | null = null;
    const stopListener = (clear = true) => { const current = listener; listener = undefined; listeningSource = null; current?.stop(); if (clear) setLiveReception(undefined); };
    // The socket's URL carries the sharing it opened with; only a later change is sent.
    let advertised: DeviceSharing | undefined;
    const advertiseSharing = () => {
      const connection = socket.current, sharing = localDeviceSharing();
      if (connection?.readyState === WebSocket.OPEN && sameCredentials(credentials, socketCredentials.current) && (sharing.audio !== advertised?.audio || sharing.video !== advertised?.video)) {
        advertised = sharing;
        connection.send(JSON.stringify({ type: "command", requestId: createId(), action: { type: "sharing", sharing } } satisfies ClientMessage));
      }
    };
    const unsubscribeIdentity = subscribeDeviceIdentity(advertiseSharing);
    const reportPlayback = () => { void couchApp?.reportPlayback?.(publishing ? "playing" : ["loading", "playing", "paused"].includes(syncedStatus) ? syncedStatus : rendererStatus).catch(() => {}); };
    const stopPlayback = () => { textInput?.close(); textInput = undefined; live.current?.close(); live.current = null; publishing = false; setLocalLiveSourceId(null); stopRendering?.(); listen(false, false, "Couch"); rendererStatus = syncedStatus = "idle"; reportPlayback(); };

    const rejectPending = () => {
      for (const request of pending.current.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Connection lost. Try again."));
      }
      pending.current.clear();
    };

    const retryLater = () => { retry = setTimeout(() => void connect(), Math.min(500 * 2 ** attempt++, 8_000)); };
    const pairingRequired = () => { stopListener(); authenticate = false; ready.current = false; observation.current = null; setClock(emptyPlaybackClock); setState(null); setIdentity(null); setCredentialRejected(true); setStatus("pairing-required"); rejectPending(); void connect(); };
    const connect = async () => {
      if (disposed) return;
      clearTimeout(retry);
      retry = undefined;
      if (authenticate) setStatus(attempt ? "reconnecting" : "connecting");
      // A remembered pairing belongs to this origin. Advertised aliases are
      // address guidance, not permission to send a credential elsewhere.
      const origin = credentials?.origin ?? location.origin;
      let iceServers: RTCIceServer[] = [];
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]);
        const response = await fetch(`${origin}/api/connection`, { signal, redirect: "error" });
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
          const response = await fetch(`${origin}/api/devices/me`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal });
          if (disposed) return;
          if (response.status === 401) { pairingRequired(); return; }
          if (response.status === 403) { setStatus("connection-rejected"); return; }
          if (!response.ok) throw new Error("Server unavailable");
          const caller = await response.json() as DeviceIdentity;
          if (disposed) return;
          setIdentity(caller);
          setCredentialRejected(false);
          const ice = await fetch(`${origin}/api/live/ice-servers`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal, redirect: "error" });
          if (disposed) return;
          if (ice.status === 401) { pairingRequired(); return; }
          if (ice.status === 403) { setStatus("connection-rejected"); return; }
          if (!ice.ok) throw new Error("Server unavailable");
          iceServers = await ice.json() as RTCIceServer[];
        }
      } catch {
        if (!disposed) { setStatus("server-unavailable"); retryLater(); }
        return;
      }
      if (!authenticate || !credentials) { setStatus("pairing-required"); attempt = 0; retry = setTimeout(() => void connect(), 5_000); return; }
      await loadLocalDeviceSharing().catch(() => {});
      if (disposed) return;
      const url = new URL("/api/ws", origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("token", credentials.token);
      url.searchParams.set("device", deviceId());
      advertised = localDeviceSharing();
      for (const capability of ["audio", "video"] as const) if (advertised[capability]) url.searchParams.set(capability, "1");
      if (playsVp9) url.searchParams.set("vp9", "1");
      if (couchApp?.update) url.searchParams.set("updates", "1");
      if (isTvPresentation()) url.searchParams.set("tv", "1");
      const asset = buildKey(loadedBuild);
      if (asset) url.searchParams.set("build", asset);
      const connection = new WebSocket(url);
      let baseline = false;
      socket.current = connection;
      socketCredentials.current = credentials;
      const isCurrent = () => !disposed && socket.current === connection && sameCredentials(credentials, currentCredentials.current);
      handshake = setTimeout(() => connection.close(), 8_000);

      connection.onopen = () => {
        if (!isCurrent()) return;
        setStatus("syncing");
        advertiseSharing();
        if (isTvPresentation()) textInput = connectRemoteText(field => { if (isCurrent() && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "textFocus", field })); });
        stopRendering = connectRenderer(state => {
          rendererStatus = state.status; reportPlayback();
          if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "player", state } satisfies PlayerMessage));
        });
        const uploadUrl = (sourceId: string, key: string, uploadId?: string) => {
          const upload = new URL("/api/live/upload", origin);
          upload.protocol = upload.protocol === "https:" ? "wss:" : "ws:";
          upload.searchParams.set("sourceId", sourceId);
          upload.searchParams.set("token", credentials.token);
          upload.searchParams.set("key", key);
          if (uploadId) upload.searchParams.set("uploadId", uploadId);
          return upload.href;
        };
        live.current = createLiveSession({ iceServers, send: message => { if (isCurrent() && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(message)); }, command: action => command(action), upload: (sourceId, key) => new WebSocket(uploadUrl(sourceId, key)), uploadUrl, failed: error => { if (isCurrent()) failed(error.message); }, published: source => { if (isCurrent()) { publishing = !!source; setLocalLiveSourceId(source?.id ?? null); reportPlayback(); } } });
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
          // A result can precede its snapshot: retain confirmation for the destination it names.
          const previous = observation.current;
          // The first idle Queue creates a playback without replacing an item or destination.
          if (previous && (previous.controlling !== message.state.controlling || previous.playback !== null && previous.playback !== message.state.playback || previous.currentEntryId !== message.state.currentEntryId)) dismissPlaybackFeedback(message.state.controlling);
          // This notice precedes the snapshot that closes the receiver. React may batch the two states.
          const activity = message.state.activity;
          if (activity?.kind === "sharing-stopped" && activity.id !== previous?.activity?.id && activity.actor.deviceId !== deviceId()) notice(activity.text);
          baseline = true;
          clearTimeout(handshake);
          attempt = 0;
          ready.current = true;
          observation.current = message.state;
          live.current?.observe(message.state.liveSources ?? []);
          syncedStatus = message.state.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === deviceId() && output.sound))?.status ?? "idle";
          reportPlayback();
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
        } else if (message.type === "updates" && couchApp?.update) {
          const reply = (value: object) => { if (isCurrent() && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "updates", requestId: message.requestId, ...value })); };
          void couchApp.update(message.action).then(state => reply({ state }), (error: Error) => reply({ error: error.message }));
        } else if (message.type === "player") {
          if (!live.current?.play(message.command)) play(message.command);
        } else if (message.type === "livePeers" || message.type === "liveSignal" || message.type === "liveIceServers") {
          live.current?.receive(message);
        } else if (message.type === "sendspin") {
          listen(message.listen, message.watch, observation.current?.devices?.find(device => device.id === deviceId())?.name ?? "Couch");
        } else if (message.type === "live") {
          if (message.removed) {
            stopListener(false);
            setLiveReception({ sourceId: message.removed, status: { state: "removed", reason: "Removed by the host" }, httpsAddress: "" });
          } else if (!message.sourceId) {
            stopListener(false);
            setLiveReception(previous => previous?.status.state === "removed" ? previous : undefined);
          } else {
            if (listeningSource !== message.sourceId) {
              stopListener();
              const sourceId = listeningSource = message.sourceId;
              const url = new URL("/api/live/listen", origin);
              url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
              url.searchParams.set("token", credentials.token); url.searchParams.set("sourceId", sourceId);
              const https = new URL(origin); https.protocol = "https:";
              const current = listener = createLiveListener({ url: url.href, latencyHint: outputLatencyHint(readOutputBufferPreference(), observation.current?.playbacks?.find(playback => playback.liveSourceId === sourceId)?.liveListenerBufferFrames), waitForTap,
                onState: status => { if (listener === current) setLiveReception({ sourceId, status, httpsAddress: https.origin }); },
                onStats: () => {}, // The network Worker reports directly over its authorized Live socket.
              });
              current.volume(message.volume);
              void current.start();
            } else listener?.volume(message.volume);
          }
        } else if (message.type === "text") {
          void (textInput?.receive(message) ?? Promise.resolve(false)).then(ok => { if (isCurrent() && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "textResult", requestId: message.requestId, ok })); });
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
        stopPlayback();
        if (event.code === 4001) stopListener();
        else if (listeningSource) setLiveReception(previous => previous && { ...previous, status: { state: "reconnecting" } });
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
      unsubscribeIdentity();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
      controller.abort();
      ready.current = false;
      clearTimeout(retry);
      clearTimeout(handshake);
      rejectPending();
      stopListener();
      stopPlayback();
      socket.current?.close();
      socket.current = null;
      socketCredentials.current = null;
    };
  }, [credentials?.origin, credentials?.token, credentials?.installationId, reconnectAttempt]);

  const current = sameCredentials(owner, credentials);
  const snapshot = useMemo(() => current && state ? { ...state, ...liveReception ? { liveReception } : {} } : null, [current, state, liveReception]);
  const connectionStatus: ConnectionStatus = current ? status : credentials ? "connecting" : "pairing-required";
  const origin = credentials?.origin ?? location.origin;
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
      const response = await fetch(`${credentials.origin}/api/devices/me`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal });
      if (controller.signal.aborted) return;
      if (response.status === 401) { socket.current?.close(4001, "Pair again"); return; }
      if (!response.ok) return;
      const caller = await response.json() as DeviceIdentity;
      if (!controller.signal.aborted && sameCredentials(credentials, currentCredentials.current)) setIdentity(caller);
    })().catch(() => {});
    return () => controller.abort();
  }, [credentials?.origin, credentials?.token, credentials?.installationId, current, status, state?.versions?.devices]);

  // Command/Undo readers see observations synchronously, before React commits a tick.
  const readObservation = useCallback(() => sameCredentials(credentials, currentCredentials.current) && sameCredentials(credentials, socketCredentials.current) && ready.current ? observation.current : null, [credentials?.origin, credentials?.token, credentials?.installationId]);

  const reconnect = useCallback(() => {
    ready.current = false;
    setStatus("reconnecting");
    setReconnectAttempt(attempt => attempt + 1);
  }, []);

  const startLive = useCallback((selection: LiveSelection) => {
    if (!ready.current || !live.current) return Promise.reject(new Error("Reconnect before sharing a live input."));
    return live.current.start(selection);
  }, []);
  const liveAudioInputs = useCallback((native = false) => {
    if (!ready.current || !live.current) return Promise.reject(new Error("Reconnect before choosing an audio input."));
    return live.current.audioInputs(native);
  }, []);
  const endLive = useCallback(() => live.current?.end() ?? Promise.resolve(), []);
  // What this device shares, and what changes while it does (sections/share).
  const liveSharing = useMemo(() => ({
    current: () => live.current?.sharing() ?? null,
    setQuality: (quality: LiveVideoQuality) => live.current?.setQuality(quality) ?? Promise.resolve(),
    setMuted: (muted: boolean) => live.current?.setMuted(muted),
    setCaptureBuffer: (frames: 128 | 256 | 512 | 1024) => live.current?.setCaptureBuffer(frames) ?? Promise.resolve(),
    routes: () => live.current?.routes() ?? Promise.resolve({}),
  }), []);



  return { clock: current && connectionStatus === "connected" ? clock : emptyPlaybackClock, readObservation, state: snapshot, status: connectionStatus, details, identity: current ? identity : null, playerStatus: connectionStatus === "connected" ? snapshot?.player.status : connectionStatus === "pairing-required" ? publicDetails?.player : undefined, pairingRequired: !credentials || current && credentialRejected, reachable: connectionStatus === "connected" || connectionStatus === "pairing-required" || connectionStatus === "connection-rejected", connected: connectionStatus === "connected" && !!credentials, command, reconnect, startLive, endLive, liveAudioInputs, liveSharing, localLiveSourceId: current ? localLiveSourceId : null };
}
