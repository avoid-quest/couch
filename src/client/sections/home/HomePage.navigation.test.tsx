import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createBrowserHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { HomePage } from "./HomePage";
import { fireEvent, screen } from "../../testing";

const originals = new Map<string, PropertyDescriptor | undefined>();
let root: Root, window: Window, client: QueryClient;
let history: ReturnType<typeof createBrowserHistory>;
let request: ReturnType<typeof spyOn> | undefined;
beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["scrollTo", "history", "location", "localStorage", "CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  client = new QueryClient();
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  request?.mockRestore(); request = undefined;
  history?.destroy(); client.clear(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("Home with nothing to show says what to do and opens source settings for an admin", async () => {
  window.happyDOM.setURL("http://localhost/");
  history = createBrowserHistory();
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/progress/history" || path === "/api/for-later") return Response.json({ items: [] });
    if (path === "/api/radio/favorites") return Response.json({ favorites: [] });
    if (path === "/api/jellyfin/connection") return Response.json({ configured: false });
    if (path === "/api/library/sources" || path === "/api/iptv/sources") return Response.json({ sources: [] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: { authority: "host" }, state: null,
    connected: true, available: false, active: false, tv: { browsing: true },
    videoQualityPreference: { quality: "auto" }, recentRadio: [], section: "Home",
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: HomePage });
  const settings = createRoute({ getParentRoute: () => base, path: "/settings/sources", component: () => <h1>Source settings</h1> });
  const router = createRouter({ routeTree: base.addChildren([home, settings]), history });
  await act(async () => { await router.load(); root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  await act(async () => { await Bun.sleep(30); });
  expect(screen.getByRole("heading", { name: "Find something to play" })).toBeDefined();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add a source" })));
  expect(history.location.pathname).toBe("/settings/sources");
  expect(screen.getByRole("heading", { name: "Source settings" })).toBeDefined();
});
