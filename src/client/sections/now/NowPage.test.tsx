import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ComponentProps } from "react";
import type { SessionState } from "../../../shared/protocol";
import { screen } from "@/testing";
import { ShellContext } from "../shell/shell-context";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const state: SessionState = {
  queue: [{ id: "current", title: "Evening movie", source: "library:movie" }], currentEntryId: "current",
  activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 40, seekable: true, error: null },
};
const shell = {
  nativeHost: true, tvPresentation: true, credentials: { origin: "http://localhost", token: "paired" }, state, connected: true,
  run: async () => true, available: true, tv: { browsing: true, dismissLayer() {} },
  browseSection: () => {}, playHistory: async () => true, enqueueRadio: async () => true,
  videoQualityPreference: { quality: "auto" }, gotoSearch: () => {}, setRemoteOpen: () => {}, recentRadio: [],
} as unknown as ComponentProps<typeof ShellContext.Provider>["value"];

beforeEach(async () => {
  window = new Window({ url: "http://localhost/now" });
  for (const key of ["CSS", "window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  window.localStorage.setItem("couch.now-sections", JSON.stringify({ order: ["playing", "queue", "history", "radio"], hidden: ["playing"] }));
  request = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ items: [], sources: [], stations: [], playlists: [], playlist: { error: null }, programmes: {} })) as unknown as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("a TV Now page keeps transport when its Now playing section is hidden", async () => {
  const { NowPage } = await import("./NowPage");
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ShellContext.Provider value={shell}><NowPage /></ShellContext.Provider></QueryClientProvider>));
  await act(async () => { await Bun.sleep(15); });
  expect(screen.queryByRole("button", { name: "Play Evening movie" })).toBeNull();
  expect(screen.getByRole("button", { name: "Stop playback" })).toBeDefined();
});
