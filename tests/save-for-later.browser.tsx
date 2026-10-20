// On an empty Vite page, import this module and call runSaveForLaterRegression().
// Provider and persistence responses are fixtures; real disk persistence is checked separately.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { SearchPanel } from "../src/client/sections/find/SearchPanel";
import { ForLaterSection } from "../src/client/sections/saved/ForLaterSection";
import type { ForLaterItem } from "../src/shared/for-later";

const wait = (ms = 650) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

export async function runSaveForLaterRegression() {
  const originalFetch = window.fetch;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let items: ForLaterItem[] = [];
  let denied = false, writes = 0, channelsSaved = 0, stationsSaved = 0;
  const media = ["Space film", "Space video"].map((title, index) => ({ id: `space-${index}`, provider: index ? "youtube" : "streamingcommunity", kind: "media", title, url: `https://www.youtube.com/watch?v=space${index}`, duration: 600 }));
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    if (url.pathname.startsWith("/api/for-later")) {
      if (init?.method === "POST") {
        writes++;
        if (denied) return Response.json({ error: "Pair this device to use Couch." }, { status: 403 });
        const { reference } = JSON.parse(String(init.body));
        items.push({ id: reference.url, ...reference });
      }
      if (init?.method === "DELETE") items = items.filter(item => item.id !== decodeURIComponent(url.pathname.slice("/api/for-later/".length)));
      return Response.json({ items });
    }
    if (url.pathname === "/api/providers/favorites" && init?.method === "POST") channelsSaved++;
    if (url.pathname === "/api/radio/favorites" && init?.method === "POST") stationsSaved++;
    if (url.pathname === "/api/radio/stations") return Response.json({ stations: [{ id: "space-radio", name: "Space radio", url: "https://example.com/radio" }] });
    const provider = url.pathname.split("/")[3];
    const results = provider === "streamingcommunity" ? [media[0]] : provider === "youtube" ? [media[1], { id: "channel", provider, kind: "channel", title: "Space channel", url: "https://www.youtube.com/@space" }]
      : provider === "bandcamp" ? [{ id: "track", provider, kind: "media", title: "Space track", url: "https://space.bandcamp.com/track/space", duration: 120 }] : [];
    return Response.json({ items: results, favorites: [], stations: [], playlists: [], programmes: {} });
  };
  const gate = { connected: true, run: async () => true, state: { devices: [], liveSources: [] } } as unknown as SessionGateValue;
  const props = { origin: location.origin, token: "fixture", connected: true, canPlay: true };
  const render = (saved = false) => root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}>{saved
    ? <ForLaterSection {...props} />
    : <SearchPanel {...props} active searchState={{ query: "space", source: "All" }} onSearchChange={() => {}} onCommand={gate.run} />}</QueryClientProvider></SessionGateContext>);
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("[data-search-top] button")].find(node => node.textContent === label);
  const menu = async (selector: string, label: string) => {
    const item = host.querySelector<HTMLElement>(selector);
    const trigger = (item?.matches("[data-media-tile]") ? item.parentElement : item)?.querySelector<HTMLButtonElement>("[data-row-options]");
    assert(trigger && getComputedStyle(trigger).opacity === "1", `Options are hidden on ${selector}`);
    trigger!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", ctrlKey: false }));
    await wait();
    const action = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === label);
    assert(action, `Missing ${label} in ${selector}`);
    action!.click();
    await wait();
  };
  try {
    render(); await wait(900);
    assert(button("Save"), "Closest match hides Save behind its menu");
    button("Save")!.click(); await wait();
    assert(button("Saved")?.getAttribute("aria-pressed") === "true" && items.length === 1, "Save did not update to Saved");
    button("Saved")!.click(); await wait();
    assert(button("Save") && items.length === 0, "Saved did not toggle off");
    await menu('[data-hit-id="youtube:space-1"]', "Save");
    await menu('[data-hit-id="youtube:channel"]', "Save");
    await menu('[data-hit-id="bandcamp:track"]', "Save");
    assert(items.length === 2 && channelsSaved === 1, "Media and collection saves did not reach their separate stores");
    await menu('[data-hit-id="Radio directory:space-radio"]', "Save");
    assert(stationsSaved === 1 && items.length === 2, "Station Save did not use radio favourites");
    render(true); await wait();
    assert(host.textContent?.includes("Space video") && host.textContent.includes("Space track") && !host.textContent.includes("Space channel"), "Saved lookup lost media or mixed in a channel");
    const row = host.querySelector<HTMLElement>("[data-saved-details]")!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await wait();
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === "Remove")!.click(); await wait();
    assert(items.length === 1 && !host.textContent?.includes("Space video"), "Remove did not update For later");
    render(); await wait(900);
    denied = true;
    button("Save")!.click(); await wait();
    assert(button("Save") && items.length === 1, "Rejected Save falsely showed Saved");
    const before = writes;
    props.connected = false; gate.connected = false; render(); await wait();
    button("Save")?.click(); await wait();
    await menu('[data-hit-id="Radio directory:space-radio"]', "Save");
    assert(writes === before && stationsSaved === 1, "Offline Save sent a mutation");
    return { passed: true, checks: ["visible closest-match Save", "Save/Saved toggle", "row, collection and tile menus", "Saved lookup separates media from channels", "Remove", "rejected Save", "offline does not mutate"] };
  } finally {
    root.unmount(); host.remove(); client.clear(); window.fetch = originalFetch;
  }
}
