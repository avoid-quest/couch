import { useCallback, useEffect, useMemo, useRef } from "react";
import { defaultStringifySearch, useLocation, useRouter, useSearch } from "@tanstack/react-router";
import { providerForUrl, type ProviderItem } from "../shared/providers";
import type { QueueEntry } from "../shared/protocol";
import { isTvPresentation } from "./session/presentation";
import { focusPageControl } from "./navigation";
import { detailFrom, sectionForPath } from "../shared/page-paths";

type FocusTarget = { selector: string; index: number };
type PageOpener = { href: string; index: number };
declare module "@tanstack/react-router" {
  interface HistoryState { detailFocus?: FocusTarget; pageOpener?: PageOpener }
}

export const itemLocation = (kind: "history" | "saved" | "radio" | "queue", id: string) => `/item${defaultStringifySearch({ kind, id })}`;
export const collectionLocation = (item: Pick<ProviderItem, "provider" | "url" | "collection">, search: { cursors?: string[]; page?: number; filter?: string } = {}) => `/collection${defaultStringifySearch({ provider: item.provider, url: item.url, ...(item.collection ? { context: item.collection } : {}),
  ...(search.cursors?.length ? { cursors: search.cursors } : {}), ...(search.page && search.page > 1 ? { page: search.page } : {}), ...(search.filter ? { filter: search.filter } : {}) })}`;

/** An item or collection page's address, carrying the section it opens in (`from`) unless it already has one. */
/**
 * A Details or collection page's own search: its route match's, not the location's, which while a navigation away is
 * pending (Play opening the player) already names the next page, so the page would flash "Item not found".
 */
export const useOwnSearch = <T,>(read: (search: Record<string, unknown>) => T) => read(useSearch({ strict: false }));

export function keepSection(href: string, section: string | undefined) {
  const from = detailFrom(section);
  return from && /^\/(?:item|collection)\?/.test(href) && !/[?&]from=/.test(href) ? `${href}&from=${from}` : href;
}

/** A detail link as rendered: a new tab (Ctrl/Cmd-click, middle-click) skips open(), so the link itself keeps the section. */
export const detailHref = (href: string) => typeof location === "undefined" ? href : keepSection(href, sectionForPath(location.pathname, location.search));

export function queueItemLocation(entry: Pick<QueueEntry, "id" | "source" | "collection">) {
  const url = entry.source.replace(/^web:/, ""), provider = providerForUrl(url);
  return entry.source.startsWith("radio:") ? itemLocation("radio", entry.source.slice(6)) : provider ? collectionLocation({ provider, url, collection: entry.collection }) : itemLocation("queue", entry.id);
}

function opener(selector?: string): FocusTarget | undefined {
  const active = document.activeElement;
  if (selector) return { selector, index: 0 };
  if (!(active instanceof HTMLElement) || active === document.body) return;
  const label = active.getAttribute("aria-label");
  // Radix's generated ids (a menu's "…") change when the page mounts again, so those controls go by their label.
  const id = active.id.startsWith("radix-") ? "" : active.id;
  const href = active.getAttribute("href");
  selector = id ? `#${CSS.escape(id)}` : label ? `${active.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]`
    : href ? `a[href="${CSS.escape(href)}"]` : undefined;
  if (!selector) return;
  // The persistent bar may hold the same link before the returning page mounts.
  // Keep its occurrence within its own page or bar, rather than the whole document.
  const page = active.closest<HTMLElement>("[data-page]")?.dataset.page;
  const scope = page ? `[data-page="${CSS.escape(page)}"]` : active.closest("[data-now-playing]") ? "[data-now-playing]" : "";
  if (scope) selector = `${scope} ${selector}`;
  return { selector, index: [...document.querySelectorAll(selector)].indexOf(active) };
}

export function restoreDetailFocus(target?: FocusTarget) {
  const element = target && document.querySelectorAll<HTMLElement>(target.selector)[target.index];
  if (!element || element.matches(":disabled") || element.closest("[inert]")) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

export function useDetailNavigation() {
  const router = useRouter({ warn: false });
  const open = useCallback((href: string, focusSelector?: string) => {
    if (!router) return;
    const location = router.state.location;
    const focus = opener(focusSelector);
    if (focus) {
      router.history.replace(location.href, { ...location.state, detailFocus: focus });
      router.history.flush();
    }
    // An item or collection page keeps the section it was opened from: its tab, breadcrumb and Back's fallback.
    void router.navigate({ href: keepSection(href, sectionForPath(location.pathname, location.searchStr)), state: { pageOpener: { href: location.href, index: location.state.__TSR_index } } });
  }, [router]);
  const back = useCallback((fallback = "/search") => {
    if (!router) return;
    const target = router.state.location.state.pageOpener;
    const distance = target && target.index - router.state.location.state.__TSR_index;
    // Return to the actual opener, skipping intervening player/queue entries.
    if (distance && distance < 0) router.history.go(distance);
    else if (target) void router.navigate({ href: target.href, replace: true });
    else if (router.state.location.pathname !== "/now" && router.history.canGoBack()) router.history.back();
    else void router.navigate({ href: fallback, replace: true });
  }, [router]);
  return useMemo(() => ({ open, back }), [open, back]);
}

// Keep the origin's focus target in its own history entry, including across reload.
// Results can arrive after the route mounts, so restore when the target appears.
export function DetailFocusRestoration() {
  const location = useLocation();
  const router = useRouter();
  const previousPage = useRef<string | null>(null);
  useEffect(() => {
    const filterable = ["/search", "/collection", "/radio", "/live-tv"].includes(location.pathname);
    const params = new URLSearchParams(location.searchStr);
    if (filterable) {
      for (const name of ["filter", "page", "radioSource", "group", ...location.pathname === "/search" ? ["source", "kind"] : []]) params.delete(name);
    }
    params.sort();
    const pageKey = location.pathname + "?" + params;
    const samePage = previousPage.current === pageKey;
    previousPage.current = pageKey;
    // Filtering updates the URL without entering a new page. Keep the active field/picker;
    // pagination already moves focus to its count, and Back from Details still restores the opener.
    if (filterable && samePage) return;
    const tv = isTvPresentation();
    const target = location.state.detailFocus ?? (["/item", "/collection"].includes(location.pathname) ? { selector: "[data-page] h1", index: 0 } : undefined);
    if (location.pathname === "/now" && !target) return;
    if (!target && !tv) return;
    const returning = !!location.state.detailFocus;
    const home = tv && !returning && location.pathname === "/";
    let fallbackFocus: Element | null = null;
    const restore = () => {
      if (tv && !returning) {
        const page = document.querySelector<HTMLElement>("[data-page]");
        if (page) focusPageControl(page);
        // A page's first control can render after later ones (Home's hero waits for its data), so focus
        // elsewhere stays provisional and moves to it when it appears, unless a key or pointer came first.
        if (!document.activeElement?.matches("[data-page-first]")) fallbackFocus = document.activeElement;
        return !!page?.contains(document.activeElement) && document.activeElement !== document.body;
      }
      if (restoreDetailFocus(target)) return true;
      // Removing a saved item can remove its opener. Keep focus on the page
      // while allowing an asynchronously loaded opener to take precedence.
      if (returning && location.pathname !== "/now") {
        const page = document.querySelector<HTMLElement>("[data-page]");
        if (page) { focusPageControl(page); fallbackFocus = document.activeElement; }
      }
      return false;
    };
    // Cached results can briefly restore an opener that a fresh result removes.
    // Keep watching for lost focus until input, navigation or the timeout.
    // Fresh Home entry waits until input or navigation, even for slow catalogues.
    restore();
    let restoring = false;
    const observer = new MutationObserver(() => {
      // Home's reordered shelves can load out of order. Until input, an earlier
      // shelf's first tile takes precedence over a later shelf's provisional entry.
      const homeEntry = home && document.activeElement?.matches("[data-page-first]");
      if (document.activeElement !== document.body && document.activeElement !== fallbackFocus && !homeEntry) return;
      // Sharing is intentional, not a delayed catalogue response: its arrival keeps the current tile.
      if (homeEntry && document.querySelector('[data-page="Home"] [data-page-first]:not(:disabled)')?.closest('[aria-label="Shared sources"]')) return;
      // Loading can replace the first control; settle again if it lost focus.
      restoring = true;
      try { restore(); } finally { restoring = false; }
    });
    const chosen = () => { if (!restoring) stop(); };
    const stop = () => {
      observer.disconnect(); clearTimeout(timer); unsubscribe();
      window.removeEventListener("keydown", stop, true);
      window.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("focusin", chosen, true);
    };
    const timer = home ? undefined : setTimeout(stop, 15_000);
    const unsubscribe = router.subscribe("onBeforeNavigate", stop);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "inert"] });
    window.addEventListener("keydown", stop, true);
    window.addEventListener("pointerdown", stop, true);
    window.addEventListener("focusin", chosen, true);
    return stop;
  }, [location.state.__TSR_key, router]);
  return null;
}
