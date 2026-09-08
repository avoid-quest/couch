import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ProviderItem } from "../shared/providers";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const requests: string[] = [], browsed: string[] = [], played: unknown[] = [];
const video: ProviderItem = { id: "video", provider: "youtube", kind: "media", title: "A public video", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: "https://example.com/art.jpg" };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
async function renderLibrary(connected = true) {
  const { MediaLibrary } = await import("./MediaLibrary");
  await act(async () => root.render(<MediaLibrary origin="http://localhost" token="paired" connected={connected} canPlay={true} version={0} defaultQuality="auto" onBrowse={section => browsed.push(section)} onEnqueue={async (...args) => { played.push(args); return true; }} onEnqueuePlaylist={async () => true} onEnqueueAlbum={async () => true} />));
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
  expect(requests.some(url => url.includes("/api/providers/youtube/items"))).toBe(true);
  expect(requests.some(url => url.includes("/api/library"))).toBe(false);
  expect([...document.querySelectorAll('[aria-label="Online providers"] [role="tab"]')].map(node => node.textContent)).toEqual(["YouTube", "Twitch", "RaiPlay", "Bandcamp"]);
  expect(button("Play on TV").disabled).toBe(false);
  await act(async () => button("Play on TV").click());
  expect(played).toEqual([[video, true, "auto"]]);
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
