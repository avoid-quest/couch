import { setupUiTests, render as renderUI, act, screen, userEvent, createTestQueryClient, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { createBrowserHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { HomePage } from "./HomePage";

setupUiTests();

let view: ReturnType<typeof renderUI>, client: QueryClient;
let history: ReturnType<typeof createBrowserHistory>;
let request: ReturnType<typeof spyOn> | undefined;
beforeEach(async () => {
  client = createTestQueryClient();
  view = renderUI(<></>);
});
afterEach(async () => {
  request = undefined;
  history?.destroy();
});
test("Home waits for radio favorites, recovers from their failure, and offers source settings when empty", async () => {
  testWindow.happyDOM.setURL("http://localhost/");
  history = createBrowserHistory();
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
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: { authority: "host" }, state: null,
    connected: true, available: false, active: false, tv: { browsing: true },
    videoQualityPreference: { quality: "auto" }, recentRadio: [], section: "Home",
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: HomePage });
  const settings = createRoute({ getParentRoute: () => base, path: "/settings/sources", component: () => <h1>Source settings</h1> });
  const router = createRouter({ routeTree: base.addChildren([home, settings]), history });
  await act(async () => { await router.load(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  await act(async () => { });
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  await act(async () => { favorites.resolve(Response.json({ error: "Radio unavailable" }, { status: 503 })); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your radio stations.");
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  retryFavorites = true;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Find something to play" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add a source" }));
  expect(history.location.pathname).toBe("/settings/sources");
  expect(await screen.findByRole("heading", { name: "Source settings" })).toBeInTheDocument();
});
