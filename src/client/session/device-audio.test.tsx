import { setupUiTests, act, render, waitFor } from "@/testing/react";
import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as adapter from "./sendspin-renderer";
import { useDeviceAudio } from "./device-audio";

setupUiTests();

const ready = mock((_value: boolean) => {});
const clients: Array<{ callbacks: Parameters<typeof adapter.createSendspinRenderer>[1]; connect: ReturnType<typeof mock>; unlock: ReturnType<typeof mock>; disconnect: ReturnType<typeof mock> }> = [];
const requests: Array<{ path: string; method: string; body: unknown }> = [];
let device: ReturnType<typeof useDeviceAudio>;
let token = "first";
function Probe({ onReady = ready }: { onReady?: (value: boolean) => void } = {}) {
  device = useDeviceAudio({ credentials: { origin: "http://core.local", token }, rendererTargetId: "browser-target", enabled: true, name: "Couch browser", onReady });
  return null;
}

beforeEach(() => {
  token = "first"; ready.mockClear(); clients.length = requests.length = 0;
  spyOn(adapter, "createSendspinRenderer").mockImplementation((_config, callbacks) => {
    const instance = { callbacks, connect: mock(async () => {}), unlock: mock(async () => {}), disconnect: mock(async () => {}) };
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
