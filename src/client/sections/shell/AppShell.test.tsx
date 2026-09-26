import { setupUiTests, render as renderUI, act, screen, within, fireEvent, createTestQueryClient, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ShellProviders } from "./test-providers";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import type { SessionState } from "../../../shared/protocol";
import type { ShellValue } from "./AppShell";

setupUiTests();

let view: ReturnType<typeof renderUI>;
let fetchSpy: ReturnType<typeof spyOn> | null = null;
const videoRects: unknown[] = [];

beforeEach(async () => {
  videoRects.length = 0;
  testWindow.happyDOM.setURL("tauri://localhost/find");
  Object.defineProperty(window, "__COUCH_NATIVE_HOST__", { configurable: true, value: true });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke: async (command: string, args?: { rect?: unknown }) => {
    if (command === "set_video_rect") videoRects.push(args?.rect);
    return command === "playback_device" ? { mode: "local", address: null, targets: [], localSetupComplete: true } : undefined;
  } } });
  view = renderUI(<></>);
});

afterEach(async () => {
  Reflect.deleteProperty(window, "__COUCH_NATIVE_HOST__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  fetchSpy = null;
});

async function renderUpdates(authority: "host" | "administrator" | "controller", localHost: boolean) {
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { UpdatesPage } = await import("../settings/system/UpdatesPage");
  const client = createTestQueryClient();
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
  await act(async () => { await router.load(); view.rerender(<RouterProvider router={router} />); });
}

test("a remote administrator manages only the selected host's update policy", async () => {
  await renderUpdates("administrator", false);
  expect(await screen.findByLabelText("Channel")).toBeInTheDocument();
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
  expect(await screen.findByLabelText("Channel")).toBeInTheDocument();
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
    sectionUrl: () => "/find", recentRadio: [],
    videoQualityPreference: { quality: "auto" },
  } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <NativeModeGate><ShellProviders value={shell}><ShellChrome><Outlet /></ShellChrome></ShellProviders></NativeModeGate> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: (await import("../home/HomePage")).HomePage });
  const now = createRoute({ getParentRoute: () => base, path: "/now", component: (await import("../now/PlayerPage")).PlayerPage });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <p>Find view</p> });
  const router = createRouter({ routeTree: base.addChildren([home, now, find]), history: createMemoryHistory({ initialEntries: ["/find"] }) });
  await act(async () => { await router.load(); view.rerender(<RouterProvider router={router} />); });
}

test("the shared browsing shell leaves video to the player page", async () => {
  await render("playing");
  expect(screen.queryByLabelText("Video playback")).toBeNull();
  expect(screen.getByText("Find view")).toBeDefined();
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeDefined();
  expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getAllByRole("link").map(link => link.textContent)).toEqual(["Home", "Find", "Saved", "Settings"]);
});

test("a stopped queue stays reachable on Home", async () => {
  await render("idle");
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "Home" })));
  expect(await screen.findByRole("button", { name: "Play Movie" })).toBeEnabled();
});

test("the header has no queue shortcut; Up next lives on Home", async () => {
  await render("idle", false, true);
  expect(screen.queryByRole("link", { name: /^Up next/ })).toBeNull();
  expect(screen.getByText("Find view")).toBeDefined();
});

test("browsing does not allocate a native video rectangle", async () => {
  await render("playing");
  expect(videoRects).toHaveLength(0);
  await act(async () => view.rerender(<></>));
  expect(videoRects).toHaveLength(0);
});

test("a missing player is a quiet status line while browsing Find", async () => {
  await render("unavailable");
  expect(screen.queryByLabelText("Video playback")).toBeNull();
  expect(screen.getByRole("button", { name: "Playing here" })).toBeDefined();
  expect(screen.getByText("Player not running on this computer.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Find view")).toBeDefined();
});

test("a desktop app keeps offline recovery on the selected remote and offers an explicit local choice", async () => {
  await render("unavailable", true);
  expect(screen.getByText("Offline. Reconnecting to Desk Couch…")).toBeDefined();
  expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Use this computer" })).toBeDefined();
});
