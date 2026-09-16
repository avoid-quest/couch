import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { QueryClient } from "@tanstack/react-query";
import type { StartupState } from "../../../../shared/startup";

let root: Root, window: Window, client: QueryClient, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; method: string }> = [];
let startup: StartupState;
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.textContent === label)!;
const flush = () => act(async () => { await Bun.sleep(20); });

async function render() {
  const { StartupSettings } = await import("./StartupSettings");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <StartupSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />
    </QueryClientProvider>
  ));
  await flush();
}

beforeEach(async () => {
  calls.length = 0;
  startup = { enabled: false, fullscreenAtLaunch: true, fullscreenNow: true, applies: "next-session" };
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    calls.push({ path, method });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin");
    if (path === "/api/settings/startup" && method === "POST") startup = { ...startup, enabled: true };
    return Response.json(startup);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("startup reads through Query and invalidates after the REST write", async () => {
  await render();
  expect(document.querySelector("[data-startup-mode]")!.textContent).toContain("Login screen");
  await act(async () => button("Enable automatic startup").click());
  await flush();
  expect(calls).toEqual([
    { path: "/api/settings/startup", method: "GET" },
    { path: "/api/settings/startup", method: "POST" },
    { path: "/api/settings/startup", method: "GET" },
  ]);
  expect(document.querySelector("[data-startup-mode]")!.textContent).toContain("Couch starts automatically");
});
