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
    assert(document.activeElement?.matches('[data-hit-id="twitch:live-0"][data-media-tile]'), "Hero demotion did not retain focus on the same tile");
    const more = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => /^\d+ more$/.test(button.textContent ?? ""))!;
    assert(more && host.querySelectorAll("[data-media-tile]").length === 12, "Expected twelve initial shelf hits");
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
    state = { query: "x", source: "All", until: "01:01" }; render();
    await wait();
    assert([...host.querySelectorAll('button[data-state="on"]')].some(button => button.textContent?.includes("01:01")), "Selected Ends by chip disappeared");
    state = { query: "x stream", source: "All" }; render();
    await wait(900);
    assert(host.querySelector('[data-search-top]')?.getAttribute("data-hit-id") === "streamingcommunity:film", "Previous query's snapshot pinned the wrong hero");
    return { passed: true, checks: ["hero href and modified clicks", "controlled-device label", "hero demotion focus", "shelf expansion", "live tile Open", "selected deadline chip", "query change retires the old hero hold"] };
  } finally {
    releaseFilms!(); root.unmount(); client.clear(); window.fetch = originalFetch;
  }
}
