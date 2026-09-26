import { setupUiTests, act, render, screen, userEvent, testWindow } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as events from "@tauri-apps/api/event";
import type { ServerMessage } from "../../shared/protocol";

setupUiTests();

const originalWebSocket = globalThis.WebSocket;
afterEach(() => { globalThis.WebSocket = originalWebSocket; });

const local = "http://127.0.0.1:4100";
const remote = "http://192.168.1.20:4100";
const requests: Array<{ url: string; authorization: string | null }> = [];
let view: ReturnType<typeof render>, gate: ReturnType<typeof import("./session-context").useSessionGate>;
let device: NonNullable<ReturnType<typeof import("../sections/shell/PlaybackDevice").usePlaybackDevice>>;
let clock: import("./playback-clock").PlaybackClock;
let installation = "remote-installation";
let remoteRole: "controller" | "administrator" = "controller";
let remoteProtocol = 1;
let mode: "local" | "remote" = "local";
let invokeSpy: ReturnType<typeof spyOn>;

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: MessageEvent<string>) => void;
  onclose?: (event: CloseEvent) => void;
  onerror?: () => void;
  constructor(readonly url: URL) { Socket.instances.push(this); }
  send() {}
  emit(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code } as CloseEvent); }
}

// The pair form submits exactly this request, then saves its result.
async function pairWith(code: string) {
  const { requestPairing } = await import("../sections/shell/PairForm");
  await act(async () => gate.savePairing(await requestPairing(gate.pairingOrigin, code, "My remote")));
}

async function renderGate() {
  const { NativeModeGate, DeviceRecovery, usePlaybackDevice } = await import("../sections/shell/PlaybackDevice");
  const { usePlaybackClock } = await import("./playback-clock");
  const { SessionGate, useSessionGate } = await import("./session-context");
  function Probe() {
    clock = usePlaybackClock();
    gate = useSessionGate(); device = usePlaybackDevice()!;
    return <><output aria-label="Session">{device.mode}: {gate.status}: {gate.identity?.authority ?? "none"}</output><DeviceRecovery /></>;
  }
  await act(async () => { view = render(<NativeModeGate><SessionGate><Probe /></SessionGate></NativeModeGate>); });
}

beforeEach(async () => {
  installation = "remote-installation";
  remoteRole = "controller";
  remoteProtocol = 1;
  mode = "local";
  testWindow.happyDOM.setURL("http://tauri.localhost");
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  requests.length = Socket.instances.length = 0;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  invokeSpy = spyOn(core, "invoke").mockImplementation(async <T,>(command: string, args?: core.InvokeArgs): Promise<T> => {
    if (command === "retry_playback_device" && mode === "remote" && remoteProtocol !== 1) throw new Error("incompatible desktop client protocol");
    if (command === "playback_device" || command === "retry_playback_device") return { mode, address: remote, targets: [remote], localSetupComplete: true } as T;
    if (command === "select_playback_device") { mode = (args as { mode: typeof mode }).mode; return { mode, address: remote, targets: [remote], localSetupComplete: true } as T; }
    if (command === "connection_info") return { origin: local, token: "local-owner", pairingCode: "", urls: [] } as T;
    return undefined as T;
  });
  spyOn(events, "listen").mockResolvedValue(() => {});
  spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), authorization = new Headers(init?.headers).get("Authorization");
    requests.push({ url, authorization });
    const selected = new URL(url);
    if (selected.pathname === "/api/connection") return Response.json({ name: selected.origin === local ? "This computer" : "Other Couch", installationId: selected.origin === local ? "local-installation" : installation, urls: [selected.origin], player: "idle", remoteControlEnabled: true, desktopClientProtocol: selected.origin === local ? 1 : remoteProtocol });
    if (selected.pathname === "/api/controllers/me") return Response.json(selected.origin === local ? { authority: "host", controller: null, claimAvailable: false } : { authority: remoteRole, controller: { id: "paired", name: "Desktop client", role: remoteRole }, claimAvailable: false });
    if (selected.pathname === "/api/pair") return Response.json({ token: "remote-pairing", installationId: installation });
    if (selected.pathname === "/api/maintenance/frontend" || selected.pathname === "/api/activity") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch);
  await renderGate();
});

test("switching playback targets never sends local owner credentials to a selected host", async () => {
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("local: connecting");
  await act(async () => { await device.choose("remote", remote); });
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("remote: pairing-required");
  expect(requests.filter(request => request.url.startsWith(remote)).every(request => request.authorization === null)).toBe(true);
  await pairWith("123456");
  expect(Socket.instances.at(-1)?.url.origin).toBe("ws://192.168.1.20:4100");
  expect(Socket.instances.at(-1)?.url.searchParams.get("token")).toBe("remote-pairing");
  expect(Socket.instances.at(-1)?.url.searchParams.get("clientProtocol")).toBe("1");
  expect(Socket.instances.at(-1)?.url.searchParams.has("build")).toBe(false);
  expect(requests.filter(request => request.url.startsWith(remote) && request.authorization !== null).every(request => request.authorization === "Bearer remote-pairing")).toBe(true);
  expect(JSON.parse(localStorage.getItem(`couch.pairing:${remote}`)!)).toEqual({ token: "remote-pairing", installationId: installation });
  await act(async () => { await device.choose("local"); });
  expect(gate.credentials).toMatchObject({ origin: local, token: "local-owner" });
  await act(async () => { await device.choose("remote", remote); });
  expect(gate.credentials).toMatchObject({ origin: remote, token: "remote-pairing" });
  installation = "replacement-installation";
  await act(async () => { await device.choose("local"); });
  await act(async () => { await device.choose("remote", remote); });
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("remote: pairing-required");
  expect(requests.filter(request => request.url.startsWith(remote) && request.authorization === "Bearer remote-pairing").length).toBeGreaterThan(0);
  const lastDiscovery = requests.findLast(request => request.url === `${remote}/api/connection`)!;
  expect(lastDiscovery.authorization).toBeNull();
});

test("revoking the selected host's pairing keeps local owner authority isolated", async () => {
  await act(async () => { await device.choose("remote", remote); });
  await pairWith("123456");
  await act(async () => Socket.instances.at(-1)?.close(4001));
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("remote: pairing-required: none");
  expect(requests.filter(request => request.url.startsWith(remote)).every(request => request.authorization !== "Bearer local-owner")).toBe(true);
  await act(async () => { await device.choose("local"); });
  expect(gate.credentials).toMatchObject({ origin: local, token: "local-owner" });
});

test("remote administrator authority comes from the selected host", async () => {
  remoteRole = "administrator";
  await act(async () => { await device.choose("remote", remote); });
  await pairWith("123456");
  expect(gate.identity?.authority).toBe("administrator");
  expect(gate.identity?.controller?.role).toBe("administrator");
  expect(requests.filter(request => request.url.startsWith(remote)).every(request => request.authorization !== "Bearer local-owner")).toBe(true);
  await act(async () => { await device.choose("local"); });
  expect(gate.identity?.authority).toBe("host");
});

test("a restart reloads the selected host and its paired authority", async () => {
  remoteRole = "administrator";
  await act(async () => { await device.choose("remote", remote); });
  await pairWith("123456");
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("remote:");
  expect(gate.identity?.authority).toBe("administrator");
  view.unmount();
  requests.length = 0;
  await renderGate();
  expect(invokeSpy.mock.calls.filter(([command]: [string]) => command === "playback_device")).toHaveLength(2);
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("remote:");
  expect(gate.credentials).toMatchObject({ origin: remote, token: "remote-pairing", installationId: installation });
  expect(gate.identity?.authority).toBe("administrator");
  expect(requests.filter(request => request.url.startsWith(remote)).every(request => request.authorization !== "Bearer local-owner")).toBe(true);
});

test("Retry reconnects the bundled session after an incompatible host upgrades", async () => {
  remoteProtocol = 2;
  await act(async () => { await device.choose("remote", remote); });
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("remote: protocol-mismatch");
  remoteProtocol = 1;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("status", { name: "Session" }).textContent).toContain("remote: pairing-required");
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});


test("switching native targets clears the old clock before another host sends its baseline", async () => {
  const localSocket = Socket.instances.at(-1)!;
  const state = { queue: [], currentEntryId: null, activeProfile: { id: "household", name: "Household" }, player: { playbackId: "local-playback", status: "playing" as const, position: 200, duration: 600, volume: 80, seekable: true, error: null } };
  await act(async () => localSocket.emit({ type: "state", state }));
  expect(clock.position).toBe(200);
  const retired = localSocket.onmessage!;
  await act(async () => { await device.choose("remote", remote); });
  expect(clock).toEqual({ playbackId: null, position: 0, duration: null });
  expect(gate.state).toBeNull();
  await pairWith("123456");
  await act(async () => retired({ data: JSON.stringify({ type: "state", state }) } as MessageEvent<string>));
  expect(clock.position).toBe(0);
  await act(async () => Socket.instances.at(-1)!.emit({ type: "state", state: { ...state, player: { ...state.player, playbackId: "remote-playback", position: 15 } } }));
  expect(clock).toEqual({ playbackId: "remote-playback", position: 15, duration: 600 });
});
