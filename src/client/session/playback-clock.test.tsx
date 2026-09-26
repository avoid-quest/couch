import { setupUiTests, act, render, screen, fireEvent, waitFor } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Profiler } from "react";
import { toast } from "sonner";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { ClientMessage, ServerMessage, SessionState } from "../../shared/protocol";
import { loadedBuild } from "../../shared/build";
import { formatEndTime } from "../time-format";
import type { SessionGateValue } from "./session-context";
import type { ShellValue } from "../sections/shell/AppShell";
import type { PlaybackClock } from "./playback-clock";

setupUiTests();

const originalWebSocket = globalThis.WebSocket;
afterEach(() => { globalThis.WebSocket = originalWebSocket; toast.dismiss(); });

const origin = "http://localhost";
const snapshot: SessionState = {
  queue: [{ id: "one", title: "Current movie", source: "library:one", duration: 600 }, { id: "two", title: "Next movie", source: "library:two", duration: 120 }],
  currentEntryId: "one", queueCursorEntryId: "one", activeProfile: { id: "household", name: "Household" },
  preferences: { profile: { audioLanguage: "en", subtitleLanguage: "en", subtitles: "auto", speed: 1, replayGain: "off" }, device: { audioDelay: 0 } },
  player: { playbackId: "playback", status: "playing", position: 60, duration: 600, volume: 80, seekable: true, error: null, chapters: [{ title: "Opening", position: 0 }, { title: "Second chapter", position: 120 }] },
};
const sockets: Socket[] = [];
const renders = { find: 0, settings: 0, connection: 0 };
let gate: SessionGateValue, shell: ShellValue, clock: PlaybackClock;
let capability: boolean, role: "controller" | "administrator";
const reads: string[] = [];

class Socket {
  static OPEN = 1;
  readyState = 1;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) { sockets.push(this); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  emit(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code } as CloseEvent); }
  confirm() { this.emit({ type: "result", requestId: this.sent.at(-1)!.requestId, ok: true }); }
}
const tick = (position: number, duration = 600) => sockets.at(-1)!.emit({ type: "clock", playbackId: "playback", position, duration });

beforeEach(async () => {
  capability = true; role = "controller";
  sockets.length = reads.length = 0;
  Object.assign(renders, { find: 0, settings: 0, connection: 0 });
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  localStorage.setItem("couch.remote-token", "secret");
  localStorage.setItem("couch.remote-installation-id", "installation");
  spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    reads.push(path);
    if (path === "/api/connection") return Response.json({ name: "Couch", installationId: "installation", urls: [origin], player: "idle", ...(capability ? { playbackClock: 1 } : {}) });
    if (path === "/api/build") return Response.json(loadedBuild);
    if (path === "/api/controllers/me") return Response.json({ authority: role, controller: { id: "remote", name: "Remote", role } });
    if (path === "/api/activity") return new Response(null, { status: 204 });
    if (path.endsWith("/sources")) return Response.json({ sources: [] });
    if (path === "/api/jellyfin") return Response.json({ connected: false });
    if (path === "/api/metadata/provider") return Response.json({ configured: false });
    if (path === "/api/streaming-community") return Response.json({ origin: "" });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
});

async function mount(path = "/find") {
  const { SessionGate, useSessionGate } = await import("./session-context");
  const { AppShell, useShell } = await import("../sections/shell/AppShell");
  const { usePlaybackClock } = await import("./playback-clock");
  const { FindPage } = await import("../sections/find/FindPage");
  const { SettingsPage } = await import("../sections/settings/SettingsPage");
  const { PlaybackTimeline, PlaybackTransport } = await import("../components/PlaybackTransport");
  const { PlaybackSettingsPanel } = await import("../components/PlaybackSettings");
  const { QueuePanel } = await import("../sections/now/QueuePanel");
  function ConnectionProbe() { gate = useSessionGate(); renders.connection++; return null; }
  function ClockProbe() { clock = usePlaybackClock(); return null; }
  function Page({ settings = false }: { settings?: boolean }) {
    shell = useShell();
    const session = useSessionGate();
    return <>
      {settings ? <Profiler id="settings" onRender={() => renders.settings++}><SettingsPage section="sources" /></Profiler>
        : <Profiler id="find" onRender={() => renders.find++}><FindPage /></Profiler>}
      {session.state && <><PlaybackTimeline state={session.state} connected={session.connected} run={session.run} />
        <PlaybackSettingsPanel player={session.state.player} entry={session.state.queue[0]} ready connected credentials={session.credentials!} preferences={session.state.preferences!} profile={session.state.activeProfile} onCommand={session.run} panel="settings" /><PlaybackTransport state={session.state} connected={session.connected} run={session.run} credentials={session.credentials!} /><QueuePanel state={session.state} credentials={session.credentials!} connected={session.connected} available nativeHost={false} defaultQuality="auto" run={session.run} /></>}
    </>;
  }
  const base = createRootRoute({ component: () => <SessionGate><ConnectionProbe /><ClockProbe /><AppShell /></SessionGate> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => <Page /> });
  const settings = createRoute({ getParentRoute: () => base, path: "/settings/sources", component: () => <Page settings /> });
  const router = createRouter({ routeTree: base.addChildren([find, settings]), history: createMemoryHistory({ initialEntries: [path] }) });
  await act(async () => { await router.load(); render(<RouterProvider router={router} />); });
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: snapshot }));
  if (path === "/settings/sources") await waitFor(() => expect(screen.getAllByText("Not set up")).toHaveLength(3));
  return router;
}

test.each(["/find", "/settings/sources"])("real gate and shell keep %s stable while clock consumers advance", async path => {
  await mount(path);
  const before = { ...renders }, initialGate = gate, initialShell = shell;
  expect(gate.state!.player).not.toHaveProperty("position");
  expect(gate.state!.player).not.toHaveProperty("duration");
  const firstQueue = screen.getByRole("list", { name: "Up next" }).textContent;
  for (const position of [90, 120, 180]) await act(async () => tick(position, 660));
  expect(renders).toEqual(before);
  expect(screen.getByRole("radio", { name: /Second chapter/ }).getAttribute("aria-checked")).toBe("true");
  expect(gate).toBe(initialGate);
  expect(shell).toBe(initialShell);
  expect(screen.getByText("3:00")).toBeVisible();
  expect(screen.getByText(`−8:00 ends ${formatEndTime(480)}`)).toBeVisible();
  expect(screen.getByRole("slider", { name: "Playback position" }).getAttribute("aria-valuenow")).toBe("180");
  expect(screen.getByRole("slider", { name: "Playback position" }).getAttribute("aria-valuemax")).toBe("660");
  expect(screen.getByRole("list", { name: "Up next" }).textContent).not.toBe(firstQueue);
  expect(screen.getByRole("list", { name: "Up next" }).textContent).toContain(`starts ${formatEndTime(480)}`);
  expect(screen.getByText(`3:00 / 11:00 · ends ${formatEndTime(480)}`)).toBeVisible();
});

test("relative seeks and Undo capture a clock delivered before React commits", async () => {
  await mount();
  const peer = sockets.at(-1)!;
  await act(async () => {
    tick(135, 600);
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
    expect(peer.sent.at(-1)!.action).toEqual({ type: "seek", playbackId: "playback", position: 145 });
    peer.confirm();
  });
  await act(async () => {
    tick(222, 600);
    const done = gate.run({ type: "stop" });
    peer.emit({ type: "state", state: { ...snapshot, currentEntryId: null, player: { ...snapshot.player, playbackId: null, status: "idle", position: 0, duration: null } } });
    peer.confirm();
    await done;
  });
  expect(clock).toEqual({ playbackId: null, position: 0, duration: null });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(peer.sent.at(-1)!.action).toEqual({ type: "play", entryId: "one" });
    peer.emit({ type: "state", state: { ...snapshot, player: { ...snapshot.player, playbackId: "resumed", position: 0 } } });
    peer.confirm();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(peer.sent.at(-1)!.action).toEqual({ type: "seek", playbackId: "resumed", position: 222 });
    peer.confirm();
  });
});

test("old hosts seed clocks from full snapshots and structural changes reach consumers", async () => {
  capability = false;
  await mount("/settings/sources");
  expect(sockets.at(-1)!.url.searchParams.has("playbackClock")).toBe(false);
  const initialGate = gate, initialShell = shell, before = { ...renders };
  role = "administrator";
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...snapshot, versions: { controllers: 1, library: 1 }, queue: [...snapshot.queue, { id: "three", title: "Third movie", source: "library:three" }], player: { ...snapshot.player, status: "paused", position: 240, duration: 800 } } }));
  await waitFor(() => expect(gate.identity?.authority).toBe("administrator"));
  expect(clock.position).toBe(240);
  expect(clock.duration).toBe(800);
  expect(gate).not.toBe(initialGate); expect(shell).not.toBe(initialShell);
  expect(renders.settings).toBeGreaterThan(before.settings);
  expect(renders.connection).toBeGreaterThan(before.connection);
  expect(gate.state?.player.status).toBe("paused");
  expect(gate.identity?.authority).toBe("administrator");
  expect(screen.getByRole("button", { name: "Play Third movie" })).toBeVisible();
  expect(reads.filter(path => path === "/api/library/sources").length).toBeGreaterThan(1);
});

test("disconnect, reconnect, replacement and unpairing never expose a retired clock", async () => {
  await mount();
  const peer = sockets.at(-1)!, retired = peer.onmessage!;
  await act(async () => tick(350));
  await act(async () => peer.close());
  expect(clock).toEqual({ playbackId: null, position: 0, duration: null });
  await act(async () => gate.reconnect());
  const next = sockets.at(-1)!;
  await act(async () => next.emit({ type: "clock", playbackId: "playback", position: 444, duration: 600 }));
  expect(clock.position).toBe(0);
  await act(async () => next.emit({ type: "state", state: { ...snapshot, player: { ...snapshot.player, position: 80 } } }));
  expect(clock.position).toBe(80);
  await act(async () => next.emit({ type: "state", state: { ...snapshot, currentEntryId: "two", player: { ...snapshot.player, playbackId: "replacement", position: 0, duration: 120 } } }));
  await act(async () => { next.emit({ type: "clock", playbackId: "playback", position: 555, duration: 600 }); retired({ data: JSON.stringify({ type: "state", state: snapshot }) } as MessageEvent<string>); });
  expect(clock).toEqual({ playbackId: "replacement", position: 0, duration: 120 });
  await act(async () => gate.unpair());
  expect(clock).toEqual({ playbackId: null, position: 0, duration: null });
  expect(gate.state).toBeNull();
});
