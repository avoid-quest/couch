import { setupUiTests, renderWithQueryClient, screen, userEvent, waitFor, within } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { BluetoothSettings } from "./BluetoothSettings";

setupUiTests();

let request: ReturnType<typeof spyOn>;
beforeEach(() => {
  request = spyOn(globalThis, "fetch").mockImplementation((async input => {
    if (new URL(String(input)).pathname === "/api/bluetooth") return Response.json({ error: "Allow Couch to use Bluetooth in System Settings on the playback host." }, { status: 503 });
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
