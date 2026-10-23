import { freshRadioProgramme } from "../shared/radio";
import { useRadioClock } from "@/radio-clock";
import { useEffect } from "react";
import type { ClientSessionState } from "@/session/session";

export function nativeWindowTitle(state: ClientSessionState | null, connected: boolean, fallbackName?: string, now = Date.now()) {
  const name = state?.installationName ?? fallbackName;
  const current = connected && state?.player.playbackId && ["loading", "playing", "paused"].includes(state.player.status)
    ? state.queue.find(entry => entry.id === state.currentEntryId) : null;
  const programme = state?.radioProgramme?.playbackId === state?.player.playbackId ? freshRadioProgramme(state?.radioProgramme, now) : null;
  const title = current ? programme?.title ?? state?.player.nowPlaying?.title ?? current.title : null;
  return ["Couch", name, title].filter(Boolean).join(" · ");
}

export function useNativeWindowTitle(nativeHost: boolean, state: ClientSessionState | null, connected: boolean, fallbackName?: string) {
  const now = useRadioClock([], state?.radioProgramme);
  const title = nativeWindowTitle(state, connected, fallbackName, now);
  useEffect(() => {
    if (!nativeHost) return;
    document.title = title;
  }, [nativeHost, title]);
}
