import { useEffect, useEffectEvent } from "react";
import type { NavigationKey } from "../shared/protocol";
import { isTvPresentation } from "./session/presentation";

const focusable = 'button, a[href], input, select, textarea, [tabindex="0"], [role="option"], [role^="menuitem"]';
const portals = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-slot="popover-content"]';
const localOnly = '[data-tv-local-only]';
const toaster = "[data-sonner-toaster]";
let remoteNavigation = false;
// The TV fader that OK handed the Up/Down keys to (#644 ticket 12).
let adjusting: HTMLElement | null = null;
function adjust(fader: HTMLElement | null) {
  adjusting?.removeAttribute("data-adjusting");
  adjusting = fader;
  fader?.setAttribute("data-adjusting", "");
}
const rendered = (element: HTMLElement) => !element.closest('[hidden]')
  && element.closest(portals)?.getAttribute("data-state") !== "closed"
  && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
const visible = (element: HTMLElement) => rendered(element) && !element.closest('[inert], [aria-hidden="true"]')
  && !element.matches(':disabled, [aria-disabled="true"]');
const lastVisible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter(visible).at(-1);
const navigationScope = () => lastVisible(portals) ?? lastVisible("[data-tv-navigation-scope]")
  ?? document.querySelector<HTMLElement>(".watch-mode") ?? document.body;
// A toast's action is reached only by Up past the top (moveFocus), never in passing.
const controlsIn = (scope: HTMLElement) => [...scope.querySelectorAll<HTMLElement>(focusable)].filter(element => visible(element)
  && !element.closest(toaster) && (!remoteNavigation || !element.closest(localOnly))
  && !element.matches('[role="tablist"], [role="tabpanel"]')
  && (element.tabIndex >= 0 || element.matches('[role="option"], [role^="menuitem"]')));
// With nothing focused (after a page change), the first key starts in the page, not on the header.
const entry = (controls: HTMLElement[]) => controls.find(element => element.matches("[data-page-first]")) ?? controls.find(element => element.closest("[data-page]")) ?? controls[0];

// A slider is placed by its whole track, not by its thumb, which moves with the value.
const box = (element: Element) => (element.closest('[data-slot="slider"]') ?? element).getBoundingClientRect();

function focus(element: HTMLElement | undefined) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Use the same enabled, visible controls for page entry as for D-pad movement. */
export function focusPageControl(scope: HTMLElement) {
  focus(entry(controlsIn(scope)) ?? scope.querySelector<HTMLElement>('h1[tabindex="-1"]') ?? undefined);
}

function moveFocus(key: string) {
  const scope = navigationScope();
  const controls = controlsIn(scope);
  const active = document.activeElement;
  // Any arrow leaves a toast's action; sonner returns focus to where it came from.
  if (active instanceof HTMLElement && active.closest(toaster)) { active.blur(); return; }
  if (!(active instanceof HTMLElement) || !scope.contains(active) || !visible(active) || active === scope
    || remoteNavigation && active.closest(localOnly)) {
    focus(entry(controls));
    return;
  }
  if (key === "ArrowDown" && active.closest(".app-header")) {
    const first = [...scope.querySelectorAll<HTMLElement>("[data-page-first]")].find(element => visible(element) && (!remoteNavigation || !element.closest(localOnly)));
    if (first) { focus(first); return; }
  }
  if (key === "ArrowDown" && active.closest(".player-page [role=slider]")) {
    const play = scope.querySelector<HTMLElement>(".player-page [data-play-button]");
    if (play && visible(play)) { focus(play); return; }
  }
  const from = box(active);
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const own = active.closest("[data-nav-row]");
  const row = key === "ArrowRight" ? own : null;
  const destinations = row ? controls.filter(element => row.contains(element)) : controls;
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const cx = from.x + from.width / 2, cy = from.y + from.height / 2;
  // How far a box starts past the active's top (Up) or bottom (Down) edge.
  const past = (to: DOMRect) => sign < 0 ? from.top - to.bottom : to.top - from.bottom;
  // The header and the footer (now-playing bar, phone tabs) come after the page's controls, which scroll under them.
  const bar = key === "ArrowUp" ? ".app-header" : key === "ArrowDown" ? ".app-footer" : null;
  const later = bar && !active.closest(bar) ? bar : null;
  const candidates = destinations.filter(element => element !== active).map(element => {
    const to = box(element);
    const dx = to.x + to.width / 2 - cx, dy = to.y + to.height / 2 - cy;
    const forward = (horizontal ? dx : dy) * sign;
    // The sideways gap between the edges, not the centres, so a wide row under a short title is in line with it.
    const gap = horizontal ? Math.max(to.top - from.bottom, from.top - to.bottom) : Math.max(to.left - from.right, from.left - to.right);
    // Up and Down reach a control in the active's own row only past its edge (a wrapped line, Continue's Details),
    // never one beside it, though a shorter or taller caption moves that one's centre.
    const beside = !horizontal && !!own?.contains(element) && past(to) < 0;
    return { element, forward, beside, score: forward + (gap < 0 ? 0 : gap * 2 + 1000) + (later && element.closest(later) ? 100_000 : 0) };
  }).filter(candidate => candidate.forward > 1 && !candidate.beside).sort((a, b) => a.score - b.score);
  // Up and Down from a row reach the nearest row first, so Home's shelves are walked one by one, never
  // skipped for a farther control that lines up. A row counts by its own box; ties keep the best score.
  const reach = !horizontal && own ? candidates.map(candidate => {
    const row = candidate.element.closest<HTMLElement>("[data-nav-row]");
    const unit = row && !row.contains(active) ? row : null, to = box(unit ?? candidate.element);
    return { row: unit, edge: Math.max(0, past(to)) };
  }) : [];
  const nearest = reach.reduce<number>((best, unit, index) => unit.edge < reach[best]!.edge ? index : best, 0);
  const next = reach[nearest]?.row;
  const best = next ? candidates.find(candidate => next.contains(candidate.element)) : candidates[0];
  // Up into the header lands on the current tab, as Down out of it lands on the page's first control.
  const tab = key === "ArrowUp" && later && best?.element.closest(later)
    ? [...scope.querySelectorAll<HTMLElement>('.app-header [aria-current="page"]')].find(visible) : undefined;
  // Up with nothing above (the header's tabs, the top of the player's band) reaches the newest toast's action.
  const toast = key === "ArrowUp" && !best ? [...scope.querySelectorAll<HTMLElement>(`${toaster} [data-button]`)].find(visible) : undefined;
  focus(tab ?? best?.element ?? toast);
}

export function sendKey(target: HTMLElement, key: string) {
  const code = key === " " ? "Space" : key;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, code, bubbles: true, cancelable: true }));
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
    if (key !== "back" && scope.querySelector("[data-player-band=hidden]")) {
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
      target = entry(controlsIn(scope)) ?? scope;
      focus(target);
      // The first directional press establishes focus rather than skipping over it.
      if (key !== "select" && key !== "back") return true;
    }
    if (key === "back") {
      sendKey(target, "Escape");
    } else if (key === "select") {
      if (target.closest('[role="combobox"], [aria-haspopup="menu"], [role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="slider"], [aria-roledescription="sortable"]')) sendKey(target, "Enter");
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
  const back = useEffectEvent(onBack);
  useEffect(() => {
    const keyboard = () => document.documentElement.setAttribute("data-keyboard", "");
    const pointer = () => document.documentElement.removeAttribute("data-keyboard");
    // Controls that keep every arrow key trap a remote (#644 ticket 12), so these keys move on instead:
    // the keys past a radio group's first or last radio (Radix loops them), and on the TV Up/Down across a
    // horizontal slider, Up/Down in a one-line field, and every arrow on a closed select or menu button (OK opens it).
    // A TV fader (a vertical slider, or a Volume, which shares its row with the player's tools)
    // moves on with every arrow too, until OK hands it the keys along it; OK, Back or leaving it hands
    // them back, as TV equalisers do.
    const leave = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const tv = isTvPresentation();
      const slider = target?.closest<HTMLElement>('[role="slider"]');
      const upright = slider?.getAttribute("aria-orientation") === "vertical";
      const fader = tv && (upright || slider?.closest("[data-volume]")) ? slider! : null;
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      const radio = target?.closest<HTMLElement>('[role="radio"]');
      const radios = [...radio?.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []].filter(visible);
      if (fader && (event.key === "Enter" || event.key === "Escape" && adjusting === fader)) adjust(adjusting === fader ? null : fader);
      else if (event.key.startsWith("Arrow") && (radio && radios.at(event.key === "ArrowDown" || event.key === "ArrowRight" ? -1 : 0) === radio
        || fader && !(vertical === upright && adjusting === fader)
        || tv && vertical && (slider && !fader || target?.matches('input:not([role="combobox"])'))
        || tv && target?.matches('button[role="combobox"][aria-expanded="false"], button[aria-haspopup="menu"][aria-expanded="false"]'))) moveFocus(event.key);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const release = (event: FocusEvent) => { if (event.target === adjusting) adjust(null); };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === "Escape" || event.key === "BrowserBack") {
        if (lastVisible(portals)) return;
        event.preventDefault();
        // Back on a toast's action leaves it, as sonner returns focus to where it came from.
        if (target?.closest(toaster)) { target.blur(); return; }
        const localBack = [...navigationScope().querySelectorAll<HTMLButtonElement>("[data-back]")].find(visible);
        // The component restores focus after its own navigation has committed.
        if (localBack) localBack.click();
        else back();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="slider"]')) return;
      // Off the TV, the player's picture keeps its arrows for its shortcuts, even where one can't act (live media can't seek).
      if (!isTvPresentation() && target?.matches("[data-player-surface]")) return;
      if (target?.closest('[role="tablist"]') && ["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      moveFocus(event.key);
    };
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("keydown", leave, true);
    window.addEventListener("focusout", release, true);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("keydown", leave, true);
      window.removeEventListener("focusout", release, true);
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", keydown);
    };
  }, []);
}
