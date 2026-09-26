import { DetailFocusRestoration } from "@/detail-navigation";
import { setupUiTests, render as renderUI, act, screen, waitFor, userEvent, createTestQueryClient } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HistoryItem } from "../../../shared/library";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet } from "@tanstack/react-router";
import { ContinueSection } from "./HomePage";

setupUiTests();

const credentials = { origin: "http://localhost", token: "paired" };
const unfinished: HistoryItem = { mediaId: "library:movie", libraryItemId: "movie", title: "Halfway home", position: 120, duration: 600, watched: false, lastPlayedAt: 1 };
const online: HistoryItem = { mediaId: "media:album", libraryItemId: null, title: "Album track", position: 45, duration: 240, watched: false, lastPlayedAt: 2, playable: true, thumbnail: "https://example.com/album.jpg", sourceLabel: "Online" };
const unplayable: HistoryItem = { ...unfinished, mediaId: "gone", libraryItemId: null, title: "Missing file" };
let view: ReturnType<typeof renderUI>, client: QueryClient, request: ReturnType<typeof spyOn>;
let historyItems: HistoryItem[], historyError: boolean;
const played: unknown[] = [], queued: HistoryItem[] = [], requests: string[] = [];

const button = (name: string) => screen.getByRole("button", { name });
async function renderContinue({ connected = true, canPlay = true, feature = false, currentEntryId }: { connected?: boolean; canPlay?: boolean; feature?: boolean; currentEntryId?: string } = {}) {
  const content = <ContinueSection credentials={credentials} connected={connected} canPlay={canPlay} feature={feature} currentEntryId={currentEntryId} onAdd={async item => { queued.push(item); return true; }} onPlay={async (...args) => { played.push(args); return true; }} />;
  const root = createRootRoute({ component: () => <><DetailFocusRestoration /><Outlet /></> });
  const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/"] }), routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/", component: () => content }),
    createRoute({ getParentRoute: () => root, path: "/item", component: () => <h1>Item details</h1> }),
  ]) });
  await act(async () => { await router.load(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  if (connected) await screen.findByRole(historyError ? "alert" : "region", historyError ? {} : { name: "Continue" });
  return router;
}

beforeEach(async () => {
  historyItems = [unfinished, online, unplayable, { ...unfinished, mediaId: "finished", title: "Finished film", watched: true }, { ...unfinished, mediaId: "started", title: "No progress", position: 0 }];
  historyError = false;
  played.length = 0; queued.length = 0; requests.length = 0;
  client = createTestQueryClient();
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (url.pathname === "/api/progress/history") return historyError ? Response.json({ error: "History unavailable" }, { status: 503 }) : Response.json({ items: historyItems });
    if (url.pathname === "/api/progress/library%3Amovie" && init?.method === "POST") {
      historyItems = historyItems.filter(item => item.mediaId !== "library:movie");
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch);
  view = renderUI(<></>);
});

test("Continue shows only unfinished items and preserves resume, restart, and queue identity", async () => {
  await renderContinue();
  expect(screen.getByRole("region", { name: "Continue" })).toBeInTheDocument();
  expect(document.body.textContent).toContain("Halfway home");
  expect(document.body.textContent).toContain("Album track");
  expect(document.body.textContent).not.toContain("Finished film");
  expect(document.body.textContent).not.toContain("No progress");
  await userEvent.click(button("Resume Halfway home"));
  await userEvent.click(button("From start Halfway home"));
  await userEvent.click(button("Queue Halfway home"));
  await userEvent.click(button("Queue Album track"));
  expect(played).toEqual([[unfinished, { fromStart: false }], [unfinished, { fromStart: true }]]);
  expect(queued).toEqual([unfinished, online]);
});

test("Continue queues every playable item even when playback is unavailable", async () => {
  await renderContinue({ canPlay: false });
  expect(button("Resume Album track")).toBeDisabled();
  expect(button("From start Album track")).toBeDisabled();
  expect(button("Queue Album track")).toBeEnabled();
  await userEvent.click(button("Queue Album track"));
  expect(queued).toEqual([online]);
  expect(played).toEqual([]);
  expect(button("Resume Missing file")).toBeDisabled();
});

test("Continue removes an item and refetches the visible history", async () => {
  await renderContinue();
  await userEvent.click(button("Remove Halfway home from Continue"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Resume Halfway home" })).not.toBeInTheDocument());
  expect(requests).toContain("/api/progress/library%3Amovie");
  expect(requests.filter(path => path === "/api/progress/history")).toHaveLength(2);
  expect(document.body.textContent).not.toContain("Halfway home");
});

test("disconnected Continue skips reads and cannot play or queue", async () => {
  await renderContinue({ connected: false });
  expect(requests).toEqual([]);
  await renderContinue();
  await renderContinue({ connected: false });
  expect(button("Resume Halfway home")).toBeDisabled();
  expect(button("Queue Halfway home")).toBeDisabled();
});

test("history failure offers retry", async () => {
  historyError = true;
  await renderContinue();
  expect(document.body.textContent).toContain("History unavailable");
  historyError = false;
  await userEvent.click(button("Try again"));
  expect(await screen.findByRole("button", { name: "Resume Halfway home" })).toBeEnabled();
});

test("with nothing playing, the latest unfinished item leads the row", async () => {
  await renderContinue({ feature: true });
  expect(screen.getByRole("heading", { name: "Halfway home" })).toBeInTheDocument();
  await userEvent.click(button("Resume Halfway home"));
  expect(played).toEqual([[unfinished, { fromStart: false }]]);
});

for (const feature of [true, false]) {
  test(`Continue refreshes episode metadata in the ${feature ? "featured" : "compact"} row and preserves replay identity`, async () => {
    const episode = { ...online, title: "MasterChef Italia S11E07", subtitle: "MasterChef Italia, Season 11, Episode 7", description: "Gli aspiranti chef affrontano una nuova prova in cucina.", sourceLabel: "StreamingCommunity" };
    historyItems = [{ ...online, title: episode.title }];
    await renderContinue({ feature });
    expect(screen.getByText("Online")).toBeInTheDocument();
    historyItems = [episode];
    await act(async () => { await client.invalidateQueries({ queryKey: ["progress"] }); });
    expect(await screen.findByText(`${episode.subtitle} · StreamingCommunity`)).toBeInTheDocument();
    expect(screen.getByText(episode.description)).toBeInTheDocument();
    expect(screen.queryByText("Online")).toBeNull();
    await userEvent.click(button(`Resume ${episode.title}`));
    await userEvent.click(button(`Queue ${episode.title}`));
    expect(played).toEqual([[episode, { fromStart: false }]]);
    expect(queued).toEqual([episode]);
  });
}

for (const trigger of ["Details Album track", "Artwork details for Album track"]) {
  test(`Continue ${trigger} navigates to its stable identity without playback`, async () => {
    historyItems = [online];
    const router = await renderContinue({ feature: true });
    await userEvent.click(button(trigger));
    expect(await screen.findByRole("heading", { name: "Item details" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/item");
    expect(router.state.location.search).toEqual({ kind: "history", id: online.mediaId });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(played).toEqual([]);
    expect(queued).toEqual([]);
    await act(async () => router.history.back());
    expect(await screen.findByRole("button", { name: trigger })).toHaveFocus();
  });
}

test("Continue omits the item already visible in Now", async () => {
  historyItems = [{ ...online, queueEntryId: "playing" }, unfinished];
  await renderContinue({ currentEntryId: "playing" });
  expect(screen.queryByRole("button", { name: "Details Album track" })).toBeNull();
  expect(button("Details Halfway home")).toBeInTheDocument();
});

test("removing Continue keeps focus on the next item's nonplaying details", async () => {
  await renderContinue();
  await userEvent.click(button("Remove Halfway home from Continue"));
  await waitFor(() => expect(button("Details Album track")).toHaveFocus());
  expect(played).toEqual([]);
});


test("Continue keeps its expanded rows and exact opener after Back", async () => {
  historyItems = Array.from({ length: 7 }, (_, index) => ({ ...online, mediaId: `media:${index}`, title: `Episode ${index}` }));
  const router = await renderContinue();
  await act(async () => router.navigate({ href: "/?retained=yes", replace: true }));
  expect(screen.queryByRole("button", { name: "Details Episode 6" })).toBeNull();
  await userEvent.click(button("Show all 7"));
  expect(router.state.location.search).toEqual({ retained: "yes", continue: "all" });
  await userEvent.click(button("Details Episode 6"));
  expect(await screen.findByRole("heading", { name: "Item details" })).toBeInTheDocument();
  await act(async () => router.history.back());
  expect(await screen.findByRole("button", { name: "Details Episode 6" })).toHaveFocus();
  expect(button("Show fewer")).toBeInTheDocument();
});
