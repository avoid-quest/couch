import type { AnyRouter } from "@tanstack/react-router";
import { focusPageControl } from "@/navigation";

// Stop may reveal a loading page. Its heading/other controls are provisional
// until the primary control arrives, unless the user chooses or navigates away.
function recoverPageFocus(page: HTMLElement, router: AnyRouter) {
  let provisional: Element | null = document.body;
  let restoring = false;
  const restore = () => {
    if (
      !page.isConnected ||
      (document.activeElement !== document.body && document.activeElement !== provisional)
    ) {
      stop();
      return;
    }
    restoring = true;
    focusPageControl(page);
    provisional = document.activeElement;
    restoring = false;
    if (provisional?.matches("[data-page-first]")) stop();
  };
  const observer = new MutationObserver(restore);
  const chosen = () => {
    if (!restoring) stop();
  };
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("keydown", stop, true);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("focusin", chosen, true);
  };
  const timer = setTimeout(stop, 15_000);
  const unsubscribe = router.subscribe("onBeforeNavigate", stop);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "inert"],
  });
  window.addEventListener("keydown", stop, true);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("focusin", chosen, true);
  restore();
}

/** Call while a commit removes the focused control: after it, return lost focus to the
 * same page, leaving navigation and any deliberately chosen target alone. */
export function returnLostFocus(router: AnyRouter) {
  const page = document.querySelector<HTMLElement>("[data-page]");
  const location = router.state.location;
  // The player puts focus on its own picture.
  queueMicrotask(() => {
    if (
      page?.isConnected &&
      !page.matches('[data-page="Now"]') &&
      router.state.location === location &&
      document.activeElement === document.body
    )
      recoverPageFocus(page, router);
  });
}
