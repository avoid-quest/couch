// Run in a paired scratch TV at /settings/device/discover. Build like tv-navigation.browser.ts.
// Uses the real settings, local storage, routes and Remote's navigation entry point; no playback starts.
import { applyTvNavigation } from "../src/client/navigation";

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
const settings = '[data-settings-content]';
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
  control('[data-settings-page="discover"]').focus();
  await remote("select");
  assert(document.activeElement === switches()[0], "Settings OK did not enter Discover controls");
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
  assert(document.activeElement?.getAttribute("aria-label") === "Search YouTube", "Reordered page entry ignored Sources");
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
  assert(document.activeElement === first() && document.activeElement?.getAttribute("aria-label") === "Search YouTube", "Removed opener did not fall back to the visible first section");
  checks.push("Return focus after reorder and hiding the opener");
  assert(localStorage.getItem("couch.home-rows") === home, "Discover changed Home preferences");
  return { passed: true, checks, saved: rows() };
};

// Run after a reload to clear the catalogue query cache. Source responses are local fixtures;
// the real Discover components still decide visibility, placement and focus.
declare global { interface Window { runDiscoverAvailabilityRegression: () => Promise<unknown> } }
window.runDiscoverAvailabilityRegression = async () => {
  const originalFetch = window.fetch;
  const saved = localStorage.getItem("couch.discover-rows");
  const checks: string[] = [];
  let release: () => void = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  window.fetch = async (...args) => {
    const path = new URL(String(args[0]), location.href).pathname;
    if (path === "/api/providers/streamingcommunity/items") return Response.json({ items: [] });
    if (path === "/api/providers/twitch/items") {
      await ready;
      return Response.json({ items: [{ id: "fixture-channel", provider: "twitch", kind: "channel", title: "Discovery focus fixture", url: "https://www.twitch.tv/fixture", live: true }] });
    }
    return originalFetch(...args);
  };
  const save = (next: ReturnType<typeof rows>) => { localStorage.setItem("couch.discover-rows", JSON.stringify(next)); window.dispatchEvent(new Event("couch.discover-rows")); };
  try {
    await click('[data-app-nav] a[href="/"]');
    save([{ id: "streamingcommunity", shown: true }, { id: "twitch", shown: true }, ...rows().filter(row => !["streamingcommunity", "twitch"].includes(row.id)).map(row => ({ ...row, shown: row.id === "sources" }))]);
    await discover(); await wait(350);
    assert(!document.querySelector('#shelf-streamingcommunity'), "Empty catalogue kept its shelf");
    assert(document.activeElement?.getAttribute("aria-label") === "Search YouTube", "Pending first source left no usable page entry");
    release(); await wait(700);
    assert(document.activeElement?.getAttribute("aria-label") === "Open Discovery focus fixture", "Earlier source did not take page entry when it loaded");
    assert(rows()[0]?.id === "streamingcommunity", "Empty source lost its saved position");
    checks.push("Empty source retains order; delayed earlier source becomes page-first");
    // With only an empty source enabled, the page still offers a next step.
    save(rows().map(row => ({ ...row, shown: row.id === "streamingcommunity" })));
    await wait();
    assert(empty() && document.body.innerText.includes("Nothing to discover here yet"), "Empty-only source left a blank page");
    checks.push("Empty-only source explains recovery");
    return { passed: true, checks };
  } finally {
    release(); window.fetch = originalFetch;
    if (saved) localStorage.setItem("couch.discover-rows", saved); else localStorage.removeItem("couch.discover-rows");
    window.dispatchEvent(new Event("couch.discover-rows"));
  }
};
