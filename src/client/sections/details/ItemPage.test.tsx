import { setupUiTests, render, act, screen, fireEvent, waitFor } from "@/testing/react";
import { expect, mock, spyOn, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { ShellProviders } from "../shell/test-providers";
import { ItemPage, readItemSearch } from "./ItemPage";

setupUiTests();

async function openItem(href: string, authority = "controller") {
  const shell = {
    credentials: { origin: "http://localhost", token: "paired" }, connected: true, available: true,
    identity: { authority }, state: { activeProfile: { id: "watcher" } },
    enqueueCatalog: mock(async () => true), playHistory: mock(async () => true), enqueueRadio: mock(async () => true), openProvider: mock(() => {}), offerUndo: mock(() => {}),
  };
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const item = createRoute({ getParentRoute: () => base, path: "/item", validateSearch: readItemSearch, component: ItemPage });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: () => <h1>Home</h1> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <h1>Find</h1> });
  const router = createRouter({ routeTree: base.addChildren([item, home, find]), history: createMemoryHistory({ initialEntries: [href] }) });
  let view!: ReturnType<typeof render>;
  await act(async () => { await router.load(); view = render(<RouterProvider router={router} />); });
  return { shell, router, view };
}

const movie = { id: "movie-1", title: "Proof movie", kind: "video", available: true, duration: 600, artworkId: null, artist: null, album: null, progress: { position: 120 }, video: { type: "movie", show: null, year: 2024, plot: "Proof", genres: [] } };

test("direct library URLs reload from the server and retain playback and authorized editing", async () => {
  const fetcher = spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL) => Response.json({ item: movie })) as typeof fetch);
  let rendered = await openItem("/item?kind=library&id=movie-1");
  expect(await screen.findByRole("heading", { name: movie.title })).toBeVisible();
  expect(fetcher.mock.calls[0]?.[0]).toBe("http://localhost/api/library/items/movie-1");
  expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resume Proof movie" })));
  expect(rendered.shell.enqueueCatalog).toHaveBeenLastCalledWith("enqueueLibrary", "movie-1", { playNow: true });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "From start" })));
  expect(rendered.shell.enqueueCatalog).toHaveBeenLastCalledWith("enqueueLibrary", "movie-1", { playNow: true, fromStart: true });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play next" })));
  expect(rendered.shell.enqueueCatalog).toHaveBeenLastCalledWith("enqueueLibrary", "movie-1", { placement: "next" });
  await act(async () => rendered.view.unmount());
  fetcher.mockImplementation((async (_input: RequestInfo | URL) => Response.json({ item: movie })) as typeof fetch);
  rendered = await openItem("/item?kind=library&id=movie-1", "administrator");
  expect(await screen.findByRole("button", { name: "Edit details" })).toBeEnabled();
  expect(fetcher.mock.calls.length).toBe(2);
});

test("history pages read an individual item and queue against the active profile", async () => {
  const item = { mediaId: "youtube:abc", title: "Older watch", libraryItemId: null, playable: true, position: 30, duration: 300, watched: false, lastPlayedAt: 1, description: "Still available after leaving the recent list." };
  const fetcher = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => Response.json(init?.method === "POST" ? {} : { item })) as typeof fetch);
  const { shell } = await openItem("/item?kind=history&id=youtube%3Aabc");
  expect(await screen.findByRole("heading", { name: item.title })).toBeVisible();
  expect(fetcher.mock.calls[0]?.[0]).toBe("http://localhost/api/progress/youtube%3Aabc");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resume" })));
  expect(shell.playHistory).toHaveBeenCalledWith(item, { fromStart: false });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Queue" })));
  const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
  expect(request?.[0]).toBe("http://localhost/api/progress/youtube%3Aabc/queue");
  expect(JSON.parse(request?.[1]?.body as string)).toEqual({ profileId: "watcher" });
});

test("saved pages resolve stable ids and retain loading actions", async () => {
  const fetcher = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => Response.json(init?.method === "POST" ? {} : { items: [{ id: "saved-1", title: "Saved episode", duration: 240, description: "Full episode description" }] })) as typeof fetch);
  await openItem("/item?kind=saved&id=saved-1");
  expect(await screen.findByText("Full episode description")).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play" })));
  const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
  expect(request?.[0]).toBe("http://localhost/api/for-later/saved-1/load");
  expect(JSON.parse(request?.[1]?.body as string)).toEqual({ mode: "play" });
});

test("radio pages resolve a station id and play the hydrated station", async () => {
  const station = { id: "station-1", name: "Night radio", url: "https://radio.example/live", countryCode: "IT", codec: "MP3", bitrate: 128, homepage: null };
  spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL) => Response.json({ station })) as typeof fetch);
  const { shell } = await openItem("/item?kind=radio&id=station-1");
  await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Play Night radio" })));
  expect(shell.enqueueRadio).toHaveBeenCalledWith(station, true);
});

test("missing and invalid direct links show a recoverable page without playback controls", async () => {
  const fetcher = spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL) => Response.json({ error: "This item is no longer available." }, { status: 404 })) as typeof fetch);
  const { view } = await openItem("/item?kind=library&id=removed");
  expect(await screen.findByRole("heading", { name: "Item not found" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Play/ })).not.toBeInTheDocument();
  await act(async () => view.unmount());
  await openItem("/item?kind=unknown&id=bad");
  expect(screen.getByRole("heading", { name: "Item not found" })).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Back" })));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Item not found" })).not.toBeInTheDocument());
});

test("saved pages render full descriptions as text and keep Browse available after a playback failure", async () => {
  const description = "<script>window.bad = true</script>\n" + "Episode description. ".repeat(120);
  const item = { id: "saved-1", title: "Saved show", description, url: "https://streamingcommunity.example/titles/42-proof/season-1", collection: { title: "Proof show", url: "https://streamingcommunity.example/titles/42-proof/season-1", index: 1 } };
  spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => init?.method === "POST" ? Response.json({ error: "Provider is temporarily unavailable." }, { status: 502 }) : Response.json({ items: [item] })) as typeof fetch);
  const { shell } = await openItem("/item?kind=saved&id=saved-1");
  expect(await screen.findByRole("heading", { name: item.title })).toBeVisible();
  expect(document.querySelector("[data-page=Item] script")).toBeNull();
  expect(screen.getByText((_content, element) => element?.tagName === "P" && element.textContent === description)).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play" })));
  expect(await screen.findByRole("alert")).toHaveTextContent("Provider is temporarily unavailable.");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Browse Proof show" })));
  expect(shell.openProvider).toHaveBeenCalledWith(expect.objectContaining({ url: "https://streamingcommunity.example/titles/42-proof" }));
});

test("history pages remove Continue progress and offer the server undo", async () => {
  const item = { mediaId: "youtube:abc", title: "Unfinished", libraryItemId: null, playable: true, position: 30, duration: 300, watched: false, lastPlayedAt: 1 };
  let cleared = false;
  const fetcher = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    if (init?.method === "POST") { cleared = true; return Response.json({ undoToken: "undo", expiresAt: Date.now() + 30_000 }); }
    return Response.json({ item: { ...item, position: cleared ? 0 : item.position } });
  }) as typeof fetch);
  const { shell } = await openItem("/item?kind=history&id=youtube%3Aabc");
  await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Remove from Continue" })));
  const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(request?.[1]?.body as string)).toEqual({ clearResume: true });
  expect(shell.offerUndo).toHaveBeenCalledWith("Removed Unfinished from Continue.", expect.any(Function), expect.any(Number));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Remove from Continue" })).not.toBeInTheDocument());
});
