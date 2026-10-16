import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isTvPresentation } from "@/session/presentation";

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
    } catch {
      toast.error("Couldn't change fullscreen. Try again using the window controls.");
    } finally { setPending(false); }
  };

  return { supported, fullscreen, pending, toggle };
}
