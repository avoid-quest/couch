import { useEffect } from "react";
import type { ClientSessionState } from "@/session/session";

export function nativeWindowTitle(state: ClientSessionState | null, connected: boolean, fallbackName?: string) {
  const name = state?.installationName ?? fallbackName;
  const current = connected && state?.player.playbackId && ["loading", "playing", "paused"].includes(state.player.status)
    ? state.queue.find(entry => entry.id === state.currentEntryId) : null;
  const programme = state?.radioProgramme?.playbackId === state?.player.playbackId ? state?.radioProgramme : null;
  const title = current ? programme?.title ?? state?.player.nowPlaying?.title ?? current.title : null;
  return ["Couch", name, title].filter(Boolean).join(" · ");
}

export function useNativeWindowTitle(nativeHost: boolean, state: ClientSessionState | null, connected: boolean, fallbackName?: string) {
  const title = nativeWindowTitle(state, connected, fallbackName);
  useEffect(() => {
    if (!nativeHost) return;
    document.title = title;
  }, [nativeHost, title]);
}
