import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { QueryClient } from "@tanstack/react-query";

let root: Root, window: Window, client: QueryClient, fetchSpy: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; method: string }> = [];
let items = [
  { mediaId: "library:movie", title: "Evening movie", libraryItemId: "movie", position: 120, duration: 200, watched: false, lastPlayedAt: 100 },
  { mediaId: "media:" + "a".repeat(64), title: "Web video", libraryItemId: null, position: 0, duration: null, watched: true, lastPlayedAt: 90 },
];
const flush = () => act(async () => { await Bun.sleep(15); });
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const press = async (node: HTMLElement) => {
  await act(async () => node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })));
  await act(async () => node.click());
  await flush();
};
async function render() {
  const { HistoryPanel } = await import("./HistoryPanel");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><HistoryPanel origin="http://localhost" token="paired" connected canPlay onPlay={async () => true} /></QueryClientProvider>));
  await flush();
}
beforeEach(async () => {
  calls.length = 0;
  items = [
    { mediaId: "library:movie", title: "Evening movie", libraryItemId: "movie", position: 120, duration: 200, watched: false, lastPlayedAt: 100 },
    { mediaId: "media:" + "a".repeat(64), title: "Web video", libraryItemId: null, position: 0, duration: null, watched: true, lastPlayedAt: 90 },
  ];
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    calls.push({ path, method });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (path === "/api/progress/history" && method === "GET") return Response.json({ items });
    if (method === "DELETE") {
      items = items.filter(item => path !== `/api/progress/${encodeURIComponent(item.mediaId)}`);
      return Response.json({ ok: true });
    }
    return Response.json({ ok: true });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); fetchSpy.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("a history row removes its entry and refreshes the shared list", async () => {
  await render();
  expect(calls).toEqual([{ path: "/api/progress/history", method: "GET" }]);
  expect(document.body.textContent).toContain("Evening movie");
  await press(button("Watching options for Evening movie"));
  await press(button("Remove from history"));
  expect(calls[1]).toEqual({ path: `/api/progress/${encodeURIComponent("library:movie")}`, method: "DELETE" });
  expect(calls.at(-1)).toEqual({ path: "/api/progress/history", method: "GET" });
  expect(document.body.textContent).not.toContain("Evening movie");
  expect(document.body.textContent).toContain("Web video");
});

test("a failed removal keeps the row and reports the server error", async () => {
  await render();
  fetchSpy.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    calls.push({ path, method });
    if (method === "DELETE") return Response.json({ error: "History item not found." }, { status: 404 });
    return Response.json({ items });
  }) as typeof fetch);
  await press(button("Watching options for Evening movie"));
  await press(button("Remove from history"));
  expect(calls.some(call => call.method === "DELETE")).toBe(true);
  expect(document.body.textContent).toContain("History item not found.");
  expect(document.body.textContent).toContain("Evening movie");
});

test("Remove from Continue clears resume without deleting history", async () => {
  const { ProgressActions } = await import("./HistoryPanel");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = new QueryClient();
  await act(async () => root.render(<QueryClientProvider client={client}><ProgressActions origin="http://localhost" token="paired" connected mediaId="library:movie" title="Evening movie" progress={items[0]} inContinue onUpdated={() => {}} /></QueryClientProvider>));
  await press(button("Watching options for Evening movie"));
  await press(button("Remove from Continue"));
  const request = fetchSpy.mock.calls.find((call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "POST");
  expect(request?.[0]).toBe("http://localhost/api/progress/library%3Amovie");
  expect(JSON.parse(String((request?.[1] as RequestInit | undefined)?.body))).toEqual({ clearResume: true });
  expect(calls.some(call => call.method === "DELETE")).toBe(false);
});
