import { renderWithQueryClient, screen, setupUiTests, userEvent, waitFor } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import type { SendspinHostingState } from "../../../../shared/sendspin";
import { SendspinHostingSettings } from "./SendspinHostingSettings";

setupUiTests();

const credentials = { origin: "http://localhost", token: "admin" };
let state: SendspinHostingState;
let readError = false;
let writeError = false;
const writes: boolean[] = [];
const hostingSwitch = () => screen.getByRole("switch", { name: "Host Sendspin" });
const render = (connected = true) => renderWithQueryClient(<SendspinHostingSettings credentials={credentials} connected={connected} />);

beforeEach(() => {
  state = { enabled: false, active: false, restartRequired: false, configuredExternally: false, error: null };
  readError = false;
  writeError = false;
  writes.length = 0;
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin");
    expect(new URL(String(input)).pathname).toBe("/api/settings/sendspin");
    if ((init?.method ?? "GET") === "GET") return readError ? Response.json({ error: "Read failed" }, { status: 503 }) : Response.json(state);
    if (writeError) return Response.json({ error: "Write failed" }, { status: 503 });
    const enabled = JSON.parse(String(init?.body)).enabled;
    writes.push(enabled);
    state = { ...state, enabled, active: enabled, restartRequired: false };
    return Response.json(state);
  }) as typeof fetch);
});

test("saving hosting starts it immediately and disabling stops hosting", async () => {
  const user = userEvent.setup();
  render();
  await waitFor(() => expect(hostingSwitch()).toBeEnabled());
  await user.click(hostingSwitch());
  await waitFor(() => expect(hostingSwitch()).toBeChecked());
  expect(screen.getByText("Hosting is active.")).toBeInTheDocument();
  expect(writes).toEqual([true]);
  state = { ...state, active: true, restartRequired: false };
  await user.click(hostingSwitch());
  await waitFor(() => expect(hostingSwitch()).not.toBeChecked());
  expect(screen.getByText("Hosting is off.")).toBeInTheDocument();
  expect(writes).toEqual([true, false]);
});

test("a read failure offers retry and a write failure keeps the saved state", async () => {
  const user = userEvent.setup();
  readError = true;
  render();
  expect(await screen.findByText("Read failed")).toBeInTheDocument();
  expect(hostingSwitch()).toBeDisabled();
  readError = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(hostingSwitch()).toBeEnabled());
  writeError = true;
  await user.click(hostingSwitch());
  expect(await screen.findByText("Write failed")).toBeInTheDocument();
  expect(hostingSwitch()).not.toBeChecked();
  expect(writes).toEqual([]);
});

test("offline hosting cannot be changed", async () => {
  render(false);
  expect(hostingSwitch()).toBeDisabled();
  expect(writes).toEqual([]);
});

test("external configuration remains available to disable and startup failure is shown", async () => {
  state = { enabled: true, active: false, restartRequired: false, configuredExternally: true, error: "Could not start Sendspin" };
  render();
  expect(await screen.findByText("Could not start Sendspin")).toBeInTheDocument();
  expect(screen.getByText("Existing Sendspin configuration supplies the address and name.")).toBeInTheDocument();
  expect(hostingSwitch()).toBeEnabled();
  await userEvent.setup().click(hostingSwitch());
  await waitFor(() => expect(hostingSwitch()).not.toBeChecked());
  expect(writes).toEqual([false]);
});

test("enabling an externally configured host starts it immediately", async () => {
  state = { ...state, configuredExternally: true };
  render();
  await waitFor(() => expect(hostingSwitch()).toBeEnabled());
  await userEvent.setup().click(hostingSwitch());
  expect(await screen.findByText("Hosting is active.")).toBeInTheDocument();
  expect(screen.getByText("Existing Sendspin configuration supplies the address and name.")).toBeInTheDocument();
  expect(writes).toEqual([true]);
});
