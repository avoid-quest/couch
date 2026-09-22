import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { fireEvent, screen } from "@/testing";

const globals = new Map<string, PropertyDescriptor | undefined>();
let window: Window, root: Root, request: ReturnType<typeof spyOn>;

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/library/sources") return Response.json({ sources: [] });
    return Response.json({ total: 1, items: [{ id: "movie-1", title: "Proof movie", kind: "video", available: true, duration: 60, artworkId: null, artist: null, album: null, progress: null, video: { type: "movie", show: null, year: 2024, plot: "Proof", genres: [] } }] });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  globals.clear();
});

test("current Find details offer metadata actions only to an authorized local-video user", async () => {
  const { SearchSource } = await import("./SearchSource");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const draw = (canManageMetadata: boolean) => act(async () => root.render(<QueryClientProvider client={client}><SearchSource source="Library" query="Proof" attempt={0} origin="http://localhost" token="paired" connected canPlay active canManageMetadata={canManageMetadata} onBrowse={() => {}} onEnqueue={async () => true} onResults={() => {}} onChooseSource={() => {}} /></QueryClientProvider>));
  await draw(false);
  await act(async () => { await Bun.sleep(10); });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Details for Proof movie" })));
  expect(screen.queryByRole("button", { name: "Edit metadata" })).toBeNull();
  await draw(true);
  expect(screen.getByRole("button", { name: "Edit metadata" })).toBeDefined();
});
