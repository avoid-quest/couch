import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ProviderItem } from "../../../shared/providers";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const requests: string[] = [], browsed: string[] = [], played: unknown[] = [];
const recent = { mediaId: "media:recent", title: "A public video", position: 24, duration: 100, watched: false, lastPlayedAt: 1, libraryItemId: null, playable: true };
const video: ProviderItem = { id: "video", provider: "youtube", kind: "media", title: "A public video", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: "https://example.com/art.jpg" };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
async function renderLibrary(connected = true) {
  const { MediaLibrary } = await import("./MediaLibrary");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MediaLibrary origin="http://localhost" token="paired" connected={connected} canPlay={true} defaultQuality="auto" onPlayHistory={async (...args) => { played.push(args); return true; }} onBrowse={section => browsed.push(section)} onEnqueue={async (...args) => { played.push(args); return true; }} onEnqueuePlaylist={async () => true} onEnqueueAlbum={async () => true} /></QueryClientProvider>));
}
beforeEach(async () => {
  requests.length = 0; browsed.length = 0; played.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "location", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    requests.push(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (String(input).includes("/api/progress/history")) return Response.json({ items: String(input).includes("provider=youtube") ? [recent] : [] });
    return String(input).endsWith("/favorites") ? Response.json({ favorites: [] }) : Response.json({ items: [video] });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("Library opens playable online media without a folder or an owned collection", async () => {
  await renderLibrary();
  expect(document.querySelector("h1")?.textContent).toBe("Library");
  expect(document.body.textContent).toContain("A public video");
  expect(document.body.textContent).not.toContain("Online media");
  expect(document.body.textContent).not.toContain("Your library");
  expect(requests.some(url => url.includes("/api/providers/youtube/items"))).toBe(false);
  expect(requests.some(url => url.includes("provider=youtube"))).toBe(true);
  expect(button("Home")).toBeUndefined();
  expect(button("Back to recent")).toBeUndefined();
  expect(requests.some(url => url.includes("/api/library"))).toBe(false);
  expect([...document.querySelectorAll('[aria-label="Online providers"] [role="tab"]')].map(node => node.textContent)).toEqual(["YouTube", "Twitch", "RaiPlay", "Bandcamp"]);
  expect(button("Resume A public video").disabled).toBe(false);
  await act(async () => button("Resume A public video").click());
  expect(played).toEqual([[recent, { fromStart: false }]]);
  for (const label of ["Radio", "Live TV", "Jellyfin", "TV folders"]) await act(async () => button(label).click());
  expect(browsed).toEqual(["Radio", "Guide", "Jellyfin", "Files"]);
  expect(played).toHaveLength(1);
});

test("Library keeps browsing destinations available while disconnected", async () => {
  await renderLibrary(false);
  expect(requests).toEqual([]);
  expect(button("TV folders").disabled).toBe(false);
  await act(async () => button("Radio").click());
  expect(browsed).toEqual(["Radio"]);
  expect(played).toEqual([]);
});


test("every platform opens its own recent history with the same empty state and no suggestions", async () => {
  await renderLibrary();
  for (const [label, provider] of [["Twitch", "twitch"], ["RaiPlay", "raiplay"], ["Bandcamp", "bandcamp"]]) {
    await act(async () => button(label!).dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }) as unknown as Event));
    expect(requests.filter(url => url.includes("/api/progress/history")).at(-1)).toContain(`provider=${provider}`);
    expect(document.body.textContent).toContain("Nothing played yet.");
    expect(document.body.textContent).not.toContain("A public video");
    expect(document.body.textContent).not.toContain("Suggested");
    expect(button("Home")).toBeUndefined();
  }
});

test("search keeps playback controls and returns explicitly to recent history", async () => {
  await renderLibrary();
  const input = document.querySelector<HTMLInputElement>("#provider-search")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "A public video");
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
  await act(async () => document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  expect(requests.some(url => url.includes("q=A+public+video"))).toBe(true);
  expect(button("Play on TV")).toBeDefined();
  await act(async () => button("Play on TV").click());
  expect(played).toEqual([[video, true, "auto"]]);
  await act(async () => button("Back to recent").click());
  expect(input.value).toBe("");
  expect(button("Resume A public video")).toBeDefined();
  expect(button("Back to recent")).toBeUndefined();
});


test("recent history failure leaves saved items usable and recovers when reopened", async () => {
  request.mockImplementation((async (input) => {
    requests.push(String(input));
    return String(input).includes("/api/progress/history")
      ? Response.json({ error: "History unavailable" }, { status: 503 })
      : Response.json({ favorites: [video] });
  }) as typeof fetch);
  await renderLibrary();
  expect(document.body.textContent).toContain("History unavailable");
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(node => node.textContent?.startsWith("Saved"))!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }) as unknown as Event));
  expect(button("Play on TV")).toBeDefined();
  request.mockImplementation((async (_input: RequestInfo | URL) => Response.json({ items: [recent], favorites: [video] })) as typeof fetch);
  await act(async () => button("Browse").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }) as unknown as Event));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(button("Resume A public video")).toBeDefined();
  expect(requests.some(url => url.includes("/api/providers/youtube/items"))).toBe(false);
});
