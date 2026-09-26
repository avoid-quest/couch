import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Credentials } from "./session/session";

export function useLocalUpdateActivity(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    let last = -Infinity;
    const activity = (event: Event) => {
      if (!event.isTrusted || performance.now() - last < 1_000) return;
      last = performance.now();
      void invoke("local_update_activity").catch(() => {});
    };
    for (const type of ["pointerdown", "pointermove", "wheel", "keydown"])
      document.addEventListener(type, activity, { capture: true, signal: stop.signal });
    return () => stop.abort();
  }, [enabled]);
}

export function useUpdateActivity(credentials: Credentials | null, connected: boolean) {
  useEffect(() => {
    if (!credentials || !connected) return;
    const stop = new AbortController();
    let pending = false, dirty = false;
    let lastSent = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = async () => {
      if (pending || stop.signal.aborted) return;
      const delay = 1_000 - (performance.now() - lastSent);
      if (delay > 0) {
        timer ??= setTimeout(() => { timer = undefined; void send(); }, delay);
        return;
      }
      clearTimeout(timer); timer = undefined;
      pending = true; dirty = false; lastSent = performance.now();
      try {
        await fetch(`${credentials.origin}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: '{"activity":true}', signal: AbortSignal.any([stop.signal, AbortSignal.timeout(2_000)]) });
      } catch { /* Commands and later input also reset the server's idle clock. */ }
      finally { pending = false; if (dirty && !stop.signal.aborted) void send(); }
    };
    const activity = () => { dirty = true; void send(); };
    document.addEventListener("pointerdown", activity, { capture: true, signal: stop.signal });
    document.addEventListener("keydown", activity, { capture: true, signal: stop.signal });
    return () => { stop.abort(); clearTimeout(timer); };
  }, [credentials?.origin, credentials?.token, connected]);
}
