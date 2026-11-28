import { useLayoutEffect, type RefObject } from "react";

/**
 * The box's items that it would cut wait unseen, as the prototype's side player does; with none left the box hides
 * too. Measured again whenever the box or an item resizes, and when `key` (what the items are) changes.
 */
export function useUncut(box: RefObject<HTMLElement | null>, items: string, key: string) {
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const fit = () => {
      const all = [...element.querySelectorAll<HTMLElement>(items)];
      for (const item of all) item.hidden = false;
      const limit = element.getBoundingClientRect().bottom + 1;
      let shown = 0;
      for (const item of all) {
        item.hidden = item.getBoundingClientRect().bottom > limit;
        if (!item.hidden) shown++;
      }
      element.style.visibility = all.length && !shown ? "hidden" : "";
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    // An item can grow inside a box that doesn't (a late font, a line that wraps anew).
    for (const item of element.querySelectorAll(items)) observer.observe(item);
    fit();
    return () => observer.disconnect();
  }, [box, items, key]);
}
