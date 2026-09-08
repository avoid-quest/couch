import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const paths: string[] = [], queued: unknown[] = [], browsed: string[] = [];
let release: (() => void) | undefined, jellyfinError = false, delayedQuery = "", unavailable = false, connectedJellyfin = true, empty = false;
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
async function render(active = true, connected = true, canPlay = true, libraryVersion = 1) {
  const { SearchPanel } = await import("./SearchPanel");
  await act(async () => root.render(<SearchPanel origin="http://localhost" token="paired" connected={connected} canPlay={canPlay} active={active} libraryVersion={libraryVersion} jellyfinVersion={1} onBrowse={section => browsed.push(section)} onEnqueue={async (...args) => { queued.push(args); return true; }} />));
  await flush();
}
beforeEach(async () => {
  paths.length = 0; queued.length = 0; browsed.length = 0; release = undefined; jellyfinError = unavailable = empty = false; delayedQuery = ""; connectedJellyfin = true;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (delayedQuery && url.searchParams.get("q") === delayedQuery && url.pathname.endsWith("/items")) await new Promise<void>(resolve => { release = resolve; });
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
  await click("Details for Evening movie");
  let dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("An evening story"); await click("Resume Evening movie", dialog); await click("Add Evening movie to queue", dialog); await click("Close", dialog);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for Evening movie"); expect(scroller.scrollTop).toBe(480);
  await click("Details for Evening song"); dialog = document.querySelector('[role="dialog"]')!;
  await click("Play Evening song", dialog); await click("Add Evening song to queue", dialog); await click("Close", dialog);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for Evening song");
  expect(queued).toEqual([["Library", "local", { playNow: true }], ["Library", "local", undefined], ["Jellyfin", "remote", { playNow: true }], ["Jellyfin", "remote", undefined]]);
  await render(false); scroller.scrollTop = 0; await render();
  expect(scroller.scrollTop).toBe(480); expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Evening");
  await click("Online"); expect(browsed).toEqual(["Online"]); expect(paths.every(path => path.startsWith("/api/library") || path.startsWith("/api/jellyfin"))).toBe(true);
});
test("one unavailable source does not hide local results and retries only that source", async () => {
  jellyfinError = true; await render(); await search("Evening");
  expect(button("Resume Evening movie").disabled).toBe(false); expect(document.body.textContent).toContain("Jellyfin server unavailable");
  const count = paths.filter(path => path.startsWith("/api/library")).length;
  jellyfinError = false; await click("Retry Jellyfin");
  expect(button("Play Evening song").disabled).toBe(false); expect(paths.filter(path => path.startsWith("/api/library")).length).toBe(count);
});
test("missing folders retain searchable items with disabled play and queue", async () => {
  unavailable = true; connectedJellyfin = false; await render(); await search("Evening");
  expect(document.body.textContent).toContain("NAS: folder unavailable"); expect(button("Resume Evening movie").disabled).toBe(true); expect(button("Add Evening movie to queue").disabled).toBe(true);
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
  await render(true, true, false); expect(button("Resume New movie").disabled).toBe(true); expect(button("Add New movie to queue").disabled).toBe(false);
  await render(true, false); expect(button("Add New movie to queue").disabled).toBe(true);
});

test("progress broadcasts retain open details and focused result nodes during refresh", async () => {
  await render(); await search("Evening"); await click("Details for Evening movie");
  const trigger = button("Details for Evening movie");
  await render(true, true, true, 2);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull(); expect(dialog.textContent).toContain("Evening movie");
  await click("Add Evening movie to queue", dialog); await click("Close", dialog);
  expect(document.activeElement).toBe(trigger);
  delayedQuery = "Evening"; connectedJellyfin = false;
  await render(true, true, true, 3);
  expect(button("Details for Evening movie")).toBe(trigger); expect(document.activeElement).toBe(trigger);
  await act(async () => release?.()); await flush();
  expect(button("Details for Evening movie")).toBe(trigger); expect(document.activeElement).toBe(trigger);
});
