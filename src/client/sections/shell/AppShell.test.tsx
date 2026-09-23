import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SessionState } from "../../../shared/protocol";
import { screen } from "@/testing";
import type { ShellValue } from "./AppShell";
import { ShellContext } from "./shell-context";

let root: Root, window: Window;
let fetchSpy: ReturnType<typeof spyOn> | null = null;
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(async () => {
  window = new Window({ url: "tauri://localhost/find" });
  Object.defineProperty(window, "__COUCH_NATIVE_HOST__", { configurable: true, value: true });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke: async (command: string) => command === "playback_device" ? { mode: "local", address: null, targets: [], localSetupComplete: true } : undefined } });
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
  fetchSpy?.mockRestore(); fetchSpy = null;
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

async function renderUpdates(authority: "host" | "administrator" | "controller", localHost: boolean) {
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { UpdatesPage } = await import("../settings/system/UpdatesPage");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const origin = localHost ? "http://127.0.0.1:4100" : "http://192.168.1.20:4100";
  const shell = { nativeHost: true, localHost, tvPresentation: false, credentials: { origin, token: localHost ? "local-owner" : "remote-pairing" }, connected: true, identity: { authority }, details: { tvPresentation: false } } as unknown as ShellValue;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async input => {
    expect(String(input)).toBe(`${origin}/api/updates`);
    return Response.json({ channel: "stable", policy: "manual", status: "idle", currentCheck: true, running: { version: "0.1.0", revision: "a".repeat(40) }, candidate: null, installation: { enabled: true, repairAvailable: false, transaction: null } });
  }) as typeof fetch);
  const base = createRootRoute({ component: () => <QueryClientProvider client={client}><ShellContext.Provider value={shell}><Outlet /></ShellContext.Provider></QueryClientProvider> });
  const updates = createRoute({ getParentRoute: () => base, path: "/settings/updates", component: UpdatesPage });
  const router = createRouter({ routeTree: base.addChildren([updates]), history: createMemoryHistory({ initialEntries: ["/settings/updates"] }) });
  await act(async () => { await router.load(); root.render(<RouterProvider router={router} />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

test("a remote administrator manages only the selected host's update policy", async () => {
  await renderUpdates("administrator", false);
  expect(screen.getByLabelText("Release channel for selected host")).toBeDefined();
  expect(screen.getByLabelText("Install updates on selected host")).toBeDefined();
  expect(screen.queryByLabelText("Release channel for this app")).toBeNull();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("a remote controller cannot manage the selected host's updates", async () => {
  await renderUpdates("controller", false);
  expect(screen.getByText("An administrator can install updates.")).toBeDefined();
  expect(screen.queryByLabelText("Install updates on selected host")).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the local host's update page names this app", async () => {
  await renderUpdates("host", true);
  expect(screen.getByLabelText("Release channel for this app")).toBeDefined();
  expect(screen.getByLabelText("Install updates on this app")).toBeDefined();
});

async function render(status: "playing" | "unavailable") {
  const { ShellChrome } = await import("./AppShell");
  const { NativeModeGate } = await import("./PlaybackDevice");
  const state: SessionState = {
    installationName: "Desk Couch",
    activeProfile: { id: "household", name: "Household" },
    queue: status === "playing" ? [{ id: "movie", title: "Movie", source: "library:movie" }] : [],
    currentEntryId: status === "playing" ? "movie" : null,
    player: { playbackId: status === "playing" ? "movie" : null, status, position: 0, duration: null, volume: 50, seekable: false, error: status === "unavailable" ? "Video backend missing" : null },
  };
  const shell = {
    nativeHost: true, localHost: true, tvPresentation: false, credentials: { origin: "http://localhost", token: "host" },
    state, status: "connected", statusLabel: "Connected", details: { tvPresentation: false },
    connected: true, active: status === "playing", current: state.queue[0] ?? null,
    available: status === "playing", section: "Find", tv: { browsing: true, controlsVisible: false },
    run: async () => true, host: null, remoteControlEnabled: false, pairingRequired: false,
    sourcesOpen: false, onlineRequest: null, remoteOpen: false, setRemoteOpen: () => {},
    sectionUrl: () => "/find",
    videoQualityPreference: { quality: "auto" },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <NativeModeGate><ShellContext.Provider value={shell}><ShellChrome><Outlet /></ShellChrome></ShellContext.Provider></NativeModeGate> });
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
  expect(screen.getByRole("button", { name: "Play on: This computer" })).toBeDefined();
  expect(screen.getByRole("alert").textContent).toContain("Video backend missing");
  expect(screen.getByText("Find view")).toBeDefined();
});
