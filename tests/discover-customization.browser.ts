// Run in a paired scratch TV at /settings/home. Build like tv-navigation.browser.ts.
// Uses the real settings, local storage, routes and Remote's navigation entry point; no playback starts.
import { applyTvNavigation } from "../src/client/navigation";
import { readDiscoverRows } from "../src/client/sections/discover/discover-rows";

const wait = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const control = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};
const click = async (selector: string) => { const element = control(selector); element.focus(); element.click(); await wait(); };
const remote = async (key: Parameters<typeof applyTvNavigation>[0]) => { applyTvNavigation(key); await wait(); };
const rows = () => JSON.parse(localStorage.getItem("couch.discover-rows") ?? "[]") as { id: string; shown: boolean }[];
const settings = '[data-section-rows="discover"]';
const switches = () => [...document.querySelectorAll<HTMLButtonElement>(`${settings} [role="switch"]`)];
const reset = async () => { const button = [...document.querySelectorAll<HTMLButtonElement>(`${settings} button`)].find(button => button.textContent === "Reset to default")!; button.click(); await wait(); };
const discover = async () => click('[data-app-nav] a[href="/discover"]');
const customize = async () => click('#customize-discover');
const first = () => document.querySelector('[data-page="Discover"] [data-page-first]:not(:disabled)');
const empty = () => control('[data-page="Discover"] [data-slot="empty"]').getClientRects().length > 0;

// Publish metadata through Core's real socket, without capturing or playing media.
// Run with Radio available and no other shared sources in the scratch Couch.
declare global { interface Window { runDiscoverSharingFocusRegression: () => Promise<unknown> } }
window.runDiscoverSharingFocusRegression = async () => {
  const saved = localStorage.getItem("couch.discover-rows");
  const token = localStorage.getItem("couch.remote-token")!;
  const { device } = await fetch("/api/devices/me", { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
  const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/ws?${new URLSearchParams({ token, device: device.id })}`);
  const until = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 40; attempt++) { if (condition()) return; await wait(100); }
    throw new Error("Sharing fixture did not settle");
  };
  const sourceId = crypto.randomUUID();
  const command = (action: object) => new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { socket.removeEventListener("message", received); reject(new Error("Sharing command timed out")); }, 4_000);
    const received = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type !== "result" || message.requestId !== requestId) return;
      socket.removeEventListener("message", received);
      clearTimeout(timer);
      if (message.ok) resolve(); else reject(new Error(message.error));
    };
    socket.addEventListener("message", received);
    socket.send(JSON.stringify({ type: "command", requestId, action }));
  });
  try {
    await until(() => socket.readyState === WebSocket.OPEN);
    await click('[data-app-nav] a[href="/"]');
    localStorage.setItem("couch.discover-rows", JSON.stringify([
      { id: "shared", shown: true }, { id: "radio", shown: true },
      ...rows().filter(row => !["shared", "radio"].includes(row.id)).map(row => ({ ...row, shown: row.id === "sources" })),
    ]));
    window.dispatchEvent(new Event("couch.discover-rows"));
    await discover();
    await until(() => !!document.activeElement?.matches('[aria-label="Radio stations"] [data-page-first]'));
    const radio = document.activeElement;
    assert(!document.querySelector('[aria-label="Shared sources"]'), "Stop existing shares before running");
    await command({ type: "publishLive", sourceId, uploadToken: "1".repeat(64), kind: "screen", audio: true, video: true });
    await until(() => !!document.querySelector('[aria-label="Shared sources"] [data-page-first]'));
    await wait(350);
    assert(document.activeElement === radio, `New sharing stole Radio focus: ${document.activeElement?.getAttribute("aria-label")}`);
    // A subsequent page entry still starts on the already available shared source.
    await click('[data-app-nav] a[href="/"]'); await discover();
    assert(document.activeElement?.matches('[aria-label="Shared sources"] [data-page-first]'), "Existing sharing lost initial page focus");
    await remote("down"); await remote("up");
    assert(document.activeElement?.matches('[aria-label="Shared sources"] [data-page-first]'), "Arrows lost the shared source");
    await command({ type: "endLive", sourceId });
    await until(() => !document.querySelector('[aria-label="Shared sources"]'));
    await remote("down");
    assert(document.activeElement?.matches('[aria-label="Radio stations"] [data-page-first]'), "Ending the focused share lost the next section");
    return { passed: true, checks: ["New sharing retains Radio focus", "Existing sharing takes page entry", "Ending sharing restores navigation"] };
  } finally {
    socket.close();
    if (saved) localStorage.setItem("couch.discover-rows", saved); else localStorage.removeItem("couch.discover-rows");
    window.dispatchEvent(new Event("couch.discover-rows"));
  }
};

declare global { interface Window { runDiscoverCustomizationRegression: () => Promise<unknown> } }
window.runDiscoverCustomizationRegression = async () => {
  const home = localStorage.getItem("couch.home-rows");
  const checks: string[] = [];
  await reset();
  control('[data-settings-page="home"]').focus();
  await remote("select");
  assert(document.activeElement?.closest("[data-settings-content]"), "Settings OK did not enter its controls");
  switches()[0]!.focus();
  await remote("select");
  assert(rows()[0]?.shown === false, "Remote OK did not hide Shared sources");
  await remote("right");
  assert(document.activeElement?.getAttribute("aria-label") === "Move Shared sources down", "Remote Right missed Move down");
  await remote("select");
  assert(rows()[1]?.id === "shared", "Remote Move down did not persist order");
  await remote("left"); await remote("select");
  assert(rows()[0]?.id === "shared", "Remote Move up did not restore order");
  assert(document.activeElement === switches()[0], "Boundary move left focus on a disabled button");
  checks.push("Remote OK, arrows, order persistence and boundary focus");

  for (const button of switches()) if (button.getAttribute("aria-checked") === "true") { button.click(); await wait(30); }
  await discover();
  assert(empty() && document.body.innerText.includes("All sections are hidden"), "All-hidden state did not explain recovery");
  assert(document.activeElement?.id === "customize-discover", "All-hidden entry did not focus customization");
  checks.push("All-hidden state and first focus");
  await customize();
  await reset();
  assert(rows().length === 10 && rows().every(row => row.shown), "Reset did not restore all defaults");
  // Keep only Radio and Sources to avoid third-party catalogue availability affecting this check.
  for (const button of switches()) if (!/-row-(radio|sources)$/.test(button.id)) { button.click(); await wait(30); }
  for (let index = 0; index < 9; index++) {
    control('button[aria-label="Move Sources up"]').focus(); await remote("select");
  }
  assert(rows()[0]?.id === "sources", "Sources did not move to the first slot");
  await discover(); await wait(800);
  assert(document.activeElement?.getAttribute("aria-label") === "Open Twitch", "Reordered page entry ignored Sources");
  assert(!empty(), "Empty message appeared beside content");
  checks.push("Reset, reordered page-first and content empty-state suppression");

  // Back retains the actual heading, even after the ordering changes while away.
  await click('#shelf-radio');
  const changed = [...rows()].reverse();
  localStorage.setItem("couch.discover-rows", JSON.stringify(changed));
  window.dispatchEvent(new Event("couch.discover-rows"));
  await remote("back"); await wait(400);
  assert(document.activeElement?.id === "shelf-radio", "Back lost its reordered Radio heading");
  await click('#shelf-radio');
  localStorage.setItem("couch.discover-rows", JSON.stringify(rows().map(row => ({ ...row, shown: row.id === "sources" }))));
  window.dispatchEvent(new Event("couch.discover-rows"));
  await remote("back"); await wait(400);
  assert(document.activeElement === first() && document.activeElement?.getAttribute("aria-label") === "Open Twitch", "Removed opener did not fall back to the visible first section");
  checks.push("Return focus after reorder and hiding the opener");
  assert(localStorage.getItem("couch.home-rows") === home, "Discover changed Home preferences");
  return { passed: true, checks, saved: rows() };
};

// Reload before each run to clear the saved channels' query cache. Saved channels are a local fixture;
// the real Discover components still decide visibility, placement and focus.
type AvailabilityOptions = { delayMs?: number; cancel?: "keyboard" | "pointer" | "navigation" };
declare global { interface Window { runDiscoverAvailabilityRegression: (options?: AvailabilityOptions) => Promise<unknown> } }
window.runDiscoverAvailabilityRegression = async ({ delayMs = 16_000, cancel }: AvailabilityOptions = {}) => {
  const originalFetch = window.fetch;
  const saved = localStorage.getItem("couch.discover-rows");
  const checks: string[] = [];
  let release: () => void = () => {};
  let requestedAt = 0;
  let requestSignal: AbortSignal | null | undefined;
  const ready = new Promise<void>(resolve => { release = resolve; });
  window.fetch = async (...args) => {
    const path = new URL(String(args[0]), location.href).pathname;
    if (path === "/api/providers/favorites") {
      requestedAt = performance.now();
      requestSignal = args[1]?.signal;
      await ready;
      return Response.json({ favorites: [{ id: "fixture-channel", provider: "twitch", kind: "channel", title: "Discovery focus fixture", url: "https://www.twitch.tv/fixture", live: true }] });
    }
    return originalFetch(...args);
  };
  const save = (next: ReturnType<typeof rows>) => { localStorage.setItem("couch.discover-rows", JSON.stringify(next)); window.dispatchEvent(new Event("couch.discover-rows")); };
  try {
    await click('[data-app-nav] a[href="/"]');
    save([{ id: "streamingcommunity", shown: true }, { id: "twitch", shown: true }, ...readDiscoverRows(localStorage).filter(row => !["streamingcommunity", "twitch"].includes(row.id)).map(row => ({ ...row, shown: row.id === "sources" }))]);
    await discover(); await wait(350);
    assert(!document.querySelector('#shelf-streamingcommunity'), "A source with nothing saved kept its shelf");
    assert(document.activeElement?.getAttribute("aria-label") === "Open Twitch", "Pending first source left no usable page entry");
    assert(requestedAt > 0, "Reload before running to clear the saved channels' cache");
    if (cancel === "navigation") await click('[data-app-nav] a[href^="/settings"]');
    // A slow Core may answer late; arrive after the old 15-second focus cutoff.
    await wait(delayMs);
    const elapsedMs = Math.round(performance.now() - requestedAt);
    if (cancel === "keyboard") control('[aria-label="Search YouTube"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    if (cancel === "pointer") control('[aria-label="Search YouTube"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    if (cancel !== "navigation") assert(requestSignal && !requestSignal.aborted, "Delayed provider request was aborted before arrival");
    release(); await wait(700);
    if (cancel === "navigation") {
      assert(location.pathname.startsWith("/settings") && requestSignal?.aborted, "Navigation did not cancel the catalogue request");
      // Settings retains its 15-second observer cutoff. After that, a DOM change must
      // not let the old Discover effect focus the new page (no input stopped it).
      assert(delayMs > 15_000, "Navigation cleanup check needs the other page's timeout to expire");
      (document.activeElement as HTMLElement).blur();
      const probe = document.createElement("span");
      document.body.append(probe); probe.remove();
      await wait();
      assert(document.activeElement === document.body, "Discover observer survived navigation or Settings lost its cutoff");
      return { passed: true, elapsedMs, checks: ["Navigation cancels the request and focus observer; other pages retain their cutoff"] };
    }
    assert(document.querySelector('[aria-label="Open Discovery focus fixture"]'), "Delayed provider tile did not render");
    assert(document.activeElement?.getAttribute("aria-label") === (cancel ? "Open Twitch" : "Open Discovery focus fixture"), cancel ? `${cancel} did not stop delayed focus takeover` : "Earlier source did not take page entry when it loaded");
    assert(rows()[0]?.id === "streamingcommunity", "Source with nothing saved lost its position");
    checks.push(cancel ? `${cancel} stops delayed focus takeover` : "Source with nothing saved retains order; delayed earlier source becomes page-first");
    // With only a source with nothing saved enabled, the page still offers a next step.
    save(rows().map(row => ({ ...row, shown: row.id === "streamingcommunity" })));
    await wait();
    assert(empty() && document.body.innerText.includes("No saved channels or series"), "Source with nothing saved left a blank page");
    checks.push("Nothing saved explains what to do");
    return { passed: true, elapsedMs, checks };
  } finally {
    release(); window.fetch = originalFetch;
    if (saved) localStorage.setItem("couch.discover-rows", saved); else localStorage.removeItem("couch.discover-rows");
    window.dispatchEvent(new Event("couch.discover-rows"));
  }
};
