import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { toast } from "sonner";
import { fireEvent, screen, within } from "../../../testing";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { path: string; method: string; body: unknown }[] = [];
const render = async () => {
  const { MetadataSettings } = await import("./MetadataSettings");
  const { createRoot } = await import("react-dom/client");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MetadataSettings connected canManage credentials={{ origin: "http://localhost", token: "paired" }} /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : (window as unknown as Record<string, unknown>)[key] });
  }
  calls.length = 0;
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === "POST") return Response.json({ configured: true });
    return Response.json({ configured: false });
  }) as unknown as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("metadata provider reads through Query and invalidates by saving without a version prop", async () => {
  await render();
  expect(calls).toEqual([{ path: "/api/metadata/provider", method: "GET", body: null }]);
  const input = document.getElementById("metadata-token") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "tmdb-token");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(calls[1]).toEqual({ path: "/api/metadata/provider", method: "POST", body: { token: "tmdb-token" } });
  expect(toast.getToasts().some(item => "title" in item && String(item.title).startsWith("Token saved."))).toBe(true);
});

test("clearing the TMDB token asks for confirmation", async () => {
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ configured: !init?.method });
  }) as unknown as typeof fetch);
  await render();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear" })));
  expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
  const dialog = screen.getByRole("alertdialog", { name: "Clear the token?" });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Clear" })); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(calls.find(call => call.method === "POST")?.body).toEqual({ token: "" });
});
