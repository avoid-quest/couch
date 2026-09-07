import { useEffect } from "react";
import type { Credentials } from "./session";

export function useUpdateActivity(credentials: Credentials | null, connected: boolean) {
  useEffect(() => {
    if (!credentials || !connected) return;
    const stop = new AbortController();
    let pending = false, dirty = false;
    const send = async () => {
      if (pending || stop.signal.aborted) return;
      pending = true; dirty = false;
      try {
        await fetch(`${credentials.origin}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: '{"activity":true}', signal: AbortSignal.any([stop.signal, AbortSignal.timeout(2_000)]) });
      } catch { /* Commands and later input also reset the server's idle clock. */ }
      finally { pending = false; if (dirty && !stop.signal.aborted) void send(); }
    };
    const activity = () => { dirty = true; void send(); };
    document.addEventListener("pointerdown", activity, { capture: true, signal: stop.signal });
    document.addEventListener("keydown", activity, { capture: true, signal: stop.signal });
    return () => stop.abort();
  }, [credentials?.origin, credentials?.token, connected]);
}
