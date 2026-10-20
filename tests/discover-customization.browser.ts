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
