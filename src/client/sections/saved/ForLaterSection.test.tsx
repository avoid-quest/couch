import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { QueryClient } from "@tanstack/react-query";

let root: Root, window: Window, client: QueryClient, fetchSpy: ReturnType<typeof spyOn>, forLaterOrder: typeof import("./ForLaterSection").forLaterOrder;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; method: string; body: unknown }> = [];
let missing = false, canceled = false;
let items = [{ id: "saved", title: "Evening movie" }, { id: "second", title: "Evening song" }];
const flush = () => act(async () => { await Bun.sleep(15); });
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };
async function render(connected = true, canPlay = true, inspect = false) {
  const { ForLaterSection, forLaterOrder: order } = await import("./ForLaterSection");
  forLaterOrder = order;
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><ForLaterSection origin="http://localhost" token="paired" connected={connected} canPlay={canPlay} inspect={inspect} /></QueryClientProvider>));
  await flush();
}
beforeEach(async () => {
  calls.length = 0; missing = canceled = false; items = [{ id: "saved", title: "Evening movie" }, { id: "second", title: "Evening song" }];
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (method === "GET") return Response.json({ items });
    if (path.endsWith("/load") && missing) return Response.json({ error: "Source unavailable. Retry or remove it from For later." }, { status: 409 });
    if (path.endsWith("/load") && canceled) return Response.json({ ok: true, notice: "Added to Up next. Playback was canceled by a newer control." });
    if (method === "DELETE") items = items.filter(item => path !== `/api/for-later/${item.id}`);
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

test("saved shared items display without queue writes; explicit actions retain the saved entry", async () => {
  await render();
  expect(calls).toEqual([{ path: "/api/for-later", method: "GET", body: undefined }]);
  await click("Add Evening movie to Up next"); await click("Play Evening movie");
  expect(calls.slice(1).map(call => call.body)).toEqual([{ mode: "append" }, { mode: "play" }]);
  expect(document.querySelectorAll("li")).toHaveLength(2);
});

test("failed source keeps its saved item removable and removal returns focus to the next item", async () => {
  await render(); missing = true; await click("Play Evening movie");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Source unavailable");
  expect(document.querySelectorAll("li")).toHaveLength(2);
  await click("Remove Evening movie from For later");
  expect(document.querySelectorAll("li")).toHaveLength(1);
  expect(document.activeElement).toBe(button("Play Evening song"));
  await click("Remove Evening song from For later");
  expect(document.activeElement?.id).toBe("for-later-title");
  expect(document.body.textContent).toContain("No saved titles");
});

test("unavailable native playback still allows append and remove; disconnected controllers cannot mutate", async () => {
  await render(true, false);
  expect(button("Play Evening movie").disabled).toBe(true);
  expect(button("Add Evening movie to Up next").disabled).toBe(false);
  expect(button("Remove Evening movie from For later").disabled).toBe(false);
  const count = calls.length; await render(false);
  expect(document.body.textContent).toContain("Reconnect to see your saved items");
  expect(document.querySelectorAll("li")).toHaveLength(0); expect(calls).toHaveLength(count);
});

test("another controller's socket revision refreshes shared saved items", async () => {
  await render(); items = [{ id: "new", title: "New shared item" }];
  await act(async () => { await client.invalidateQueries({ queryKey: ["for-later"] }); }); await flush();
  expect(document.body.textContent).toContain("New shared item");
  expect(document.body.textContent).not.toContain("Evening movie");
});

test("saving a library result posts only its catalog identity and never a queue operation", async () => {
  const { SaveForLater } = await import("@/components/SaveForLater");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  await act(async () => root.render(<QueryClientProvider client={client}><SaveForLater origin="http://localhost" token="paired" connected reference={{ kind: "library", id: "movie" }} title="Evening movie" /></QueryClientProvider>));
  await click("Save Evening movie for later");
  expect(calls).toEqual([{ path: "/api/for-later", method: "POST", body: { reference: { kind: "library", id: "movie" } } }]);
  expect(document.body.textContent).toContain("Saved for everyone on this TV");
});

test("a successful append whose Play was canceled reports that outcome instead of a source error or retry", async () => {
  await render(); canceled = true;
  await click("Play Evening movie");
  expect(document.body.textContent).toContain("Added to Up next. Playback was canceled by a newer control.");
  expect(document.body.textContent).not.toContain("Starting Evening movie");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
  expect(document.querySelectorAll("li")).toHaveLength(2);
});

test("reorder handles are always available and a drop computes the persisted order", async () => {
  await render();
  expect([...document.querySelectorAll('button[aria-label^="Reorder"]')].map(node => node.getAttribute("aria-label"))).toEqual(["Reorder Evening movie", "Reorder Evening song"]);
  expect(forLaterOrder(items, "second", "saved")).toEqual(["second", "saved"]);
  expect(forLaterOrder(items, "saved", "saved")).toBeNull();
  expect(forLaterOrder(items, "elsewhere", "saved")).toBeNull();
});

test("Saved opens details without playing and also exposes direct playback actions", async () => {
  await render(true, true, true);
  expect(button("Play Evening movie")).toBeDefined();
  await click("Details for Evening movie");
  expect(calls.every(call => call.method === "GET")).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Saved for later");
  await click("Play Evening movie");
  expect(calls.at(-1)?.body).toEqual({ mode: "play" });
  await click("Close");
  expect(document.activeElement).toBe(button("Details for Evening movie"));
});
