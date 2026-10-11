import { useEffect } from "react";

// In TV mode the cursor hides once the pointer goes idle and returns on any activity.
export function useIdleCursor(enabled: boolean, idleMs = 4_000) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      clearTimeout(timer);
      root.toggleAttribute("data-cursor-hidden", false);
      timer = setTimeout(() => root.toggleAttribute("data-cursor-hidden", true), idleMs);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      clearTimeout(timer);
      root.toggleAttribute("data-cursor-hidden", false);
    };
  }, [enabled, idleMs]);
}
