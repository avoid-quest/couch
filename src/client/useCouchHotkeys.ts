import { useHotkeys, type RegisterableHotkey } from "@tanstack/react-hotkeys";

type Shortcut = { hotkey: RegisterableHotkey; action: () => void; enabled?: boolean; backgroundOnly?: boolean };
const overlays = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]';
const controls = 'button, a, input, select, textarea, [tabindex], [role="slider"], [role="button"]';

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
      if (backgroundOnly && target?.closest(controls)) return;
      if (document.getElementById("media-search") && /^[a-z0-9]$/i.test(event.key) && !target?.closest(controls)) return;
      event.preventDefault();
      action();
    },
  })), { ignoreInputs: true, preventDefault: false, stopPropagation: false });
}
