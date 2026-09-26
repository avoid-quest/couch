import { useCallback, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { setupUiTests, render, screen, userEvent, waitFor, createTestQueryClient } from "@/testing/react";
import { SearchOnlineResults, type SearchResultSummary } from "./SearchOnlineResults";
import { CollectionHeader, HitList } from "./SearchPanel";

setupUiTests();
const cover = "https://cdn.streamingcommunityz.academy/images/show.webp";
const showUrl = "https://streamingcommunityz.academy/it/titles/1-show";
const requests: string[] = [];
const commands: unknown[] = [];
const show = { id: "show", provider: "streamingcommunity", kind: "collection", title: "The show", url: showUrl, thumbnail: cover, description: "A short search synopsis." };
const season = { id: "season", provider: "streamingcommunity", kind: "collection", title: "Season 1", url: `${showUrl}/season-1` };
const episode = { id: "episode", provider: "streamingcommunity", kind: "media", title: "S01E01 · Arrival", subtitle: "The show", url: "https://streamingcommunityz.academy/it/watch/1?e=2", thumbnail: cover, description: "The crew arrives at the station." };

beforeEach(() => {
  requests.length = commands.length = 0;
  spyOn(globalThis, "fetch").mockImplementation((async input => {
    const url = new URL(String(input)); requests.push(url.pathname);
    if (url.pathname === "/api/providers/favorites") return Response.json({ favorites: [] });
    if (url.pathname === "/api/for-later") return Response.json({ items: [] });
    const target = url.searchParams.get("url");
    if (target === showUrl) return Response.json({ title: "The show", thumbnail: cover, description: "The full show synopsis.", subtitle: "2025 · Series", items: [season] });
    if (target === season.url) return Response.json({ title: "The show - Season 1", items: [episode] });
    return Response.json({ items: [show] });
  }) as typeof fetch);
});

const command = async (action: unknown) => { commands.push(action); return true; };
function Browser() {
  const [summary, setSummary] = useState<SearchResultSummary>();
  const receive = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  return <>
    <SearchOnlineResults provider="streamingcommunity" query="show" origin="http://localhost" token="paired" connected canPlay active quality="auto" onEnqueued={() => {}} onCommand={command} onResults={receive} />
    {summary?.collection && <CollectionHeader collection={summary.collection} back="Back" onBack={summary.collection.back} canPlay />}
    <HitList hits={summary?.hits ?? []} label="Results" origin="http://localhost" token="paired" />
  </>;
}

test("opening a show and sparse season keeps cover and synopsis while episodes show their own details", async () => {
  render(<QueryClientProvider client={createTestQueryClient()}><Browser /></QueryClientProvider>);
  await userEvent.click(await screen.findByRole("button", { name: "Open The show" }));
  await screen.findByText("The full show synopsis.");
  expect(document.querySelector<HTMLImageElement>("[data-collection-preview] img")?.src).toBe(cover);
  await userEvent.click(await screen.findByRole("button", { name: "Open Season 1" }));
  await screen.findByRole("heading", { name: "The show - Season 1" });
  expect(screen.getByText("The full show synopsis.")).toBeInTheDocument();
  expect(document.querySelector<HTMLImageElement>("[data-collection-preview] img")?.src).toBe(cover);
  expect(screen.getByText("The crew arrives at the station.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Details/ })).toBeNull();
  expect(requests.some(path => path.includes("/titles/"))).toBe(false);
});

test("repeated playlist occurrences remain separate playable rows", async () => {
  spyOn(globalThis, "fetch").mockImplementation((async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/providers/favorites") return Response.json({ favorites: [] });
    if (url.pathname === "/api/for-later") return Response.json({ items: [] });
    return Response.json({ items: [0, 1].map(index => ({ ...episode, collection: { title: "Two viewings", url: showUrl, index } })) });
  }) as typeof fetch);
  render(<QueryClientProvider client={createTestQueryClient()}><Browser /></QueryClientProvider>);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Play S01E01 · Arrival" })).toHaveLength(2));
  await userEvent.click(screen.getAllByRole("button", { name: "Play S01E01 · Arrival" })[1]!);
  expect(commands).toContainEqual(expect.objectContaining({ type: "enqueueProvider", url: episode.url, collection: { title: "Two viewings", url: showUrl, index: 1 } }));
});
