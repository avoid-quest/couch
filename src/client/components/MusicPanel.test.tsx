import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Root } from "react-dom/client";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const paths: string[] = [], queued: unknown[] = [];
let release: (() => void) | undefined;
let delay = false;
const album = { id: "tones", title: "Three tones", artist: "Fixture", trackCount: 1, duration: 18, artworkId: null };
const flush = () => act(async () => { await Bun.sleep(10); });
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };
async function render(active = true) {
  const { MusicPanel } = await import("./MusicPanel");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MusicPanel origin="http://localhost" token="paired" connected canPlay active={active} view="albums" onEnqueue={async () => true} onQueueAlbum={async (...args) => { queued.push(args); return true; }} onArtistTracks={() => {}} /></QueryClientProvider>));
  await flush();
}
beforeEach(async () => {
  paths.length = 0; queued.length = 0; delay = false; release = undefined;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    if (delay && url.pathname.endsWith("/albums")) await new Promise<void>(resolve => { release = resolve; });
    return Response.json(url.pathname.endsWith("/tones") ? { album, items: [{ id: "track", title: "First tone", available: true, duration: 18 }] } : { items: [album], total: 48, offset: Number(url.searchParams.get("offset")), limit: 24 });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  release?.(); await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

for (const tv of [false, true]) test(`${tv ? "TV" : "phone"} album return retains query, page, scroll and focus after play and queue`, async () => {
  const container = document.body.firstElementChild!;
  if (tv) container.className = "tv-browser";
  const scroller = tv ? container : document.documentElement;
  if (!tv) Object.defineProperty(document, "scrollingElement", { configurable: true, value: scroller });
  await render();
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "tones");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush(); await click("Next");
  scroller.scrollTop = 650; scroller.scrollLeft = 12;
  await click("Browse Three tones");
  await click("Play album on TV"); await click("Add album to queue");
  expect(queued).toEqual([["tones", true], ["tones", false]]);
  await render(false); await render(true);
  expect(document.querySelector(".music-album-detail")).not.toBeNull();
  scroller.scrollTop = 90; scroller.scrollLeft = 0;
  delay = true; await click("Back");
  expect(scroller.scrollTop).toBe(90);
  await act(async () => release?.()); await flush();
  expect(paths.at(-1)).toBe("/api/library/music/albums?q=tones&offset=24&limit=24");
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("tones");
  expect(document.activeElement?.getAttribute("data-music-album")).toBe("tones");
  expect(scroller.scrollTop).toBe(650); expect(scroller.scrollLeft).toBe(12);
});
