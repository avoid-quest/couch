import { setupUiTests, act, render, waitFor } from "@/testing/react";
import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as adapter from "./sendspin-renderer";
import * as nativeContext from "./native-context";
import * as core from "@tauri-apps/api/core";
import * as events from "@tauri-apps/api/event";
import { useDeviceAudio } from "./device-audio";

setupUiTests();

const ready = mock((_value: boolean) => {});
const clients: Array<{ config: Parameters<typeof adapter.createSendspinRenderer>[0]; callbacks: Parameters<typeof adapter.createSendspinRenderer>[1]; connect: ReturnType<typeof mock>; unlock: ReturnType<typeof mock>; disconnect: ReturnType<typeof mock> }> = [];
const requests: Array<{ path: string; method: string; body: unknown }> = [];
let device: ReturnType<typeof useDeviceAudio>;
let token = "first";
function Probe({ onReady = ready, name = "Couch browser" }: { onReady?: (value: boolean) => void; name?: string } = {}) {
  device = useDeviceAudio({ credentials: { origin: "http://core.local", token }, rendererTargetId: "browser-target", enabled: true, name, onReady });
  return null;
}

beforeEach(() => {
  token = "first"; ready.mockClear(); clients.length = requests.length = 0;
  spyOn(adapter, "createSendspinRenderer").mockImplementation((config, callbacks) => {
    const instance = { config, callbacks, connect: mock(async () => {}), unlock: mock(async () => {}), disconnect: mock(async () => {}) };
    clients.push(instance);
    return { clientId: "sdk-client", preload: async () => {}, setEnrollment: () => {}, connect: instance.connect,
      unlockFromGesture: instance.unlock, connectFromGesture: instance.connect, disconnect: instance.disconnect,
      setVolume: () => {}, setMuted: () => {}, transport: () => false, openPairingWindow: () => {} };
  });
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(init?.method === "POST"
      ? { url: "ws://core.local/sendspin", serverId: "host", psk: "private" }
      : { available: true, url: "ws://core.local/sendspin", serverId: "host" });
  }) as typeof fetch);
});

test("registers authenticated audio without opening output, then unlocks on Play", async () => {
  render(<Probe />);
  await waitFor(() => expect(device.clientId).toBe("sdk-client"));
  expect(requests).toEqual([
    { path: "/api/sendspin/enrollment", method: "GET", body: null },
    { path: "/api/sendspin/enrollment", method: "POST", body: { clientId: "sdk-client", rendererTargetId: "browser-target" } },
  ]);
  expect(clients[0]!.connect).toHaveBeenCalledTimes(1);
  expect(clients[0]!.unlock).not.toHaveBeenCalled();
  expect(await device.activateFromGesture()).toBe(false);
  expect(clients[0]!.unlock).not.toHaveBeenCalled();
  await act(async () => clients[0]!.callbacks.state({ connected: true, isPlaying: false, volume: 75, muted: false, metadata: undefined, group: {}, supportedCommands: [] }));
  expect(device.connected).toBe(true);
  await act(async () => expect(await device.activateFromGesture()).toBe(true));
  expect(clients[0]!.unlock).toHaveBeenCalledTimes(1);
  expect(device.audioReady).toBe(true);
  expect(ready).toHaveBeenCalledWith(true);
  await act(async () => clients[0]!.callbacks.state({ connected: false, isPlaying: false, volume: 75, muted: false, metadata: undefined, group: {}, supportedCommands: [] }));
  expect(ready).toHaveBeenLastCalledWith(false);
});

test("credential replacement closes the old registration and fences late observations", async () => {
  const view = render(<Probe />);
  await waitFor(() => expect(device.clientId).toBe("sdk-client"));
  const old = clients[0]!;
  await act(async () => old.callbacks.state({ connected: true, isPlaying: false, volume: 100, muted: false, metadata: undefined, group: {}, supportedCommands: [] }));
  await act(async () => expect(await device.activateFromGesture()).toBe(true));
  token = "second";
  const newOwnerReady = mock((_value: boolean) => {});
  await act(async () => view.rerender(<Probe onReady={newOwnerReady} />));
  await waitFor(() => expect(clients).toHaveLength(2));
  expect(old.disconnect).toHaveBeenCalledTimes(1);
  expect(ready).toHaveBeenLastCalledWith(false);
  expect(newOwnerReady).not.toHaveBeenCalled();
  await act(async () => old.callbacks.state({ connected: true, isPlaying: false, volume: 100, muted: false, metadata: undefined, group: {}, supportedCommands: [] }));
  expect(device.connected).toBe(false);
});

test("Rename keeps the live SDK connection and applies the name on a future enrollment", async () => {
  const view = render(<Probe />);
  await waitFor(() => expect(device.clientId).toBe("sdk-client"));
  await act(async () => view.rerender(<Probe name="Study laptop" />));
  expect(clients).toHaveLength(1);
  expect(clients[0]!.disconnect).not.toHaveBeenCalled();
  token = "second";
  await act(async () => view.rerender(<Probe name="Study laptop" />));
  await waitFor(() => expect(clients).toHaveLength(2));
  expect(clients[1]!.config.name).toBe("Study laptop");
});

test("managed native lease reserves before playback and releases only its owning playback", async () => {
  const native = spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  const listening = spyOn(events, "listen").mockResolvedValue(() => {});
  const ipc = spyOn(core, "invoke").mockImplementation((async (name: string) => name === "native_audio_begin" ? { generation: "lease-one" } : undefined) as typeof core.invoke);
  try {
    render(<Probe />);
    await waitFor(() => expect(device.clientId).toBe("sdk-client"));
    await act(async () => clients[0]!.callbacks.state({ connected: true, isPlaying: false, volume: 75, muted: false, metadata: undefined, group: {}, supportedCommands: [] }));
    await act(async () => expect(await device.activateFromGesture()).toBe(true));
    await act(async () => device.reserve("group-one", "direct-player"));
    expect(ipc).toHaveBeenCalledWith("native_audio_begin", { managed: true, retiringPlaybackId: "direct-player" });
    await act(async () => device.reserve("group-one"));
    expect(ipc.mock.calls.filter(([name]) => name === "native_audio_begin")).toHaveLength(1);
    await act(async () => device.release("other-group"));
    expect(ipc.mock.calls.some(([name]) => name === "native_audio_end")).toBe(false);
    await act(async () => device.release("group-one"));
    expect(ipc).toHaveBeenCalledWith("native_audio_end", { generation: "lease-one" });
    expect(clients[0]!.disconnect).not.toHaveBeenCalled();
  } finally { native.mockRestore(); listening.mockRestore(); ipc.mockRestore(); }
});

test("revoked native output stays fenced until SDK disconnect completes", async () => {
  const native = spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  let revoked!: (event: { payload: string }) => void;
  const listening = spyOn(events, "listen").mockImplementation((async (_name, callback) => { revoked = callback as typeof revoked; return () => {}; }) as typeof events.listen);
  const ipc = spyOn(core, "invoke").mockImplementation((async (name: string) => name === "native_audio_begin" ? { generation: "lease-one" } : undefined) as typeof core.invoke);
  try {
    render(<Probe />);
    await waitFor(() => expect(device.clientId).toBe("sdk-client"));
    await act(async () => clients[0]!.callbacks.state({ connected: true, isPlaying: false, volume: 75, muted: false, metadata: undefined, group: {}, supportedCommands: [] }));
    await act(async () => expect(await device.activateFromGesture()).toBe(true));
    await act(async () => device.reserve("group-one"));
    const drained = Promise.withResolvers<void>();
    clients[0]!.disconnect.mockImplementation(() => drained.promise);
    await act(async () => revoked({ payload: "lease-one" }));
    await waitFor(() => expect(clients[0]!.disconnect).toHaveBeenCalledTimes(1));
    expect(ipc.mock.calls.some(([name]) => name === "native_audio_end")).toBe(false);
    await act(async () => drained.resolve());
    await waitFor(() => expect(ipc).toHaveBeenCalledWith("native_audio_end", { generation: "lease-one" }));
  } finally { native.mockRestore(); listening.mockRestore(); ipc.mockRestore(); }
});

test("failed SDK disconnect cannot release a revoked native output", async () => {
  const native = spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  let revoked!: (event: { payload: string }) => void;
  const listening = spyOn(events, "listen").mockImplementation((async (_name, callback) => { revoked = callback as typeof revoked; return () => {}; }) as typeof events.listen);
  const ipc = spyOn(core, "invoke").mockImplementation((async (name: string) => name === "native_audio_begin" ? { generation: "lease-one" } : undefined) as typeof core.invoke);
  try {
    render(<Probe />);
    await waitFor(() => expect(device.clientId).toBe("sdk-client"));
    await act(async () => clients[0]!.callbacks.state({ connected: true, isPlaying: false, volume: 75, muted: false, metadata: undefined, group: {}, supportedCommands: [] }));
    await act(async () => expect(await device.activateFromGesture()).toBe(true));
    await act(async () => device.reserve("group-one"));
    clients[0]!.disconnect.mockRejectedValue(new Error("SDK could not stop"));
    await act(async () => revoked({ payload: "lease-one" }));
    await waitFor(() => expect(device.error).toContain("Restart Couch"));
    expect(ipc.mock.calls.some(([name]) => name === "native_audio_end")).toBe(false);
    expect(clients).toHaveLength(1);
  } finally { native.mockRestore(); listening.mockRestore(); ipc.mockRestore(); }
});
