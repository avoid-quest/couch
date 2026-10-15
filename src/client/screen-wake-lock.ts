import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlaybackSummary } from "../shared/protocol";

const storageKey = "couch.keep-screen-awake";
type LockStatus = "active" | "released" | "blocked";

export const playingOnDevice = (playbacks: PlaybackSummary[] | undefined, deviceId: string) =>
  playbacks?.some(playback => ["loading", "playing"].includes(playback.status)
    && playback.outputs.some(output => output.deviceId === deviceId && (output.picture || output.sound))) ?? false;

const readEnabled = () => {
  try { return localStorage.getItem(storageKey) !== "false"; }
  catch { return true; }
};

// Own one visible document's lock. Requests can finish after hiding, stopping
// playback or React StrictMode cleanup; those grants must be released as well.
export function keepScreenAwake(document: Document, onStatus: (status: LockStatus) => void) {
  const view = document.defaultView;
  if (!view?.isSecureContext || !view.navigator.wakeLock) return () => {};
  let stopped = false;
  let pending = false;
  let visibilityVersion = 0;
  let lock: WakeLockSentinel | null = null;
  const release = () => {
    const previous = lock;
    lock = null;
    void previous?.release().catch(() => {});
  };
  const request = async () => {
    if (stopped || pending || lock || document.visibilityState !== "visible") return;
    pending = true;
    const requestedAt = visibilityVersion;
    try {
      const granted = await view.navigator.wakeLock.request("screen");
      if (stopped || document.visibilityState !== "visible") { void granted.release().catch(() => {}); return; }
      if (granted.released) { onStatus("released"); return; }
      lock = granted;
      granted.addEventListener("release", () => {
        if (lock !== granted) return;
        lock = null;
        // A browser may revoke the lock for battery or permission reasons.
        // Retry on returning to Couch or explicitly, never in a rejection loop.
        onStatus("released");
      }, { once: true });
      onStatus("active");
    } catch { if (!stopped) onStatus("blocked"); }
    finally {
      pending = false;
      // Returning may have happened while this now-invalid request was pending.
      if (requestedAt !== visibilityVersion) void request();
    }
  };
  const visibility = () => {
    visibilityVersion++;
    if (document.visibilityState === "visible") void request();
    else release();
  };
  document.addEventListener("visibilitychange", visibility);
  view.addEventListener("pageshow", visibility);
  void request();
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", visibility);
    view.removeEventListener("pageshow", visibility);
    release();
  };
}

export function useScreenWakeLock(playing: boolean) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const unavailable = !window.isSecureContext ? "Open Couch over trusted HTTPS to use this setting."
    : !navigator.wakeLock ? "This browser can't keep the screen awake." : null;
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) { setEnabled(readEnabled()); setError(null); }
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, []);
  useEffect(() => {
    setStatus(null);
    if (enabled && playing) return keepScreenAwake(document, setStatus);
  }, [enabled, playing, attempt]);
  const save = useCallback((value: boolean) => {
    setEnabled(value);
    try { localStorage.setItem(storageKey, String(value)); setError(null); }
    catch { setError("Applied, but couldn't save on this device."); }
  }, []);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const interrupted = enabled && playing && (status === "blocked" || status === "released");
  const reason = unavailable ?? (interrupted ? "Your browser isn't keeping the screen awake. Check its permissions or battery-saving settings." : null);
  return useMemo(() => ({ enabled, save, error, reason, supported: !unavailable, retry, retryable: !unavailable && interrupted }),
    [enabled, save, error, reason, unavailable, retry, interrupted]);
}
