// Run in a paired TV with a stopped, decoded finite video in Continue and a
// second online shared output. Stop that item on every output first. See
// docs/native-tv.md. Uses real handlers/APIs.
declare global {
  interface Window {
    runContinueDetailsRegression: (unavailable?: boolean) => Promise<{ passed: boolean; error?: string }>;
    runNarrowSettingsRegression: () => Promise<{ passed: boolean; error?: string }>;
    runBusyLiveHitRegression: () => Promise<{ passed: boolean; error?: string }>;
  }
}

const wait = (ms = 350) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (condition: () => boolean, message = "Continue fixture did not settle") => {
  for (let i = 0; i < 40; i++) { if (condition()) return; await wait(100); }
  throw new Error(message);
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const press = async (key: string) => {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
  await wait();
};
const usable = (element: HTMLElement) => !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0;

window.runContinueDetailsRegression = async (unavailable = false) => {
  try {
    document.querySelector<HTMLElement>('[data-app-nav] a[href="/"]')!.click(); await wait();
    const row = document.querySelector<HTMLElement>('[aria-label="Continue"] [data-history-details]')!;
    assert(row, "Stop a real finite video before completion");
    const id = row.dataset.historyDetails!;
    const resume = row.querySelector<HTMLElement>('[data-media-tile]')!;
    const details = row.querySelector<HTMLElement>('button[aria-label^="Details "]')!;
    assert(details && usable(details), "Continue lacks reachable History Details");
    assert(row.querySelectorAll('button,a[href]').length === 2 && !resume.querySelector('button,a[href]'), "Continue must have only sibling Resume and Details controls");
    assert(details.getBoundingClientRect().height >= 44, "Continue Details target is smaller than 44px");
    assert(resume.getAttribute("aria-label")?.startsWith("Resume "), "Continue lost primary Resume");
    assert(!unavailable || resume.matches(":disabled"), "Use an unavailable Continue fixture");
    const paused = document.querySelector('video')?.paused;
    details.focus(); details.click();
    await until(() => !!document.querySelector('[data-page="Item"] button[aria-label^="Options"]'));
    assert(new URLSearchParams(location.search).get("kind") === "history" && new URLSearchParams(location.search).get("id") === id, "Details opened the wrong history item");
    assert(document.querySelector('video')?.paused === paused, "Inspection started playback");
    await press("Escape"); await wait();
    const opener = document.activeElement as HTMLElement;
    assert(opener?.getAttribute("aria-label") === details.getAttribute("aria-label") && usable(opener), "Back lost the usable Continue Details opener");
    await press("Enter");
    // Synthetic Enter is for spatial navigation/menu activation; native buttons
    // need click to activate without the browser's trusted default action.
    if (location.pathname === "/") opener.click();
    await until(() => !!document.querySelector('[data-page="Item"] button[aria-label^="Options"]'));
    const options = async () => { document.querySelector<HTMLElement>('[data-page="Item"] button[aria-label^="Options"]')!.focus(); await press("Enter"); };
    const menu = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent === label);
    await options();
    assert(menu("From start") && menu("Queue") && menu("Remove from Continue") && (unavailable || document.querySelector('[role="group"][aria-label="Play on"] [role="menuitem"]:not([data-disabled])')), "History Details lacks Continue actions or playable targets");
    if (unavailable) {
      assert(menu("From start")!.hasAttribute("data-disabled") && document.querySelector('[data-page="Item"] button:disabled') && !menu("Remove from Continue")!.hasAttribute("data-disabled"), "Unavailable History lost disabled playback or enabled removal");
    } else {
      const originalFetch = window.fetch;
      let queued = false;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (new URL(String(args[0]), location.href).pathname === `/api/progress/${encodeURIComponent(id)}/queue` && response.ok) queued = true;
        return response;
      };
      try { menu("Queue")!.click(); await until(() => queued); }
      finally { window.fetch = originalFetch; }
      assert(location.pathname === "/item" && document.querySelector('video')?.paused === paused, "Queue started playback or left Details");
      await options();
    }
    const originalFetch = window.fetch;
    let removed = false;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (new URL(String(args[0]), location.href).pathname === `/api/progress/${encodeURIComponent(id)}` && args[1]?.method === "POST" && response.ok) removed = true;
      return response;
    };
    try {
      menu("Remove from Continue")!.click();
      await until(() => removed, "Continue removal did not complete; stop this fixture on every output first");
    } finally { window.fetch = originalFetch; }
    await until(() => !document.querySelector('[role="menu"]'));
    await press("Escape");
    await until(() => location.pathname === "/" && !document.querySelector(`[aria-label="Continue"] [data-history-details="${id}"]`));
    const fallback = document.activeElement as HTMLElement;
    assert(fallback?.closest('[data-page]') && usable(fallback), "Removed Continue opener lost usable page focus");
    // Clearing resume can move the same History item to the last Recent shelf.
    // Up has a destination there; Down is legitimately at the page boundary.
    await press("ArrowUp");
    const next = document.activeElement;
    assert(next !== fallback && next instanceof HTMLElement && usable(next), "Next arrow could not leave the removed opener fallback");
    const undo = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast] button')].find(element => element.textContent === "Undo");
    assert(undo, "Continue removal did not offer Undo");
    undo!.click();
    await until(() => !!document.querySelector(`[aria-label="Continue"] [data-history-details="${id}"]`));
    await wait();
    assert(document.activeElement === next, "Continue Undo stole deliberate focus");
    return { passed: true };
  } catch (error) { return { passed: false, error: String(error) }; }
};

// Use a sub-md TV viewport; repeat at Default and confirmed Largest text size.
window.runNarrowSettingsRegression = async () => {
  try {
    document.querySelector<HTMLElement>('[data-app-nav] a[href="/settings"]')!.click();
    await until(() => !!document.querySelector('#local-device-name'));
    const selector = document.querySelector<HTMLElement>('[aria-label="Settings page"]')!;
    assert(usable(selector), "Use a narrow TV viewport with its visible Settings selector");
    document.querySelector<HTMLElement>('#local-device-name')!.focus();
    await press("Escape");
    assert(document.activeElement === selector && usable(selector), "Settings Back did not focus visible navigation");
    await press("Enter");
    assert(document.querySelector('[role="listbox"]'), "Restored Settings selector could not open");
    await press("Escape");
    assert(document.activeElement === selector, "Settings selector overlay lost its opener");
    await press("Escape");
    assert(location.pathname === "/", "Settings navigation Back did not reach Home");
    return { passed: true };
  } catch (error) { return { passed: false, error: String(error) }; }
};

// Hold only the successful real Save response. Restore that fixture favorite
// afterward; never substitute a request, response body or permissions/busy state.
window.runBusyLiveHitRegression = async () => {
  const originalFetch = window.fetch;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saved: { url: string; init: RequestInit; id: string } | undefined;
  try {
    document.querySelector<HTMLElement>('[data-app-nav] a[href="/find"]')!.click(); await wait();
    document.querySelector<HTMLElement>('button[aria-label="Open Radio"]')!.click();
    await until(() => !!document.querySelector('[data-hit-id] button[aria-label^="Options"]'));
    const row = document.querySelector<HTMLElement>('[data-hit-id]')!;
    const id = row.dataset.hitId!.split(":").at(-1)!;
    const options = row.querySelector<HTMLElement>('button[aria-label^="Options"]')!;
    options.focus(); await press("Enter");
    const save = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent === "Save");
    assert(save && usable(save), "First Radio fixture must be unsaved");
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = new URL(String(args[0]), location.href);
      if (url.pathname === "/api/radio/favorites" && args[1]?.method === "POST" && response.ok) {
        saved = { url: url.href, init: args[1], id };
        await gate;
      }
      return response;
    };
    save!.click(); await until(() => !!saved); await wait(850);
    const open = row.querySelector<HTMLElement>('[data-play]')!;
    assert(open.getAttribute("aria-label")?.startsWith("Open ") && usable(open) && open.getAttribute("href") === `/item?kind=radio&id=${id}`, "Pending Save hid the original enabled Open destination");
    assert(row.querySelector('button[aria-label^="Options"]') && row.querySelector('button[aria-label^="Play"]:disabled'), "Busy Play or secondary actions changed");
    const paused = document.querySelector('video')?.paused;
    open.focus(); open.click();
    await until(() => new URLSearchParams(location.search).get("kind") === "radio" && new URLSearchParams(location.search).get("id") === id && !!document.querySelector('[data-page="Item"] button[aria-label^="Options"]'));
    assert(document.querySelector('video')?.paused === paused, "Open started playback");
    await press("Escape"); await wait();
    // Remount ends this row's busy lifetime and restores Play, so the temporary
    // Open opener can disappear. Existing navigation must retain usable page focus.
    assert(location.search.includes("browse=radio") && document.activeElement?.closest('[data-page]') && usable(document.activeElement as HTMLElement), "Busy Open Back lost usable browse focus");
    return { passed: true };
  } catch (error) { return { passed: false, error: String(error) }; }
  finally {
    window.fetch = originalFetch; release();
    if (saved) await originalFetch(`${saved.url}/${encodeURIComponent(saved.id)}`, { ...saved.init, method: "DELETE", body: undefined, signal: undefined });
  }
};

export {};
