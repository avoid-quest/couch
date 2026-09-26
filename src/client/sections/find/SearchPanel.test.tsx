import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act, useState } from "react";
import { Toaster } from "sonner";
import type { Root } from "react-dom/client";
import type { Action } from "../../../shared/protocol";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
let root: Root, window: Window, request: ReturnType<typeof spyOn>, queryClient: QueryClient;
let revisions = { providers: 0, radio: 0 };
const originals = new Map<string, PropertyDescriptor | undefined>();
const paths: string[] = [], queued: unknown[] = [], browsed: string[] = [];
let release: (() => void) | undefined, jellyfinError = false, delayedQuery = "", unavailable = false, connectedJellyfin = true, empty = false;
const commands: Action[] = [];
const setupSources: (string | undefined)[] = [];
let integrated = false, youtubeError = false, administrator = false;
let onlineFavorites: ProviderItem[] = [], radioFavorites: RadioStation[] = [];
const video: ProviderItem = { id: "yt-video", provider: "youtube", kind: "media", title: "Evening video", subtitle: "An artist", url: "https://www.youtube.com/watch?v=abcdefghijk" };
const collection: ProviderItem = { id: "yt-list", provider: "youtube", kind: "collection", title: "Evening collection", url: "https://www.youtube.com/playlist?list=PLabc" };
const station: RadioStation = { id: "station-one", sourceId: "own", name: "Evening radio", url: "https://radio.example/live", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
const local = { id: "local", title: "Evening movie", kind: "video", artist: null, album: null, available: true, duration: 180, video: { type: "movie", plot: "An evening story" }, progress: { position: 12 } };
const flush = () => act(async () => { await Bun.sleep(10); });
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const click = async (label: string, scope: ParentNode = document) => { await act(async () => button(label, scope).click()); await flush(); };
async function search(query: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
}
async function render(active = true, connected = true, canPlay = true, libraryVersion = 1, providerVersion = 1, origin = "http://localhost", defaultQuality: "auto" | "1080p" = "1080p") {
  const { SearchPanel } = await import("./SearchPanel");
  const invalidated: string[] = [];
  if (providerVersion > revisions.providers) invalidated.push("providers");
  if (providerVersion > revisions.radio) invalidated.push("radio");
  revisions = { providers: providerVersion, radio: providerVersion };
  await act(async () => {
    for (const rootKey of invalidated) await queryClient.invalidateQueries({ queryKey: [rootKey] });
    root.render(<QueryClientProvider client={queryClient}><Toaster /><SearchPanel onManageSources={administrator ? source => { browsed.push("Source settings"); setupSources.push(source); } : undefined} origin={origin} token="paired" connected={connected} canPlay={canPlay} active={active} defaultQuality={defaultQuality} onCommand={async command => { commands.push(command); return true; }} onEnqueue={async (...args) => { queued.push(args); return true; }} /></QueryClientProvider>);
  });
  await flush();
}
beforeEach(async () => {
  setupSources.length = 0; commands.length = 0; integrated = youtubeError = administrator = false; onlineFavorites = []; radioFavorites = [];
  paths.length = 0; queued.length = 0; browsed.length = 0; release = undefined; jellyfinError = unavailable = empty = false; delayedQuery = ""; connectedJellyfin = true;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }); revisions = { providers: 0, radio: 0 };
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (delayedQuery && url.searchParams.get("q") === delayedQuery && url.pathname === "/api/library/items") await new Promise<void>(resolve => { release = resolve; });
    if (url.pathname === "/api/providers/favorites") {
      if (init?.method === "POST") onlineFavorites.push(JSON.parse(String(init.body)).item);
      return Response.json({ favorites: onlineFavorites });
    }
    if (url.pathname.startsWith("/api/providers/favorites/")) { onlineFavorites = onlineFavorites.filter(item => item.id !== url.pathname.split("/").at(-1)); return new Response(null, { status: 204 }); }
    if (url.pathname === "/api/radio/favorites") {
      if (init?.method === "POST") radioFavorites.push(JSON.parse(String(init.body)).station);
      return Response.json({ favorites: radioFavorites });
    }
    if (url.pathname.startsWith("/api/radio/favorites/")) { radioFavorites = radioFavorites.filter(item => item.id !== url.pathname.split("/").at(-1)); return new Response(null, { status: 204 }); }
    if (url.pathname === "/api/providers/youtube/items") {
      if (youtubeError) return Response.json({ error: "YouTube is temporarily unavailable" }, { status: 502 });
      return Response.json({ items: integrated ? url.searchParams.get("url") ? [{ ...video, id: "collection-video", title: "Collection episode" }] : url.searchParams.get("cursor") ? [{ ...video, id: "yt-more", title: "Another video" }] : [video, collection] : [], ...(!url.searchParams.has("url") && !url.searchParams.has("cursor") && integrated ? { nextCursor: "24" } : {}) });
    }
    if (url.pathname === "/api/providers/raiplay/items" && url.searchParams.get("url")?.endsWith("/dirette")) return Response.json({ items: [{ id: "rai-one", provider: "raiplay", title: "Rai 1", kind: "media", live: true, url: "https://www.raiplay.it/dirette/rai1" }] });
    if (url.pathname === "/api/providers/bandcamp/items") return Response.json({ title: "Public album", items: [{ id: "bc-track", provider: "bandcamp", kind: "media", title: "Album track", url: "https://artist.bandcamp.com/track/one" }] });
    if (url.pathname.startsWith("/api/providers/")) return Response.json({ items: [] });
    if (url.pathname === "/api/radio/playlists") return Response.json({ playlists: integrated ? [{ id: "own", name: "My radio" }] : [] });
    if (url.pathname === "/api/radio/playlists/own/stations") return Response.json({ stations: integrated ? [station] : [] });
    if (url.pathname === "/api/radio/avoid") return Response.json({ stations: [] });
    if (url.pathname === "/api/radio/stations") return Response.json({ stations: integrated ? [{ ...station, sourceId: undefined, id: "directory-one", name: "Directory radio" }] : [] });
    if (url.pathname === "/api/jellyfin") return Response.json({ connected: connectedJellyfin, serverName: "Home" });
    if (url.pathname === "/api/jellyfin/items") return jellyfinError ? Response.json({ error: "Jellyfin server unavailable" }, { status: 502 }) : Response.json({ items: empty ? [] : [{ id: "remote", title: "Evening song", kind: "Audio", detail: "Artist", duration: 80, resumePosition: 0, played: false }], total: empty ? 0 : 55, startIndex: Number(url.searchParams.get("startIndex")) });
    if (url.pathname.endsWith("/sources")) return Response.json({ sources: [{ name: "NAS", status: unavailable ? "unavailable" : "ready" }] });
    return Response.json({ items: empty ? [] : [{ ...local, available: !unavailable, title: url.searchParams.get("q") === "new" ? "New movie" : local.title }], total: empty ? 0 : 40, offset: Number(url.searchParams.get("offset")), limit: 30 });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  release?.(); await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Search did not settle"); await flush(); }
}

test("Find merges local, Jellyfin, provider and radio results with direct actions", async () => {
  integrated = true; await render(); await search("Evening");
  await until(() => !!button("Play Evening video"));
  for (const label of ["Resume Evening movie", "Play Evening song", "Play Evening video", "Play Evening radio"]) expect(button(label)).toBeDefined();
  for (const path of ["/api/providers/youtube/items?q=Evening", "/api/radio/playlists/own/stations?q=Evening", "/api/library/items?q=Evening&offset=0&limit=30"]) expect(paths).toContain(path);
  await click("Queue Evening movie"); expect(queued.at(-1)).toEqual(["Library", "local", undefined]);
  await until(() => document.body.textContent?.includes("Queued Evening movie.") ?? false);
  await click("Play Evening video"); expect(commands.at(-1)).toMatchObject({ type: "enqueueProvider", url: video.url, playNow: true });
});

test("opening and leaving a collection restores focus to its result", async () => {
  integrated = true; await render(); await search("Evening");
  await until(() => !!button("Open Evening collection"));
  await click("Open Evening collection");
  await until(() => !!button("Play Collection episode"));
  expect(document.activeElement).toBe(button("Results"));
  await click("Results");
  await until(() => document.activeElement?.getAttribute("aria-label") === "Open Evening collection");
  expect(button("Open Evening collection").isConnected).toBe(true);
});

test("one failed provider stays visible as feedback while other results work, and retry is independent", async () => {
  integrated = true; youtubeError = true; await render(); await search("Evening");
  await until(() => document.body.textContent?.includes("YouTube is temporarily unavailable") ?? false);
  expect(button("Resume Evening movie")).toBeDefined();
  expect(button("Play Evening radio")).toBeDefined();
  const raiCount = paths.filter(path => path.includes("raiplay/items")).length;
  youtubeError = false; await click("Try again");
  await until(() => !!button("Play Evening video"));
  expect(paths.filter(path => path.includes("raiplay/items"))).toHaveLength(raiCount);
});

test("local and provider pagination controls are available in the merged Find view", async () => {
  integrated = true; await render(); await search("Evening");
  await until(() => !!button("More from Folders"));
  await click("More from Folders");
  expect(paths).toContain("/api/library/items?q=Evening&offset=30&limit=30");
  await click("More from YouTube");
  await until(() => !!button("Play Another video"));
  expect(paths).toContain("/api/providers/youtube/items?q=Evening&cursor=24");
});

test("empty results and filters give a way back", async () => {
  empty = true; connectedJellyfin = false; await render(); await search("nothing");
  await until(() => document.body.textContent?.includes("Nothing found for") ?? false);
  expect(document.body.textContent).toContain("Nothing found for “nothing”");
  empty = false; await search("Evening");
  await until(() => !!button("Resume Evening movie"));
  const what = document.querySelector<HTMLElement>('[aria-label="What filter"]')!;
  await act(async () => [...what.querySelectorAll("button")].find(node => node.textContent?.startsWith("Video"))!.click());
  await until(() => !button("Play Evening song"));
  expect(button("Resume Evening movie")).toBeDefined();
  await act(async () => [...what.querySelectorAll("button")].find(node => node.textContent?.startsWith("All"))!.click());
  expect(button("Resume Evening movie")).toBeDefined();
});

test("focus moves to a real result when the focused result is filtered away", async () => {
  integrated = true; await render(); await search("Evening");
  await until(() => !!button("Resume Evening movie") && !!button("Play Evening song"));
  button("Resume Evening movie").focus();
  const from = document.querySelector<HTMLElement>('[aria-label="From filter"]')!;
  await act(async () => [...from.querySelectorAll("button")].find(node => node.textContent?.startsWith("Jellyfin"))!.click());
  await until(() => !button("Resume Evening movie"));
  expect(document.activeElement?.closest("[data-hit-id]")).toBeTruthy();
});

test("a pasted direct-media link queues an entry with a server-safe title", async () => {
  await render();
  const url = `https://example.com/${"x".repeat(240)}`;
  await search(url);
  await click("Direct media");
  await click("Queue");
  expect(commands.at(-1)).toMatchObject({ type: "enqueue", playNow: false });
  const entry = (commands.at(-1) as Extract<Action, { type: "enqueue" }>).entry;
  expect(entry.title.length).toBeLessThanOrEqual(200);
});
test("an unfinished link stays editable without crashing Find", async () => {
  await render();
  await search("http://");
  expect(document.querySelector<HTMLInputElement>("#media-search")?.value).toBe("http://");
  expect(document.querySelector('[aria-label="Pasted link"]')).toBeNull();
});
test("controlled search drafts change only through the owner and never report route updates as edits", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const client = new QueryClient();
  const edits: string[] = [];
  const draw = async (draftQuery: string, routeQuery: string) => act(async () => root.render(<QueryClientProvider client={client}><SearchPanel draftQuery={draftQuery} searchState={{ query: routeQuery, source: "All" }} onQueryChange={query => edits.push(query)} origin="http://localhost" token="paired" connected canPlay active={false} onEnqueue={async () => true} /></QueryClientProvider>));
  await draw("Owner draft", "route"); await flush();
  const input = document.querySelector<HTMLInputElement>("#media-search")!;
  expect(input.value).toBe("Owner draft"); expect(edits).toEqual([]);
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "Typed edit"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(edits).toEqual(["Typed edit"]); expect(input.value).toBe("Owner draft");
  await draw("Accepted edit", "new route"); await flush();
  expect(input.value).toBe("Accepted edit"); expect(edits).toEqual(["Typed edit"]);
  await click("Clear search");
  expect(edits).toEqual(["Typed edit", ""]); expect(input.value).toBe("Accepted edit");
});

test("standalone drafts follow route updates without reporting synthetic edits", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const client = new QueryClient();
  const edits: string[] = [];
  const draw = async (query: string) => act(async () => root.render(<QueryClientProvider client={client}><SearchPanel searchState={{ query, source: "All" }} onQueryChange={value => edits.push(value)} origin="http://localhost" token="paired" connected canPlay active={false} onEnqueue={async () => true} /></QueryClientProvider>));
  await draw("first route"); await flush(); await draw("second route"); await flush();
  expect(document.querySelector<HTMLInputElement>("#media-search")!.value).toBe("second route");
  expect(edits).toEqual([]);
});

test("debounced drafts survive frequent parent renders, use the latest callback and support explicit retry", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const client = new QueryClient();
  const oldRoutes: string[] = [], newRoutes: string[] = [];
  let setDraft!: (query: string) => void;
  function Controlled({ latest }: { latest: boolean }) {
    const [draftQuery, updateDraft] = useState(""); setDraft = updateDraft;
    const [searchState, setRoute] = useState({ query: "", source: "All" });
    return <QueryClientProvider client={client}><SearchPanel draftQuery={draftQuery} onQueryChange={updateDraft} searchState={searchState} onSearchChange={value => { (latest ? newRoutes : oldRoutes).push(value.query); setRoute(value); }} origin="http://localhost" token="paired" connected canPlay active onEnqueue={async () => true} /></QueryClientProvider>;
  }
  await act(async () => root.render(<Controlled latest={false} />));
  await act(async () => setDraft("Evening"));
  for (let tick = 0; tick < 5; tick++) {
    await act(async () => root.render(<Controlled latest />));
    await act(async () => { await Bun.sleep(75); });
  }
  await flush();
  expect(oldRoutes).toEqual([]); expect(newRoutes).toEqual(["Evening"]);
  const reads = paths.filter(path => path.includes("youtube/items")).length;
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush();
  expect(paths.filter(path => path.includes("youtube/items"))).toHaveLength(reads + 1);
});
