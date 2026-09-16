import { useEffect } from "react";

// In TV mode the mouse cursor disappears once the pointer goes idle and returns on any activity.
export function useIdleCursor(enabled: boolean, idleMs = 4_000) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      document.documentElement.style.cursor = "";
      clearTimeout(timer);
      timer = setTimeout(() => { document.documentElement.style.cursor = "none"; }, idleMs);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      clearTimeout(timer);
      document.documentElement.style.cursor = "";
    };
  }, [enabled, idleMs]);
}
