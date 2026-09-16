import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// In TV mode the native window cursor hides once the pointer goes idle and returns on any activity.
// Hiding through the window API covers elements that declare their own cursor, unlike document CSS.
export function useIdleCursor(enabled: boolean, idleMs = 4_000) {
  useEffect(() => {
    if (!enabled) return;
    const tvWindow = getCurrentWindow();
    let hidden = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      clearTimeout(timer);
      if (hidden) { hidden = false; void tvWindow.setCursorVisible(true).catch(() => {}); }
      timer = setTimeout(() => { hidden = true; void tvWindow.setCursorVisible(false).catch(() => {}); }, idleMs);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      clearTimeout(timer);
      if (hidden) void tvWindow.setCursorVisible(true).catch(() => {});
    };
  }, [enabled, idleMs]);
}
