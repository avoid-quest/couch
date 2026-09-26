import { setupUiTests, act, renderWithQueryClient, screen, userEvent, waitFor, within } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { useState } from "react";
import type { Controller, ControllerIdentity } from "../../../../shared/controllers";
import { ConnectionsSettings } from "./ConnectionsSettings";

setupUiTests();

const calls: Array<{ path: string; method: string; body: unknown }> = [];
const self: Controller = { id: "self", name: "Browser", role: "administrator", createdAt: 1, lastSeenAt: 2 };
let devices: Controller[];
let sharingFailure = false;
let originDomain = "";
let setSharingFromHost: ((enabled: boolean) => void) | undefined;
const sharingChanges: boolean[] = [];
const button = (label: string) => screen.getByRole("button", { name: label });

async function render(identity: ControllerIdentity = { authority: "administrator", controller: self, claimAvailable: false }, remoteControlEnabled = true) {
  function SettingsHarness() {
    const [sharing, setSharing] = useState(remoteControlEnabled);
    setSharingFromHost = setSharing;
    return <ConnectionsSettings credentials={{ origin: "http://localhost", token: "admin" }} connected
      urls={["http://localhost:4100"]} identity={identity} remoteControlEnabled={sharing} administratorClaimed managedLan />;
  }
  renderWithQueryClient(<SettingsHarness />);
  await screen.findByText("Phone");
}

beforeEach(() => {
  calls.length = 0;
  sharingChanges.length = 0;
  sharingFailure = false;
  originDomain = "";
  setSharingFromHost = undefined;
  devices = [self, { id: "other", name: "Phone", role: "controller", createdAt: 1, lastSeenAt: 2 }];
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin");
    if (path === "/api/controllers/pairing-code") return Response.json({ code: "246810" });
    if (path === "/api/settings/sharing" && method === "POST") {
      if (sharingFailure) return Response.json({ error: "Unavailable" }, { status: 503 });
      // The host's controllers revision push is what refreshes remoteControlEnabled.
      const enabled = JSON.parse(String(init?.body)).enabled;
      sharingChanges.push(enabled);
      queueMicrotask(() => setSharingFromHost?.(enabled));
      return Response.json({ enabled });
    }
    if (path === "/api/settings/origin-domain") {
      if (method === "POST") originDomain = JSON.parse(String(init?.body)).domain;
      return Response.json({ domain: originDomain });
    }
    if (path === "/api/controllers" && method === "GET") return Response.json({ controllers: devices });
    if (/^\/api\/controllers\/other\/role$/.test(path)) {
      const device = devices.find(entry => entry.id === "other")!;
      device.role = (init?.body ? JSON.parse(String(init.body)) : { role: device.role }).role;
      return Response.json({ controller: device });
    }
    if (path === "/api/controllers/other" && method === "DELETE") {
      devices = devices.filter(entry => entry.id !== "other");
      return Response.json({ ok: true });
    }
    return Response.json({ error: `Unexpected ${method} ${path}` }, { status: 404 });
  }) as typeof fetch);
});

test("an administrator opens the pairing dialog, then sees every device with its role", async () => {
  const user = userEvent.setup();
  await render();
  await user.click(button("Pair a remote"));
  await screen.findByRole("img", { name: "Pair another device with code 246810" });
  await user.click(button("Close"));
  expect(screen.getByText("Browser")).toBeInTheDocument();
  expect(screen.getByText("(this remote)")).toBeInTheDocument();
  expect(screen.getByText("Phone")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Remove admin" })).not.toBeInTheDocument();
});

test("the host can change whether this computer accepts remotes", async () => {
  await render({ authority: "host", controller: null, claimAvailable: false }, false);
  expect(button("Pair a remote")).toBeDisabled();
  await userEvent.setup().click(screen.getByRole("switch", { name: "Allow remotes" }));
  await waitFor(() => expect(button("Pair a remote")).toBeEnabled());
  expect(calls).toContainEqual({ path: "/api/settings/sharing", method: "POST", body: { enabled: true } });
  expect(sharingChanges).toEqual([true]);
  expect(screen.getByRole("switch", { name: "Allow remotes" })).toBeChecked();
});

test("an administrator can save a network address", async () => {
  const user = userEvent.setup();
  await render();
  await user.type(screen.getByRole("textbox", { name: "Network address" }), "http://couch.home:4100");
  await user.click(button("Save"));
  await waitFor(() => expect(calls).toContainEqual({ path: "/api/settings/origin-domain", method: "POST", body: { domain: "http://couch.home:4100" } }));
  expect(screen.getByRole("textbox", { name: "Network address" })).toHaveValue("http://couch.home:4100");
});

test("a failed sharing save keeps pairing disabled and reports the error", async () => {
  sharingFailure = true;
  await render({ authority: "host", controller: null, claimAvailable: false }, false);
  await userEvent.setup().click(screen.getByRole("switch", { name: "Allow remotes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(sharingChanges).toEqual([]);
  expect(button("Pair a remote")).toBeDisabled();
});

for (const close of ["Close", "Escape"] as const) test(`${close} restores the Connections pairing opener`, async () => {
  const user = userEvent.setup();
  await render();
  await user.click(button("Pair a remote"));
  await screen.findByRole("img", { name: "Pair another device with code 246810" });
  if (close === "Close") await user.click(button("Close"));
  else await user.keyboard("{Escape}");
  await waitFor(() => expect(button("Pair a remote")).toHaveFocus());
});

test("turning off remote control closes an open pairing dialog", async () => {
  await render({ authority: "host", controller: null, claimAvailable: false });
  await userEvent.setup().click(button("Pair a remote"));
  await screen.findByRole("dialog");
  await act(async () => { setSharingFromHost!(false); });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(button("Pair a remote")).toBeDisabled();
});

test("promoting a controller writes the role and reloads the list", async () => {
  await render();
  await userEvent.setup().click(button("Make admin"));
  await screen.findByRole("button", { name: "Remove admin" });
  expect(calls).toContainEqual({ path: "/api/controllers/other/role", method: "POST", body: { role: "administrator" } });
});

test("removing a device deletes it and drops the row", async () => {
  const user = userEvent.setup();
  await render();
  await user.click(button("Remove"));
  expect(calls.some(call => call.method === "DELETE")).toBe(false);
  await user.click(within(screen.getByRole("alertdialog", { name: "Remove Phone?" })).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByText("Phone")).not.toBeInTheDocument());
  expect(calls).toContainEqual({ path: "/api/controllers/other", method: "DELETE", body: null });
});
