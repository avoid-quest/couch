import { useHotkeys, type RegisterableHotkey } from "@tanstack/react-hotkeys";
import { useSyncExternalStore } from "react";

type Shortcut = {
  hotkey: RegisterableHotkey;
  action: () => void;
  enabled?: boolean;
  backgroundOnly?: boolean;
};
const overlays =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]';
// A tabindex of -1 marks a focus target, such as the player's picture or a page's heading, not a control.
const controls =
  'button, a, input, select, textarea, video, audio, [tabindex]:not([tabindex="-1"]), [role="slider"], [role="button"]';

/** Whether a key pressed on `target` is the shortcuts' to take: nothing focused, or a focus target rather than a control. */
const isBackground = (target: Element | null | undefined) => !target?.closest(controls);

function shortcutFocus(target = document.activeElement) {
  if (
    target?.closest(
      'input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
    ) ||
    [...document.querySelectorAll(overlays)].some(
      (element) => !element.closest('[hidden], [data-state="closed"]'),
    )
  )
    return "blocked";
  if (!isBackground(target)) return "control";
  return window.getSelection()?.isCollapsed === false ? "selection" : "background";
}

// Video.js takes a disabled flag for document hotkeys. React to focus entering or leaving a control or portal.
const subscribeFocus = (update: () => void) => {
  const changed = () => queueMicrotask(update);
  const events = ["focusin", "focusout", "selectionchange", "toggle"];
  for (const name of events) document.addEventListener(name, changed);
  return () => {
    for (const name of events) document.removeEventListener(name, changed);
  };
};
export const useShortcutFocus = () =>
  useSyncExternalStore(subscribeFocus, shortcutFocus, () => "blocked" as const);

// Radix portals and focused controls keep ownership of their keyboard input.
export function useCouchHotkeys(shortcuts: Shortcut[]) {
  useHotkeys(
    shortcuts.map(({ hotkey, action, enabled, backgroundOnly }) => ({
      hotkey,
      options: { enabled: enabled ?? true },
      callback: (event) => {
        if (event.defaultPrevented || event.isComposing || event.repeat) return;
        // A layout can type "<" on the physical comma key. Settings is the comma character.
        if (hotkey === "," && event.key !== ",") return;
        const focus = shortcutFocus(
          event.target instanceof HTMLElement ? event.target : document.activeElement,
        );
        if (focus === "blocked" || (backgroundOnly && focus !== "background")) return;
        // Typing on Search continues the query.
        if (location.pathname === "/search" && /^[a-z0-9]$/i.test(event.key) && focus !== "control")
          return;
        event.preventDefault();
        action();
      },
    })),
    { ignoreInputs: true, preventDefault: false, stopPropagation: false },
  );
}
