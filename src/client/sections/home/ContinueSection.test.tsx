import { setupUiTests, render as renderUI, act, screen, waitFor, userEvent, createTestQueryClient } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HistoryItem } from "../../../shared/library";
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
async function renderContinue({ connected = true, canPlay = true, feature = false }: { connected?: boolean; canPlay?: boolean; feature?: boolean } = {}) {
  await act(async () => view.rerender(<QueryClientProvider client={client}><ContinueSection credentials={credentials} connected={connected} canPlay={canPlay} feature={feature} onAdd={async item => { queued.push(item); return true; }} onPlay={async (...args) => { played.push(args); return true; }} /></QueryClientProvider>));
  if (connected) await screen.findByRole(historyError ? "alert" : "region", historyError ? {} : { name: "Continue" });
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
