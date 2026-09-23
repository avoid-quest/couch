import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { screen } from "../../../testing";

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
