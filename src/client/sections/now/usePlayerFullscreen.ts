import { useEffect, useState } from "react";
import { isTvPresentation } from "@/session/presentation";
import { failed } from "@/toasts";

// The app window follows the page's fullscreen, like any Chromium tab. The TV is always fullscreen.
export function usePlayerFullscreen() {
  const supported = !isTvPresentation() && document.fullscreenEnabled === true;
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const refresh = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", refresh);
    return () => document.removeEventListener("fullscreenchange", refresh);
  }, [supported]);

  const toggle = async () => {
    if (!supported || pending) return;
    setPending(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      // Fullscreen the document so portaled playback sheets stay available.
      else await document.documentElement.requestFullscreen();
    } catch (reason) {
      failed("Couldn't change fullscreen.", reason);
    } finally { setPending(false); }
  };

  return { supported, fullscreen, pending, toggle };
}
