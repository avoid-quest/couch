import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "./test-providers";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SessionState } from "../../../shared/protocol";
import { fireEvent, screen } from "@/testing";
import type { ShellValue } from "./AppShell";
import { buildInfo } from "../../../shared/build";

let root: Root, window: Window;
let fetchSpy: ReturnType<typeof spyOn> | null = null;
const originals = new Map<string, PropertyDescriptor | undefined>();
const videoRects: unknown[] = [];

beforeEach(async () => {
  videoRects.length = 0;
  window = new Window({ url: "tauri://localhost/find" });
  Object.defineProperty(window, "__COUCH_NATIVE_HOST__", { configurable: true, value: true });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke: async (command: string, args?: { rect?: unknown }) => {
    if (command === "set_video_rect") videoRects.push(args?.rect);
    return command === "playback_device" ? { mode: "local", address: null, targets: [], localSetupComplete: true } : undefined;
  } } });
  for (const key of ["CSS", "window", "document", "location", "navigator", "localStorage", "scrollTo", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  buildInfo.clientOnly = false;
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
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    expect(String(input)).toBe(`${origin}/api/updates${init?.method === "POST" ? "/check" : ""}`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${localHost ? "local-owner" : "remote-pairing"}`);
    return Response.json({ channel: "stable", policy: "manual", status: "idle", currentCheck: true, running: { version: "0.1.0", revision: "a".repeat(40) }, candidate: null, installation: { enabled: true, repairAvailable: false, transaction: null } }, { status: init?.method === "POST" ? 202 : 200 });
  }) as typeof fetch);
  const base = createRootRoute({ component: () => <QueryClientProvider client={client}><ShellProviders value={shell}><Outlet /></ShellProviders></QueryClientProvider> });
  const updates = createRoute({ getParentRoute: () => base, path: "/settings/updates", component: UpdatesPage });
  const router = createRouter({ routeTree: base.addChildren([updates]), history: createMemoryHistory({ initialEntries: ["/settings/updates"] }) });
  await act(async () => { await router.load(); root.render(<RouterProvider router={router} />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

test("a remote administrator manages only the selected host's update policy", async () => {
  await renderUpdates("administrator", false);
  expect(screen.getByLabelText("Channel")).toBeDefined();
  expect(screen.getByLabelText("Install updates")).toBeDefined();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check for updates" })));
  expect(fetchSpy?.mock.calls.some(([input, init]: [unknown, RequestInit?]) => String(input) === "http://192.168.1.20:4100/api/updates/check" && init?.method === "POST")).toBe(true);
});

test("a remote controller cannot manage the selected host's updates", async () => {
  await renderUpdates("controller", false);
  expect(screen.getByText("Only an admin can change this.")).toBeDefined();
  expect(screen.queryByLabelText("Install updates")).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the local host's update page offers its controls", async () => {
  await renderUpdates("host", true);
  expect(screen.getByLabelText("Channel")).toBeDefined();
  expect(screen.getByLabelText("Install updates")).toBeDefined();
});

async function render(status: "playing" | "unavailable" | "idle", remoteOffline = false, emptyQueue = false) {
  const { ShellChrome } = await import("./AppShell");
  const { NativeModeGate } = await import("./PlaybackDevice");
  if (remoteOffline) Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke: async (command: string) => command === "playback_device" ? { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: false } : undefined } });
  const state: SessionState = {
    installationName: "Desk Couch",
    activeProfile: { id: "household", name: "Household" },
    queue: status === "unavailable" || emptyQueue ? [] : [{ id: "movie", title: "Movie", source: "library:movie" }],
    currentEntryId: status === "playing" ? "movie" : null,
    player: { playbackId: status === "playing" ? "movie" : null, status, position: 0, duration: null, volume: 50, seekable: false, error: status === "unavailable" ? "Video backend missing" : null },
  };
  const shell = {
    nativeHost: true, localHost: !remoteOffline, tvPresentation: false, credentials: { origin: remoteOffline ? "http://192.168.1.10:4100" : "http://localhost", token: "host" },
    state, status: remoteOffline ? "server-unavailable" : "connected", statusLabel: remoteOffline ? "Server unavailable" : "Connected", details: { tvPresentation: false },
    connected: !remoteOffline, active: status === "playing", current: status === "playing" ? state.queue[0] : null,
    available: status !== "unavailable", section: "Find", tv: { browsing: true, controlsVisible: false },
    run: async () => true, reconnect: () => {}, host: null, remoteControlEnabled: false, pairingRequired: false,
    sourcesOpen: false, onlineRequest: null, remoteOpen: false, setRemoteOpen: () => {},
    sectionUrl: () => "/find",
    videoQualityPreference: { quality: "auto" },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <NativeModeGate><ShellProviders value={shell}><ShellChrome><Outlet /></ShellChrome></ShellProviders></NativeModeGate> });
  const now = createRoute({ getParentRoute: () => base, path: "/", component: (await import("../now/PlayerPage")).PlayerPage });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <p>Find view</p> });
  const router = createRouter({ routeTree: base.addChildren([now, find]), history: createMemoryHistory({ initialEntries: ["/find"] }) });
  await act(async () => { await router.load(); root.render(<RouterProvider router={router} />); });
}

test("the shared browsing shell leaves video to the player page", async () => {
  await render("playing");
  expect(screen.queryByLabelText("Video playback")).toBeNull();
  expect(screen.getByText("Find view")).toBeDefined();
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeDefined();
  expect([...screen.getByRole("navigation", { name: "Main navigation" }).querySelectorAll("a")].map(link => link.textContent)).toEqual(["Find", "Saved", "Settings"]);
});

test("a stopped queue stays reachable from Find without a top-level queue page", async () => {
  await render("idle");
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "Up next (1)" })));
  expect(document.querySelector('[data-page="Now"] h1')?.textContent).toBe("Nothing playing");
  expect(screen.getByRole("button", { name: "Play Movie" })).toBeDefined();
});

test("an idle session without queued entries has no queue shortcut", async () => {
  await render("idle", false, true);
  expect(screen.queryByRole("link", { name: /^Up next/ })).toBeNull();
  expect(screen.getByText("Find view")).toBeDefined();
});

test("browsing does not allocate a native video rectangle", async () => {
  await render("playing");
  expect(videoRects).toHaveLength(0);
  await act(async () => root.render(<></>));
  expect(videoRects).toHaveLength(0);
});

test("a missing player is a quiet status line while browsing Find", async () => {
  await render("unavailable");
  expect(screen.queryByLabelText("Video playback")).toBeNull();
  expect(screen.getByRole("button", { name: "Playing here" })).toBeDefined();
  expect(document.querySelector("[data-status-line]")?.textContent).toBe("Player not running on this computer.");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Find view")).toBeDefined();
});

test("a Client-only app keeps offline recovery on the selected remote", async () => {
  buildInfo.clientOnly = true;
  await render("unavailable", true);
  expect(screen.getByText("Offline. Reconnecting to Desk Couch…")).toBeDefined();
  expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Use this computer" })).toBeNull();
});
