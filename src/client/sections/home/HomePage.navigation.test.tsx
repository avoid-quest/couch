import { DetailFocusRestoration } from "@/detail-navigation";
import { setupUiTests, render as renderUI, act, screen, userEvent, waitFor, within, createTestQueryClient, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { createBrowserHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet, type AnyRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { HomePage } from "./HomePage";
import { SettingsHome } from "../settings/device/SettingsHome";
import { SettingsLayout } from "../settings/SettingsLayout";
import type { QueueEntry, SessionState } from "../../../shared/protocol";
import { defaultHomeRows } from "./home-rows";
import { avoidRadioPlaylistId } from "../../../shared/radio";

setupUiTests();

let view: ReturnType<typeof renderUI>, client: QueryClient;
let history: ReturnType<typeof createBrowserHistory>;
let router: AnyRouter;
let request: ReturnType<typeof spyOn> | undefined;
beforeEach(async () => {
  client = createTestQueryClient();
  view = renderUI(<></>);
});
afterEach(async () => {
  request = undefined;
  history?.destroy();
});
async function renderHome(overrides: { current?: QueueEntry; state?: SessionState; active?: boolean; run?: (action: unknown) => Promise<boolean>; playHistory?: ShellValue["playHistory"] } = {}) {
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
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><DetailFocusRestoration /><Outlet /></ShellProviders> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: HomePage });
  const item = createRoute({ getParentRoute: () => base, path: "/item", component: () => <h1>Item details</h1> });
  const player = createRoute({ getParentRoute: () => base, path: "/now", component: () => <h1>Player</h1> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <h1>Find</h1> });
  const settings = createRoute({ getParentRoute: () => base, path: "/settings", component: () => <SettingsLayout section="playback">{null}</SettingsLayout> });
  const homeSettings = createRoute({ getParentRoute: () => base, path: "/settings/home", component: SettingsHome });
  router = createRouter({ routeTree: base.addChildren([home, item, player, find, settings, homeSettings]), history });
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
  expect(within(screen.getByRole("list", { name: "Radio stations" })).getByRole("button", { name: "Details Lyl Radio" })).toHaveTextContent("Live");
  expect(screen.queryByRole("heading", { name: "Find something to play" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Customize Home" })).toBeNull();
  expect(request.mock.calls.some(([input]: [unknown]) => /\/api\/(jellyfin|library\/sources|iptv\/sources)$/.test(String(input)))).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Details Lyl Radio" }));
  expect(await screen.findByRole("heading", { name: "Item details" })).toBeInTheDocument();
  expect(router.state.location.search).toEqual({ kind: "radio", id: "lyl" });
  await act(async () => history.back());
  expect(await screen.findByRole("button", { name: "Details Lyl Radio" })).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Details Alexander Nut" }));
  expect(await screen.findByRole("heading", { name: "Item details" })).toBeInTheDocument();
  expect(router.state.location.search).toEqual({ kind: "radio", id: "nts" });
});

test("hiding failed Home rows restores the empty state and skips their reads on the next visit", async () => {
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "History unavailable" }, { status: 503 }));
  await renderHome();
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
  await act(async () => router.navigate({ href: "/settings/home" }));
  for (const name of ["Continue", "For later", "Radio", "Played recently"]) {
    await userEvent.click(screen.getByRole("switch", { name }));
  }
  await act(async () => router.navigate({ href: "/" }));
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

test("an unavailable player keeps recovery reachable with Now and Up next hidden", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: false }))));
  const current: QueueEntry = { id: "current", source: "youtube", title: "Current", duration: 120 };
  const state = { sessionId: "session", deviceIds: ["desk"], playbacks: [{ id: "session", title: current.title, status: "unavailable", deviceIds: ["desk"] }], queue: [current, { ...current, id: "next", title: "Waiting film" }], currentEntryId: current.id, player: { status: "unavailable", position: 0, duration: 120, volume: 40, playbackId: null }, activeProfile: { id: "household", name: "Household" } } as SessionState;
  await renderHome({ state, current, active: false });
  expect(screen.queryByRole("heading", { name: "Up next" })).toBeNull();
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

test("a hidden Up next row stays hidden when playback stops", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: false }))));
  const queued: QueueEntry = { id: "next", source: "https://media.example/next", title: "Waiting film", duration: 120 };
  const state = { queue: [queued], currentEntryId: null, queueCursorEntryId: null, player: { status: "idle", position: 0, duration: null, volume: 40, playbackId: null }, activeProfile: { id: "household", name: "Household" } } as SessionState;
  await renderHome({ state, active: false });
  expect(screen.queryAllByRole("heading", { name: "Up next" })).toHaveLength(0);
});

test("Settings Home applies row visibility and order and retains them after reload", async () => {
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/radio/avoid") return Response.json({ stations: [{ id: "station", name: "Test Radio", url: "https://radio.example/live" }] });
    if (path === "/api/radio/favorites") return Response.json({ favorites: [] });
    return Response.json({ items: [] });
  }) as typeof fetch);
  const queued: QueueEntry = { id: "next", source: "https://media.example/next", title: "Waiting film", duration: 120 };
  const state = { queue: [queued], currentEntryId: null, queueCursorEntryId: null, player: { status: "idle", position: 0, duration: null, volume: 40, playbackId: null }, activeProfile: { id: "household", name: "Household" } } as SessionState;
  await renderHome({ state });
  expect(await screen.findByRole("heading", { name: "Radio" })).toBeInTheDocument();
  await act(async () => router.navigate({ href: "/settings" }));
  await userEvent.click(within(screen.getByRole("navigation", { name: "Settings pages" })).getByRole("link", { name: "Home" }));
  expect(history.location.pathname).toBe("/settings/home");
  await userEvent.click(screen.getByRole("switch", { name: "Up next" }));
  for (let index = 0; index < 5; index++) await userEvent.click(screen.getByRole("button", { name: "Move Up next up" }));
  expect(within(screen.getByRole("list", { name: "Home rows" })).getAllByRole("switch")[0]).toHaveAccessibleName("Up next");
  await act(async () => router.navigate({ href: "/" }));
  const rows = within(screen.getByRole("region", { name: "Home" })).getAllByRole("region");
  expect(rows[0]).toHaveAccessibleName("Up next");
  expect(rows[1]).toHaveAccessibleName("Radio");
  await act(async () => router.navigate({ href: "/settings/home" }));
  await userEvent.click(screen.getByRole("switch", { name: "Radio" }));
  view.rerender(<></>);
  await renderHome({ state });
  expect(screen.getByRole("heading", { name: "Up next" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Radio" })).toBeNull();
  await act(async () => router.navigate({ href: "/settings/home" }));
  expect(screen.getByRole("switch", { name: "Radio" })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "Up next" })).toBeChecked();
  expect(within(screen.getByRole("list", { name: "Home rows" })).getAllByRole("switch")[0]).toHaveAccessibleName("Up next");
  await userEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  await act(async () => router.navigate({ href: "/" }));
  expect(await screen.findByRole("heading", { name: "Radio" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Up next" })).toBeNull();
});

test("Home live controls stop an unpausable stream instead of sending Pause", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: row.id === "now" }))));
  const current: QueueEntry = { id: "live", title: "Live station", source: "radio:station", kind: "radio" };
  const state = { sessionId: "session", deviceIds: ["desk"], playbacks: [{ id: "session", title: current.title, status: "playing", deviceIds: ["desk"] }], queue: [current], currentEntryId: current.id, player: { status: "playing", playbackId: "live-playback", position: 0, duration: null, volume: 40, seekable: false }, activeProfile: { id: "household", name: "Household" } } as SessionState;
  const commands: unknown[] = [];
  await renderHome({ state, current, active: true, run: async action => { commands.push(action); return true; } });
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(commands).toEqual([{ type: "stop" }]);
});

test("Recent artwork and title open details without replaying", async () => {
  localStorage.setItem("couch.home-rows", JSON.stringify(defaultHomeRows.map(row => ({ ...row, shown: row.id === "recent" }))));
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ items: [{ mediaId: "movie", libraryItemId: null, title: "Remembered episode", thumbnail: "https://example.com/still.jpg", description: "The full remembered episode description.", position: 120, duration: 120, watched: true, playable: true }] }));
  const played: unknown[] = [];
  await renderHome({ playHistory: async (...args) => { played.push(args); return true; } });
  const opener = await screen.findByRole("button", { name: "Details Remembered episode" });
  await userEvent.click(opener);
  expect(await screen.findByRole("heading", { name: "Item details" })).toBeInTheDocument();
  expect(history.location.pathname).toBe("/item");
  expect(router.state.location.search).toEqual({ kind: "history", id: "movie" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(played).toEqual([]);
  await act(async () => history.back());
  expect(await screen.findByRole("button", { name: "Details Remembered episode" })).toHaveFocus();
});
