import inventories from "../../../../../tests/fixtures/bluetooth-inventories.json";
import type { BluetoothState } from "../../../../shared/bluetooth";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { fireEvent, screen, within } from "../../../testing";

let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  spyOn(globalThis, "fetch").mockImplementation((async input => {
    if (new URL(String(input)).pathname === "/api/bluetooth") return Response.json({ error: "Allow Couch to use Bluetooth in System Settings on the playback host." }, { status: 503 });
    return Response.json({ outputs: [], routing: {} });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await Bun.sleep(0);
  (globalThis.fetch as ReturnType<typeof spyOn>).mockRestore();
  window.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("an initial Bluetooth permission error tells the administrator where to enable access", async () => {
  const { BluetoothSettings } = await import("./BluetoothSettings");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BluetoothSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />
  </QueryClientProvider>));
  await act(async () => { await Bun.sleep(20); });
  expect(screen.getByRole("alert").textContent).toContain("Allow Couch to use Bluetooth in System Settings");
});

test("disconnecting a paired speaker asks for confirmation first", async () => {
  const actions: string[] = [];
  (globalThis.fetch as ReturnType<typeof spyOn>).mockImplementation((async (input, init) => {
    if (new URL(String(input)).pathname === "/api/bluetooth") {
      if (init?.method === "POST") actions.push(JSON.parse(String(init.body)).action.op);
      return Response.json({ adapter: "available", operation: null, devices: [{ address: "AA:BB:CC:DD:EE:FF", name: "Speaker", paired: true, connected: true, available: true }] });
    }
    return Response.json({ outputs: [], routing: {} });
  }) as typeof fetch);
  const { BluetoothSettings } = await import("./BluetoothSettings");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BluetoothSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />
  </QueryClientProvider>));
  await act(async () => { await Bun.sleep(20); });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Disconnect Speaker" })));
  expect(actions).toEqual([]);
  const dialog = screen.getByRole("alertdialog", { name: "Disconnect Speaker?" });
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" })));
  expect(actions).toEqual(["disconnect"]);
});

async function inventoryView(state: BluetoothState) {
  const actions: import("../../../../shared/bluetooth").BluetoothAction[] = [];
  (globalThis.fetch as ReturnType<typeof spyOn>).mockImplementation((async (input, init) => {
    if (new URL(String(input)).pathname === "/api/bluetooth") {
      if (init?.method === "POST") actions.push(JSON.parse(String(init.body)).action);
      return Response.json(state);
    }
    return Response.json({ outputs: [], routing: {} });
  }) as typeof fetch);
  const { BluetoothSettings } = await import("./BluetoothSettings");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}>
    <BluetoothSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />
  </QueryClientProvider>));
  await act(async () => { await Bun.sleep(20); });
  return { actions, client };
}

const platformState = (platform: keyof typeof inventories): BluetoothState => structuredClone(inventories[platform]) as BluetoothState;

test("Mac power guidance precedes any mutation while Bluetooth is off", async () => {
  const state = { ...platformState("macos"), adapter: "off" as const };
  const { actions } = await inventoryView(state);
  expect(screen.getByText(/current macOS Bluetooth adapter cannot turn Bluetooth on/).textContent).toContain("playback host");
  const power = screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement;
  expect(power.disabled).toBe(true);
  await act(async () => fireEvent.click(power));
  expect(actions).toEqual([]);
});

test("Mac Forget is guidance-only while Connect and Disconnect stay supported", async () => {
  const { actions } = await inventoryView(platformState("macos"));
  expect(screen.getAllByText(/current macOS Bluetooth adapter cannot forget devices/)).toHaveLength(2);
  const forget = screen.getByRole("button", { name: "Forget Speaker" }) as HTMLButtonElement;
  expect(forget.disabled).toBe(true);
  await act(async () => fireEvent.click(forget));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(actions).toEqual([]);
  expect((screen.getByRole("button", { name: "Disconnect Speaker" }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect Headphones" })));
  expect(actions.map(action => action.op)).toEqual(["connect"]);
});

test("Windows connection guidance prevents mutations and destructive confirmations but preserves Forget", async () => {
  const { actions } = await inventoryView(platformState("windows"));
  expect(screen.getByText(/current Windows Bluetooth adapter cannot connect paired devices/).textContent).toContain("playback host");
  expect(screen.getByText(/current Windows Bluetooth adapter cannot disconnect devices/).textContent).toContain("playback host");
  for (const name of ["Connect Headphones", "Disconnect Speaker"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => fireEvent.click(button));
  }
  expect(actions).toEqual([]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Forget Speaker" })));
  expect(actions).toEqual([]);
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog", { name: "Forget Speaker?" })).getByRole("button", { name: "Forget" })));
  expect(actions.map(action => action.op)).toEqual(["forget"]);
});

test("Windows explains playback-desktop consent before starting supported pairing", async () => {
  const { actions } = await inventoryView(platformState("windows"));
  expect(screen.getByText(/Pairing requires consent in the local Windows prompt/).textContent).toContain("playback host's desktop");
  expect(screen.getByText(/Cancelling in Couch may not dismiss that prompt/)).toBeTruthy();
  expect(actions).toEqual([]);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect New speaker" })));
  expect(actions.map(action => [action.op, action.device])).toEqual([["pair", "AA:BB:CC:DD:EE:03"]]);
});

for (const platform of ["linux", "legacy"] as const) {
  test(`${platform} preserves power, pairing, connect and confirmation behavior`, async () => {
    const state = platformState("linux");
    if (platform === "legacy") delete state.support;
    state.adapter = "off";
    const { actions, client } = await inventoryView(state);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Turn on" })));
    state.adapter = "available";
    await act(async () => client.invalidateQueries({ queryKey: ["bluetooth"] }));
    await act(async () => { await Bun.sleep(20); });
    for (const name of ["Connect New speaker", "Connect Headphones"]) {
      await act(async () => fireEvent.click(screen.getByRole("button", { name })));
      await act(async () => { await Bun.sleep(20); });
    }
    for (const op of ["Disconnect", "Forget"]) {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: `${op} Speaker` })));
      const before = actions.length;
      await act(async () => fireEvent.click(within(screen.getByRole("alertdialog", { name: `${op} Speaker?` })).getByRole("button", { name: op })));
      expect(actions.length).toBe(before + 1);
      await act(async () => { await Bun.sleep(20); });
    }
    expect(actions.map(action => action.op)).toEqual(["power", "pair", "connect", "disconnect", "forget"]);
  });
}

test("refreshed support closes an already-open confirmation without dispatching", async () => {
  const state = platformState("linux");
  const { actions, client } = await inventoryView(state);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Disconnect Speaker" })));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  const { bluetoothView } = await import("@/api/settings");
  await act(async () => client.setQueryData(["bluetooth"], bluetoothView(null, platformState("windows"))));
  await act(async () => { await Bun.sleep(20); });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(actions).toEqual([]);
});

test("a competing operation keeps supported actions disabled and cannot be cancelled by this remote", async () => {
  const state = platformState("linux");
  state.operation = { id: "foreign", kind: "pair", device: state.devices[2]!.address, status: "running", endsAt: Date.now() + 60_000, prompt: null, message: null };
  const { actions } = await inventoryView(state);
  expect(screen.getByText("Another remote is using Bluetooth.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Connect Headphones" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(actions).toEqual([]);
});

for (const adapter of ["absent", "blocked"] as const) {
  test(`${adapter} hardware remains distinct from operation support`, async () => {
    const { actions } = await inventoryView({ ...platformState("windows"), adapter });
    expect(screen.getByRole("alert").textContent).toContain(adapter === "absent" ? "No Bluetooth adapter found" : "Bluetooth is blocked");
    expect(screen.queryByRole("button", { name: "Connect Headphones" })).toBeNull();
    expect(actions).toEqual([]);
  });
}

test("runtime operation failure remains visible alongside adapter guidance", async () => {
  const state = platformState("windows");
  state.operation = { id: "failed", kind: "pair", device: state.devices[2]!.address, status: "error", endsAt: 0, prompt: null, message: "Windows Bluetooth pair ended with code 5." };
  await inventoryView(state);
  expect(screen.getByRole("status").textContent).toContain("Windows Bluetooth pair ended with code 5.");
  expect(screen.getByText(/current Windows Bluetooth adapter cannot connect paired devices/)).toBeTruthy();
});
