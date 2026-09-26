import { setupUiTests, render as renderUI, act, screen, userEvent, createTestQueryClient, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { createBrowserHistory, createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet, Link } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { FindPage } from "./FindPage";
import { ProviderPage } from "./ProviderPage";
import { collectionLocation } from "@/detail-navigation";
import { searchLocation } from "../../search";

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
for (const hash of [false, true]) test(`${hash ? "native hash" : "browser"} navigation leaves a nonempty Find search`, async () => {
  testWindow.happyDOM.setURL(`http://localhost/${hash ? "#/" : ""}find?q=fixture`);
  testWindow.history.replaceState(null, "", testWindow.location.href);
  history = hash ? createHashHistory() : createBrowserHistory();
  const shell = {
    nativeHost: hash, credentials: { origin: "http://localhost", token: "paired" }, state: null,
    connected: false, available: false, active: false, tv: { browsing: true }, section: "Find",
    videoQualityPreference: { quality: "auto" },
    changeSearch: (state: Parameters<typeof searchLocation>[0]) => history.replace(searchLocation(state)),
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Link to="/">Home</Link><Link to="/find" search={{ q: "fixture" }}>Find</Link><Outlet /></ShellProviders> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: () => <h1>Home page</h1> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: FindPage });
  const router = createRouter({ routeTree: base.addChildren([home, find]), history });
  await act(async () => { await router.load(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  expect(await screen.findByRole("searchbox")).toHaveValue("fixture");
  await userEvent.click(screen.getByRole("link", { name: "Home" }));
  expect(history.location.pathname).toBe("/");
  expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Find" }));
  expect(await screen.findByRole("searchbox")).toHaveValue("fixture");
});

test("a direct collection URL loads fresh items and actions without an in-memory opener", async () => {
  const list = { id: "list", provider: "youtube", kind: "collection", title: "Evening list", url: "https://www.youtube.com/playlist?list=PLevening" } as const;
  testWindow.happyDOM.setURL(`http://localhost${collectionLocation(list)}`);
  testWindow.history.replaceState(null, "", testWindow.location.href);
  history = createBrowserHistory();
  const saved: unknown[] = [];
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/providers/favorites") { if (init?.method === "POST") saved.push(JSON.parse(String(init.body)).item); return Response.json({ favorites: saved }); }
    if (path === "/api/for-later") return Response.json({ items: [] });
    if (path === "/api/providers/youtube/items") return Response.json({ item: list, title: "Evening list", items: [{ id: "one", provider: "youtube", kind: "media", title: "First episode", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", duration: 60 }] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
  const commands: unknown[] = [];
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: null, state: null,
    connected: true, available: true, section: "Find", videoQualityPreference: { quality: "auto" }, changeSearch: () => {},
    run: async (action: unknown) => { commands.push(action); return true; },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: FindPage });
  const collection = createRoute({ getParentRoute: () => base, path: "/collection", component: ProviderPage });
  const router = createRouter({ routeTree: base.addChildren([find, collection]), history });
  await act(async () => { await router.load(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  expect(await screen.findByRole("heading", { name: "Evening list" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Play First episode" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Save", pressed: false }));
  expect(saved).toEqual([list]);
  expect(await screen.findByRole("button", { name: "Saved", pressed: true })).toBeDefined();
  await userEvent.click(screen.getByRole("button", { name: "Play all" }));
  expect(commands).toEqual([{ type: "enqueueProvider", provider: "youtube", url: list.url, shape: "playlist", playNow: true, quality: "auto" }]);
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(history.location.pathname).toBe("/find");
});

for (const hash of [false, true]) test(`${hash ? "native hash" : "browser"} collection URLs preserve nested navigation, reload, and search filters`, async () => {
  const showUrl = "https://streamingcommunityz.academy/it/titles/1-show";
  const show = { id: "show", provider: "streamingcommunity", kind: "collection", title: "The show", url: showUrl } as const;
  const season = { ...show, id: "season", title: "Season 1", url: `${showUrl}/season-1` };
  const episode = { ...show, id: "episode", kind: "media", title: "Arrival", url: "https://streamingcommunityz.academy/it/watch/1?e=2" };
  const search = "/find?q=show&source=StreamingCommunity&kind=Channels&length=10%E2%80%9360+min";
  testWindow.happyDOM.setURL(`http://localhost/${hash ? "#" : ""}${search.slice(hash ? 0 : 1)}`);
  testWindow.history.replaceState(null, "", testWindow.location.href);
  history = hash ? createHashHistory() : createBrowserHistory();
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/providers/favorites") return Response.json({ favorites: [] });
    if (url.pathname === "/api/for-later") return Response.json({ items: [] });
    const selected = url.searchParams.get("url") === season.url ? season : show;
    return Response.json({ item: selected, title: selected.title, items: selected === season ? [episode] : [season] });
  }) as typeof fetch);
  const commands: unknown[] = [];
  const shell = {
    credentials: { origin: "http://localhost", token: "paired" }, connected: true, available: true, section: "Find", videoQualityPreference: { quality: "720p" },
    openProvider: (item: typeof show) => { void router.navigate({ href: collectionLocation(item) }); },
    run: async (action: unknown) => { commands.push(action); return true; },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <Link to="/collection" search={{ provider: show.provider, url: show.url }}>The show</Link> });
  const collection = createRoute({ getParentRoute: () => base, path: "/collection", component: ProviderPage });
  const router = createRouter({ routeTree: base.addChildren([find, collection]), history });
  await act(async () => { await router.load(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  await userEvent.click(await screen.findByRole("link", { name: "The show" }));
  await userEvent.click(await screen.findByRole("button", { name: "Open Season 1" }));
  expect(new URLSearchParams(history.location.search).get("url")).toBe(season.url);
  await screen.findByRole("heading", { name: "Season 1" });
  await userEvent.click(await screen.findByRole("button", { name: "Play Arrival" }));
  expect(commands).toContainEqual(expect.objectContaining({ type: "enqueueProvider", url: episode.url, quality: "720p", playNow: true }));
  await act(async () => { history.back(); });
  await screen.findByRole("heading", { name: "The show" });
  await act(async () => { history.back(); });
  await screen.findByRole("link", { name: "The show" });
  expect(history.location.search).toBe(search.slice(search.indexOf("?")));
  await act(async () => { history.forward(); });
  await screen.findByRole("heading", { name: "The show" });
  await act(async () => { history.forward(); });
  await screen.findByRole("heading", { name: "Season 1" });
  await act(async () => { view.rerender(<></>); client.clear(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  expect(await screen.findByRole("button", { name: "Play Arrival" })).toBeEnabled();
});
