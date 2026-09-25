import { useEffect, useRef } from "react";
import type { NavigationKey } from "../shared/protocol";

const focusable = 'button, a[href], input, select, textarea, [tabindex="0"], [role="option"], [role^="menuitem"]';
const portals = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-slot="popover-content"]';
const localOnly = '[data-tv-local-only]';
let remoteNavigation = false;
const rendered = (element: HTMLElement) => !element.closest('[hidden]')
  && element.closest(portals)?.getAttribute("data-state") !== "closed"
  && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
const visible = (element: HTMLElement) => rendered(element) && !element.closest('[inert], [aria-hidden="true"]')
  && !element.matches(':disabled, [aria-disabled="true"]');
const lastVisible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter(visible).at(-1);
const navigationScope = () => lastVisible(portals) ?? lastVisible("[data-tv-navigation-scope]")
  ?? document.querySelector<HTMLElement>(".watch-mode") ?? document.body;
const controlsIn = (scope: HTMLElement) => [...scope.querySelectorAll<HTMLElement>(focusable)].filter(element => visible(element)
  && (!remoteNavigation || !element.closest(localOnly))
  && !element.matches('[role="tablist"], [role="tabpanel"]')
  && (element.tabIndex >= 0 || element.matches('[role="option"], [role^="menuitem"]')));

function focus(element: HTMLElement | undefined) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function moveFocus(key: string) {
  const scope = navigationScope();
  const controls = controlsIn(scope);
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !scope.contains(active) || !visible(active) || active === scope
    || remoteNavigation && active.closest(localOnly)) {
    focus(controls[0]);
    return;
  }
  if (key === "ArrowDown" && active.closest(".app-header")) {
    const first = scope.querySelector<HTMLElement>("[data-page-first]");
    if (first && visible(first)) { focus(first); return; }
  }
  if (key === "ArrowDown" && active.closest(".player-page [role=slider]")) {
    const play = scope.querySelector<HTMLElement>(".player-page .play-button");
    if (play && visible(play)) { focus(play); return; }
  }
  const from = active.getBoundingClientRect();
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const cx = from.x + from.width / 2, cy = from.y + from.height / 2;
  const candidates = controls.filter(element => element !== active).map(element => {
    const to = element.getBoundingClientRect();
    const dx = to.x + to.width / 2 - cx, dy = to.y + to.height / 2 - cy;
    const forward = (horizontal ? dx : dy) * sign;
    const across = Math.abs(horizontal ? dy : dx);
    const overlap = horizontal ? to.bottom > from.top && to.top < from.bottom : to.right > from.left && to.left < from.right;
    return { element, forward, score: forward + across * 2 + (overlap ? 0 : 1000) };
  }).filter(candidate => candidate.forward > 1).sort((a, b) => a.score - b.score);
  focus(candidates[0]?.element);
}

function sendKey(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
}

// Home and Info change the TV's screen/overlay state in App. Other keys act on
// its real DOM, including Radix portals, without changing a controller's page.
export function applyTvNavigation(key: NavigationKey) {
  if (key === "home" || key === "info") return false;
  // A nested Radix portal can aria-hide its parent dialog without closing it.
  if (key !== "back" && [...document.querySelectorAll<HTMLElement>(portals)].some(element => element.closest(localOnly) && rendered(element))) return true;
  const previous = remoteNavigation;
  remoteNavigation = true;
  try {
    document.documentElement.setAttribute("data-keyboard", "");
    const scope = navigationScope();
    if (key !== "back" && scope.querySelector(".player-band-hidden")) {
      sendKey(document.body, key === "select" ? "Enter" : { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[key]);
      return true;
    }
    let target = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement) && visible(document.activeElement)
      ? document.activeElement : null;
    if (key !== "back" && target?.closest(localOnly)) {
      if (key === "select") return true;
      const tablist = target.closest('[role="tablist"]');
      if (tablist && target.matches('[role="tab"]') && (key === "left" || key === "right")) {
        const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
        const index = tabs.indexOf(target), direction = key === "left" ? -1 : 1;
        for (let step = 1; step < tabs.length; step++) {
          const candidate = tabs[(index + direction * step + tabs.length) % tabs.length]!;
          if (visible(candidate) && !candidate.closest(localOnly)) { focus(candidate); return true; }
        }
      }
      target = null;
    }
    if (!target || target === scope) {
      target = controlsIn(scope)[0] ?? scope;
      focus(target);
      // The first directional press establishes focus rather than skipping over it.
      if (key !== "select" && key !== "back") return true;
    }
    if (key === "back") {
      sendKey(target, "Escape");
    } else if (key === "select") {
      if (target.closest('[role="combobox"], [role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"]')) sendKey(target, "Enter");
      else target.click();
    } else {
      const arrow = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[key];
      const slider = target.closest('[role="slider"]');
      const crossSlider = slider && (slider.getAttribute("aria-orientation") === "vertical"
        ? key === "left" || key === "right" : key === "up" || key === "down");
      if (crossSlider || target.closest('[role="combobox"][aria-expanded="false"], input:not([role="combobox"]), textarea, [contenteditable="true"]')) moveFocus(arrow);
      else sendKey(target, arrow);
    }
    return true;
  } finally {
    remoteNavigation = previous;
  }
}

// Radix owns navigation within its controls; spatial movement connects the rest.
export function useNavigation(onBack: () => void) {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const keyboard = () => document.documentElement.setAttribute("data-keyboard", "");
    const pointer = () => document.documentElement.removeAttribute("data-keyboard");
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === "Escape" || event.key === "BrowserBack") {
        if (lastVisible(portals)) return;
        event.preventDefault();
        const localBack = [...navigationScope().querySelectorAll<HTMLButtonElement>("[data-back]")].find(visible);
        // The component restores focus after its own navigation has committed.
        if (localBack) localBack.click();
        else back.current();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="slider"]')) return;
      if (target?.closest('[role="tablist"]') && ["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      moveFocus(event.key);
    };
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", keydown);
    };
  }, []);
}
