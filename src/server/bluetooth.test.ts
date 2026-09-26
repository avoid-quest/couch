import inventories from "../../tests/fixtures/bluetooth-inventories.json";
import { bluetoothView } from "../client/api/settings";
import { expect, test } from "bun:test";
import type { ControllerIdentity } from "../shared/controllers";
import type { BluetoothAction, BluetoothState } from "../shared/bluetooth";
import { bluetoothSettings } from "./bluetooth";
import { createNativeBluetooth } from "./bluetooth-native";
import { soundOutputs, soundProfiles } from "./sound-pulse";
import { openStore } from "./store";
const admin = { authority: "administrator", controller: { id: "admin-one" } } as ControllerIdentity;
const state: BluetoothState = { adapter: "available", devices: [], operation: null };
const request = (action?: unknown) => new Request("http://localhost/api/bluetooth", action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) } : {});

test("Bluetooth inventory and mutations require current administration, with a server-owned actor", async () => {
  const calls: BluetoothAction[] = [];
  const invoke = async (action: BluetoothAction) => { calls.push(action); return state; };
  expect((await bluetoothSettings(request(), () => null, invoke)).status).toBe(401);
  expect((await bluetoothSettings(request(), () => ({ ...admin, authority: "controller" }), invoke)).status).toBe(403);
  expect(calls).toEqual([]);
  expect((await bluetoothSettings(request({ op: "scan", owner: "somebody-else" }), () => admin, invoke)).status).toBe(200);
  expect(calls[0]).toEqual({ op: "scan", owner: "admin-one" });
  expect((await bluetoothSettings(request({ op: "scan" }), () => ({ authority: "host", controller: null, claimAvailable: false }), invoke)).status).toBe(200);
  expect(calls[1]).toEqual({ op: "scan", owner: "host" });
  expect((await bluetoothSettings(request({ op: "reconnect", device: "AA:BB:CC:DD:EE:FF" }), () => admin, invoke)).status).toBe(400);
  expect((await bluetoothSettings(request({ op: "pair", device: "../hci0" }), () => admin, invoke)).status).toBe(400);
});

test("revocation during request-body reading prevents mutation and revocation after dispatch cancels the owner", async () => {
  let identity: ControllerIdentity | null = admin;
  const calls: BluetoothAction[] = [];
  const invoke = async (action: BluetoothAction) => { calls.push(action); identity = null; return state; };
  const delayed = new Request("http://localhost/api/bluetooth", { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ start(controller) { queueMicrotask(() => { identity = null; controller.enqueue(new TextEncoder().encode('{"action":{"op":"scan"}}')); controller.close(); }); } }) });
  expect((await bluetoothSettings(delayed, () => identity, invoke)).status).toBe(401);
  expect(calls).toEqual([]);
  identity = admin;
  expect((await bluetoothSettings(request({ op: "pair", device: "AA:BB:CC:DD:EE:FF" }), () => identity, invoke)).status).toBe(401);
  expect(calls).toEqual([{ op: "pair", owner: "admin-one", device: "AA:BB:CC:DD:EE:FF" }, { op: "cancel", owner: "admin-one" }]);
});

test("cancellation crosses the native pipe even while an inventory request is pending", async () => {
  const sent: { id: string; action: BluetoothAction }[] = [];
  const bridge = createNativeBluetooth((id, action) => sent.push({ id, action }));
  const read = bridge.request({ op: "read", owner: "admin" });
  const cancel = bridge.request({ op: "cancel", owner: "admin" });
  expect(sent.map(item => item.action.op)).toEqual(["read", "cancel"]);
  bridge.receive({ requestId: sent[1]!.id, state });
  expect(await cancel).toEqual(state);
  bridge.receive({ requestId: "stale", state });
  bridge.receive({ requestId: sent[0]!.id, state });
  expect(await read).toEqual(state);
  const late = bridge.request({ op: "answer", owner: "admin", answer: "123456" });
  bridge.close();
  expect(late).rejects.toThrow("disconnected");
});

test("A2DP output-only profiles retain exact Bluetooth address; hands-free profiles cannot be selected", () => {
  const card = { index: 7, name: "bluez_card.audio", properties: { "device.string": "AA:BB:CC:DD:EE:FF" }, active_profile: "a2dp-sink-sbc", profiles: {
    "a2dp-sink-sbc": { sinks: 1, sources: 0, available: true },
    "headset-head-unit": { sinks: 1, sources: 1, available: true },
  } };
  const profiles = soundProfiles([card]);
  expect(profiles.map(profile => profile.selectable)).toEqual([true, false]);
  expect(profiles[0]!.bluetoothAddress).toBe("AA:BB:CC:DD:EE:FF");
  expect(soundOutputs([{ index: 8, card: 7, name: "bluez_output.audio" }], [card])[0]!.bluetoothAddress).toBe("AA:BB:CC:DD:EE:FF");
});

test("only the selected output remembers its Bluetooth reconnect identity", () => {
  const store = openStore(":memory:");
  try {
    store.saveAudioOutput("bluez_output.audio", { card: "bluez_card.audio", profile: "a2dp-sink", bluetoothAddress: "AA:BB:CC:DD:EE:FF" });
    expect(store.audioProfile()?.bluetoothAddress).toBe("AA:BB:CC:DD:EE:FF");
    store.saveAudioOutput("hdmi", { card: "alsa_card.tv", profile: "output:hdmi-stereo" });
    expect(store.audioProfile()?.bluetoothAddress).toBeUndefined();
  } finally { store.close(); }
});


for (const platform of ["linux", "macos", "windows"] as const) {
  test(`${platform} inventory support crosses native transport, authorized reads and mutation reconciliation unchanged`, async () => {
    const inventory = structuredClone(inventories[platform]) as BluetoothState;
    const calls: BluetoothAction[] = [];
    const bridge = createNativeBluetooth((requestId, action) => {
      calls.push(action);
      bridge.receive({ requestId, state: inventory });
    });
    try {
      const invoke = (action: BluetoothAction) => bridge.request(action);
      expect((await bluetoothSettings(request(), () => null, invoke)).status).toBe(401);
      expect((await bluetoothSettings(request(), () => ({ ...admin, authority: "controller" }), invoke)).status).toBe(403);
      expect(calls).toEqual([]);
      const read = await (await bluetoothSettings(request(), () => admin, invoke)).json() as BluetoothState;
      expect(read).toEqual(inventory);
      const before = bluetoothView(null, read);
      inventory.devices.reverse();
      inventory.operation = { id: "scan", kind: "scan", status: "running", device: null, endsAt: 60_000, message: null, prompt: null };
      const mutation = await (await bluetoothSettings(request({ op: "scan", owner: "forged" }), () => admin, invoke)).json() as BluetoothState;
      const after = bluetoothView(before, mutation, true);
      expect(after.support).toEqual(inventories[platform].support);
      expect(after.devices.map(device => device.address)).toEqual(before.devices.map(device => device.address));
      expect(after.operation).toEqual(inventory.operation);
      expect(calls.map(action => action.owner)).toEqual(["admin-one", "admin-one"]);
    } finally { bridge.close(); }
  });
}

test("reconciliation replaces support, preserves discovery order and reconciles Forget with old-host fallback", () => {
  const windows = structuredClone(inventories.windows) as BluetoothState;
  const before = bluetoothView(null, windows);
  const oldHost: BluetoothState = { adapter: "available", devices: [...windows.devices].reverse(), operation: null };
  const legacy = bluetoothView(before, oldHost);
  expect(legacy.support).toBeUndefined();
  expect(legacy.devices.map(device => device.address)).toEqual(before.devices.map(device => device.address));
  const mac = bluetoothView(legacy, inventories.macos as BluetoothState);
  expect(mac.support?.connectUnavailableReason).toBeUndefined();
  expect(mac.support?.forgetUnavailableReason).toBeTruthy();
  const forget: BluetoothState = { ...windows, operation: { id: "forget", kind: "forget", device: windows.devices[0]!.address, status: "finished", endsAt: 0, message: null, prompt: null } };
  const after = bluetoothView(before, forget);
  expect(after.support).toEqual(windows.support);
  expect(after.devices.map(device => device.address)).toEqual(before.devices.slice(1).map(device => device.address));
});
