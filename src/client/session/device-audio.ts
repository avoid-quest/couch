import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { isNativeHost } from "./native-context";
import { createSendspinRenderer } from "./sendspin-renderer";

type Hosting = { available: boolean; url?: string; serverId?: string };
type Enrollment = { url: string; serverId: string; psk: string };

/** The owning tab registers shared audio quietly; only Play unlocks its output. */
export function useDeviceAudio({ credentials, rendererTargetId, enabled, name, onReady }: {
  credentials: (ApiCredentials & { installationId?: string }) | null;
  rendererTargetId: string | null;
  enabled: boolean;
  name: string;
  onReady: (ready: boolean) => void;
}) {
  const latestReady = useRef(onReady); latestReady.current = onReady;
  const generation = useRef(0);
  const closing = useRef(Promise.resolve());
  const client = useRef<ReturnType<typeof createSendspinRenderer> | null>(null);
  const connectedRef = useRef(false);
  const readyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = useCallback((value: boolean) => {
    if (readyRef.current === value) return;
    readyRef.current = value; setAudioReady(value); latestReady.current(value);
  }, []);

  useEffect(() => {
    const attempt = ++generation.current;
    const current = () => attempt === generation.current;
    let prepared: ReturnType<typeof createSendspinRenderer> | null = null;
    let retired = false;
    const disconnect = () => { if (!prepared || retired) return Promise.resolve(); retired = true; return prepared.disconnect(); };
    connectedRef.current = false; setConnected(false); setClientId(null); setError(null); ready(false);
    if (enabled && credentials && rendererTargetId) void (async () => {
      try {
        await closing.current;
        const hosting = await apiJson<Hosting>(credentials, "/api/sendspin/enrollment");
        if (!current() || !hosting.available || !hosting.url || !hosting.serverId) return;
        prepared = createSendspinRenderer({ url: hosting.url, name }, {
          state: state => {
            if (!current()) return;
            connectedRef.current = state.connected; setConnected(state.connected);
            if (!state.connected) ready(false);
            else if (!isNativeHost()) try { localStorage.setItem("couch.browser-volume", String(state.volume / 100)); } catch { /* Storage is optional. */ }
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
          if (saved !== null && Number.isFinite(Number(saved))) prepared.setVolume(Math.max(0, Math.min(1, Number(saved))) * 100);
        } catch { /* Storage is optional. */ }
        await connecting;
      } catch {
        if (current()) { ready(false); setError("Shared audio is unavailable on this device."); }
        await disconnect();
      }
    })();
    return () => {
      ++generation.current;
      client.current = null;
      connectedRef.current = false; setConnected(false); setClientId(null); ready(false);
      closing.current = closing.current.catch(() => {}).then(disconnect);
    };
  }, [credentials?.origin, credentials?.token, credentials?.installationId, rendererTargetId, enabled, name, ready]);

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

  return { connected, clientId, error, audioReady, activateFromGesture,
    volume: (value: number) => client.current?.setVolume(value), mute: (value: boolean) => client.current?.setMuted(value) };
}
