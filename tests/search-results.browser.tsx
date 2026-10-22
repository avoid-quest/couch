// On an empty page served by Vite, import this module and call runSearchResultsRegression().
// All API responses are local fixtures; no Couch process or installed data is used.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { SearchPanel } from "../src/client/sections/find/SearchPanel";
import type { SearchRouteState } from "../src/client/search";
import { SearchOnlineResults } from "../src/client/sections/find/SearchOnlineResults";
import type { Action } from "../src/shared/protocol";

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
    // The first query answers a moment later, so its cold load shows.
    if (url.searchParams.get("q") === "x") await wait(150);
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
    const kinds = () => [...host.querySelectorAll('[role="radiogroup"][aria-label="Kind"] [role="radio"]')].map(radio => radio.firstChild?.textContent).join();
    render();
    await wait(50);
    // The cold load is drawn as what it becomes: a closest match, then a shelf.
    assert(host.querySelector('[data-loading="search"]') && !host.querySelector('[data-loading="rows"]'), "Search's skeleton was not a closest match and a shelf");
    await wait(850);
    assert(kinds() === "All,Live", `Kinds offered before their sources answered: ${kinds()}`);
    const filtersTop = host.querySelector('[data-search-top]')!.getBoundingClientRect().top;
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
    assert(kinds() === "All,Films & series,Live" && host.querySelector('[data-search-top]')!.getBoundingClientRect().top === filtersTop, `A late kind was out of order or moved the results: ${kinds()}`);
    // The kinds count; the shelves don't, and a result's length never says when it would end.
    assert(![...host.querySelectorAll("section > header p")].length && !/ends \d/.test(host.textContent ?? "") && host.textContent?.includes("20:00"), "A shelf heading counted again, or a result told its end time");
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
    assert(!host.querySelector('[aria-label="Source"]'), "A kind from one source offered it");
    state = { ...state, source: "Twitch" }; render();
    await wait();
    const twitch = host.querySelector<HTMLButtonElement>('[aria-label="Source"] button[aria-pressed="true"]');
    assert(twitch?.textContent?.startsWith("Twitch"), "The chosen source was not shown pressed");
    [...host.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Kind"] [role="radio"]')].find(radio => radio.firstChild?.textContent === "Films & series")!.click();
    await wait();
    assert(state.kind === "films" && state.source === "All", "A source without films stayed chosen");
    // A scope chosen in the field before the results says when it holds nothing, and leads back to everything.
    state = { query: "x", source: "Bandcamp", kind: "music" }; render();
    await wait();
    const everything = host.querySelector<HTMLButtonElement>("[data-page-first]");
    assert(host.querySelector('[role="radio"][aria-checked="true"]')?.firstChild?.textContent === "Music" && host.textContent?.includes("Nothing in Music on Bandcamp for “x”") && !host.querySelector("[data-media-tile]") && everything?.textContent?.startsWith("Show all"), "A scope without hits did not say so, or offered no way back");
    everything!.click();
    await wait();
    assert(state.source === "All" && !state.kind && host.querySelectorAll("[data-media-tile]").length, "Show all did not clear the scope");
    state = { query: "x stream", source: "All" }; render();
    await wait(900);
    assert(host.querySelector('[data-search-top]')?.getAttribute("data-hit-id") === "streamingcommunity:film", "Previous query's snapshot pinned the wrong hero");
    return { passed: true, checks: ["hero href and modified clicks", "controlled-device label", "late responses preserve hero and focus", "shelf expansion", "live tile Open", "one kind fills the page", "kinds arrive in order without moving results", "kind change resets an empty source", "an empty scope says so and leads back", "query change retires the old hero hold", "skeleton in the results' geometry", "no heading counts or end times"] };
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
    // A kind only reports the sources that could return it.
    state = { query: "space", source: "All", kind: "music" }; render();
    await wait();
    assert(!host.querySelector("[data-source-problems]"), "Music reported a source that never returns music");
    state = { query: "space", source: "All" }; render();
    await wait();
    const alert = host.querySelector("[data-source-problems]")!;
    assert(alert?.textContent?.startsWith("Twitch didn't answer.") && !alert.closest('[role="alert"]') && !alert.textContent.includes("Source is unavailable"), `Failed source was not one quiet line: ${alert?.textContent}`);
    assert(alert.compareDocumentPosition(host.querySelector("[data-search-top]")!) & Node.DOCUMENT_POSITION_PRECEDING, "A partial failure led the results instead of closing them");
    assert(!host.textContent?.includes("Nothing found"), "Partial failure was reported as an empty search");
    [...alert.querySelectorAll("button")].find(button => button.textContent === "Try again")!.click();
    await wait(900);
    assert(attempts === 2 && !host.querySelector("[data-source-problems]"), "Try again did not clear the recovered failure");
    assert(host.querySelector('[data-hit-id="youtube:space"]') && host.querySelector('[data-hit-id="twitch:stream"]'), "Retry replaced successful results");
    state = { query: "space", source: "Bandcamp", kind: "music" }; render();
    await wait();
    const offered = [...host.querySelectorAll('[role="radio"]')].map(radio => radio.firstChild?.textContent).join();
    assert(offered === "All,Live,Music,Videos", `Search offered a kind without hits, or hid the chosen one: ${offered}`);
    assert(host.textContent?.includes("Nothing in Music on Bandcamp for “space”") && !host.querySelector("[data-search-top]") && !host.querySelector("[data-source-problems]"), "A scope without hits showed other results, or another kind's failure");
    state = { query: "no matches", source: "All" }; render();
    await wait(900);
    assert(host.textContent?.includes("Nothing found for “no matches”") && !host.querySelector("[data-hit-id]"), "Empty search retained stale results");
    return { passed: true, checks: ["named pending source", "open during loading", "partial failure as one quiet line at the end", "a kind reports only its own sources", "retry retains successes", "no empty kind or source", "empty search retires results"] };
  } finally {
    release(); root.unmount(); client.clear(); window.fetch = originalFetch;
  }
}

/** A series of seasons leads with the episode its Play starts: Play S1 E1, Resume S1 E1, then Play S1 E2. */
export async function runSeriesPlayRegression() {
  const originalFetch = window.fetch;
  const host = document.getElementById("fixture") ?? document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const series = "https://streamingcommunityz.example/it/titles/42-phony";
  const season = (n: number) => ({ id: `season-${n}`, provider: "streamingcommunity", kind: "collection", title: `Season ${n}`, url: `${series}/season-${n}` });
  const episode = (n: number) => ({ id: `e${n}`, provider: "streamingcommunity", kind: "media", title: `S01E0${n} · Episodio ${n}`, url: `https://streamingcommunityz.example/it/watch/42?e=${n}`, duration: 1800, collection: { title: "Season 1", url: `${series}/season-1`, index: n - 1, parent: { title: "Phony", url: series } } });
  let history: unknown[] = [];
  let seasonFails = false;
  const commands: Action[] = [];
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    if (url.pathname === "/api/progress/history") return Response.json({ items: history });
    const target = url.searchParams.get("url");
    if (target === series) return Response.json({ item: { id: "phony", provider: "streamingcommunity", kind: "collection", title: "Phony", url: series }, title: "Phony", items: [season(1), season(2)] });
    if (target === `${series}/season-1`) return seasonFails ? Response.json({ error: "Season unavailable." }, { status: 503 }) : Response.json({ items: [episode(1), episode(2)] });
    return Response.json({ items: [], favorites: [] });
  };
  let label: string | undefined;
  let play: (() => void) | undefined;
  const run = async (action: Action) => { commands.push(action); return true; };
  const render = (key: string) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root.render(<QueryClientProvider client={client}><SearchOnlineResults key={key} provider="streamingcommunity" query="" url={series} paged origin={location.origin} token="fixture" connected canPlay active quality="auto" onEnqueued={() => {}} onCommand={run} onPlayHistory={async () => true}
      onResults={(_, summary) => { label = summary.collection?.playLabel; play = summary.collection?.playAll; }} /></QueryClientProvider>);
  };
  try {
    render("fresh"); await wait(600);
    assert(label === "Play S1 E1", `A new series did not offer Play S1 E1: ${label}`);
    history = [{ mediaId: "m1", title: "S01E01 · Episodio 1", url: episode(1).url, position: 300, duration: 1800, watched: false, playable: true, lastPlayedAt: 1, collection: episode(1).collection }];
    render("started"); await wait(600);
    assert(label === "Resume S1 E1", `A started episode did not lead as Resume S1 E1: ${label}`);
    history = [{ ...history[0] as object, position: 1800, watched: true }];
    render("watched"); await wait(600);
    assert(label === "Play S1 E2", `A watched episode did not move Play on: ${label}`);
    history = []; seasonFails = true;
    render("unreadable"); await wait(600);
    assert(label === "Play S1 E1" && play, `Without the season's episodes, Play did not start the first season: ${label}`);
    play!(); await wait();
    const sent = commands.at(-1) as Extract<Action, { type: "enqueueProvider" }> | undefined;
    assert(sent?.type === "enqueueProvider" && sent.url === `${series}/season-1` && sent.shape === "playlist" && sent.playNow, "Play did not play the first season from its start");
    return { passed: true, checks: ["Play S1 E1", "Resume S1 E1", "Play S1 E2 after S1 E1", "the first season when its episodes can't be read"] };
  } finally {
    root.unmount(); window.fetch = originalFetch;
  }
}
