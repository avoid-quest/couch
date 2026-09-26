import { setupUiTests, createTestQueryClient, renderWithQueryClient, act, screen, userEvent, waitFor, within } from "@/testing/react";
import inventories from "../../../../../tests/fixtures/bluetooth-inventories.json";
import type { BluetoothAction, BluetoothState } from "../../../../shared/bluetooth";
import { bluetoothView } from "@/api/settings";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { BluetoothSettings } from "./BluetoothSettings";

setupUiTests();

let request: ReturnType<typeof spyOn>;
beforeEach(() => {
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    if (new URL(String(input)).pathname === "/api/bluetooth") return Response.json({ error: "Allow Couch to use Bluetooth in System Settings on this computer." }, { status: 503 });
    return Response.json({ outputs: [], routing: {} });
  }) as typeof fetch);
});

test("an initial Bluetooth permission error tells the administrator where to enable access", async () => {
  renderWithQueryClient(<BluetoothSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Allow Couch to use Bluetooth in System Settings");
});

test("disconnecting a paired speaker asks for confirmation first", async () => {
  const user = userEvent.setup();
  const actions: string[] = [];
  request.mockImplementation((async (input, init) => {
    if (new URL(String(input)).pathname === "/api/bluetooth") {
      if (init?.method === "POST") actions.push(JSON.parse(String(init.body)).action.op);
      return Response.json({ adapter: "available", operation: null, devices: [{ address: "AA:BB:CC:DD:EE:FF", name: "Speaker", paired: true, connected: true, available: true }] });
    }
    return Response.json({ outputs: [], routing: {} });
  }) as typeof fetch);
  renderWithQueryClient(<BluetoothSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />);
  await user.click(await screen.findByRole("button", { name: "Disconnect Speaker" }));
  expect(actions).toEqual([]);
  const dialog = screen.getByRole("alertdialog", { name: "Disconnect Speaker?" });
  await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
  await waitFor(() => expect(actions).toEqual(["disconnect"]));
});

async function inventoryView(state: BluetoothState) {
  const actions: BluetoothAction[] = [];
  request.mockImplementation((async (input, init) => {
    if (new URL(String(input)).pathname === "/api/bluetooth") {
      if (init?.method === "POST") actions.push(JSON.parse(String(init.body)).action);
      return Response.json(state);
    }
    return Response.json({ outputs: [], routing: {} });
  }) as typeof fetch);
  const client = createTestQueryClient();
  const user = userEvent.setup();
  renderWithQueryClient(<BluetoothSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />, client);
  if (state.adapter === "absent" || state.adapter === "blocked") await screen.findByRole("alert");
  else await screen.findByRole("button", { name: state.adapter === "off" ? "Turn on" : "Search" });
  return { actions, client, user };
}

const platformState = (platform: keyof typeof inventories): BluetoothState => structuredClone(inventories[platform]) as BluetoothState;

test("Mac power guidance precedes any mutation while Bluetooth is off", async () => {
  const state = { ...platformState("macos"), adapter: "off" as const };
  const { actions, user } = await inventoryView(state);
  expect(screen.getByText(/Couch can't yet turn on Bluetooth on macOS/)).toHaveTextContent("the computer running Couch");
  const power = screen.getByRole("button", { name: "Turn on" });
  expect(power).toBeDisabled();
  await user.click(power);
  expect(actions).toEqual([]);
});

test("Mac Forget is guidance-only while Connect and Disconnect stay supported", async () => {
  const { actions, user } = await inventoryView(platformState("macos"));
  expect(screen.getAllByText(/Couch can't yet forget devices on macOS/)).toHaveLength(2);
  const forget = screen.getByRole("button", { name: "Forget Speaker" });
  expect(forget).toBeDisabled();
  await user.click(forget);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(actions).toEqual([]);
  expect(screen.getByRole("button", { name: "Disconnect Speaker" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Connect Headphones" }));
  await waitFor(() => expect(actions.map(action => action.op)).toEqual(["connect"]));
});

test("Windows connection guidance prevents mutations and destructive confirmations but preserves Forget", async () => {
  const { actions, user } = await inventoryView(platformState("windows"));
  expect(screen.getByText(/Couch can't yet connect paired devices on Windows/)).toHaveTextContent("the computer running Couch");
  expect(screen.getByText(/Couch can't yet disconnect devices on Windows/)).toHaveTextContent("the computer running Couch");
  for (const name of ["Connect Headphones", "Disconnect Speaker"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled();
    await user.click(button);
  }
  expect(actions).toEqual([]);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Forget Speaker" }));
  expect(actions).toEqual([]);
  await user.click(within(screen.getByRole("alertdialog", { name: "Forget Speaker?" })).getByRole("button", { name: "Forget" }));
  await waitFor(() => expect(actions.map(action => action.op)).toEqual(["forget"]));
});

test("Windows explains playback-desktop consent before starting supported pairing", async () => {
  const { actions, user } = await inventoryView(platformState("windows"));
  expect(screen.getByText(/Pairing needs your confirmation/)).toHaveTextContent("the computer running Couch");
  expect(screen.getByText(/Cancelling in Couch may not dismiss that prompt/)).toBeInTheDocument();
  expect(actions).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Connect New speaker" }));
  await waitFor(() => expect(actions.map(action => [action.op, action.device])).toEqual([["pair", "AA:BB:CC:DD:EE:03"]]));
});

for (const platform of ["linux", "legacy"] as const) {
  test(`${platform} preserves power, pairing, connect and confirmation behavior`, async () => {
    const state = platformState("linux");
    if (platform === "legacy") delete state.support;
    state.adapter = "off";
    const { actions, client, user } = await inventoryView(state);
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(actions.map(action => action.op)).toEqual(["power"]));
    state.adapter = "available";
    await act(async () => client.invalidateQueries({ queryKey: ["bluetooth"] }));
    for (const name of ["Connect New speaker", "Connect Headphones"]) {
      const button = await screen.findByRole("button", { name });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);
    }
    for (const op of ["Disconnect", "Forget"]) {
      const button = screen.getByRole("button", { name: `${op} Speaker` });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);
      const before = actions.length;
      await user.click(within(screen.getByRole("alertdialog", { name: `${op} Speaker?` })).getByRole("button", { name: op }));
      await waitFor(() => expect(actions).toHaveLength(before + 1));
    }
    expect(actions.map(action => action.op)).toEqual(["power", "pair", "connect", "disconnect", "forget"]);
  });
}

test("refreshed support closes an already-open confirmation without dispatching", async () => {
  const { actions, client, user } = await inventoryView(platformState("linux"));
  await user.click(screen.getByRole("button", { name: "Disconnect Speaker" }));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  await act(async () => { client.setQueryData(["bluetooth"], bluetoothView(null, platformState("windows"))); });
  await waitFor(() => expect(screen.queryByRole("alertdialog") === null).toBe(true));
  expect(actions).toEqual([]);
});

test("a competing operation keeps supported actions disabled and cannot be cancelled by this remote", async () => {
  const state = platformState("linux");
  state.operation = { id: "foreign", kind: "pair", device: state.devices[2]!.address, status: "running", endsAt: Date.now() + 60_000, prompt: null, message: null };
  const { actions } = await inventoryView(state);
  expect(screen.getByText("Another remote is using Bluetooth.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect Headphones" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  expect(actions).toEqual([]);
});

for (const adapter of ["absent", "blocked"] as const) {
  test(`${adapter} hardware remains distinct from operation support`, async () => {
    const { actions } = await inventoryView({ ...platformState("windows"), adapter });
    expect(screen.getByRole("alert")).toHaveTextContent(adapter === "absent" ? "No Bluetooth adapter found" : "Bluetooth is blocked");
    expect(screen.queryByRole("button", { name: "Connect Headphones" })).not.toBeInTheDocument();
    expect(actions).toEqual([]);
  });
}

test("runtime operation failure remains visible alongside adapter guidance", async () => {
  const state = platformState("windows");
  state.operation = { id: "failed", kind: "pair", device: state.devices[2]!.address, status: "error", endsAt: 0, prompt: null, message: "Windows Bluetooth pair ended with code 5." };
  await inventoryView(state);
  expect(screen.getByRole("status")).toHaveTextContent("Windows Bluetooth pair ended with code 5.");
  expect(screen.getByText(/Couch can't yet connect paired devices on Windows/)).toBeInTheDocument();
});
