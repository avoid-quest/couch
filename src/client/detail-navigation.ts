import { useEffect } from "react";
import { defaultStringifySearch, useLocation, useRouter } from "@tanstack/react-router";
import { providerForUrl, type ProviderItem } from "../shared/providers";
import type { QueueEntry } from "../shared/protocol";
import { isTvPresentation } from "./session/native-context";
import { focusPageControl } from "./navigation";

type FocusTarget = { selector: string; index: number };
type PageOpener = { href: string; index: number };
declare module "@tanstack/react-router" {
  interface HistoryState { detailFocus?: FocusTarget; pageOpener?: PageOpener }
}

export const itemLocation = (kind: "history" | "saved" | "radio" | "queue", id: string) => `/item${defaultStringifySearch({ kind, id })}`;
export const collectionLocation = (item: Pick<ProviderItem, "provider" | "url" | "collection">, search: { cursors?: string[]; page?: number; filter?: string } = {}) => `/collection${defaultStringifySearch({ provider: item.provider, url: item.url, ...(item.collection ? { context: item.collection } : {}),
  ...(search.cursors?.length ? { cursors: search.cursors } : {}), ...(search.page && search.page > 1 ? { page: search.page } : {}), ...(search.filter ? { filter: search.filter } : {}) })}`;

export function queueItemLocation(entry: Pick<QueueEntry, "id" | "source" | "collection">) {
  const url = entry.source.replace(/^web:/, ""), provider = providerForUrl(url);
  return entry.source.startsWith("radio:") ? itemLocation("radio", entry.source.slice(6)) : provider ? collectionLocation({ provider, url, collection: entry.collection }) : itemLocation("queue", entry.id);
}

function opener(selector?: string): FocusTarget | undefined {
  const active = document.activeElement;
  if (selector) return { selector, index: 0 };
  if (!(active instanceof HTMLElement) || active === document.body) return;
  const label = active.getAttribute("aria-label");
  selector = active.id ? `#${CSS.escape(active.id)}` : label ? `${active.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]` : undefined;
  if (!selector) return;
  return { selector, index: [...document.querySelectorAll(selector)].indexOf(active) };
}

export function useDetailNavigation() {
  const router = useRouter({ warn: false });
  return {
    open(href: string, focusSelector?: string, viewTransition = false) {
      if (!router) return;
      const location = router.state.location;
      const focus = opener(focusSelector);
      if (focus) {
        router.history.replace(location.href, { ...location.state, detailFocus: focus });
        router.history.flush();
      }
      void router.navigate({ href, viewTransition, state: { pageOpener: { href: location.href, index: location.state.__TSR_index } } });
    },
    back(fallback = "/find") {
      if (!router) return;
      const target = router.state.location.state.pageOpener;
      const distance = target && target.index - router.state.location.state.__TSR_index;
      // Return to the actual opener, skipping intervening player/queue entries.
      if (distance && distance < 0) router.history.go(distance);
      else if (target) void router.navigate({ href: target.href, replace: true });
      else if (router.state.location.pathname !== "/now" && router.history.canGoBack()) router.history.back();
      else void router.navigate({ href: fallback, replace: true });
    },
  };
}

// Keep the origin's focus target in its own history entry, including across reload.
// Results can arrive after the route mounts, so restore when the target appears.
export function DetailFocusRestoration() {
  const location = useLocation();
  useEffect(() => {
    const tv = isTvPresentation();
    if (location.pathname === "/now") return;
    const target = location.state.detailFocus ?? (["/item", "/collection"].includes(location.pathname) ? { selector: "[data-page] h1", index: 0 } : undefined);
    if (!target && !tv) return;
    const returning = !!location.state.detailFocus;
    const restore = () => {
      if (tv && !returning) {
        const page = document.querySelector<HTMLElement>("[data-page]");
        if (page) focusPageControl(page);
        return !!page?.contains(document.activeElement) && document.activeElement !== document.body;
      }
      const element = target && document.querySelectorAll<HTMLElement>(target.selector)[target.index];
      if (!element) return false;
      element.focus({ preventScroll: true });
      return document.activeElement === element;
    };
    if (restore() && returning) return;
    const observer = new MutationObserver(() => {
      if (document.activeElement !== document.body) return;
      // Loading can replace the first control; settle again if it lost focus.
      if (restore() && returning) stop();
    });
    const stop = () => { observer.disconnect(); clearTimeout(timer); window.removeEventListener("keydown", stop, true); window.removeEventListener("pointerdown", stop, true); };
    const timer = setTimeout(stop, 15_000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "inert"] });
    window.addEventListener("keydown", stop, true);
    window.addEventListener("pointerdown", stop, true);
    return stop;
  }, [location.state.__TSR_key]);
  return null;
}
