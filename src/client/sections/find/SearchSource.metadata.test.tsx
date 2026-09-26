import { setupUiTests, render as renderUI, act, screen, waitFor, createTestQueryClient } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";

setupUiTests();

let view: ReturnType<typeof renderUI>;

beforeEach(async () => {
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/library/sources") return Response.json({ sources: [] });
    return Response.json({ total: 1, items: [{ id: "movie-1", title: "Proof movie", kind: "video", available: true, duration: 60, artworkId: null, artist: null, album: null, progress: null, video: { type: "movie", show: null, year: 2024, plot: "Proof", genres: [] } }] });
  }) as typeof fetch);
  view = renderUI(<></>);
});

test("current Find details offer metadata actions only to an authorized local-video user", async () => {
  const { SearchSource } = await import("./SearchSource");
  let summary: import("./SearchOnlineResults").SearchResultSummary | undefined;
  const client = createTestQueryClient();
  const draw = (canManageMetadata: boolean) => act(async () => view.rerender(<QueryClientProvider client={client}><SearchSource source="Library" query="Proof" origin="http://localhost" token="paired" connected canPlay active canManageMetadata={canManageMetadata} onEnqueue={async () => true} onResults={(_, result) => { summary = result; }} /></QueryClientProvider>));
  await draw(false);
  await waitFor(() => expect(summary?.hits?.map(hit => hit.title)).toEqual(["Proof movie"]));
  await act(async () => summary?.hits?.[0]?.actions.find(action => action.label === "Details")?.run?.());
  expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  await draw(true);
  expect(await screen.findByRole("button", { name: "Edit details" })).toBeEnabled();
});

test("Jellyfin Find previews carry descriptions and authenticated artwork into details", async () => {
  const { SearchSource } = await import("./SearchSource");
  const artworkId = "e".repeat(64);
  let intersect!: () => void;
  spyOn(globalThis, "IntersectionObserver").mockImplementation(((callback: IntersectionObserverCallback) => {
    intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    return { observe() {}, disconnect() {} };
  }) as never);
  const calls: { path: string; authorization: string | null }[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, authorization: new Headers(init?.headers).get("Authorization") });
    if (path === "/api/jellyfin") return Response.json({ connected: true, serverName: "Home", username: "viewer" });
    if (path.startsWith("/api/library/artwork/")) return new Response(null, { status: 404 });
    return Response.json({ total: 1, items: [{ id: "episode-1", title: "A quiet evening", kind: "Episode", detail: "The series · S2 · E3", description: "Friends return home after a long journey.", artworkId, duration: 3600, resumePosition: 0, played: false }] });
  }) as typeof fetch);
  let summary: import("./SearchOnlineResults").SearchResultSummary | undefined;
  await act(async () => view.rerender(<QueryClientProvider client={createTestQueryClient()}><SearchSource source="Jellyfin" query="evening" origin="http://localhost" token="paired" connected canPlay active onEnqueue={async () => true} onResults={(_, result) => { summary = result; }} /></QueryClientProvider>));
  await waitFor(() => expect(summary?.hits?.[0]?.title).toBe("A quiet evening"));
  expect(summary?.hits?.[0]?.description).toBe("Friends return home after a long journey.");
  expect(summary?.hits?.[0]?.artworkId).toBe(artworkId);
  await act(async () => summary?.hits?.[0]?.actions.find(action => action.label === "Details")?.run?.());
  expect(await screen.findByText("Friends return home after a long journey.")).toBeVisible();
  expect(screen.getByText(/The series · S2 · E3/)).toBeVisible();
  await act(async () => intersect());
  await waitFor(() => expect(calls.find(call => call.path === `/api/library/artwork/${artworkId}`)?.authorization).toBe("Bearer paired"));
  expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
});
