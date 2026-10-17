import { useHotkeys, type RegisterableHotkey } from "@tanstack/react-hotkeys";

type Shortcut = { hotkey: RegisterableHotkey; action: () => void; enabled?: boolean; backgroundOnly?: boolean };
const overlays = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]';
// A tabindex of -1 marks a focus target, such as the player's picture or a page's heading, not a control.
const controls = 'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="slider"], [role="button"]';

/** Whether a key pressed on `target` is the shortcuts' to take: nothing focused, or a focus target rather than a control. */
export const isBackground = (target: Element | null | undefined) => !target?.closest(controls);

// Radix portals and focused controls keep ownership of their keyboard input.
export function useCouchHotkeys(shortcuts: Shortcut[]) {
  useHotkeys(shortcuts.map(({ hotkey, action, enabled, backgroundOnly }) => ({
    hotkey,
    options: { enabled: enabled ?? true },
    callback: event => {
      const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (target?.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]')) return;
      if ([...document.querySelectorAll(overlays)].some(element => !element.closest('[hidden], [data-state="closed"]'))) return;
      if (backgroundOnly && !isBackground(target)) return;
      // On the search results, typing goes on with the query (HeaderSearch), so letters and digits are not shortcuts there.
      if (location.pathname === "/search" && /^[a-z0-9]$/i.test(event.key) && isBackground(target)) return;
      event.preventDefault();
      action();
    },
  })), { ignoreInputs: true, preventDefault: false, stopPropagation: false });
}
