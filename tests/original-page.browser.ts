// On a scratch Couch, open a saved webpage's Details, then build/evaluate this
// as an IIFE (docs/native-tv.md) and call runOriginalPageRegression().
import { applyTvNavigation, sendKey } from "../src/client/navigation";

const wait = () => new Promise(resolve => setTimeout(resolve, 100));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

async function runOriginalPageRegression() {
  const opener = document.querySelector<HTMLButtonElement>('[data-page="Item"] [data-row-options]');
  assert(opener, "Open a saved webpage's Details first");
  const page = location.href;
  const results: string[] = [];
  const open = async () => {
    if (!document.querySelector('[role="menu"]')) { opener!.focus(); sendKey(opener!, "Enter"); await wait(); }
    const link = document.querySelector<HTMLAnchorElement>('a[role="menuitem"][data-tv-local-only]');
    assert(link?.textContent === "Open in browser", "Missing browser action");
    assert(link!.target === "_blank" && link!.rel.includes("noopener"), "Browser link lost its separate safe browsing context");
    return link!;
  };
  // Observe the browser's default action without leaving the scratch page or opening external tabs.
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
    const link = await open();
    let intercepted: boolean | undefined;
    document.addEventListener("click", event => { intercepted = event.defaultPrevented; event.preventDefault(); }, { once: true });
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }));
    await wait();
    assert(intercepted === false && location.href === page, "Menu intercepted native link activation or changed the Couch route");
  }
  results.push("ordinary and modified clicks retain native link behavior");
  let link = await open();
  let clicks = 0;
  const observe = (event: MouseEvent) => { if ((event.target as Element).closest('a[data-tv-local-only]')) { clicks++; event.preventDefault(); } };
  document.addEventListener("click", observe);
  try {
    link.focus();
    applyTvNavigation("select");
    await wait();
    assert(clicks === 0, "Phone Remote launched the TV's browser");
    results.push("Remote-pad OK cannot launch a browser on the TV");
    sendKey(link, "Enter");
    await wait();
    assert(clicks === 1, "Local keyboard Enter did not activate the browser link");
    assert(document.activeElement === opener, "Closing the menu lost its opener");
    results.push("local Enter activates the link and restores menu focus");
    link = await open();
    const box = link.getBoundingClientRect();
    assert(box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, "Browser action falls outside the viewport");
    assert(document.documentElement.scrollWidth <= innerWidth, "Details overflows the viewport");
    results.push(`action fits ${innerWidth}×${innerHeight}`);
  } finally { document.removeEventListener("click", observe); }
  return { passed: true, results };
}

Object.assign(window, { runOriginalPageRegression });
