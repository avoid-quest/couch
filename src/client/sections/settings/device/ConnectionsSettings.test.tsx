import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import type { Controller, ControllerIdentity } from "../../../../shared/controllers";
import { fireEvent, screen, within } from "../../../testing";

let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; method: string; body: unknown }> = [];
const self: Controller = { id: "self", name: "Browser", role: "administrator", createdAt: 1, lastSeenAt: 2 };
let devices: Controller[];
let sharingFailure = false;
let originDomain = "";
let setSharingFromHost: ((enabled: boolean) => void) | undefined;
const sharingChanges: boolean[] = [];
const button = (label: string) => screen.getByRole("button", { name: label });
const flush = () => act(async () => { await Bun.sleep(20); });

async function render(identity: ControllerIdentity = { authority: "administrator", controller: self, claimAvailable: false }, remoteControlEnabled = true) {
  const { ConnectionsSettings } = await import("./ConnectionsSettings");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  function SettingsHarness() {
    const [sharing, setSharing] = useState(remoteControlEnabled);
    setSharingFromHost = setSharing;
    return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConnectionsSettings credentials={{ origin: "http://localhost", token: "admin" }} connected
        urls={["http://localhost:4100"]} identity={identity} remoteControlEnabled={sharing} setRemoteControlEnabled={enabled => { sharingChanges.push(enabled); setSharing(enabled); }} administratorClaimed managedLan />
      </QueryClientProvider>;
  }
  await act(async () => root.render(<SettingsHarness />));
  await flush();
}

beforeEach(async () => {
  calls.length = 0;
  sharingChanges.length = 0;
  sharingFailure = false;
  originDomain = "";
  setSharingFromHost = undefined;
  devices = [self, { id: "other", name: "Phone", role: "controller", createdAt: 1, lastSeenAt: 2 }];
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin");
    if (path === "/api/controllers/pairing-code") return Response.json({ code: "246810" });
    if (path === "/api/settings/sharing" && method === "POST") return sharingFailure ? Response.json({ error: "Unavailable" }, { status: 503 }) : Response.json({ enabled: JSON.parse(String(init?.body)).enabled });
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
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  (globalThis.fetch as ReturnType<typeof spyOn>).mockRestore();
  window.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("an administrator opens the pairing dialog, then sees every device with its role", async () => {
  await render();
  await act(async () => { fireEvent.click(button("Pair a remote")); });
  await flush();
  expect(screen.getByRole("img", { name: "Pair another device with code 246810" })).toBeDefined();
  await act(async () => { fireEvent.click(button("Close")); });
  expect(screen.getByText("Browser")).toBeDefined();
  expect(screen.getByText("(this device)")).toBeDefined();
  expect(screen.getByText("Phone")).toBeDefined();
  expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  expect(within(screen.getByText("(this device)").closest("li")!).queryAllByRole("button")).toHaveLength(0);
});

test("the host can change whether this computer accepts remotes", async () => {
  await render({ authority: "host", controller: null, claimAvailable: false }, false);
  expect(button("Pair a remote").disabled).toBe(true);
  expect(screen.getByText("Turn on remote control before pairing a device.")).toBeDefined();
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Allow remote control" })); });
  await flush();
  const write = calls.find(call => call.path === "/api/settings/sharing")!;
  expect(write.method).toBe("POST");
  expect(write.body).toEqual({ enabled: true });
  expect(sharingChanges).toEqual([true]);
  expect(screen.getByRole("switch", { name: "Allow remote control" }).getAttribute("aria-checked")).toBe("true");
  expect(button("Pair a remote").disabled).toBe(false);
});

test("the host can save a local network domain", async () => {
  await render({ authority: "host", controller: null, claimAvailable: false });
  await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "Domain name" }), { target: { value: "couch.home" } }); });
  await act(async () => { fireEvent.click(button("Save domain")); });
  await flush();
  expect(calls.some(call => call.path === "/api/settings/origin-domain" && call.method === "POST" && JSON.stringify(call.body) === JSON.stringify({ domain: "couch.home" }))).toBe(true);
  expect((screen.getByRole("textbox", { name: "Domain name" }) as HTMLInputElement).value).toBe("couch.home");
});

test("a failed sharing save keeps pairing disabled and reports the error", async () => {
  sharingFailure = true;
  await render({ authority: "host", controller: null, claimAvailable: false }, false);
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Allow remote control" })); });
  await flush();
  expect(sharingChanges).toEqual([]);
  expect(screen.getByRole("alert").textContent).toContain("Unavailable");
  expect(button("Pair a remote").disabled).toBe(true);
});

for (const close of ["Close", "Escape"] as const) test(`${close} restores the Connections pairing opener`, async () => {
  await render();
  await act(async () => { fireEvent.click(button("Pair a remote")); });
  await flush();
  await act(async () => { if (close === "Close") fireEvent.click(button("Close")); else fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" }); });
  await flush();
  expect(document.activeElement).toBe(button("Pair a remote"));
});

test("turning off remote control closes an open pairing dialog", async () => {
  await render({ authority: "host", controller: null, claimAvailable: false });
  await act(async () => { fireEvent.click(button("Pair a remote")); });
  await flush();
  expect(screen.getByRole("dialog")).toBeDefined();
  await act(async () => { setSharingFromHost!(false); });
  await flush();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(button("Pair a remote").disabled).toBe(true);
});

test("promoting a controller writes the role and reloads the list", async () => {
  await render();
  await act(async () => { fireEvent.click(button("Make administrator")); });
  await flush();
  const write = calls.find(call => call.method === "POST")!;
  expect(write.path).toBe("/api/controllers/other/role");
  expect(write.body).toEqual({ role: "administrator" });
  expect(calls.filter(call => call.method === "GET" && call.path === "/api/controllers").length).toBeGreaterThanOrEqual(2);
});

test("removing a device deletes it and drops the row", async () => {
  await render();
  await act(async () => { fireEvent.click(button("Remove")); });
  expect(calls.some(call => call.method === "DELETE" && call.path === "/api/controllers/other")).toBe(false);
  await act(async () => { fireEvent.click(button("Remove")); });
  await flush();
  expect(calls.some(call => call.method === "DELETE" && call.path === "/api/controllers/other")).toBe(true);
  expect(document.body.textContent).not.toContain("Phone");
});
