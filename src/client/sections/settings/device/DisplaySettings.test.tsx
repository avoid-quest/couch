import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import { screen } from "../../../testing";
import type { DisplayState } from "../../../../shared/display";

let root: Root, window: Window, queryClient: QueryClient;
const originals = new Map<string, PropertyDescriptor | undefined>();
let resolvePreview: ((state: DisplayState) => void) | undefined;
let previewFails = false;
const state: DisplayState = { outputs: [{ id: "tv", name: "Living room TV", connected: true, width: 1920, height: 1080, x: 0, y: 0, refresh: 60 }], saved: "tv", current: "tv", notice: null, preview: null };
const poll: DisplayState = { ...state, notice: "Display inventory refreshed." };
const preview: DisplayState = { ...state, preview: { token: "preview", expiresAt: Date.now() + 20_000 } };

const flush = () => act(async () => { await Bun.sleep(20); });

beforeEach(async () => {
  resolvePreview = undefined;
  previewFails = false;
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/display" && !init?.method) {
      return Response.json(state);
    }
    if (path === "/api/display/preview") return previewFails ? Response.json({ error: "Display unavailable" }, { status: 503 }) : await new Promise<Response>(resolve => { resolvePreview = next => resolve(Response.json(next)); });
    return Response.json({ error: "Unexpected request" }, { status: 500 });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider, useQueryClient } = await import("@tanstack/react-query");
  const { DisplaySettings } = await import("./DisplaySettings");
  function Harness() { queryClient = useQueryClient(); return <DisplaySettings credentials={{ origin: "http://localhost", token: "admin" }} connected />; }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness /></QueryClientProvider>));
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  (globalThis.fetch as ReturnType<typeof spyOn>).mockRestore();
  window.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("a completed display poll cannot enable a second preview while the first is pending", async () => {
  await act(async () => { screen.getByRole("button", { name: "Preview on Living room TV" }).click(); });
  await flush();
  expect(screen.getByRole("button", { name: "Preview on Living room TV" }).disabled).toBe(true);
  await act(async () => { queryClient.setQueryData(["display", "http://localhost", "admin"], poll); });
  expect(screen.getByRole("button", { name: "Preview on Living room TV" }).disabled).toBe(true);
  await act(async () => { resolvePreview!(preview); });
  await flush();
  expect(screen.getByRole("button", { name: "Keep this screen" })).toBeDefined();
});

test("a display poll does not dismiss a mutation error", async () => {
  previewFails = true;
  await act(async () => { screen.getByRole("button", { name: "Preview on Living room TV" }).click(); });
  await flush();
  expect(screen.getByRole("alert").textContent).toContain("Display unavailable");
  await act(async () => { queryClient.setQueryData(["display", "http://localhost", "admin"], poll); });
  expect(screen.getByRole("alert").textContent).toContain("Display unavailable");
  previewFails = false;
  await act(async () => { screen.getByRole("button", { name: "Preview on Living room TV" }).click(); });
  await flush();
  expect(screen.queryByRole("alert")).toBeNull();
});
