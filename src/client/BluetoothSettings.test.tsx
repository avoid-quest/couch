import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { BluetoothState } from "../shared/bluetooth";
let Component: typeof import("./BluetoothSettings")["BluetoothSettings"];
let root: Root, window: Window, request: ReturnType<typeof spyOn>, interval: ReturnType<typeof spyOn>, state: BluetoothState;
let poll: () => Promise<void>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const actions: Record<string, string>[] = [];
const click = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === name)!.click();
beforeEach(async () => {
  state = { adapter: "available", operation: null, devices: [{ address: "AA:BB:CC:DD:EE:FF", name: "Audio device", paired: true, connected: false, trusted: true }] };
  actions.length = 0; window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
    if (String(url).endsWith("/sound")) return Response.json({ outputs: [], routing: { selectedBluetoothAddress: "AA:BB:CC:DD:EE:FF" } });
    if (init?.body) {
      const { action } = JSON.parse(String(init.body)); actions.push(action);
      if (action.op === "scan") state.operation = { id: action.token, kind: "scan", device: null, status: "running", endsAt: Date.now() + 30_000, message: null, prompt: null };
      if (action.op === "cancel" && state.operation) state.operation.status = "cancelled";
    }
    return Response.json(state);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ BluetoothSettings: Component } = await import("./BluetoothSettings"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  interval = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => Promise<void>) => { poll = callback; return 0; }) as typeof setInterval);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); interval.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
const render = (connected = true) => act(async () => root.render(<Component credentials={{ origin: "http://localhost", token: "admin" }} connected={connected} />));
test("a remembered disconnected device stays selected separately from its paired and connected status", async () => {
  await render();
  expect(document.body.textContent).toContain("Paired · Disconnected · Selected for sound");
  expect(document.body.textContent).toContain("Connecting does not change your sound output or start playback");
});
test("leaving Bluetooth or losing the remote connection cancels the exact discovery operation", async () => {
  await render();
  await act(async () => click("Search"));
  expect(document.body.textContent).toContain("Stop search");
  const token = actions[0]!.token;
  expect(token).toMatch(/^[0-9a-f-]{36}$/);
  await render(false);
  expect(actions.at(-1)).toEqual({ op: "cancel", token });
});
test("an HTTP remote can start discovery without randomUUID and cancel its exact operation", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    await render();
    await act(async () => click("Search"));
    expect(actions[0]?.op).toBe("scan");
    const token = actions[0]!.token;
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(document.body.textContent).toContain("Searching…");
    await act(async () => click("Stop search"));
    expect(actions.at(-1)).toEqual({ op: "cancel", token });
    expect(document.body.textContent).not.toContain("Searching…");
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
});

test("all discovered devices share one list and can be selected while this remote searches", async () => {
  state.devices.push({ address: "11:22:33:44:55:66", name: "Nearby keyboard", paired: false, connected: false, trusted: false });
  await render();
  expect(document.querySelectorAll('[aria-label="Bluetooth devices"] li').length).toBe(2);
  await act(async () => click("Search"));
  const scanToken = actions[0]!.token;
  const select = document.querySelector<HTMLButtonElement>('[aria-label="Connect Nearby keyboard"]')!;
  expect(select.disabled).toBe(false);
  await act(async () => select.click());
  expect(actions.slice(1).map(action => action.op)).toEqual(["cancel", "pair"]);
  expect(actions[1]).toEqual({ op: "cancel", token: scanToken });
  expect(actions[2]!.device).toBe("11:22:33:44:55:66");
  expect(actions[2]!.token).not.toBe(scanToken);
});
test("another remote's search cannot be cancelled by choosing a result", async () => {
  state.operation = { id: "someone-else", kind: "scan", device: null, status: "running", endsAt: Date.now() + 30_000, message: null, prompt: null };
  await render();
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Connect Audio device"]')!.disabled).toBe(true);
  expect(document.body.textContent).not.toContain("Stop search");
});


test("polls append new Bluetooth results without moving the focused device and retain expired rows", async () => {
  const speaker = { address: "11:22:33:44:55:66", name: "C39S", paired: false, connected: false, trusted: false };
  state.devices.push(speaker);
  await render();
  const list = document.querySelector('[aria-label="Bluetooth devices"]')!;
  const rows = () => [...list.querySelectorAll("li")].map(row => row.querySelector("p")!.textContent);
  const select = document.querySelector<HTMLButtonElement>('[aria-label="Connect C39S"]')!;
  select.focus();
  state.devices = [speaker, { address: "22:33:44:55:66:77", name: "New headphones", paired: false, connected: false, trusted: false }, state.devices[0]!];
  await act(async () => poll());
  expect(rows()).toEqual(["Audio device", "C39S", "New headphones"]);
  expect(document.activeElement).toBe(select);
  expect(document.querySelector('[aria-label="Connect C39S"]')).toBe(select);
  await act(async () => select.click());
  expect(actions.at(-1)).toMatchObject({ op: "pair", device: speaker.address });
  state.devices = state.devices.filter(device => device.address !== speaker.address);
  await act(async () => poll());
  expect(rows()).toEqual(["Audio device", "C39S", "New headphones"]);
  expect(select.disabled).toBe(true);
  expect(select.closest("li")!.textContent).toContain("Not currently available");
  state.devices = [speaker, ...state.devices];
  await act(async () => poll());
  expect(document.querySelector('[aria-label="Connect C39S"]')).toBe(select);
  expect(select.disabled).toBe(false);
  expect(rows()).toEqual(["Audio device", "C39S", "New headphones"]);
});


test("only an explicit new search clears expired unpaired results and preserves paired rows", async () => {
  state.devices.push({ address: "11:22:33:44:55:66", name: "C39S", paired: false, connected: false, trusted: false });
  await render();
  state.devices = [];
  await act(async () => poll());
  expect(document.querySelectorAll('[aria-label="Bluetooth devices"] li').length).toBe(2);
  await act(async () => click("Search"));
  expect(document.querySelectorAll('[aria-label="Bluetooth devices"] li').length).toBe(1);
  expect(document.querySelector('[aria-label="Connect Audio device"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Connect C39S"]')).toBeNull();
});

test("successful Forget removes the retained row without hiding a later rediscovery", async () => {
  await render();
  await act(async () => click("Forget"));
  const device = state.devices[0]!;
  state.devices = [];
  state.operation = { id: actions.at(-1)!.token!, kind: "forget", device: device.address, status: "finished", endsAt: Date.now(), message: null, prompt: null };
  await act(async () => poll());
  expect(document.querySelectorAll('[aria-label="Bluetooth devices"] li').length).toBe(0);
  state.devices = [{ ...device, paired: false, trusted: false }];
  await act(async () => poll());
  expect(document.querySelector('[aria-label="Connect Audio device"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Forget Audio device"]')).toBeNull();
});

test("changing TV origin clears the previous TV's discovery results", async () => {
  await render();
  state.devices = [];
  await act(async () => root.render(<Component credentials={{ origin: "http://another-tv", token: "admin" }} connected />));
  expect(document.querySelectorAll('[aria-label="Bluetooth devices"] li').length).toBe(0);
});
