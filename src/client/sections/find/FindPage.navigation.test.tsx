import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createBrowserHistory, createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider, Outlet, Link } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellValue } from "../shell/AppShell";
import { FindPage } from "./FindPage";
import { fireEvent, screen } from "../../testing";
import { searchLocation } from "../../search";

const originals = new Map<string, PropertyDescriptor | undefined>();
let root: Root, window: Window, client: QueryClient;
let history: ReturnType<typeof createBrowserHistory>;
let request: ReturnType<typeof spyOn> | undefined;
beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["scrollTo", "history", "location", "localStorage", "CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  client = new QueryClient();
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  request?.mockRestore(); request = undefined;
  history?.destroy(); client.clear(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("Add a source on empty Find home opens source settings", async () => {
  window.happyDOM.setURL("http://localhost/find");
  history = createBrowserHistory();
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/progress/history" || path === "/api/for-later") return Response.json({ items: [] });
    if (path === "/api/jellyfin/connection") return Response.json({ configured: false });
    if (path === "/api/library/sources" || path === "/api/iptv/sources") return Response.json({ sources: [] });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: { authority: "host" }, state: null,
    connected: true, available: false, active: false, tv: { browsing: true }, section: "Find",
    videoQualityPreference: { quality: "auto" }, changeSearch: () => {},
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: FindPage });
  const settings = createRoute({ getParentRoute: () => base, path: "/settings/sources", component: () => <h1>Source settings</h1> });
  const router = createRouter({ routeTree: base.addChildren([find, settings]), history });
  await act(async () => { await router.load(); root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  await act(async () => { await Bun.sleep(30); });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add a source" })));
  expect(history.location.pathname).toBe("/settings/sources");
  expect(screen.getByRole("heading", { name: "Source settings" })).toBeDefined();
});
for (const hash of [false, true]) test(`${hash ? "native hash" : "browser"} navigation leaves a nonempty Find search`, async () => {
  window.happyDOM.setURL(`http://localhost/${hash ? "#/" : ""}find?q=fixture`);
  history = hash ? createHashHistory() : createBrowserHistory();
  const shell = {
    nativeHost: hash, credentials: { origin: "http://localhost", token: "paired" }, state: null,
    connected: false, available: false, active: false, tv: { browsing: true }, section: "Find",
    videoQualityPreference: { quality: "auto" },
    changeSearch: (state: Parameters<typeof searchLocation>[0]) => history.replace(searchLocation(state)),
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Link to="/">Now</Link><Link to="/find" search={{ q: "fixture" }}>Find</Link><Outlet /></ShellProviders> });
  const now = createRoute({ getParentRoute: () => base, path: "/", component: () => <h1>Now playing</h1> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: FindPage });
  const router = createRouter({ routeTree: base.addChildren([now, find]), history });
  await act(async () => { await router.load(); root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("fixture");
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Now", exact: true })); await Bun.sleep(30); });
  expect(history.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { name: "Now playing" })).toBeDefined();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Find", exact: true })); await Bun.sleep(30); });
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("fixture");
});

test("a list opened from Saved shows its items with Saved as the way back", async () => {
  window.happyDOM.setURL("http://localhost/find");
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
  let closed = 0;
  const shell = {
    nativeHost: false, credentials: { origin: "http://localhost", token: "paired" }, identity: null, state: null,
    connected: true, available: true, section: "Find", videoQualityPreference: { quality: "auto" }, changeSearch: () => {},
    onlineRequest: { item: list, revision: 1 }, closeOnlineRequest: () => { closed++; }, changeSection: (name: string) => sections.push(name),
    run: async (action: unknown) => { commands.push(action); return true; },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: FindPage });
  const router = createRouter({ routeTree: base.addChildren([find]), history });
  await act(async () => { await router.load(); root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>); });
  await act(async () => { await Bun.sleep(50); });
  expect(screen.getByRole("heading", { name: "Evening list" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Play First episode" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Saved", pressed: true })).toBeDefined();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play all" })));
  expect(commands).toEqual([{ type: "enqueueProvider", provider: "youtube", url: list.url, shape: "playlist", playNow: true, quality: "auto" }]);
  const back = document.querySelector<HTMLButtonElement>("[data-back]")!;
  expect(back.textContent).toBe("Saved");
  await act(async () => fireEvent.click(back));
  expect([closed, sections]).toEqual([1, ["Saved"]]);
});
