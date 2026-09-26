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
