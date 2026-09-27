import { setupUiTests, render as renderUI, act, screen, within, fireEvent, createTestQueryClient, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { ShellProviders } from "./test-providers";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import type { SessionState } from "../../../shared/protocol";
import type { ShellValue } from "./AppShell";

setupUiTests();

let view: ReturnType<typeof renderUI>;
let fetchSpy: ReturnType<typeof spyOn> | null = null;
const videoRects: unknown[] = [];
const titles: string[] = [];
const playerPanels: ("queue" | undefined)[] = [];

beforeEach(async () => {
  titles.length = 0;
  videoRects.length = 0;
  playerPanels.length = 0;
  testWindow.happyDOM.setURL("tauri://localhost/find");
  Object.defineProperty(window, "__COUCH_NATIVE_HOST__", { configurable: true, value: true });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { metadata: { currentWindow: { label: "main" } }, invoke: async (command: string, args?: { rect?: unknown; title?: string }) => {
    if (command === "set_native_window_title" && args?.title) titles.push(args.title);
    if (command === "set_video_rect") videoRects.push(args?.rect);
    return command === "playback_device" ? { mode: "local", address: null, targets: [], localSetupComplete: true } : undefined;
  } } });
  view = renderUI(<></>);
});

afterEach(async () => {
  Reflect.deleteProperty(window, "__COUCH_NATIVE_HOST__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  fetchSpy = null;
  toast.dismiss();
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

async function render(status: "playing" | "unavailable" | "idle" | "ended", remoteOffline = false, emptyQueue = false, activity?: SessionState["activity"], controllerId?: string, target?: SessionState["targets"], targetId?: string, checkpointStopped = false) {
  const { ShellChrome } = await import("./AppShell");
  const { NativeModeGate } = await import("./PlaybackDevice");
  if (remoteOffline) Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { metadata: { currentWindow: { label: "main" } }, invoke: async (command: string) => command === "playback_device" ? { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: false } : undefined } });
  const state: SessionState = {
    installationName: "Desk Couch", activity, targets: target, targetId: targetId ?? (target ? target[0]?.id ?? "browser:phone" : undefined),
    activeProfile: { id: "household", name: "Household" },
    queue: status === "unavailable" || emptyQueue ? [] : [{ id: "movie", title: "Movie", source: "library:movie" }],
    currentEntryId: status === "playing" || status === "ended" || targetId === "checkpoint" && !checkpointStopped ? "movie" : null,
    player: { playbackId: status === "playing" ? "movie" : null, status, position: 0, duration: null, volume: 50, seekable: false, error: status === "unavailable" ? "Video backend missing" : null },
  };
  const shell = {
    nativeHost: true, localHost: !remoteOffline, tvPresentation: false, credentials: { origin: remoteOffline ? "http://192.168.1.10:4100" : "http://localhost", token: "host" },
    identity: { authority: controllerId ? "controller" : "host", controller: controllerId ? { id: controllerId } : null },
    state, status: remoteOffline ? "server-unavailable" : "connected", statusLabel: remoteOffline ? "Server unavailable" : "Connected", details: { tvPresentation: false },
    connected: !remoteOffline, active: status === "playing", current: status === "playing" || status === "ended" ? state.queue[0] : null,
    available: status !== "unavailable", section: "Find", tv: { browsing: true, controlsVisible: false },
    run: async () => true, reconnect: () => {}, host: null, remoteControlEnabled: false, pairingRequired: false,
    sourcesOpen: false, onlineRequest: null, remoteOpen: false, setRemoteOpen: () => {},
    sectionUrl: () => "/find", recentRadio: [],
    openPlayer: (panel?: "queue") => { playerPanels.push(panel); },
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
  expect(titles).toEqual(["Couch · Desk Couch · Movie"]);
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeDefined();
  expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getAllByRole("link").map(link => link.textContent)).toEqual(["Home", "Find", "Saved", "Settings"]);
});

test("a stopped queue stays reachable on Home", async () => {
  await render("idle");
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "Home" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Up next" })));
  expect(playerPanels).toEqual(["queue"]);
});

test("the header keeps a stopped queue reachable outside Home", async () => {
  await render("idle");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Up next" })));
  expect(playerPanels).toEqual(["queue"]);
  expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getAllByRole("link")).toHaveLength(4);
});

test("the header omits Up next when the queue is empty", async () => {
  await render("idle", false, true);
  expect(screen.queryByRole("button", { name: "Up next" })).toBeNull();
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

test("an ended item keeps Replay accessible in the dock while browsing", async () => {
  await render("ended");
  expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
});

for (const [actorId, controllerId, expected] of [["host", undefined, 0], ["phone", "phone", 0], ["phone", undefined, 1], ["host", "phone", 1]] as const) {
  test(`${controllerId ?? "native host"} only receives activity from other devices (${actorId})`, async () => {
    await render("playing", false, false, { id: "activity", actor: { deviceId: actorId, name: "Living room" }, text: "Living room queued Movie" }, controllerId);
    expect(toast.getToasts()).toHaveLength(expected);
    if (expected) {
      expect(toast.getToasts().at(-1)).toMatchObject({ title: "Living room queued Movie" });
      expect(document.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-x-position", "right");
      expect(document.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-y-position", "bottom");
    }
  });
}

test("browsing names the unavailable renderer instead of the local Core", async () => {
  await render("unavailable", false, false, undefined, undefined, [{ id: "browser:phone", name: "Kitchen phone", kind: "endpoint", backend: "browser", connected: false }]);
  expect(screen.getByText("Player not running on Kitchen phone.")).toBeInTheDocument();
});

test("browsing does not name Core when a disconnected browser disappears from discovery", async () => {
  await render("unavailable", false, false, undefined, undefined, []);
  expect(screen.getByText("Player not running on the selected playback output.")).toBeInTheDocument();
});

test("a restored checkpoint asks for an output without describing a missing player", async () => {
  await render("unavailable", false, false, undefined, undefined, [], "checkpoint");
  expect(screen.getByText("Choose a playback output to resume paused.")).toBeInTheDocument();
  expect(screen.queryByText(/Player not running/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a stopped checkpoint asks for an output without promising resume", async () => {
  await render("unavailable", false, false, undefined, undefined, [], "checkpoint", true);
  expect(screen.getByText("Choose a playback output.")).toBeInTheDocument();
});

test("an uncertain audio group asks for reconnection before transfer", async () => {
  await render("unavailable", false, false, undefined, undefined, [{ id: "rooms", name: "Home speakers", kind: "group", backend: "snapcast", connected: false }], "rooms");
  expect(screen.getByText("Reconnect Home speakers from Playback output before moving playback.")).toBeInTheDocument();
});
