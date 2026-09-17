import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Controller } from "../../../../shared/controllers";
import { fireEvent, screen, within } from "../../../testing";

let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; method: string; body: unknown }> = [];
const self: Controller = { id: "self", name: "Browser", role: "administrator", createdAt: 1, lastSeenAt: 2 };
let devices: Controller[];
const button = (label: string) => screen.getByRole("button", { name: label });
const flush = () => act(async () => { await Bun.sleep(20); });

async function render() {
  const { ConnectionsSettings } = await import("./ConnectionsSettings");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  await act(async () => root.render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConnectionsSettings credentials={{ origin: "http://localhost", token: "admin" }} connected
        host={{ origin: "http://localhost", token: "admin", pairingCode: "246810", urls: ["http://localhost:4100"] }} selfId="self" />
    </QueryClientProvider>
  ));
  await flush();
}

beforeEach(async () => {
  calls.length = 0;
  devices = [self, { id: "other", name: "Phone", role: "controller", createdAt: 1, lastSeenAt: 2 }];
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin");
    if (path === "/api/controllers/pairing-code") return Response.json({ code: "246810" });
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

test("connections shows the pairing code and every device with its role, minus own-device actions", async () => {
  await render();
  expect(document.body.textContent).toContain("246810");
  expect(document.body.textContent).toContain("Browser");
  expect(document.body.textContent).toContain("(this device)");
  expect(document.body.textContent).toContain("Phone");
  expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  expect(within(screen.getByText("(this device)").closest("li")!).queryAllByRole("button")).toHaveLength(0);
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
  await flush();
  expect(calls.some(call => call.method === "DELETE" && call.path === "/api/controllers/other")).toBe(true);
  expect(document.body.textContent).not.toContain("Phone");
});
