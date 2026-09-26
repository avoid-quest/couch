import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createBrowserHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { fireEvent, screen } from "../../testing";
import { waitFor } from "@testing-library/dom";
import type { QueueEntry, SessionState } from "../../../shared/protocol";
import { defaultHomeRows } from "./home-rows";

const originals = new Map<string, PropertyDescriptor | undefined>();
let root: Root, window: Window, client: QueryClient;
let history: ReturnType<typeof createBrowserHistory>;
let request: ReturnType<typeof spyOn> | undefined;
beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["scrollTo", "history", "location", "localStorage", "CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
async function renderHome(overrides: { current?: QueueEntry; state?: SessionState; active?: boolean } = {}) {
  const { HomePage } = await import("./HomePage");
  window.happyDOM.setURL("http://localhost/");
  history = createBrowserHistory();
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: { authority: "host" }, state: null,
    connected: true, available: false, active: false, tv: { browsing: true },
    videoQualityPreference: { quality: "auto" }, recentRadio: [], section: "Home",
    ...overrides,
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: HomePage });
  const settings = createRoute({ getParentRoute: () => base, path: "/settings/sources", component: () => <h1>Source settings</h1> });
  const router = createRouter({ routeTree: base.addChildren([home, settings]), history });
  await act(async () => { await router.load(); root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
}

test("Home waits for radio favorites, recovers from their failure, and offers source settings when empty", async () => {
  const favorites = Promise.withResolvers<Response>();
  let retryFavorites = false;
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/progress/history" || path === "/api/for-later") return Response.json({ items: [] });
    if (path === "/api/radio/favorites") return retryFavorites ? Response.json({ favorites: [] }) : favorites.promise;
    if (path === "/api/jellyfin/connection") return Response.json({ configured: false });
    if (path === "/api/library/sources" || path === "/api/iptv/sources") return Response.json({ sources: [] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
  await renderHome();
  await act(async () => { await Bun.sleep(30); });
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  await act(async () => { favorites.resolve(Response.json({ error: "Radio unavailable" }, { status: 503 })); await Bun.sleep(30); });
  expect(screen.getByRole("alert").textContent).toContain("Couldn't load your radio stations.");
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  retryFavorites = true;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); await Bun.sleep(30); });
  expect(screen.getByRole("heading", { name: "Find something to play" })).toBeDefined();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add a source" })));
  expect(history.location.pathname).toBe("/settings/sources");
  expect(screen.getByRole("heading", { name: "Source settings" })).toBeDefined();
});

test("hiding failed Home rows restores the empty state and skips their reads on the next visit", async () => {
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "History unavailable" }, { status: 503 }));
  await renderHome();
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Customize Home" })));
  for (const name of ["Continue", "For later", "Radio", "Played recently"]) {
    await act(async () => fireEvent.click(screen.getByRole("switch", { name })));
  }
  expect(screen.getByRole("heading", { name: "Find something to play" })).toBeDefined();
  expect(screen.queryByText("History unavailable")).toBeNull();
  expect(screen.queryByText("Couldn't load For later.")).toBeNull();
  expect(screen.queryByText("Couldn't load your radio stations.")).toBeNull();
  request.mockClear();
  await act(async () => root.render(null));
  await renderHome();
  expect(screen.getByRole("heading", { name: "Find something to play" })).toBeDefined();
  expect(request.mock.calls.some(([input]: [unknown]) => /\/api\/(progress\/history|for-later|radio\/favorites)$/.test(String(input)))).toBe(false);
});

test("Played recently offers history retry when Continue is hidden", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: row.id === "recent" }))));
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "History unavailable" }, { status: 503 }));
  await renderHome();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't load Played recently."));
  request.mockResolvedValue(Response.json({ items: [] }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Find something to play" })).toBeDefined());
});

test("an unavailable player keeps the waiting queue reachable with Now and Up next hidden", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: false }))));
  const current: QueueEntry = { id: "current", source: "youtube", title: "Current", duration: 120 };
  const state = { queue: [current, { ...current, id: "next", title: "Waiting film" }], currentEntryId: current.id, player: { status: "unavailable", position: 0, duration: 120, volume: 40, playbackId: null }, activeProfile: { id: "household", name: "Household" } } as SessionState;
  await renderHome({ state, current, active: false });
  expect(screen.getByRole("heading", { name: "Up next" })).toBeDefined();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit" })));
  expect(screen.getByRole("dialog", { name: "Up next" })).toBeDefined();
  expect(screen.getByRole("dialog", { name: "Up next" }).textContent).toContain("Waiting film");
});
