import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerState } from "../shared/protocol";

const portalSelector = '[role="dialog"], [role="listbox"], [role="menu"], [data-slot="popover-content"]';
const canFocus = (element: HTMLElement | null): element is HTMLElement => !!element?.isConnected
  && !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0;
const playbackControl = () => document.querySelector<HTMLElement>(".tv-playback-controls .play-button:not(:disabled)")
  ?? document.querySelector<HTMLElement>(".tv-playback-controls button:not(:disabled)");

export function useTvPresentation({ enabled, playbackId, phase }: {
  enabled: boolean;
  playbackId?: string | null;
  phase?: PlayerState["status"];
}) {
  const [browsing, setBrowsing] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);
  const previousPlayback = useRef<string | null | undefined>(undefined);
  const browserFocus = useRef<HTMLElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusFrame = useRef(0);
  const current = useRef({ enabled, browsing, controlsVisible, phase, playbackId });
  current.current = { enabled, browsing, controlsVisible, phase, playbackId };

  const cancelHide = useCallback(() => clearTimeout(hideTimer.current), []);
  const focusAfterRender = useCallback((find: () => HTMLElement | null) => {
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const element = find();
      if (canFocus(element)) element.focus({ preventScroll: true });
    });
  }, []);
  const rememberBrowserFocus = useCallback(() => {
    const element = document.activeElement;
    if (element instanceof HTMLElement && element.closest(".tv-browser")) browserFocus.current = element;
  }, []);
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    const hide = () => {
      if (!current.current.enabled || current.current.browsing || current.current.phase !== "playing") return;
      if (document.querySelector(portalSelector)) {
        hideTimer.current = setTimeout(hide, 4_000);
        return;
      }
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".tv-playback-controls, .tv-watch-actions")) {
        document.activeElement.blur();
      }
      setControlsVisible(false);
    };
    if (!current.current.browsing && current.current.phase === "playing") hideTimer.current = setTimeout(hide, 4_000);
  }, []);
  const showControls = useCallback(({ keyboard = false, fromHome = false }: { keyboard?: boolean; fromHome?: boolean } = {}) => {
    if (!current.current.enabled || (current.current.browsing && !fromHome)) return;
    if (current.current.browsing) {
      rememberBrowserFocus();
      setBrowsing(false);
    }
    setControlsVisible(true);
    scheduleHide();
    if (keyboard && (current.current.browsing || !current.current.controlsVisible) && !document.querySelector(portalSelector)) {
      focusAfterRender(playbackControl);
    }
  }, [focusAfterRender, rememberBrowserFocus, scheduleHide]);
  const openHome = useCallback(() => {
    if (!current.current.enabled) return;
    const active = document.activeElement;
    const restore = current.current.browsing
      ? active instanceof HTMLElement && active.closest(".media-browser") ? active : null
      : browserFocus.current;
    cancelHide();
    setBrowsing(true);
    setControlsVisible(false);
    focusAfterRender(() => canFocus(restore) ? restore
      : document.querySelector<HTMLElement>('.tv-browser [role="tab"][aria-selected="true"]')
        ?? document.querySelector<HTMLElement>(".tv-browser button:not(:disabled)"));
  }, [cancelHide, focusAfterRender]);
  const closeBrowser = useCallback(() => {
    if (!current.current.enabled || !current.current.playbackId || ["idle", "unavailable"].includes(current.current.phase ?? "idle")) return;
    rememberBrowserFocus();
    setBrowsing(false);
    setControlsVisible(true);
    focusAfterRender(playbackControl);
  }, [focusAfterRender, rememberBrowserFocus]);
  const dismissLayer = useCallback(() => {
    if (!current.current.enabled || document.querySelector(portalSelector)) return false;
    if (current.current.browsing) {
      if (!current.current.playbackId || ["idle", "unavailable"].includes(current.current.phase ?? "idle")) return false;
      closeBrowser();
    } else if (current.current.controlsVisible && ["idle", "unavailable"].includes(current.current.phase ?? "idle")) {
      openHome();
    } else if (current.current.controlsVisible) {
      cancelHide();
      setControlsVisible(false);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } else openHome();
    return true;
  }, [cancelHide, closeBrowser, openHome]);

  useEffect(() => {
    if (!enabled) return;
    if (phase === "idle" || phase === "unavailable") {
      if (!current.current.browsing) openHome();
    } else if (playbackId && previousPlayback.current !== playbackId) {
      rememberBrowserFocus();
      setBrowsing(false);
      setControlsVisible(true);
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".tv-browser")) document.activeElement.blur();
    } else if (phase === "paused" || phase === "loading" || phase === "error") {
      setControlsVisible(true);
    }
    previousPlayback.current = playbackId;
  }, [enabled, phase, playbackId, openHome, rememberBrowserFocus]);

  useEffect(() => {
    if (enabled && controlsVisible && !browsing) scheduleHide();
    else cancelHide();
    return cancelHide;
  }, [enabled, controlsVisible, browsing, phase, scheduleHide, cancelHide]);

  useEffect(() => {
    if (!enabled) return;
    const pointer = () => showControls();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || ["Escape", "BrowserBack"].includes(event.key)) return;
      showControls({ keyboard: true });
    };
    window.addEventListener("pointermove", pointer);
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key, true);
    };
  }, [enabled, showControls]);

  useEffect(() => () => { cancelHide(); cancelAnimationFrame(focusFrame.current); }, [cancelHide]);
  return { browsing, controlsVisible, openHome, closeBrowser, showControls, dismissLayer };
}
