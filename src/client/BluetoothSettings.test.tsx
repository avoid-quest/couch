import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { BluetoothState } from "../shared/bluetooth";
let Component: typeof import("./BluetoothSettings")["BluetoothSettings"];
let root: Root, window: Window, request: ReturnType<typeof spyOn>, state: BluetoothState;
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
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
const render = (connected = true) => act(async () => root.render(<Component credentials={{ origin: "http://localhost", token: "admin" }} connected={connected} />));
test("a remembered disconnected device stays selected separately from its paired and connected status", async () => {
  await render();
  expect(document.body.textContent).toContain("Paired · Disconnected · Selected in Sound");
  expect(document.body.textContent).toContain("Connecting does not select an output or resume playback");
});
test("leaving Bluetooth or losing the remote connection cancels the exact discovery operation", async () => {
  await render();
  await act(async () => click("Find audio devices"));
  expect(document.body.textContent).toContain("Cancel Bluetooth operation");
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
    await act(async () => click("Find audio devices"));
    expect(actions[0]?.op).toBe("scan");
    const token = actions[0]!.token;
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(document.body.textContent).toContain("Finding audio devices");
    await act(async () => click("Cancel Bluetooth operation"));
    expect(actions.at(-1)).toEqual({ op: "cancel", token });
    expect(document.body.textContent).not.toContain("Finding audio devices");
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
});
