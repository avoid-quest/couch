import { useCallback, useEffect, useState } from "react";
import { isTvPresentation } from "@/session/presentation";
import { failed } from "@/toasts";

// In the app, fullscreen is the window's own, which the system's green button and menu also change, so the button
// always shows what the window is. A browser tab uses the page's Fullscreen API. The TV is always fullscreen.
export function usePlayerFullscreen() {
  const app = window.couchApp?.fullScreen && window.couchApp;
  const supported = !isTvPresentation() && (!!app || document.fullscreenEnabled === true);
  const [fullscreen, setFullscreen] = useState(!app && !!document.fullscreenElement);

  useEffect(() => {
    if (!supported) return;
    if (app) {
      void app.fullScreen?.().then(setFullscreen);
      return app.onFullScreen?.(setFullscreen);
    }
    const refresh = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", refresh);
    return () => document.removeEventListener("fullscreenchange", refresh);
  }, [app, supported]);

  const change = useCallback(
    async (enter: boolean) => {
      if (!supported) return;
      try {
        if (app) await app.fullScreen?.(enter);
        else if (!enter) {
          if (document.fullscreenElement) await document.exitFullscreen();
        }
        // Fullscreen the document so portaled playback sheets stay available.
        else if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      } catch (reason) {
        failed("Couldn't change fullscreen.", reason);
      }
    },
    [app, supported],
  );
  const exit = useCallback(() => change(false), [change]);

  return {
    supported,
    fullscreen,
    toggle: () => change(!fullscreen),
    exit,
  };
}
