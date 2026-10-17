import { isTvPresentation } from "./session/presentation";
import { flushSync } from "react-dom";
import { isRemoteField, remoteFields, type TextFocus } from "../shared/remote";
import type { ServerMessage } from "../shared/protocol";
import { settingsPages } from "../shared/settings-pages";

// Only explicitly annotated, ordinary inputs can receive text. Identity rotates on every focus lifecycle.
export function connectRemoteText(report: (field: TextFocus | null) => void) {
  let focused: { element: HTMLInputElement; field: TextFocus } | null = null;
  let active = true;
  let published = "";
  const currentInput = () => {
    const element = document.activeElement;
    if (!isTvPresentation() || document.visibilityState !== "visible" || !(element instanceof HTMLInputElement)
      || !["text", "search"].includes(element.type) || element.disabled || element.readOnly
      || element.closest('[hidden], [inert], [aria-hidden="true"], [data-tv-local-only]') || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return null;
    const kind = element.dataset.remoteField;
    if (!isRemoteField(kind) || element.id !== (kind === "find" ? "media-search" : "local-device-name")) return null;
    // Search is the header's field, on every page; the device name lives on General.
    if (kind === "device-name" && location.pathname !== settingsPages.general.path) return null;
    return { element, kind };
  };
  const update = () => {
    if (!active) return;
    const input = currentInput();
    if (!input) focused = null;
    else if (focused?.element !== input.element || focused.field.kind !== input.kind) focused = { element: input.element, field: { kind: input.kind, token: crypto.randomUUID(), value: input.element.value } };
    else focused.field = { ...focused.field, value: input.element.value };
    const field = focused?.field ?? null, next = JSON.stringify(field);
    if (next !== published) { published = next; report(field); }
  };
  const blur = () => { focused = null; published = ""; report(null); };
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", blur);
  document.addEventListener("input", update);
  document.addEventListener("visibilitychange", update);
  const observer = new MutationObserver(update);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden", "disabled", "readonly", "type", "id", "data-remote-field", "data-tv-local-only", "style", "class", "data-state"] });
  update();
  return {
    async receive(message: Extract<ServerMessage, { type: "text" }>) {
      update();
      const before = focused, input = currentInput();
      if (!before || input?.element !== before.element || message.token !== before.field.token || message.text.length > remoteFields[before.field.kind].maxLength) return false;
      // The native setter fires React's existing onChange rather than creating a second form model.
      flushSync(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(before.element, message.text);
        before.element.dispatchEvent(new Event("input", { bubbles: true }));
      });
      update();
      if (!focused || focused.field.token !== before.field.token || currentInput()?.element !== before.element) return false;
      if (message.submit) {
        if (!remoteFields[before.field.kind].submit || !before.element.form) return false;
        before.element.form.requestSubmit();
      }
      return true;
    },
    close() {
      active = false; focused = null; observer.disconnect();
      document.removeEventListener("focusin", update); document.removeEventListener("focusout", blur);
      document.removeEventListener("input", update); document.removeEventListener("visibilitychange", update);
    },
  };
}
