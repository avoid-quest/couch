import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const paths: string[] = [], queued: unknown[] = [];
let release: (() => void) | undefined;
let delay = false;
const show = { id: "show", title: "Evening show", seasonCount: 2, episodeCount: 2, genres: [], plot: "Show plot", artworkId: null };
const episode = { id: "episode", title: "First episode", kind: "video", available: true, duration: 180, artworkId: null, video: { type: "episode", episode: 1, genres: [], plot: "Episode plot", show } };
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
async function render(view: "movies" | "shows" = "shows", active = true) {
  const { VideoLibraryPanel } = await import("./VideoLibraryPanel");
  await act(async () => root.render(<VideoLibraryPanel origin="http://localhost" token="paired" connected canPlay canManage={false} version={1} active={active} view={view} onEnqueue={async (...args) => { queued.push(args); return true; }} />));
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
    if (delay && url.pathname.endsWith("/shows")) await new Promise<void>(resolve => { release = resolve; });
    return Response.json(url.pathname.endsWith("/shows") ? { items: [show], total: 48, offset: Number(url.searchParams.get("offset")), limit: 24 }
      : url.pathname.endsWith("/seasons") ? { items: [{ season: 1, episodeCount: 1 }, { season: 2, episodeCount: 1 }] }
      : { items: [url.searchParams.get("videoType") === "movie" ? { ...episode, id: "movie", title: "Evening movie", video: { ...episode.video, type: "movie", show: null } } : episode], total: 1, offset: 0, limit: 24 });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  release?.(); await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});


for (const tv of [false, true]) test(`${tv ? "TV" : "phone"} show return restores each level after episode inspection, playback and queue`, async () => {
  const container = document.body.firstElementChild!;
  if (tv) container.className = "tv-browser";
  const scroller = tv ? container : document.documentElement;
  if (!tv) Object.defineProperty(document, "scrollingElement", { configurable: true, value: scroller });
  await render(); await search("Evening"); await click("Next");
  scroller.scrollTop = 650; scroller.scrollLeft = 12;
  await click("Browse Evening show seasons");
  scroller.scrollTop = 320; scroller.scrollLeft = 0;
  await click("Browse Season 2"); await search("First");
  await click("Details for First episode");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Episode plot");
  await click("Play First episode", dialog); await click("Add First episode to queue", dialog);
  expect(queued).toEqual([["episode", { playNow: true }], ["episode", undefined]]);
  await click("Close", dialog);
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("First");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for First episode");
  await render("shows", false); await render();
  expect(document.querySelector("h3")!.textContent).toBe("Evening show");
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("First");
  scroller.scrollTop = 90;
  await click("Back");
  expect(document.activeElement?.getAttribute("data-video-season")).toBe("2");
  expect(scroller.scrollTop).toBe(320);
  delay = true; scroller.scrollTop = 100; await click("Back");
  expect(scroller.scrollTop).toBe(100);
  await act(async () => release?.()); await flush();
  expect(paths.at(-1)).toBe("/api/library/video/shows?q=Evening&offset=24&limit=24");
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
  expect(document.activeElement?.getAttribute("data-video-show")).toBe("show");
  expect(scroller.scrollTop).toBe(650); expect(scroller.scrollLeft).toBe(12);
});

test("movie inspection keeps the searched list and returns focus after play and queue", async () => {
  await render("movies"); await search("Evening");
  await click("Details for Evening movie");
  const dialog = document.querySelector('[role="dialog"]')!;
  await click("Play Evening movie", dialog); await click("Add Evening movie to queue", dialog);
  await click("Close", dialog);
  expect(queued).toEqual([["movie", { playNow: true }], ["movie", undefined]]);
  expect(paths.at(-1)).toBe("/api/library/items?q=Evening&offset=0&limit=24&videoType=movie");
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for Evening movie");
});
