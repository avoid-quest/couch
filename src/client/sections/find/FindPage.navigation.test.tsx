import { setupUiTests, render as renderUI, act, screen, userEvent, createTestQueryClient, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { createBrowserHistory, createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet, Link } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { FindPage } from "./FindPage";
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

test("a list opened from Saved shows its items with Saved as the way back", async () => {
  testWindow.happyDOM.setURL("http://localhost/find");
  history = createBrowserHistory();
  const list = { id: "list", provider: "youtube", kind: "collection", title: "Evening list", url: "https://www.youtube.com/playlist?list=PLevening" } as const;
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/providers/favorites") return Response.json({ favorites: [list] });
    if (path === "/api/for-later") return Response.json({ items: [] });
    if (path === "/api/providers/youtube/items") return Response.json({ title: "Evening list", items: [{ id: "one", provider: "youtube", kind: "media", title: "First episode", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", duration: 60 }] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
  const commands: unknown[] = [], sections: string[] = [];
  const closed: boolean[] = [];
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: null, state: null,
    connected: true, available: true, section: "Find", videoQualityPreference: { quality: "auto" }, changeSearch: () => {},
    onlineRequest: { item: list, revision: 1, returnPath: "/saved", returnLabel: "Saved" }, closeOnlineRequest: (returnToOrigin = false) => { closed.push(returnToOrigin); }, changeSection: (name: string) => sections.push(name),
    run: async (action: unknown) => { commands.push(action); return true; },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: FindPage });
  const router = createRouter({ routeTree: base.addChildren([find]), history });
  await act(async () => { await router.load(); view.rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  expect(await screen.findByRole("heading", { name: "Evening list" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Play First episode" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Saved", pressed: true })).toBeDefined();
  await userEvent.click(screen.getByRole("button", { name: "Play all" }));
  expect(commands).toEqual([{ type: "enqueueProvider", provider: "youtube", url: list.url, shape: "playlist", playNow: true, quality: "auto" }]);
  const back = screen.getAllByRole("button", { name: "Saved" }).find(button => !button.hasAttribute("aria-pressed"))!;
  await userEvent.click(back);
  expect([closed, sections]).toEqual([[true], []]);
});
