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
  let denied = false, writes = 0, channelsSaved = 0, stationsSaved = 0, commands = 0;
  let query = "space", stationSaved = false;
  const station = { id: "space-radio", name: "Space radio", url: "https://example.com/radio" };
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
    if (url.pathname.startsWith("/api/radio/favorites")) {
      if (init?.method === "POST") { stationsSaved++; stationSaved = true; }
      if (init?.method === "DELETE") stationSaved = false;
      return Response.json({ favorites: stationSaved ? [station] : [] });
    }
    if (url.pathname === "/api/radio/stations") return Response.json({ stations: [station] });
    const provider = url.pathname.split("/")[3];
    const results = provider === "streamingcommunity" ? [media[0]] : provider === "youtube" ? [media[1], { id: "channel", provider, kind: "channel", title: "Space channel", url: "https://www.youtube.com/@space" }]
      : provider === "bandcamp" ? [{ id: "track", provider, kind: "media", title: "Space track", url: "https://space.bandcamp.com/track/space", duration: 120 }] : [];
    return Response.json({ items: results, favorites: [], stations: [], playlists: [], programmes: {} });
  };
  const gate = { connected: true, run: async () => { commands++; return true; }, state: { devices: [], liveSources: [] } } as unknown as SessionGateValue;
  const props = { origin: location.origin, token: "fixture", connected: true, canPlay: true };
  const render = (saved = false) => root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}>{saved
    ? <ForLaterSection {...props} />
    : <SearchPanel {...props} active searchState={{ query, source: "All" }} onSearchChange={() => {}} onCommand={gate.run} />}</QueryClientProvider></SessionGateContext>);
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
    props.connected = false; gate.connected = false; render(); await wait(20);
    // The closest match still holds its online summary during the 250 ms debounce.
    assert(button("Save") && !button("Save")!.disabled, "Missed the cached Save interaction window");
    assert(button("Play") && !button("Play")!.disabled && button("Queue") && !button("Queue")!.disabled, "Missed the cached playback interaction window");
    button("Play")!.click(); button("Queue")!.click();
    button("Save")!.click(); await wait();
    assert(writes === before, "Cached Save sent a mutation immediately after disconnect");
    assert(commands === 0, "Cached Play or Queue sent a command immediately after disconnect");
    assert(button("Save")?.disabled, "Offline Save did not become disabled");
    button("Save")?.click(); await wait();
    await menu('[data-hit-id="Radio directory:space-radio"]', "Saved");
    assert(writes === before && stationsSaved === 1, "Offline Save sent a mutation");
    assert(stationSaved, "Offline Saved removed a station");
    denied = false; props.connected = true; gate.connected = true; render(); await wait(900);
    button("Save")!.click(); await wait();
    assert(writes === before + 1 && button("Saved")?.getAttribute("aria-pressed") === "true", "Reconnect did not restore Save on cached results");
    button("Saved")!.click(); await wait();
    assert(button("Save") && items.length === 1, "Reconnect did not restore Saved removal");
    button("Play")!.click(); await wait(); button("Queue")!.click(); await wait();
    assert(commands === 2, "Reconnect did not restore Play and Queue on cached results");
    await menu('[data-hit-id="youtube:space-1"]', "Save");
    assert(items.length === 2, "Reconnect did not restore row Save on cached results");
    query = "radio"; render(); await wait(900);
    assert(host.querySelector("[data-search-top]")?.getAttribute("data-hit-id") === "Radio directory:space-radio", "Radio is not the closest match");
    button("Saved")!.click(); await wait();
    assert(!stationSaved && button("Save"), "Radio Saved did not toggle off");
    const radioWrites = stationsSaved, radioCommands = commands;
    props.connected = false; gate.connected = false; render(); await wait(20);
    assert(button("Save") && !button("Save")!.disabled && button("Play") && !button("Play")!.disabled && button("Queue") && !button("Queue")!.disabled, "Missed the cached radio interaction window");
    button("Play")!.click(); button("Queue")!.click(); button("Save")!.click(); await wait();
    assert(stationsSaved === radioWrites && commands === radioCommands, `Cached radio actions ran after disconnect: ${stationsSaved - radioWrites} Save POSTs, ${commands - radioCommands} commands`);
    assert(button("Save")?.disabled, "Offline radio Save did not become disabled");
    props.connected = true; gate.connected = true; render(); await wait(900);
    button("Save")!.click(); await wait();
    assert(stationsSaved === radioWrites + 1 && stationSaved && button("Saved")?.getAttribute("aria-pressed") === "true", "Reconnect did not restore radio Save");
    button("Saved")!.click(); await wait();
    assert(!stationSaved && button("Save"), "Reconnect did not restore radio Saved removal");
    button("Play")!.click(); await wait(); button("Queue")!.click(); await wait();
    assert(commands === radioCommands + 2, "Reconnect did not restore radio Play and Queue");
    return { passed: true, checks: ["visible closest-match Save", "Save/Saved toggle", "row, collection and tile menus", "Saved lookup separates media from channels", "Remove", "rejected Save", "immediate disconnect blocks cached provider and radio Save, Play and Queue", "offline does not mutate", "reconnect restores provider and radio Save/Saved, Play and Queue, and row Save"] };
  } finally {
    root.unmount(); host.remove(); client.clear(); window.fetch = originalFetch;
  }
}
