import { useEffect } from "react";
import { defaultStringifySearch, useLocation, useRouter } from "@tanstack/react-router";
import type { ProviderItem } from "../shared/providers";

type FocusTarget = { selector: string; index: number };
declare module "@tanstack/react-router" {
  interface HistoryState { detailFocus?: FocusTarget }
}

export const itemLocation = (kind: "history" | "saved" | "radio", id: string) => `/item${defaultStringifySearch({ kind, id })}`;
export const collectionLocation = (item: Pick<ProviderItem, "provider" | "url" | "collection">, search: { cursors?: string[]; page?: number; filter?: string } = {}) => `/collection${defaultStringifySearch({ provider: item.provider, url: item.url, ...(item.collection ? { context: item.collection } : {}),
  ...(search.cursors?.length ? { cursors: search.cursors } : {}), ...(search.page && search.page > 1 ? { page: search.page } : {}), ...(search.filter ? { filter: search.filter } : {}) })}`;

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
    open(href: string, focusSelector?: string) {
      if (!router) return;
      const focus = opener(focusSelector);
      if (focus) {
        router.history.replace(router.state.location.href, { ...router.state.location.state, detailFocus: focus });
        router.history.flush();
      }
      void router.navigate({ href });
    },
    back(fallback = "/find") {
      if (!router) return;
      if (router.history.canGoBack()) router.history.back();
      else void router.navigate({ href: fallback, replace: true });
    },
  };
}

// Keep the origin's focus target in its own history entry, including across reload.
// Results can arrive after the route mounts, so restore when the target appears.
export function DetailFocusRestoration() {
  const location = useLocation();
  useEffect(() => {
    const target = location.state.detailFocus ?? (["/item", "/collection"].includes(location.pathname) ? { selector: "[data-page] h1", index: 0 } : undefined);
    if (!target) return;
    const restore = () => {
      const element = document.querySelectorAll<HTMLElement>(target.selector)[target.index];
      if (!element) return false;
      element.focus({ preventScroll: true });
      return true;
    };
    const returning = !!location.state.detailFocus;
    if (restore() && returning) return;
    const observer = new MutationObserver(() => {
      if (document.activeElement !== document.body) return;
      if (restore() && returning) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.state.__TSR_key]);
  return null;
}
