import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { isNativeHost, isTvPresentation } from "@/session/native-context";

export function usePlayerFullscreen() {
  const native = isNativeHost();
  const supported = !isTvPresentation() && (native || document.fullscreenEnabled === true);
  const [fullscreen, setFullscreen] = useState(!native && !!document.fullscreenElement);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!supported) return;
    if (!native) {
      const refresh = () => setFullscreen(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", refresh);
      return () => document.removeEventListener("fullscreenchange", refresh);
    }
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const value = await appWindow.isFullscreen();
        if (!disposed) setFullscreen(value);
      } catch { /* A failed toggle reports the error without background notifications. */ }
    };
    void refresh();
    void appWindow.onResized(() => void refresh()).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [native, supported]);

  const toggle = async () => {
    if (!supported || pending) return;
    setPending(true);
    try {
      if (native) {
        const appWindow = getCurrentWindow();
        await appWindow.setFullscreen(!await appWindow.isFullscreen());
        setFullscreen(await appWindow.isFullscreen());
      } else if (document.fullscreenElement) await document.exitFullscreen();
      // Fullscreen the document so portaled playback sheets stay available.
      else await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Couldn't change fullscreen. Try again using the window controls.");
    } finally { setPending(false); }
  };

  return { supported, fullscreen, pending, toggle };
}
