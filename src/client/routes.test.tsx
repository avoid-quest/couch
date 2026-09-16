import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { RouterProvider, createBrowserHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { createAppHistory } from "./app-history";
import { readSearchState, searchLocation } from "./search";
import { frontendPaths } from "../shared/page-paths";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const flush = () => act(async () => { await Bun.sleep(30); });
const globals = ["window", "document", "navigator", "location", "history", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "PopStateEvent", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"] as const;
function adopt(source: Window) {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? source : Reflect.get(source, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? (value as (...args: unknown[]) => unknown).bind(source) : value });
  }
for (const stub of ["scrollTo", "cancelAnimationFrame"]) {
    originals.set(stub, Object.getOwnPropertyDescriptor(globalThis, stub));
    Object.defineProperty(globalThis, stub, { configurable: true, writable: true, value: () => {} });
  }
}
function release() {
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
}
function freshRouter() {
  return createRouter({ routeTree, history: createBrowserHistory(), scrollRestoration: false });
}
async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  await act(async () => root.render(<RouterProvider router={freshRouter()} />));
  await flush();
}
beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  adopt(window);
  request = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ error: "unavailable" }, { status: 503 })) as unknown as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore(); await window.happyDOM.close();
  release();
});

test("the Tauri webview keeps hash history and the browser keeps browser history", async () => {
  const tv = new Window({ url: "http://tauri.localhost/" });
  (tv as unknown as { __COUCH_NATIVE_HOST__: boolean }).__COUCH_NATIVE_HOST__ = true;
  adopt(tv);
  try {
    const native = createAppHistory();
    native.push("/find?q=moon");
    expect(native.location.pathname).toBe("/find");
    expect(native.location.search).toBe("?q=moon");
  } finally { release(); adopt(window); }
  const web = createAppHistory();
  web.push("/find?q=moon");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(window.location.pathname + window.location.search).toBe("/find?q=moon");
});

test("unknown paths land on Now", async () => {
  await renderAt("/yesterday");
  console.log("BODY:", document.body.textContent?.slice(0, 200));
  expect(window.location.pathname).toBe("/");
});

test("legacy paths and settings indexes redirect to their live pages", async () => {
  await renderAt("/search?q=moon&source=TV+folders");
  expect(window.location.pathname).toBe("/find");
  expect(new URLSearchParams(window.location.search).get("q")).toBe("moon");
  await renderAt("/up-next");
  expect(window.location.pathname).toBe("/");
  await renderAt("/browse/guide");
  expect(window.location.pathname).toBe("/find");
  await renderAt("/settings");
  expect(window.location.pathname).toBe("/settings/playback");
  expect(document.title).toBe("Playback · Settings · Couch");
  await renderAt("/settings/remotes");
  expect(window.location.pathname).toBe("/settings/connection");
  expect(document.title).toBe("Connections · Settings · Couch");
})

test("every frontend path resolves to a registered route", () => {
  const router = freshRouter();
  const ids = Object.keys(router.routesById);
  for (const path of frontendPaths) expect(ids).toContain(path);
});

test("malformed search filters use truthful defaults", () => {
  expect(readSearchState("?q=a%26b&source=Unknown")).toEqual({ query: "a&b", source: "All" });
  expect(searchLocation({ query: "", source: "All" })).toBe("/find");
});
