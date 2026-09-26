import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HistoryItem } from "../../../shared/library";
import { ContinueSection } from "./HomePage";

const credentials = { origin: "http://localhost", token: "paired" };
const unfinished: HistoryItem = { mediaId: "library:movie", libraryItemId: "movie", title: "Halfway home", position: 120, duration: 600, watched: false, lastPlayedAt: 1 };
const online: HistoryItem = { mediaId: "media:album", libraryItemId: null, title: "Album track", position: 45, duration: 240, watched: false, lastPlayedAt: 2, playable: true, thumbnail: "https://example.com/album.jpg", sourceLabel: "Online" };
const unplayable: HistoryItem = { ...unfinished, mediaId: "gone", libraryItemId: null, title: "Missing file" };
const originals = new Map<string, PropertyDescriptor | undefined>();
let root: Root, window: Window, client: QueryClient, request: ReturnType<typeof spyOn>;
let historyItems: HistoryItem[], historyError: boolean;
const played: unknown[] = [], queued: HistoryItem[] = [], requests: string[] = [];

function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function row(title: string) {
  const found = [...document.querySelectorAll<HTMLLIElement>("li")].find(node => node.textContent?.includes(title));
  if (!found) throw new Error(`Missing row: ${title}`);
  return found;
}
async function flush() { await act(async () => { await Bun.sleep(30); }); }
async function renderContinue({ connected = true, canPlay = true, feature = false }: { connected?: boolean; canPlay?: boolean; feature?: boolean } = {}) {
  await act(async () => root.render(<QueryClientProvider client={client}><ContinueSection credentials={credentials} connected={connected} canPlay={canPlay} feature={feature} onAdd={async item => { queued.push(item); return true; }} onPlay={async (...args) => { played.push(args); return true; }} /></QueryClientProvider>));
  if (connected) await flush();
}

beforeEach(async () => {
  historyItems = [unfinished, online, unplayable, { ...unfinished, mediaId: "finished", title: "Finished film", watched: true }, { ...unfinished, mediaId: "started", title: "No progress", position: 0 }];
  historyError = false;
  played.length = 0; queued.length = 0; requests.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "location", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (url.pathname === "/api/progress/history") return historyError ? Response.json({ error: "History unavailable" }, { status: 503 }) : Response.json({ items: historyItems });
    if (url.pathname === "/api/progress/library%3Amovie" && init?.method === "POST") {
      historyItems = historyItems.filter(item => item.mediaId !== "library:movie");
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("Continue shows only unfinished items and preserves resume, restart, and queue identity", async () => {
  await renderContinue();
  expect(document.querySelector('section[aria-label="Continue"]')).toBeDefined();
  expect(row("Halfway home").hasAttribute("data-nav-row")).toBe(true);
  expect(row("Album track").hasAttribute("data-nav-row")).toBe(true);
  expect(row("Halfway home").contains(button("Queue", row("Album track")))).toBe(false);
  expect(document.body.textContent).toContain("Halfway home");
  expect(document.body.textContent).toContain("Album track");
  expect(document.body.textContent).not.toContain("Finished film");
  expect(document.body.textContent).not.toContain("No progress");
  await act(async () => button("Resume Halfway home").click());
  await act(async () => button("From start", row("Halfway home")).click());
  await act(async () => button("Queue", row("Halfway home")).click());
  await act(async () => button("Queue", row("Album track")).click());
  expect(played).toEqual([[unfinished, { fromStart: false }], [unfinished, { fromStart: true }]]);
  expect(queued).toEqual([unfinished, online]);
  expect(document.querySelector<HTMLImageElement>('ul[aria-label="Continue"] img')?.src).toBe("https://example.com/album.jpg");
});

test("Continue queues every playable item even when playback is unavailable", async () => {
  await renderContinue({ canPlay: false });
  expect(button("Resume Album track").disabled).toBe(true);
  expect(button("From start", row("Album track")).disabled).toBe(true);
  expect(button("Queue", row("Album track")).disabled).toBe(false);
  await act(async () => button("Queue", row("Album track")).click());
  expect(queued).toEqual([online]);
  expect(played).toEqual([]);
  expect(button("Resume Missing file").disabled).toBe(true);
});

test("Continue removes an item and refetches the visible history", async () => {
  await renderContinue();
  await act(async () => button("Remove", row("Halfway home")).click());
  await flush();
  expect(requests).toContain("/api/progress/library%3Amovie");
  expect(requests.filter(path => path === "/api/progress/history")).toHaveLength(2);
  expect(document.body.textContent).not.toContain("Halfway home");
});

test("disconnected Continue skips reads and cannot play or queue", async () => {
  await renderContinue({ connected: false });
  expect(requests).toEqual([]);
  await renderContinue();
  await renderContinue({ connected: false });
  expect(button("Resume Halfway home").disabled).toBe(true);
  expect(button("Queue", row("Halfway home")).disabled).toBe(true);
});

test("history failure offers retry", async () => {
  historyError = true;
  await renderContinue();
  expect(document.body.textContent).toContain("History unavailable");
  historyError = false;
  await act(async () => button("Try again").click());
  await flush();
  expect(document.body.textContent).toContain("Halfway home");
});

test("with nothing playing, the latest unfinished item leads the row", async () => {
  await renderContinue({ feature: true });
  expect(document.querySelector("h3")?.textContent).toBe("Halfway home");
  expect(document.querySelector('ul[aria-label="Continue"]')?.textContent).not.toContain("Halfway home");
  await act(async () => button("Resume Halfway home").click());
  expect(played).toEqual([[unfinished, { fromStart: false }]]);
});
