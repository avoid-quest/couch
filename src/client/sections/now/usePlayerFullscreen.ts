import { useEffect, useState } from "react";
import { isTvPresentation } from "@/session/presentation";
import { failed } from "@/toasts";

// The app window follows the page's fullscreen, like any Chromium tab. The TV is always fullscreen.
export function usePlayerFullscreen() {
  const supported = !isTvPresentation() && document.fullscreenEnabled === true;
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [pending, setPending] = useState(false);
  const [nativePending, setNativePending] = useState(false);

  useEffect(() => window.couchApp?.onFullscreenPending?.(setNativePending), []);

  useEffect(() => {
    if (!supported) return;
    const refresh = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", refresh);
    return () => document.removeEventListener("fullscreenchange", refresh);
  }, [supported]);

  const toggle = async () => {
    if (!supported || pending || nativePending) return;
    setPending(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      // Fullscreen the document so portaled playback sheets stay available.
      else {
        await window.couchApp?.playerFullscreen?.(true);
        try { await document.documentElement.requestFullscreen(); }
        catch (reason) {
          await window.couchApp?.playerFullscreen?.(false);
          throw reason;
        }
      }
    } catch (reason) {
      failed("Couldn't change fullscreen.", reason);
    } finally { setPending(false); }
  };

  return { supported, fullscreen, pending: pending || nativePending, toggle };
}
