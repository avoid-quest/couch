import { setupUiTests, render as renderUI, act, screen, userEvent, waitFor, within, createTestQueryClient, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { createBrowserHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { HomePage } from "./HomePage";
import type { QueueEntry, SessionState } from "../../../shared/protocol";
import { defaultHomeRows } from "./home-rows";
import { avoidRadioPlaylistId } from "../../../shared/radio";

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
async function renderHome(overrides: { current?: QueueEntry; state?: SessionState; active?: boolean } = {}) {
  testWindow.happyDOM.setURL("http://localhost/");
  history?.destroy();
  history = createBrowserHistory();
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: { authority: "host" }, state: null,
    connected: true, available: false, active: false, tv: { browsing: true },
    videoQualityPreference: { quality: "auto" }, recentRadio: [], section: "Home",
    changeSection: (section: string) => { if (section === "Now" || section === "Find") void router.navigate({ to: section === "Now" ? "/now" : "/find" }); },
    ...overrides,
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: HomePage });
  const player = createRoute({ getParentRoute: () => base, path: "/now", component: () => <h1>Player</h1> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <h1>Find</h1> });
  const router = createRouter({ routeTree: base.addChildren([home, player, find]), history });
  await act(async () => { await router.load(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
}

test("Home waits for radio favorites, recovers from their failure, and offers Find when empty", async () => {
  const favorites = Promise.withResolvers<Response>();
  let retryFavorites = false;
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/progress/history" || path === "/api/for-later") return Response.json({ items: [] });
    if (path === "/api/radio/favorites") return retryFavorites ? Response.json({ favorites: [] }) : favorites.promise;
    if (path === "/api/radio/avoid") return Response.json({ stations: [] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
  await renderHome();
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  await act(async () => { favorites.resolve(Response.json({ error: "Radio unavailable" }, { status: 503 })); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your radio stations.");
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  retryFavorites = true;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Find something to play" })).toBeInTheDocument();
  expect(screen.queryByText(/Search .*or paste a link/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Add folders, Jellyfin or Live TV" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Find" }));
  expect(history.location.pathname).toBe("/find");
  expect(await screen.findByRole("heading", { name: "Find" })).toBeInTheDocument();
});

test("a fresh Home fills Radio with built-in stations and leads with the one on air", async () => {
  const station = (id: string, name: string) => ({ id, name, url: `https://radio.example/${id}`, sourceId: avoidRadioPlaylistId, groupTitle: "avoid radio" });
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/radio/avoid") return Response.json({ stations: [station("nts", "NTS Radio"), station("lyl", "Lyl Radio")] });
    if (path === "/api/radio/avoid/programmes") return Response.json({ programmes: { nts: { stationId: "nts", provider: "radio.avoid.quest", title: "Alexander Nut", sampledAt: Date.now(), expiresAt: Date.now() + 60_000 } } });
    if (path === "/api/radio/favorites") return Response.json({ favorites: [] });
    return Response.json({ items: [] });
  }) as typeof fetch);
  await renderHome();
  expect(await screen.findByRole("heading", { name: "Alexander Nut" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Play NTS Radio" })).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Radio stations" })).getByRole("button", { name: "Play Lyl Radio" })).toHaveTextContent("Live");
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  const home = screen.getByRole("region", { name: "Home" });
  expect(within(home.querySelector("header")!).getByRole("button", { name: "Customize Home" })).toBeInTheDocument();
  expect(home.querySelector("footer")).toBeNull();
  expect(request.mock.calls.some(([input]: [unknown]) => /\/api\/(jellyfin|library\/sources|iptv\/sources)$/.test(String(input)))).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Customize Home" }));
  expect(screen.getByRole("dialog", { name: "Customize Home" })).toBeInTheDocument();
});

test("hiding failed Home rows restores the empty state and skips their reads on the next visit", async () => {
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "History unavailable" }, { status: 503 }));
  await renderHome();
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
  await userEvent.click(screen.getByRole("button", { name: "Customize Home" }));
  for (const name of ["Continue", "For later", "Radio", "Played recently"]) {
    await userEvent.click(screen.getByRole("switch", { name }));
  }
  expect(screen.getByRole("heading", { name: "Find something to play" })).toBeInTheDocument();
  expect(screen.queryByText("History unavailable")).toBeNull();
  expect(screen.queryByText("Couldn't load For later.")).toBeNull();
  expect(screen.queryByText("Couldn't load your radio stations.")).toBeNull();
  request.mockClear();
  view.rerender(<></>);
  await renderHome();
  expect(screen.getByRole("heading", { name: "Find something to play" })).toBeInTheDocument();
  expect(request.mock.calls.some(([input]: [unknown]) => /\/api\/(progress\/history|for-later|radio\/favorites)$/.test(String(input)))).toBe(false);
});

test("Played recently offers history retry when Continue is hidden", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: row.id === "recent" }))));
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "History unavailable" }, { status: 503 }));
  await renderHome();
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load Played recently.");
  request.mockResolvedValue(Response.json({ items: [] }));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Find something to play" })).toBeInTheDocument();
});

test("an unavailable player keeps playback and the queue reachable with Now and Up next hidden", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: false }))));
  const current: QueueEntry = { id: "current", source: "youtube", title: "Current", duration: 120 };
  const state = { queue: [current, { ...current, id: "next", title: "Waiting film" }], currentEntryId: current.id, player: { status: "unavailable", position: 0, duration: 120, volume: 40, playbackId: null }, activeProfile: { id: "household", name: "Household" } } as SessionState;
  await renderHome({ state, current, active: false });
  expect(screen.getByRole("heading", { name: "Up next" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("dialog", { name: "Up next" })).toHaveTextContent("Waiting film");
  for (const { status, queue } of [
    { status: "unavailable" as const, queue: [current] },
    { status: "idle" as const, queue: [{ ...current, id: "previous" }, current] },
  ]) {
    view.rerender(<></>);
    await renderHome({ state: { ...state, queue, player: { ...state.player, status } }, current, active: false });
    expect(screen.queryByRole("heading", { name: "Up next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Find something to play" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open player" }));
    expect(history.location.pathname).toBe("/now");
    expect(screen.getByRole("heading", { name: "Player" })).toBeInTheDocument();
  }
});
