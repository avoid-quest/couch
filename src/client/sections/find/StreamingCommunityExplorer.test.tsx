import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ProviderItem } from "../../../shared/providers";

let root: Root, window: Window, request: ReturnType<typeof spyOn>, queryClient: QueryClient;
const originals = new Map<string, PropertyDescriptor | undefined>();
const paths: string[] = [], enqueued: [ProviderItem, boolean][] = [], saves: [string, string][] = [];
let browseError = false;
const origin = "https://streamingcommunityz.academy";
const movie: ProviderItem = { id: "sc-movie", provider: "streamingcommunity", kind: "media", title: "Testimone d'accusa", url: `${origin}/it/titles/11264-testimone-daccusa`, subtitle: "1957 · Film", thumbnail: "https://cdn.example/poster.webp" };
const series: ProviderItem = { id: "sc-series", provider: "streamingcommunity", kind: "collection", title: "Johnny Test", url: `${origin}/it/titles/9125-johnny-test`, subtitle: "2005 · Series" };
const season: ProviderItem = { id: "sc-s1", provider: "streamingcommunity", kind: "collection", title: "Season 1", url: `${origin}/it/titles/9125-johnny-test/season-1` };
const episode: ProviderItem = { id: "sc-e1", provider: "streamingcommunity", kind: "media", title: "S01E01 · Johnny X", url: `${origin}/it/watch/9125?e=69717`, duration: 1260 };
const preview = { id: 11264, kind: "movie", year: "1957", quality: "HD", runtime: 116, plot: "An ailing barrister defends a sensational murder trial.", genres: ["Drama", "Crime"] };
const flush = () => act(async () => { await Bun.sleep(10); });
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label);
const click = async (label: string, scope: ParentNode = document) => { await act(async () => button(label, scope)!.click()); await flush(); };

async function render(connected = true, canPlay = true) {
  const { StreamingCommunityExplorer } = await import("./StreamingCommunityExplorer");
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}>
      <StreamingCommunityExplorer credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} canPlay={canPlay} active
        onEnqueue={(item, playNow) => { enqueued.push([item, playNow]); return Promise.resolve(true); }}
        onSavePlaylist={(provider, url) => { saves.push([provider, url]); return Promise.resolve(true); }} />
    </QueryClientProvider>);
  });
  await flush();
}

beforeEach(async () => {
  paths.length = 0; enqueued.length = 0; saves.length = 0; browseError = false;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (browseError) return Response.json({ error: "StreamingCommunity is unreachable" }, { status: 502 });
    if (url.pathname === "/api/providers/streamingcommunity/items") {
      const target = url.searchParams.get("url"), cursor = url.searchParams.get("cursor"), query = url.searchParams.get("q");
      if (target?.endsWith("/season-1")) return Response.json({ title: "Johnny Test - Season 1", items: [episode] });
      if (target?.includes("9125")) return Response.json({ title: "Johnny Test", items: [season] });
      if (target) return Response.json({ title: "Testimone d'accusa", items: [{ ...movie, duration: 6960 }] });
      if (query) return Response.json({ items: [movie] });
      return Response.json({ title: "Catalogue", items: cursor ? [episode] : [movie, series], ...(cursor ? {} : { nextCursor: "2" }) });
    }
    if (url.pathname.endsWith("/titles/11264")) return Response.json(preview);
    return Response.json({ items: [] });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: descriptor.value }); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("the explorer browses the catalogue, loads more, and searches", async () => {
  await render();
  expect(paths.some(path => path.startsWith("/api/providers/streamingcommunity/items"))).toBe(true);
  expect(document.body.textContent).toContain("Catalogue");
  expect(document.body.textContent).toContain("Testimone d'accusa");
  expect(document.body.textContent).toContain("1957 · Film");
  await click("Load more");
  expect(document.body.textContent).toContain("S01E01 · Johnny X");
  expect(paths.some(path => path.includes("cursor=2"))).toBe(true);
  const input = document.querySelector<HTMLInputElement>("#streamingcommunity-search")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "western");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => (document.querySelector("form")!).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  expect(paths.some(path => path.includes("q=western"))).toBe(true);
  expect(!!button("Details for Testimone d'accusa")).toBe(true);
});

test("details show the preview, playback goes through onEnqueue, and saving calls the playlist path", async () => {
  await render();
  await click("Details for Testimone d'accusa");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("An ailing barrister");
  expect(dialog.textContent).toContain("Drama");
  expect(dialog.textContent).toContain("116 min");
  await click("Play now: Testimone d'accusa", dialog);
  expect(enqueued).toEqual([[movie, true]]);
  await click(`Save Testimone d'accusa as playlist`, dialog);
  await flush();
  expect(saves).toEqual([["streamingcommunity", movie.url]]);
  await click("Close", dialog);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for Testimone d'accusa");
});

test("series open into seasons, save whole lists, and back returns to the catalogue", async () => {
  await render();
  await click("Open Johnny Test");
  await flush();
  expect(paths.some(path => path.includes(`url=${encodeURIComponent(series.url)}`))).toBe(true);
  expect(document.body.textContent).toContain("Johnny Test");
  expect(!!button("Open Season 1")).toBe(true);
  await click(`Save Johnny Test as playlist`);
  expect(saves).toEqual([["streamingcommunity", series.url]]);
  await click("Open Season 1");
  expect(document.body.textContent).toContain("S01E01 · Johnny X");
  expect(!!button("Play now: S01E01 · Johnny X")).toBe(true);
  await click("Back");
  expect(!!button("Open Season 1")).toBe(true);
  await click("Back");
  expect(document.body.textContent).toContain("Testimone d'accusa");
});

test("browse errors surface the source message with a retry", async () => {
  browseError = true;
  await render();
  expect(document.body.textContent).toContain("StreamingCommunity is unreachable");
  expect(!!button("Try again")).toBe(true);
});
