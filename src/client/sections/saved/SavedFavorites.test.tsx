import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import type { QueryClient } from "@tanstack/react-query";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";

let root: Root, window: Window, client: QueryClient, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; method: string }> = [];
const played: Array<{ kind: string; id: string; playNow: boolean }> = [];
const opened: string[] = [];
const video: ProviderItem = { id: "video", provider: "youtube", kind: "media", title: "Evening video", url: "https://youtube.com/watch?v=evening" };
const album: ProviderItem = { id: "album", provider: "bandcamp", kind: "collection", title: "Evening album", url: "https://artist.bandcamp.com/album/evening" };
const station: RadioStation = { id: "station", name: "Evening radio", url: "https://radio.example/stream", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
let online: ProviderItem[] = [], radios: RadioStation[] = [], failOnline = false;
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const flush = () => act(async () => { await Bun.sleep(20); });
const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };
async function render(connected = true, canPlay = true) {
  const { SavedFavorites } = await import("./SavedFavorites");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: React.ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  await act(async () => root.render(wrap(<SavedFavorites origin="http://localhost" token="paired" connected={connected} canPlay={canPlay}
    onEnqueueProvider={async (item, playNow) => { played.push({ kind: "provider", id: item.id, playNow }); return true; }}
    onEnqueueRadio={async (item, playNow) => { played.push({ kind: "radio", id: item.id, playNow }); return true; }}
    onOpenProvider={item => opened.push(item.id)} />)));
  await flush();
}
beforeEach(async () => {
  calls.length = 0; played.length = 0; opened.length = 0; failOnline = false;
  online = [video, album]; radios = [station];
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "HTMLSelectElement", "KeyboardEvent", "PointerEvent", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    calls.push({ path, method });
    if (path === "/api/for-later") return Response.json({ items: [{ id: "local", title: "Saved local movie" }] });
    if (path === "/api/progress/history") return Response.json({ items: [], profile: { id: "household", name: "Household" } });
    if (method === "DELETE") {
      online = online.filter(item => path !== `/api/providers/favorites/${item.id}`);
      radios = radios.filter(item => path !== `/api/radio/favorites/${item.id}`);
      return Response.json({ ok: true });
    }
    if (path === "/api/providers/favorites" && failOnline) return Response.json({ error: "Online saves unavailable" }, { status: 503 });
    return Response.json({ favorites: path === "/api/providers/favorites" ? online : radios });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("one saved list shows existing online and radio favorites without catalog or queue writes", async () => {
  await render();
  expect(document.querySelectorAll("li")).toHaveLength(3);
  expect(document.body.textContent).toContain("YouTube");
  expect(document.body.textContent).toContain("Bandcamp");
  expect(document.body.textContent).toContain("Radio");
  expect(calls).toEqual([{ path: "/api/providers/favorites", method: "GET" }, { path: "/api/radio/favorites", method: "GET" }]);
  await click("Open Evening album");
  expect(opened).toEqual(["album"]); expect(played).toEqual([]);
  await click("Play Evening video"); await click("Add Evening radio to Up next");
  expect(played).toEqual([{ kind: "provider", id: "video", playNow: true }, { kind: "radio", id: "station", playNow: false }]);
  expect(document.querySelectorAll("li")).toHaveLength(3);
});

test("removal uses original stores and preserves the queue and another controller's changes", async () => {
  await render();
  await click("Remove Evening video from Saved");
  expect(calls.some(call => call.path === "/api/providers/favorites/video" && call.method === "DELETE")).toBe(true);
  expect(document.body.textContent).not.toContain("YouTube");
  await click("Remove Evening radio from Saved");
  expect(calls.some(call => call.path === "/api/radio/favorites/station" && call.method === "DELETE")).toBe(true);
  expect(document.querySelectorAll("li")).toHaveLength(1);
  expect(played).toEqual([]);
  online.push({ ...video, id: "new", title: "New shared video" });
  await act(async () => { await client.invalidateQueries(); }); await flush();
  expect(document.querySelectorAll("li")).toHaveLength(2);
  expect(document.body.textContent).toContain("New shared video");
});

test("one unavailable save source does not hide the other source and retry recovers", async () => {
  failOnline = true; await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Online saves unavailable");
  expect(button("Play Evening radio")).toBeDefined();
  expect(button("Play Evening video")).toBeUndefined();
  await click("Play Evening radio");
  expect(played).toEqual([{ kind: "radio", id: "station", playNow: true }]);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Online saves unavailable");
  expect(button("Retry saved items").disabled).toBe(false);
  failOnline = false; await click("Retry saved items");
  expect(document.querySelectorAll("li")).toHaveLength(3);
});

test("without native playback saved media remains queueable, while disconnect clears actionable data", async () => {
  await render(true, false);
  expect(button("Play Evening video").disabled).toBe(true);
  expect(button("Add Evening video to Up next").disabled).toBe(false);
  expect(button("Remove Evening video from Saved").disabled).toBe(false);
  const count = calls.length; await render(false);
  expect(document.querySelectorAll("li")).toHaveLength(0);
  expect(calls).toHaveLength(count);
  expect(document.body.textContent).toContain("Reconnect");
});

test("Saved keeps saved collections together without a separate history destination", async () => {
  const { SavedSection } = await import("./SavedSection");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const browsed: string[] = [];
  await act(async () => root.render(<QueryClientProvider client={client}><SavedSection state={null} credentials={{ origin: "http://localhost", token: "paired" }} connected canPlay active
    onBrowse={section => browsed.push(section)} onEnqueueProvider={async () => true} onEnqueueRadio={async () => true} onOpenProvider={() => {}} /></QueryClientProvider>));
  await flush();
  for (const itemTitle of ["Saved local movie", "Evening video", "Evening album", "Evening radio"]) expect(document.body.textContent).toContain(itemTitle);
  expect([...document.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(["Items", "Playlists"]);
  expect(calls.every(call => call.method === "GET")).toBe(true);
  expect(calls.some(call => call.path === "/api/progress/history")).toBe(false);
  expect([...document.querySelectorAll("button")].some(node => node.textContent === "History")).toBe(false);
});

test("opening a saved collection browses its provider and URL, with Back returning to that provider", async () => {
  const { SavedFavorites } = await import("./SavedFavorites");
  const { ProviderPanel } = await import("../../ProviderPanel");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const wrapClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: React.ReactNode) => <QueryClientProvider client={wrapClient}>{node}</QueryClientProvider>;
  const browsed: URL[] = [];
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/items")) {
      browsed.push(url);
      return Response.json({ provider: "bandcamp", title: "Evening album", items: [] });
    }
    return Response.json({ favorites: url.pathname === "/api/providers/favorites" ? [album] : [], items: [] });
  }) as typeof fetch);
  function SavedCollection() {
    const [selected, setSelected] = useState<ProviderItem | null>(null);
    const connection = { origin: "http://localhost", token: "paired", connected: true, canPlay: true };
    return selected
      ? wrap(<ProviderPanel onPlayHistory={async () => true} {...connection} initialItem={selected} version={1} defaultQuality="auto" onEnqueue={async () => true} onEnqueuePlaylist={async () => true} onEnqueueAlbum={async () => true} />)
      : wrap(<SavedFavorites {...connection} onEnqueueProvider={async () => true} onEnqueueRadio={async () => true} onOpenProvider={setSelected} />);
  }
  await act(async () => root.render(<SavedCollection />));
  await flush(); await click("Open Evening album");
  expect(browsed.at(-1)?.pathname).toBe("/api/providers/bandcamp/items");
  expect(browsed.at(-1)?.searchParams.get("url")).toBe(album.url);
  expect(document.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe("Bandcamp");
  await act(async () => document.querySelector<HTMLButtonElement>("[data-back]")!.click());
  await flush();
  expect(browsed.at(-1)?.pathname).toBe("/api/providers/bandcamp/items");
  expect(document.body.textContent).toContain("Recently played");
});
