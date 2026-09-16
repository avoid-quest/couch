import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act, useState } from "react";
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
    root.render(<QueryClientProvider client={queryClient}><SearchPanel onManageSources={administrator ? source => { browsed.push("Source settings"); setupSources.push(source); } : undefined} origin={origin} token="paired" connected={connected} canPlay={canPlay} active={active} defaultQuality={defaultQuality} onCommand={async command => { commands.push(command); return true; }} onBrowse={section => browsed.push(section)} onEnqueue={async (...args) => { queued.push(args); return true; }} /></QueryClientProvider>);
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
for (const tv of [false, true]) test(`${tv ? "TV" : "phone"} cross-source inspect, play, queue and return retains query, scroll and focus`, async () => {
  const container = document.body.firstElementChild!;
  if (tv) container.className = "tv-browser";
  const scroller = tv ? container : document.documentElement;
  if (!tv) Object.defineProperty(document, "scrollingElement", { configurable: true, value: scroller });
  await render(); expect(paths).toEqual([]); await search("Evening");
  expect(document.body.textContent).toContain("40 results"); expect(document.body.textContent).toContain("55 results");
  scroller.scrollTop = 480;
  expect(queued).toEqual([]);
  expect(!!button("Resume now: Evening movie")).toBe(true);
  await click("Details for Evening movie");
  expect(queued).toEqual([]);
  let dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("An evening story"); await click("Resume now: Evening movie", dialog); await click("Add to queue: Evening movie", dialog); await click("Close", dialog);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for Evening movie"); expect(scroller.scrollTop).toBe(480);
  await click("Details for Evening song"); dialog = document.querySelector('[role="dialog"]')!;
  await click("Play now: Evening song", dialog); await click("Add to queue: Evening song", dialog); await click("Close", dialog);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for Evening song");
  expect(queued).toEqual([["Library", "local", { playNow: true }], ["Library", "local", undefined], ["Jellyfin", "remote", { playNow: true }], ["Jellyfin", "remote", undefined]]);
  await render(false); scroller.scrollTop = 0; await render();
  expect(scroller.scrollTop).toBe(480); expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
  await click("Jellyfin"); expect(browsed).toEqual([]);
  expect(paths).toContain("/api/providers/youtube/items?q=Evening");
  expect(document.querySelector('[aria-label="Library search results"]')?.closest("[hidden]")).not.toBeNull();
  await click("All sources"); expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
});
test("one unavailable source does not hide local results and retries only that source", async () => {
  jellyfinError = true; await render(); await search("Evening");
  expect(button("Details for Evening movie").disabled).toBe(false); expect(document.body.textContent).toContain("Jellyfin server unavailable");
  const count = paths.filter(path => path.startsWith("/api/library")).length;
  jellyfinError = false; await click("Retry Jellyfin");
  expect(button("Details for Evening song").disabled).toBe(false); expect(paths.filter(path => path.startsWith("/api/library")).length).toBe(count);
});
test("missing folders retain searchable items with disabled play and queue", async () => {
  unavailable = true; connectedJellyfin = false; await render(); await search("Evening");
  expect(document.body.textContent).toContain("NAS: folder unavailable"); expect(button("Add to queue: Evening movie").disabled).toBe(true);
  await click("Details for Evening movie"); expect(button("Resume now: Evening movie").disabled).toBe(true); await click("Close");
  expect(document.body.textContent).toContain("Jellyfin is not connected"); expect(paths.some(path => path.startsWith("/api/jellyfin/items"))).toBe(false);
});
test("pagination is independent, new searches reset both pages, and empty results are explicit", async () => {
  await render(); await search("Evening");
  const library = document.querySelector('[aria-label="Library search results"]')!;
  await click("Next", library); expect(paths).toContain("/api/library/items?q=Evening&offset=30&limit=30");
  expect(paths.some(path => path.includes("startIndex=50"))).toBe(false);
  empty = true; await search("nothing");
  expect(paths).toContain("/api/library/items?q=nothing&offset=0&limit=30");
  expect(document.body.textContent).toContain("No matches in Library"); expect(document.body.textContent).toContain("No matches in Jellyfin");
});
test("new queries cancel delayed old responses and disconnected playback stays disabled", async () => {
  connectedJellyfin = false; delayedQuery = "old"; await render(); await search("old");
  expect(document.body.textContent).toContain("Searching Library");
  await search("new"); await act(async () => release?.()); await flush();
  expect(document.body.textContent).toContain("New movie"); expect(document.body.textContent).not.toContain("Evening movie");
  await render(true, true, false); await click("Details for New movie"); expect(button("Resume now: New movie").disabled).toBe(true); expect(button("Add to queue: New movie").disabled).toBe(false); await click("Close");
  await render(true, false); expect(button("Add to queue: New movie").disabled).toBe(true);
});

test("progress broadcasts retain open details and focused result nodes during refresh", async () => {
  await render(); await search("Evening"); await click("Details for Evening movie");
  const trigger = button("Details for Evening movie");
  await render(true, true, true, 2);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull(); expect(dialog.textContent).toContain("Evening movie");
  await click("Add to queue: Evening movie", dialog); await click("Close", dialog);
  expect(document.activeElement).toBe(trigger);
  delayedQuery = "Evening"; connectedJellyfin = false;
  await render(true, true, true, 3);
  expect(button("Details for Evening movie")).toBe(trigger); expect(document.activeElement).toBe(trigger);
  await act(async () => release?.()); await flush();
  expect(button("Details for Evening movie")).toBe(trigger); expect(document.activeElement).toBe(trigger);
});

test("TV playback hides details and Home restores their result focus", async () => {
  await render(); await search("Evening"); await click("Details for Evening movie");
  const opener = button("Details for Evening movie");
  await click("Resume now: Evening movie", document.querySelector('[role="dialog"]')!);
  await render(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  // TV Home first focuses its source tab. Search restores the detail opener after that render.
  document.querySelector<HTMLInputElement>("#media-search")!.focus();
  await render(); await act(async () => { await Bun.sleep(30); });
  expect(document.activeElement).toBe(opener);
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

for (const invalidation of ["query", "hidden"] as const) test(`deferred return focus is cancelled by a new ${invalidation}`, async () => {
  await render(); await search("Evening"); await click("Details for Evening movie"); await render(false);
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 1;
  const schedule = spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { const id = nextFrame++; frames.set(id, callback); return id; });
  const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  try {
    await render();
    expect(frames.size).toBe(1);
    if (invalidation === "query") await search("new"); else await render(false);
    expect(frames.size).toBe(0);
  } finally { schedule.mockRestore(); cancel.mockRestore(); }
});

test("one submitted search integrates online and configured radio with default quality and existing saved stores", async () => {
  integrated = true; await render(); await search("Evening");
  for (const path of ["/api/providers/youtube/items?q=Evening", "/api/providers/raiplay/items?q=Evening", "/api/providers/twitch/items?q=Evening", "/api/radio/stations?q=Evening", "/api/radio/playlists/own/stations?q=Evening"]) expect(paths).toContain(path);
  await click("Play now: Evening video"); expect(commands.at(-1)).toMatchObject({ type: "enqueueWeb", url: video.url, quality: "1080p", playNow: true });
  await click("Add to queue: Evening video"); expect(commands.at(-1)).toMatchObject({ type: "enqueueWeb", quality: "1080p", playNow: false });
  await click("Play now: Evening radio"); expect(commands.at(-1)).toMatchObject({ type: "enqueueRadio", stationId: station.id, playNow: true });
  await click("Play now: Directory radio"); expect(commands.at(-1)).toMatchObject({ type: "enqueue", entry: { title: "Directory radio", kind: "radio" } });
  await click("Save Evening video"); expect(onlineFavorites).toEqual([video]); expect(button("Remove Evening video from saved").getAttribute("aria-pressed")).toBe("true");
  await click("Save Evening radio"); expect(radioFavorites).toEqual([station]);
  await click("Remove Evening video from saved"); expect(onlineFavorites).toEqual([]);
});
test("provider errors and pagination stay independent and collection Back restores result focus", async () => {
  integrated = true; youtubeError = true; await render(); await search("Evening");
  expect(document.body.textContent).toContain("YouTube is temporarily unavailable"); expect(button("Play now: Evening radio").disabled).toBe(false); expect(button("Details for Evening movie").disabled).toBe(false);
  const raiCount = paths.filter(path => path.includes("raiplay/items")).length;
  youtubeError = false; await click("Retry YouTube"); expect(paths.filter(path => path.includes("raiplay/items"))).toHaveLength(raiCount);
  await click("Show more YouTube"); expect(paths).toContain("/api/providers/youtube/items?q=Evening&cursor=24"); expect(button("Play now: Another video")).toBeDefined();
  await click("Open Evening collection"); expect(button("Play now: Collection episode")).toBeDefined(); expect(document.activeElement?.textContent).toBe("Back to results");
  await click("Back to results"); expect(document.activeElement?.getAttribute("aria-label")).toBe("Open Evening collection"); expect(button("Play now: Another video")).toBeDefined();
  const onlineCount = paths.filter(path => path.includes("youtube/items")).length;
  await render(true, true, true, 2); expect(paths.filter(path => path.includes("youtube/items"))).toHaveLength(onlineCount);
});
test("provider URL opens its existing catalogue, Bandcamp album commands remain audio, and other links use existing playback", async () => {
  integrated = true; await render(); await search("https://artist.bandcamp.com/album/public");
  expect(paths).toContain("/api/providers/bandcamp/items?url=https%3A%2F%2Fartist.bandcamp.com%2Falbum%2Fpublic");
  expect(paths.some(path => path.includes("youtube/items") || path.includes("library/items"))).toBe(false);
  await click("Play album"); expect(commands.at(-1)).toEqual({ type: "enqueueProviderAlbum", provider: "bandcamp", url: "https://artist.bandcamp.com/album/public", playNow: true });
  await click("Play now: Album track"); expect(commands.at(-1)).toMatchObject({ type: "enqueueWeb", url: "https://artist.bandcamp.com/track/one" }); expect(commands.at(-1)).not.toHaveProperty("quality");
  await search("https://streamingcommunityz.academy/watch/public"); await click("Play now"); expect(commands.at(-1)).toMatchObject({ type: "enqueueWeb", url: "https://streamingcommunityz.academy/watch/public", playNow: true });
});
test("filters retain query and source results, and broadcasts refresh saved state without repeating online searches", async () => {
  integrated = true; await render(); await search("Evening");
  const count = paths.filter(path => path.includes("youtube/items")).length;
  await click("Radio playlists"); await click("YouTube"); expect(paths.filter(path => path.includes("youtube/items"))).toHaveLength(count);
  expect(document.querySelector<HTMLInputElement>("#media-search")!.value).toBe("Evening");
  onlineFavorites = [video]; await render(true, true, true, 1, 2); expect(button("Remove Evening video from saved").getAttribute("aria-pressed")).toBe("true");
  expect(paths.filter(path => path.includes("youtube/items"))).toHaveLength(count);
  await render(true, false); expect(button("Play now: Evening video").disabled).toBe(true); expect(button("Remove Evening video from saved")).toBeUndefined();
});
test("Search applies a temporary online quality override once and returns to the default", async () => {
  integrated = true; await render(); await search("Evening");
  await click("Video quality for Evening video");
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="popover-content"] [role="combobox"]')!.click()); await flush();
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "Up to 720p")!;
  expect(option).toBeDefined();
  await act(async () => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await flush();
  await act(async () => document.querySelector<HTMLElement>('[data-slot="popover-content"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await flush();
  await click("Play now: Evening video"); expect(commands.at(-1)).toMatchObject({ quality: "720p" });
  await click("Add to queue: Evening video"); expect(commands.at(-1)).toMatchObject({ quality: "1080p" });
});
test("a superseded online search cannot overwrite the current provider results", async () => {
  integrated = true;
  const implementation = request.getMockImplementation()!;
  let oldSignal: AbortSignal | undefined;
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/providers/youtube/items" && url.searchParams.get("q") === "old online") {
      oldSignal = init?.signal as AbortSignal;
      await new Promise<void>(resolve => { release = resolve; });
      return Response.json({ items: [{ ...video, title: "Obsolete provider video" }] });
    }
    return implementation(input, init);
  }) as typeof fetch);
  await render(); await search("old online"); await search("Evening");
  expect(oldSignal?.aborted).toBe(true); release?.(); await flush();
  expect(document.body.textContent).not.toContain("Obsolete provider video"); expect(button("Play now: Evening video")).toBeDefined();
});

test("changing TV identity clears saved radio results while the new TV request is pending", async () => {
  integrated = true; radioFavorites = [{ ...station, id: "old-favorite", name: "Evening private favorite" }];
  await render(); await search("Evening"); expect(button("Play now: Evening private favorite")).toBeDefined();
  const implementation = request.getMockImplementation()!;
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).origin === "http://other-tv" && String(input).includes("/api/radio/")) {
      await new Promise<void>(resolve => { const prior = release; release = () => { prior?.(); resolve(); }; });
      return Response.json({ favorites: [], playlists: [], stations: [] });
    }
    return implementation(input, init);
  }) as typeof fetch);
  await render(true, true, true, 1, 1, "http://other-tv");
  expect(document.body.textContent).not.toContain("Evening private favorite"); expect(button("Play now: Evening radio")).toBeUndefined();
  release?.(); await flush(); expect(document.body.textContent).not.toContain("Evening private favorite");
});
test("a new query aborts an in-flight provider pagination request", async () => {
  integrated = true; await render(); await search("Evening");
  const implementation = request.getMockImplementation()!; let pageSignal: AbortSignal | undefined;
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/providers/youtube/items" && url.searchParams.has("cursor")) {
      pageSignal = init?.signal as AbortSignal;
      await new Promise<void>(resolve => { release = resolve; });
      return Response.json({ items: [{ ...video, title: "Obsolete page" }] });
    }
    return implementation(input, init);
  }) as typeof fetch);
  await click("Show more YouTube"); expect(pageSignal?.aborted).toBe(false);
  await search("new"); expect(pageSignal?.aborted).toBe(true);
  release?.(); await flush(); expect(document.body.textContent).not.toContain("Obsolete page");
});

test("RaiPlay searches include matching live channels even when the programme catalogue has no match", async () => {
  await render(); await search("rai1");
  expect(button("Play now: Rai 1")).toBeDefined();
  await click("Play now: Rai 1"); expect(commands.at(-1)).toMatchObject({ type: "enqueueWeb", url: "https://www.raiplay.it/dirette/rai1", quality: "1080p", playNow: true });
});

test("the empty discovery field has no filters, heading or premature requests", async () => {
  await render(true, true, true, 1, 1, "http://localhost", "auto");
  expect(document.querySelector("h1")).toBeNull();
  expect(document.querySelector("[data-search-scopes]")).toBeNull();
  expect(document.querySelector<HTMLInputElement>("#media-search")?.placeholder).toBe("Search or paste a link");
  expect(paths).toEqual([]);
});

for (const live of [true, false]) test(`Twitch ${live ? "live" : "offline"} search channel opens broadcasts and restores its browse control without playback`, async () => {
  const { SearchOnlineResults } = await import("./SearchOnlineResults");
  const channel: ProviderItem = { id: "channel", provider: "twitch", kind: live ? "media" : "channel", title: "Evening channel", url: "https://www.twitch.tv/evening", live };
  const archive: ProviderItem = { id: "archive", provider: "twitch", kind: "media", title: "Past episode", url: "https://www.twitch.tv/videos/123456789", live: false };
  request.mockImplementation((async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    return Response.json(url.pathname.endsWith("/favorites") ? { favorites: [] } : { items: url.searchParams.has("url") ? [channel, archive] : [channel] });
  }) as typeof fetch);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><SearchOnlineResults provider="twitch" query="Evening" quality="auto" onEnqueued={() => {}} origin="http://localhost" token="paired" connected canPlay active onCommand={async action => { commands.push(action); return true; }} /></QueryClientProvider>)); await flush();
  const label = live ? "Past broadcasts from Evening channel" : "Open Evening channel";
  await click(label);
  expect(paths).toContain("/api/providers/twitch/items?url=https%3A%2F%2Fwww.twitch.tv%2Fevening");
  expect(button("Play now: Past episode")).toBeDefined();
  expect(button("Past broadcasts from Evening channel")).toBeUndefined();
  expect(commands).toEqual([]);
  await click("Back to results");
  expect(document.activeElement).toBe(button(label));
  expect(commands).toEqual([]);
});

for (const manage of [false, true]) test(`${manage ? "administrator" : "guest"} can recover from an unconfigured source without losing their query`, async () => {
  integrated = true; administrator = manage; connectedJellyfin = false;
  await render(); await search("Evening");
  const source = document.querySelector('[aria-label="Jellyfin search results"]')!;
  expect(source.textContent).toContain("Jellyfin is not connected");
  expect(!!button("Source settings", source)).toBe(manage);
  if (manage) { await click("Source settings", source); expect(browsed).toEqual(["Source settings"]); }
  await click("Search YouTube", source);
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
  expect(button("YouTube").getAttribute("aria-pressed")).toBe("true");
  await flush(); expect(document.activeElement).toBe(button("YouTube"));
  expect(button("Play now: Evening video").textContent).toBe("Play now");
  expect(button("Add to queue: Evening video").textContent).toBe("Add to queue");
  expect(commands).toEqual([]);
  await click("Add to queue: Evening video");
  expect(commands.at(-1)).toMatchObject({ type: "enqueueWeb", playNow: false });
  expect(document.body.textContent).toContain("added to the end of Up next. Playback is unchanged.");
  await click("Play now: Evening video");
  expect(commands.at(-1)).toMatchObject({ type: "enqueueWeb", playNow: true });
  expect(document.body.textContent).toContain("Starting Evening video on the playback computer.");
});

test("typing searches in place after debounce and keeps input focus", async () => {
  integrated = true; await render();
  const input = document.querySelector<HTMLInputElement>("#media-search")!;
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "Evening"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(paths).toEqual([]);
  await act(async () => { await Bun.sleep(350); }); await flush();
  expect(paths).toContain("/api/providers/youtube/items?q=Evening");
  expect(document.activeElement === input).toBe(true);
  expect(button("YouTube").textContent).toBe("YouTube 2");
  expect(!!button("avoid radio")).toBe(false);
  expect(button("Radio playlists").textContent).toBe("Radio playlists 1");
  await click("Clear search");
  expect(input.value).toBe(""); expect(document.activeElement === input).toBe(true);
  expect(document.querySelector("[data-search-scopes]")).toBeNull();
});

for (const deferred of [false, true]) test(`${deferred ? "deferred" : "synchronous"} route updates focus the newly selected source after recovery`, async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const { flushSync } = await import("react-dom");
  connectedJellyfin = false; integrated = true;
  let updateRoute: (() => void) | undefined;
  function RoutedSearch() {
    const [searchState, setSearchState] = useState({ query: "Evening", source: "Jellyfin" });
    return <SearchPanel origin="http://localhost" token="paired" connected canPlay active searchState={searchState} onSearchChange={value => { if (deferred) updateRoute = () => setSearchState(value); else flushSync(() => setSearchState(value)); }} onBrowse={() => {}} onEnqueue={async () => true} />;
  }
  await act(async () => root.render(<RoutedSearch />)); await flush();
  await click("Search YouTube", document.querySelector('[aria-label="Jellyfin search results"]')!);
  if (deferred) await act(async () => updateRoute?.());
  expect(document.activeElement).toBe(button("YouTube"));
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
});

for (const label of ["Evening video", "Evening radio"]) test(`${label} details preserve browsing focus and expose separate play and queue commands`, async () => {
  integrated = true; await render(); await search("Evening");
  const opener = button(`Details for ${label}`); opener.focus();
  await click(`Details for ${label}`);
  expect(commands).toEqual([]);
  const dialog = document.querySelector('[role="dialog"]')!;
  await click(`Add to queue: ${label}`, dialog);
  expect(commands.at(-1)).toMatchObject({ playNow: false });
  await click(`Play now: ${label}`, dialog);
  expect(commands.at(-1)).toMatchObject({ playNow: true });
  await click("Close", dialog);
  expect(document.activeElement === opener).toBe(true);
  expect(document.querySelector<HTMLInputElement>("#media-search")?.value).toBe("Evening");
});

test("avoid radio has its own matching group and retries a stale catalog without reloading other sources", async () => {
  const { avoidRadioPlaylistId } = await import("../../../shared/radio");
  integrated = true;
  const own = { ...station, id: "avoid-one", sourceId: avoidRadioPlaylistId, name: "Evening avoid" };
  const original = request.getMockImplementation()!;
  let refreshed = false, savedUnavailable = false;
  const avoidReads: boolean[] = [];
  request.mockImplementation((async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/radio/avoid") {
      const force = url.searchParams.get("refresh") === "true";
      avoidReads.push(force);
      refreshed ||= force;
      return Response.json({ stations: [own], playlist: { error: refreshed ? null : "Using saved avoid stations" } });
    }
    if (url.pathname === "/api/radio/favorites" && savedUnavailable) return Response.json({ error: "Favorites unavailable" }, { status: 503 });
    if (url.pathname === "/api/radio/playlists") return Response.json({ playlists: [{ id: "own" }, { id: avoidRadioPlaylistId }] });
    return original(input, init);
  }) as typeof fetch);
  radioFavorites = [own]; await render(); await search("Evening");
  expect(button("avoid radio").textContent).toBe("avoid radio 1");
  expect(button("Radio playlists").textContent).toBe("Radio playlists 1");
  expect(document.querySelector('[aria-label="Radio playlists search results"]')?.textContent).not.toContain("Evening avoid");
  expect(paths.some(path => path.includes(`/playlists/${avoidRadioPlaylistId}/stations`))).toBe(false);
  const youtubeReads = paths.filter(path => path.includes("youtube/items")).length;
  await click("Retry avoid radio");
  expect(avoidReads).toEqual([false, true]);
  expect(document.body.textContent).not.toContain("Using saved avoid stations");
  expect(paths.filter(path => path.includes("youtube/items"))).toHaveLength(youtubeReads);
  // A completed refresh broadcasts radioVersion. Following reads must use its cache.
  await render(true, true, true, 1, 2);
  expect(avoidReads).toEqual([false, true, false]);
  savedUnavailable = true;
  await render(true, true, true, 1, 3);
  savedUnavailable = false;
  const avoidResults = document.querySelector('[aria-label="avoid radio search results"]')!;
  await click("Retry saved status", avoidResults);
  expect(avoidReads.filter(Boolean)).toHaveLength(1);
  expect(avoidReads.at(-1)).toBe(false);
  expect(document.querySelector<HTMLInputElement>("#media-search")?.value).toBe("Evening");
});

for (const manage of [false, true]) for (const [source, failedPath, setup] of [
  ["Library", "/api/library/items", "folders"],
  ["Jellyfin", "/api/jellyfin/items", "jellyfin"],
  ["Radio playlists", "/api/radio/playlists/own/stations", "radio"],
]) test(`${source} failure offers ${manage ? "direct source settings" : "a controller role explanation"} without losing search`, async () => {
  integrated = true; administrator = manage;
  const original = request.getMockImplementation()!;
  request.mockImplementation((async (input, init) => new URL(String(input)).pathname === failedPath ? Response.json({ error: "Source access expired" }, { status: 401 }) : original(input, init)) as typeof fetch);
  await render(); await search("Evening");
  const results = document.querySelector(`[aria-label="${source} search results"]`)!;
  expect(results.textContent).toContain("Source access expired");
  expect(!!button("Source settings", results)).toBe(manage);
  if (manage) { await click("Source settings", results); expect(setupSources).toEqual([setup]); }
  else expect(results.textContent).toContain("Ask an administrator to manage this source");
  expect(document.querySelector<HTMLInputElement>("#media-search")?.value).toBe("Evening");
  expect(button("Play now: Evening video").disabled).toBe(false);
  expect(commands).toEqual([]);
});

test("saved directory stations keep their source identity and do not create a radio playlist group", async () => {
  integrated = true;
  const directoryStation = { ...station, id: "saved-directory", sourceId: undefined, name: "Evening directory" };
  radioFavorites = [directoryStation];
  const original = request.getMockImplementation()!;
  request.mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/radio/playlists") return Response.json({ playlists: [] });
    if (path === "/api/radio/stations") return Response.json({ stations: [directoryStation] });
    return original(input, init);
  }) as typeof fetch);
  await render(); await search("Evening");
  expect(!!button("Radio playlists")).toBe(false);
  expect(button("Radio directory").textContent).toBe("Radio directory 1");
  expect(document.querySelector('[aria-label="Radio playlists search results"]')?.textContent).not.toContain("Evening directory");
  expect(button("Remove Evening directory from saved").getAttribute("aria-pressed")).toBe("true");
  await click("Add to queue: Evening directory");
  expect(commands.at(-1)).toMatchObject({ type: "enqueue", entry: { title: "Evening directory", kind: "radio" }, playNow: false });
});

test("disconnecting after an empty search no longer claims search completion", async () => {
  empty = true; await render(); await search("nothing");
  expect(document.body.textContent).toContain('No results for "nothing"');
  const reads = paths.length;
  await render(true, false);
  expect(document.body.textContent).toContain("Reconnect to search and play your media");
  expect(document.body.textContent).not.toContain('No results for "nothing"');
  expect(paths).toHaveLength(reads);
});

test("radio details follow refreshed results, retain saved stations and close after removal", async () => {
  integrated = true; radioFavorites = [station];
  let currentStations = [station];
  const original = request.getMockImplementation()!;
  request.mockImplementation((async (input, init) => new URL(String(input)).pathname === "/api/radio/playlists/own/stations" ? Response.json({ stations: currentStations }) : original(input, init)) as typeof fetch);
  await render(); await search("Evening"); await click("Details for Evening radio");
  currentStations = [{ ...station, name: "Evening renamed", codec: "AAC", bitrate: 256 }];
  await render(true, true, true, 1, 2);
  let dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Evening renamed");
  expect(dialog.textContent).toContain("AAC · 256 kbps");
  await click("Add to queue: Evening renamed", dialog);
  expect(commands.at(-1)).toMatchObject({ type: "enqueueRadio", stationId: station.id, playNow: false });
  currentStations = [];
  radioFavorites = [{ ...station, name: "Evening saved station" }];
  await render(true, true, true, 1, 3);
  dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Evening saved station");
  await click("Remove Evening saved station from saved", dialog);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button("Play now: Evening saved station")).toBeUndefined();
});

for (const label of ["Evening video", "Evening radio"]) {
  test(`${label} closes while inactive and restores the original result on return`, async () => {
    integrated = true; await render(); await search("Evening");
    const opener = button(`Details for ${label}`); opener.focus(); await click(`Details for ${label}`);
    await render(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.querySelector<HTMLInputElement>("#media-search")!.focus();
    await render();
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test(`${label} return does not steal focus from another open dialog`, async () => {
    integrated = true; await render(); await search("Evening"); await click(`Details for ${label}`); await render(false);
    const modal = document.createElement("div"); modal.setAttribute("role", "dialog"); modal.dataset.state = "open";
    const focused = modal.appendChild(document.createElement("button")); document.body.append(modal); focused.focus();
    await render();
    expect(document.activeElement).toBe(focused);
    modal.remove();
  });

  test(`${label} cannot restore an obsolete result after the query changes while inactive`, async () => {
    integrated = true; await render(); await search("Evening");
    const opener = button(`Details for ${label}`); await click(`Details for ${label}`); await render(false);
    await search("new");
    const input = document.querySelector<HTMLInputElement>("#media-search")!; input.focus();
    await render();
    expect(opener.isConnected).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  test(`${label} cancels pending focus restoration when hidden again`, async () => {
    integrated = true; await render(); await search("Evening"); await click(`Details for ${label}`); await render(false);
    const input = document.querySelector<HTMLInputElement>("#media-search")!; input.focus();
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const schedule = spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
    const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
    try {
      await render(); expect(frames.size).toBeGreaterThan(0);
      await render(false); expect(cancel).toHaveBeenCalled();
      await act(async () => { for (const callback of frames.values()) callback(0); });
      expect(document.activeElement).toBe(input);
    } finally { schedule.mockRestore(); cancel.mockRestore(); }
  });
}

test("controlled search drafts change only through the owner and never report route updates as edits", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const edits: string[] = [];
  const draw = async (draftQuery: string, routeQuery: string) => act(async () => root.render(<SearchPanel draftQuery={draftQuery} searchState={{ query: routeQuery, source: "All" }} onQueryChange={query => edits.push(query)} origin="http://localhost" token="paired" connected canPlay active={false} onBrowse={() => {}} onEnqueue={async () => true} />));
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
  const edits: string[] = [];
  const draw = async (query: string) => act(async () => root.render(<SearchPanel searchState={{ query, source: "All" }} onQueryChange={value => edits.push(value)} origin="http://localhost" token="paired" connected canPlay active={false} onBrowse={() => {}} onEnqueue={async () => true} />));
  await draw("first route"); await flush(); await draw("second route"); await flush();
  expect(document.querySelector<HTMLInputElement>("#media-search")!.value).toBe("second route");
  expect(edits).toEqual([]);
});

test("debounced drafts survive frequent parent renders, use the latest callback and support explicit retry", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const oldRoutes: string[] = [], newRoutes: string[] = [];
  let setDraft!: (query: string) => void;
  function Controlled({ latest }: { latest: boolean }) {
    const [draftQuery, updateDraft] = useState(""); setDraft = updateDraft;
    const [searchState, setRoute] = useState({ query: "", source: "All" });
    return <SearchPanel draftQuery={draftQuery} onQueryChange={updateDraft} searchState={searchState} onSearchChange={value => { (latest ? newRoutes : oldRoutes).push(value.query); setRoute(value); }} origin="http://localhost" token="paired" connected canPlay active onBrowse={() => {}} onEnqueue={async () => true} />;
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
