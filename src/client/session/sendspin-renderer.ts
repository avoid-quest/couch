import type { SendspinPlayer, SendspinPlayerConfig, SendspinStorage, ServerStateMetadata, GroupUpdatePayload } from "@sendspin/sendspin-js";

type Library = Pick<typeof import("@sendspin/sendspin-js"), "SendspinPlayer" | "loadSendspinClientIdentity">;
export type SendspinTransport = "play" | "pause" | "stop" | "next" | "previous";
export interface SendspinRendererState {
  connected: boolean;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  metadata: ServerStateMetadata | undefined;
  group: GroupUpdatePayload;
  supportedCommands: SendspinTransport[];
}
export interface SendspinEnrollment { serverId?: string; psk: string }
export interface SendspinRendererConfig { url: string; name: string; serverId?: string; psk?: string; suite?: "aesgcm" | "chacha" }
export interface SendspinRendererCallbacks {
  state(state: SendspinRendererState): void;
  error(error: Error): void;
  pairingPin?(pin: string | null, languages?: string[]): void;
}
const transports: SendspinTransport[] = ["play", "pause", "stop", "next", "previous"];
export const sendspinReconnectStopped = "Sendspin stopped reconnecting. Leave and join again.";

// Preload before enabling Connect: unlock must be the first awaited work in its
// gesture handler. The SDK owns decoding, clock synchronization and Web Audio.
// https://github.com/Sendspin/sendspin-js#example
export function createSendspinRenderer(config: SendspinRendererConfig, callbacks: SendspinRendererCallbacks, options: {
  loadLibrary?: () => Promise<Library>;
  storage?: SendspinStorage | null;
} = {}) {
  let library: Library | undefined;
  let loading: Promise<void> | undefined;
  let clientId: string | null = null;
  let player: SendspinPlayer | undefined;
  let connecting: Promise<void> | undefined;
  let disposed = false;
  let reconnects = 0;
  let reconnectStopped = false;
  let enrollment: SendspinEnrollment | undefined = config.psk ? { psk: config.psk, serverId: config.serverId } : undefined;
  let supportedCommands: SendspinTransport[] = [];
  let lastState: SendspinRendererState | undefined;
  const fail = (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    if (!disposed) callbacks.error(error);
    return error;
  };
  const publish: NonNullable<SendspinPlayerConfig["onStateChange"]> = state => {
    if (disposed || reconnectStopped) return;
    supportedCommands = transports.filter(command => state.serverState.controller?.supported_commands?.includes(command));
    lastState = { connected: player?.isConnected ?? false, isPlaying: state.isPlaying, volume: state.volume, muted: state.muted, metadata: state.serverState.metadata, group: state.groupState, supportedCommands };
    callbacks.state(lastState);
    if (state.playerState === "error") fail(new Error("Sendspin playback failed."));
  };
  const publishDisconnected = () => {
    if (disposed || reconnectStopped) return;
    callbacks.state({ connected: false, isPlaying: false, volume: lastState?.volume ?? 100, muted: lastState?.muted ?? false, metadata: lastState?.metadata, group: lastState?.group ?? {}, supportedCommands: [] });
  };
  const stopReconnecting = () => {
    if (disposed || reconnectStopped) return;
    reconnectStopped = true;
    // The SDK opens a socket after onReconnecting returns. Let that call finish
    // before disconnecting so its new socket and retry timer are also closed.
    queueMicrotask(() => {
      if (disposed) return;
      player?.disconnect("user_request");
      supportedCommands = [];
      callbacks.state({ connected: false, isPlaying: false, volume: lastState?.volume ?? 100, muted: lastState?.muted ?? false, metadata: undefined, group: { ...lastState?.group, playback_state: "stopped" }, supportedCommands });
      callbacks.pairingPin?.(null);
      callbacks.error(new Error(sendspinReconnectStopped));
    });
  };
  const ensurePlayer = () => {
    if (disposed) throw new Error("This Sendspin connection is closed.");
    if (reconnectStopped) throw new Error(sendspinReconnectStopped);
    if (!library) throw new Error("Wait for Sendspin to load, then connect again.");
    return player ??= new library.SendspinPlayer({
      baseUrl: config.url, clientName: config.name, productName: "Couch", storage: options.storage,
      correctionMode: "sync", suite: config.suite ?? "aesgcm", unpairedAccess: false,
      ...(enrollment ? { longTermPsks: [enrollment] } : {}),
      onStateChange: publish,
      onPairingPin: (pin, languages) => { if (!disposed && !reconnectStopped) callbacks.pairingPin?.(pin, languages); },
      reconnect: { maxAttempts: 7, onReconnecting: () => { publishDisconnected(); if (++reconnects > 7) stopReconnecting(); }, onExhausted: stopReconnecting },
    });
  };
  const connect = () => {
    if (disposed) return Promise.reject(new Error("This Sendspin connection is closed."));
    if (reconnectStopped) return Promise.reject(new Error(sendspinReconnectStopped));
    if (connecting) return connecting;
    if (player?.isConnected) return Promise.resolve();
    try {
      const current = ensurePlayer();
      connecting = current.connect().then(async () => {
        if (disposed || reconnectStopped) await current.disconnect("user_request");
      }).catch(async reason => {
        await current.disconnect("user_request");
        if (reconnectStopped) throw new Error(sendspinReconnectStopped);
        throw fail(reason);
      }).finally(() => { connecting = undefined; });
      return connecting;
    } catch (reason) { return Promise.reject(fail(reason)); }
  };
  const unlockFromGesture = () => {
    try { return ensurePlayer().unlock(); }
    catch (reason) { return Promise.reject(reason); }
  };
  return {
    get clientId() { return clientId; },
    get audioClock() {
      if (!player?.isConnected || !player.timeSyncInfo.synced) return null;
      const progress = player.trackProgress;
      const groupId = lastState?.group.group_id;
      return progress && groupId ? { groupId, positionMs: progress.positionMs, playbackSpeed: progress.playbackSpeed } : null;
    },
    preload() {
      return loading ??= (options.loadLibrary ?? (() => import("@sendspin/sendspin-js")))().then(loaded => {
        if (disposed) return;
        library = loaded;
        clientId = loaded.loadSendspinClientIdentity(options.storage).clientId;
      }).catch(reason => { loading = undefined; throw fail(reason); });
    },
    setEnrollment(value: SendspinEnrollment) {
      if (disposed || player) throw new Error("Configure Sendspin enrollment before connecting.");
      enrollment = value;
    },
    connect,
    unlockFromGesture,
    connectFromGesture(): Promise<void> {
      if (disposed) return Promise.reject(new Error("This Sendspin connection is closed."));
      if (reconnectStopped) return Promise.reject(new Error(sendspinReconnectStopped));
      if (connecting) return connecting;
      if (player?.isConnected) return Promise.resolve();
      try {
        // Do not await an import, enrollment request or another teardown here.
        const unlocked = unlockFromGesture();
        connecting = (async () => {
          await unlocked;
          if (disposed || reconnectStopped) { await player?.disconnect("user_request"); return; }
          const current = player!;
          await current.connect();
          if (disposed || reconnectStopped) await current.disconnect("user_request");
        })().catch(async reason => {
          await player?.disconnect("user_request");
          if (reconnectStopped) throw new Error(sendspinReconnectStopped);
          throw fail(reason);
        }).finally(() => { connecting = undefined; });
        return connecting;
      } catch (reason) { return Promise.reject(fail(reason)); }
    },
    async disconnect() {
      disposed = true;
      supportedCommands = [];
      callbacks.pairingPin?.(null);
      // SDK 5 disconnect clears scheduled buffers synchronously but returns void;
      // it does not expose AudioContext.close completion or physical silence.
      // This is deliberately not a verified handoff/silence acknowledgement.
      await player?.disconnect("user_request");
    },
    setVolume(volume: number) {
      if (!disposed && !reconnectStopped && player && Number.isFinite(volume)) player.setVolume(Math.max(0, Math.min(100, volume)));
    },
    setMuted(muted: boolean) { if (!disposed && !reconnectStopped) player?.setMuted(muted); },
    transport(command: SendspinTransport) {
      if (disposed || reconnectStopped || !player?.isConnected || !supportedCommands.includes(command)) return false;
      player.sendCommand(command, undefined);
      return true;
    },
    openPairingWindow() { if (!disposed && !reconnectStopped) player?.openPairingWindow(); },
  };
}
