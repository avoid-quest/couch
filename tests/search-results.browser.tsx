// On an empty page served by Vite, import this module and call runSearchResultsRegression().
// All API responses are local fixtures; no Couch process or installed data is used.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { SearchPanel } from "../src/client/sections/find/SearchPanel";
import type { SearchRouteState } from "../src/client/search";

const wait = (ms = 400) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
export async function runSearchResultsRegression() {
  const originalFetch = window.fetch;
  const host = document.getElementById("fixture") ?? document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let releaseFilms: (() => void) | undefined;
  const films = new Promise<void>(resolve => { releaseFilms = resolve; });
  let opened = "";
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    if (url.pathname === "/api/providers/streamingcommunity/items") await films;
    const provider = url.pathname.split("/")[3];
    const items = provider === "twitch" ? Array.from({ length: 15 }, (_, index) => ({ id: `live-${index}`, provider, kind: "media", title: `X stream ${index}`, live: true, url: `https://www.twitch.tv/test${index}` }))
      : provider === "streamingcommunity" ? [{ id: "film", provider, kind: "media", title: url.searchParams.get("q") === "x stream" ? "X stream film" : "X film", url: "https://streamingcommunity.example/titles/1-x", duration: 1200 }]
      : [];
    return Response.json({ items, favorites: [], stations: [], playlists: [], programmes: {} });
  };
  const gate = { connected: true, run: async () => true, state: { controlling: "other", devices: [{ id: "other", name: "Living room" }], liveSources: [] } } as unknown as SessionGateValue;
  let state: SearchRouteState = { query: "x", source: "All" };
  const render = () => root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><SearchPanel origin={location.origin} token="fixture" connected canPlay active searchState={state} onSearchChange={next => { state = next; render(); }} onCommand={gate.run} onOpenCollection={item => { opened = item.id; }} /></QueryClientProvider></SessionGateContext>);
  try {
    render();
    await wait(900);
    const hero = host.querySelector<HTMLElement>('[data-search-top] [data-play]')!;
    assert(hero?.tagName === "A" && hero.getAttribute("href")?.includes("twitch"), "Hero Open lost its href");
    assert(host.querySelector('[data-search-top]')?.textContent?.includes("Play on Living room"), "Hero Play lost its controlled device");
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    // Prevent browser navigation after recording whether React intercepted the modified click.
    let intercepted = true;
    const intercept = (event: MouseEvent) => { intercepted = event.defaultPrevented; event.preventDefault(); };
    document.addEventListener("click", intercept, { once: true });
    hero.dispatchEvent(modified);
    assert(!intercepted && !opened, "Modified hero click was intercepted");
    hero.click();
    assert(opened === "live-0", "Ordinary hero Open did not run");
    hero.focus();
    releaseFilms!();
    await wait(900);
    assert(document.activeElement === hero && host.querySelector('[data-search-top]')?.getAttribute("data-hit-id") === "twitch:live-0", "A late source replaced the leading result or moved focus");
    const more = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => /^\d+ more$/.test(button.textContent ?? ""))!;
    assert(more && host.querySelectorAll('[data-hit-id^="twitch:"] [data-media-tile], [data-media-tile][data-hit-id^="twitch:"]').length === 12, "Expected twelve initial live shelf hits");
    more.click();
    await wait();
    assert(host.querySelectorAll("[data-media-tile]").length === 15 && state.source === "All", "More did not reveal all hits in the same scope");
    const tile = host.querySelector<HTMLElement>('[data-hit-id="twitch:live-1"]')!;
    tile.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await wait();
    const open = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Open");
    assert(open, "Playable live tile lost Open in its menu");
    open!.click();
    await wait();
    assert(opened === "live-1", "Live tile Open did not reach its collection");
    state = { query: "x", source: "All", kind: "live" }; render();
    await wait();
    assert(host.querySelectorAll("[data-media-tile]").length === 14 && !host.querySelector('section[aria-label="Live now"]') && ![...host.querySelectorAll("button")].some(button => /^\d+ more$/.test(button.textContent ?? "")), "One kind kept its heading or its cap");
    assert(host.querySelector('[data-search-top]')?.getAttribute("data-hit-id") === "twitch:live-0", "One kind lost its leading result");
    state = { ...state, source: "Twitch" }; render();
    await wait();
    [...host.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Kind"] [role="radio"]')].find(radio => radio.textContent === "Films & series")!.click();
    await wait();
    assert(state.kind === "films" && state.source === "All", "A source without films stayed chosen");
    state = { query: "x stream", source: "All" }; render();
    await wait(900);
    assert(host.querySelector('[data-search-top]')?.getAttribute("data-hit-id") === "streamingcommunity:film", "Previous query's snapshot pinned the wrong hero");
    return { passed: true, checks: ["hero href and modified clicks", "controlled-device label", "late responses preserve hero and focus", "shelf expansion", "live tile Open", "one kind fills the page", "kind change resets an empty source", "query change retires the old hero hold"] };
  } finally {
    releaseFilms!(); root.unmount(); client.clear(); window.fetch = originalFetch;
  }
}

/** Delayed and failed sources must leave the results usable, then recover in place. */
export async function runSearchResultStatesRegression() {
  const originalFetch = window.fetch;
  const host = document.getElementById("fixture") ?? document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  let opened = "";
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const provider = url.pathname.split("/")[3];
    if (provider === "twitch" && url.searchParams.get("q") === "space" && ++attempts === 1) {
      await pending;
      return Response.json({ error: "Source is unavailable." }, { status: 503 });
    }
    const items = url.searchParams.get("q") !== "space" ? [] : provider === "youtube"
      ? [{ id: "space", provider, kind: "media", title: "Journeying through stunning cosmic views with James Webb Space Telescope", subtitle: "European Space Agency, ESA", description: "A compilation of cosmic views.", duration: 2606, url: "https://www.youtube.com/watch?v=space" }]
      : provider === "twitch" ? [{ id: "stream", provider, kind: "media", title: "Space stream", live: true, url: "https://www.twitch.tv/space" }] : [];
    return Response.json({ items, favorites: [], stations: [], playlists: [], programmes: {} });
  };
  const gate = { connected: true, run: async () => true, state: { devices: [], liveSources: [] } } as unknown as SessionGateValue;
  let state: SearchRouteState = { query: "space", source: "All" };
  const render = () => root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><SearchPanel origin={location.origin} token="fixture" connected canPlay active searchState={state} onSearchChange={next => { state = next; render(); }} onCommand={gate.run} onOpenCollection={item => { opened = item.id; }} /></QueryClientProvider></SessionGateContext>);
  try {
    render();
    await wait(900);
    assert(host.querySelector('[role="status"]')?.textContent?.includes("Still asking Twitch"), "Pending source was not named");
    const first = host.querySelector<HTMLElement>("[data-search-top] [data-play]")!;
    assert(first, "Pending source hid successful results");
    first.click();
    assert(opened === "space", "Successful result could not open while another source was pending");
    release();
    await wait(900);
    const alert = host.querySelector('[role="alert"]')!;
    assert(alert?.textContent?.includes("Couldn't load Twitch."), "Failed source was not named");
    assert(alert.compareDocumentPosition(host.querySelector("[data-search-top]")!) & Node.DOCUMENT_POSITION_FOLLOWING, "Partial failure was buried after the results");
    assert(!host.textContent?.includes("Nothing found"), "Partial failure was reported as an empty search");
    [...alert.querySelectorAll("button")].find(button => button.textContent === "Try again")!.click();
    await wait(900);
    assert(attempts === 2 && !host.querySelector('[role="alert"]'), "Try again did not clear the recovered failure");
    assert(host.querySelector('[data-hit-id="youtube:space"]') && host.querySelector('[data-hit-id="twitch:stream"]'), "Retry replaced successful results");
    state = { query: "space", source: "Bandcamp", kind: "music" }; render();
    await wait();
    assert(host.textContent?.includes("No music on Bandcamp for “space”"), "Empty source scope had no explanation");
    [...host.querySelectorAll("button")].find(button => button.textContent === "All results")!.click();
    await wait();
    assert(state.source === "All" && !state.kind && host.querySelector("[data-search-top]"), "All results did not restore results");
    state = { query: "no matches", source: "All" }; render();
    await wait(900);
    assert(host.textContent?.includes("Nothing found for “no matches”") && !host.querySelector("[data-hit-id]"), "Empty search retained stale results");
    return { passed: true, checks: ["named pending source", "open during loading", "visible partial failure", "retry retains successes", "filtered empty and All results", "empty search retires results"] };
  } finally {
    release(); root.unmount(); client.clear(); window.fetch = originalFetch;
  }
}
