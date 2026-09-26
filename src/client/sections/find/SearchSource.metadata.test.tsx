import { setupUiTests, render, act, screen, waitFor } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { ShellProviders } from "../shell/test-providers";
import { ItemPage, readItemSearch } from "../details/ItemPage";
import { SearchSource } from "./SearchSource";
import type { SearchResultSummary } from "./SearchOnlineResults";

setupUiTests();

async function renderSearch(source: "Library" | "Jellyfin") {
  let summary: SearchResultSummary | undefined;
  const shell = { credentials: { origin: "http://localhost", token: "paired" }, connected: true, available: true, identity: { authority: "controller" } };
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <SearchSource source={source} query="Proof" {...shell.credentials} connected canPlay active onEnqueue={async () => true} onResults={(_, result) => { summary = result; }} /> });
  const details = createRoute({ getParentRoute: () => base, path: "/item", validateSearch: readItemSearch, component: ItemPage });
  const router = createRouter({ routeTree: base.addChildren([find, details]), history: createMemoryHistory({ initialEntries: ["/find?q=Proof&source=Folders"] }) });
  await act(async () => { await router.load(); render(<RouterProvider router={router} />); });
  await waitFor(() => expect(summary?.hits).toHaveLength(1));
  return { router, summary: () => summary! };
}

test("Find opens a durable library page and browser Back restores its search URL", async () => {
  const item = { id: "movie-1", title: "Proof movie", kind: "video", available: true, duration: 60, artworkId: null, artist: null, album: null, progress: null, video: { type: "movie", show: null, year: 2024, plot: "Proof", genres: [] } };
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/library/sources") return Response.json({ sources: [] });
    return Response.json(path === "/api/library/items/movie-1" ? { item } : { total: 1, items: [item] });
  }) as typeof fetch);
  const { router, summary } = await renderSearch("Library");
  await act(async () => summary().hits?.[0]?.actions.find(action => action.label === "Details")?.run?.());
  expect(await screen.findByRole("heading", { name: "Proof movie" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/item");
  expect(router.state.location.search).toMatchObject({ kind: "library", id: "movie-1" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => router.history.back());
  await waitFor(() => expect(router.state.location.href).toBe("/find?q=Proof&source=Folders"));
});

test("Jellyfin search details fetch their description and authenticated artwork by id", async () => {
  const artworkId = "e".repeat(64);
  let intersect!: () => void;
  spyOn(globalThis, "IntersectionObserver").mockImplementation(((callback: IntersectionObserverCallback) => {
    intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    return { observe() {}, disconnect() {} };
  }) as never);
  const calls: { path: string; authorization: string | null }[] = [];
  const item = { id: "episode-1", title: "A quiet evening", kind: "Episode", detail: "The series · S2 · E3", description: "Friends return home after a long journey.", artworkId, duration: 3600, resumePosition: 0, played: false };
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, authorization: new Headers(init?.headers).get("Authorization") });
    if (path === "/api/jellyfin") return Response.json({ connected: true });
    if (path.startsWith("/api/library/artwork/")) return new Response(null, { status: 404 });
    return Response.json(path === "/api/jellyfin/items/episode-1" ? { item } : { total: 1, items: [item] });
  }) as typeof fetch);
  const { summary } = await renderSearch("Jellyfin");
  expect(summary().hits?.[0]?.description).toBe(item.description);
  await act(async () => summary().hits?.[0]?.actions.find(action => action.label === "Details")?.run?.());
  expect(await screen.findByText(item.description)).toBeVisible();
  expect(screen.getByText(/The series · S2 · E3/)).toBeVisible();
  await act(async () => intersect());
  await waitFor(() => expect(calls.find(call => call.path === `/api/library/artwork/${artworkId}`)?.authorization).toBe("Bearer paired"));
  expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
});
