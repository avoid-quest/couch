import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SessionState } from "../../../shared/protocol";
import { screen } from "@/testing";
import type { ShellValue } from "./AppShell";
import { ShellContext } from "./shell-context";

let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(async () => {
  window = new Window({ url: "tauri://localhost/find" });
  Object.defineProperty(window, "__COUCH_NATIVE_HOST__", { configurable: true, value: true });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke: async () => undefined } });
  for (const key of ["CSS", "window", "document", "location", "navigator", "localStorage", "scrollTo", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

async function render(status: "playing" | "unavailable") {
  const { ShellChrome } = await import("./AppShell");
  const state: SessionState = {
    installationName: "Desk Couch",
    activeProfile: { id: "household", name: "Household" },
    queue: status === "playing" ? [{ id: "movie", title: "Movie", source: "library:movie" }] : [],
    currentEntryId: status === "playing" ? "movie" : null,
    player: { playbackId: status === "playing" ? "movie" : null, status, position: 0, duration: null, volume: 50, seekable: false, error: status === "unavailable" ? "Video backend missing" : null },
  };
  const shell = {
    nativeHost: true, tvPresentation: false, credentials: { origin: "http://localhost", token: "host" },
    state, status: "connected", statusLabel: "Connected", details: { tvPresentation: false },
    connected: true, active: status === "playing", current: state.queue[0] ?? null,
    available: status === "playing", section: "Find", tv: { browsing: true, controlsVisible: false },
    run: async () => true, host: null, remoteControlEnabled: false, pairingRequired: false,
    sourcesOpen: false, onlineRequest: null, remoteOpen: false, setRemoteOpen: () => {},
    sectionUrl: () => "/find",
    videoQualityPreference: { quality: "auto" },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellContext.Provider value={shell}><ShellChrome><Outlet /></ShellChrome></ShellContext.Provider> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <p>Find view</p> });
  const router = createRouter({ routeTree: base.addChildren([find]), history: createMemoryHistory({ initialEntries: ["/find"] }) });
  await act(async () => { await router.load(); root.render(<RouterProvider router={router} />); });
}

test("local desktop playback retains a measured video area outside TV presentation", async () => {
  await render("playing");
  expect(screen.getByLabelText("Video playback")).toBeDefined();
  expect(screen.getByText("Find view")).toBeDefined();
});

test("a playback backend error remains visible while browsing Find", async () => {
  await render("unavailable");
  expect(screen.getByRole("alert").textContent).toContain("Video backend missing");
  expect(screen.getByText("Find view")).toBeDefined();
});
