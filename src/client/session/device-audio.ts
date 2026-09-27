import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { isNativeHost } from "./native-context";
import { createSendspinRenderer } from "./sendspin-renderer";
import { fromSendspinVolume, toSendspinVolume } from "../../shared/audio-volume";

type Hosting = { available: boolean; url?: string; serverId?: string };
type Enrollment = { url: string; serverId: string; psk: string };
type OutputLease = { playbackId: string; generation: string | null; renewal?: ReturnType<typeof setInterval> };

/** The owning tab registers shared audio quietly; only Play unlocks its output. */
export function useDeviceAudio({ credentials, rendererTargetId, enabled, name, onReady }: {
  credentials: (ApiCredentials & { installationId?: string }) | null;
  rendererTargetId: string | null;
  enabled: boolean;
  name: string;
  onReady: (ready: boolean) => void;
}) {
  const latestReady = useRef(onReady); latestReady.current = onReady;
  const latestName = useRef(name); latestName.current = name;
  const generation = useRef(0);
  const closing = useRef(Promise.resolve());
  const client = useRef<ReturnType<typeof createSendspinRenderer> | null>(null);
  const connectedRef = useRef(false);
  const readyRef = useRef(false);
  const lease = useRef<OutputLease | null>(null);
  const leaseWork = useRef(Promise.resolve());
  const revoking = useRef(false);
  const revokeOutput = useRef<(generation: string) => void>(() => {});
  const [restart, setRestart] = useState(0);
  const [connected, setConnected] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = useCallback((value: boolean, report = latestReady.current) => {
    if (readyRef.current === value) return;
    readyRef.current = value; setAudioReady(value); report(value);
  }, []);
  const withLease = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = leaseWork.current.then(operation);
    leaseWork.current = result.then(() => {}, () => {});
    return result;
  }, []);

  useEffect(() => {
    const attempt = ++generation.current;
    const current = () => attempt === generation.current;
    const ownerReady = latestReady.current;
    let prepared: ReturnType<typeof createSendspinRenderer> | null = null;
    let retired = false;
    let disconnecting: Promise<void> | null = null;
    let disconnectError: unknown;
    const disconnect = () => {
      if (!prepared || retired) return Promise.resolve();
      if (disconnectError) return Promise.reject(disconnectError);
      return disconnecting ??= prepared.disconnect().then(() => { retired = true; }, reason => { disconnectError = reason; throw reason; });
    };
    revoking.current = false;
    revokeOutput.current = generation => {
      if (lease.current?.generation !== generation || revoking.current) return;
      revoking.current = true;
      if (lease.current.renewal) clearInterval(lease.current.renewal);
      ready(false);
      connectedRef.current = false; setConnected(false);
      closing.current = closing.current.then(async () => {
        // Rust keeps the output fenced until this SDK disconnect and end ack.
        await disconnect();
        await withLease(async () => {
          if (lease.current?.generation !== generation) return;
          await invoke("native_audio_end", { generation });
          lease.current = null;
        });
      }).then(() => { if (current()) setRestart(value => value + 1); }, () => {
        if (current()) setError("This device's audio connection expired. Restart Couch before using its output again.");
        throw new Error("Native audio remains reserved because SDK disconnect was not confirmed.");
      });
      void closing.current.catch(() => {});
    };
    let unlistenRevoked: (() => void) | undefined;
    if (isNativeHost()) void listen<string>("native-audio-revoked", event => revokeOutput.current(event.payload)).then(stop => {
      if (current()) unlistenRevoked = stop;
      else stop();
    }).catch(() => { /* Renewal failure also retires the output. */ });
    connectedRef.current = false; setConnected(false); setClientId(null); setError(null); ready(false);
    if (enabled && credentials && rendererTargetId) void (async () => {
      try {
        await closing.current;
        const hosting = await apiJson<Hosting>(credentials, "/api/sendspin/enrollment");
        if (!current() || !hosting.available || !hosting.url || !hosting.serverId) return;
        prepared = createSendspinRenderer({ url: hosting.url, name: latestName.current }, {
          state: state => {
            if (!current()) return;
            connectedRef.current = state.connected; setConnected(state.connected);
            if (!state.connected) ready(false);
            else if (!isNativeHost()) try { localStorage.setItem("couch.browser-volume", String(fromSendspinVolume(state.volume) / 100)); } catch { /* Storage is optional. */ }
          },
          error: () => { if (current()) { ready(false); setError("Shared audio is unavailable on this device."); } },
        });
        await prepared.preload();
        if (!current()) { await disconnect(); return; }
        if (!prepared.clientId) throw new Error("Missing audio identity");
        const enrollment = await apiSend<Enrollment>(credentials, "/api/sendspin/enrollment", { clientId: prepared.clientId, rendererTargetId });
        if (!current()) { await disconnect(); return; }
        if (enrollment.url !== hosting.url || enrollment.serverId !== hosting.serverId) throw new Error("Audio host changed");
        prepared.setEnrollment(enrollment);
        client.current = prepared; setClientId(prepared.clientId);
        const connecting = prepared.connect();
        if (!isNativeHost()) try {
          const saved = localStorage.getItem("couch.browser-volume");
          if (saved !== null && Number.isFinite(Number(saved))) prepared.setVolume(toSendspinVolume(Math.max(0, Math.min(1, Number(saved))) * 100));
        } catch { /* Storage is optional. */ }
        await connecting;
      } catch {
        if (current()) { ready(false); setError("Shared audio is unavailable on this device."); }
        await disconnect();
      }
    })();
    return () => {
      ++generation.current;
      revokeOutput.current = () => {};
      unlistenRevoked?.();
      client.current = null;
      connectedRef.current = false; setConnected(false); setClientId(null); ready(false, ownerReady);
      closing.current = closing.current.then(async () => {
        await disconnect();
        await withLease(async () => {
          const held = lease.current;
          if (!held) return;
          if (held.renewal) clearInterval(held.renewal);
          if (held.generation) await invoke("native_audio_end", { generation: held.generation });
          lease.current = null;
        });
      });
      void closing.current.catch(() => {});
    };
  }, [credentials?.origin, credentials?.token, credentials?.installationId, rendererTargetId, enabled, ready, restart, withLease]);

  const activateFromGesture = useCallback(() => {
    const active = client.current;
    if (!active || !connectedRef.current) return Promise.resolve(false);
    const attempt = generation.current;
    // This SDK call starts the AudioContext and must precede every await.
    const unlocking = active.unlockFromGesture();
    return unlocking.then(() => {
      if (attempt !== generation.current || !connectedRef.current) return false;
      ready(true); setError(null); return true;
    }, () => { if (attempt === generation.current) { ready(false); setError("This device couldn't start audio. Try Play again."); } return false; });
  }, [ready]);

  const reserve = useCallback(async (playbackId: string, retiringPlaybackId?: string) => {
    const attempt = generation.current;
    await closing.current;
    return withLease(async () => {
      if (attempt !== generation.current || !enabled || revoking.current || !client.current || !connectedRef.current || !readyRef.current) throw new Error("Enable audio on this device before adding it to playback.");
      const held = lease.current;
      if (held?.playbackId === playbackId) return;
      if (held) throw new Error("This device is already playing another playback.");
      if (!isNativeHost()) { lease.current = { playbackId, generation: null }; return; }
      const started = await invoke<{ generation: string }>("native_audio_begin", { managed: true, ...(retiringPlaybackId ? { retiringPlaybackId } : {}) });
      if (attempt !== generation.current) {
        // Effect cleanup disconnects the SDK before ending this late lease.
        lease.current = { playbackId, generation: started.generation };
        throw new Error("This device's audio connection changed.");
      }
      const renewal = setInterval(() => { void invoke("native_audio_renew", started).catch(() => revokeOutput.current(started.generation)); }, 2_000);
      lease.current = { playbackId, generation: started.generation, renewal };
    });
  }, [enabled, withLease]);

  const release = useCallback(async (playbackId: string) => {
    const attempt = generation.current;
    await closing.current;
    return withLease(async () => {
      if (attempt !== generation.current) return;
      const held = lease.current;
      if (!held || held.playbackId !== playbackId) return;
      if (held.generation) await invoke("native_audio_end", { generation: held.generation });
      if (held.renewal) clearInterval(held.renewal);
      lease.current = null;
    });
  }, [withLease]);

  return useMemo(() => ({ connected, clientId, error, audioReady, activateFromGesture, reserve, release,
    volume: (value: number) => client.current?.setVolume(value), mute: (value: boolean) => client.current?.setMuted(value)
  }), [connected, clientId, error, audioReady, activateFromGesture, reserve, release]);
}
