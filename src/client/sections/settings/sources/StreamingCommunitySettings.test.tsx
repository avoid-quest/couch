import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { path: string; method: string; body: unknown }[] = [];
const render = async () => {
  const { StreamingCommunitySettings } = await import("./StreamingCommunitySettings");
  const { createRoot } = await import("react-dom/client");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><StreamingCommunitySettings connected canManage credentials={{ origin: "http://localhost", token: "paired" }} /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : (window as unknown as Record<string, unknown>)[key] });
  }
  calls.length = 0;
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ origin: init?.method === "POST" ? JSON.parse(String(init.body)).origin : "https://streamingcommunityz.academy" });
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

test("StreamingCommunity origin loads through Query and saves the normalized origin", async () => {
  await render();
  expect(calls).toEqual([{ path: "/api/settings/streamingcommunity", method: "GET", body: null }]);
  const input = document.getElementById("streamingcommunity-origin") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "https://streamingcommunity.example/");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(calls[1]).toEqual({ path: "/api/settings/streamingcommunity", method: "POST", body: { origin: "https://streamingcommunity.example" } });
  expect(document.body.textContent).toContain("Website origin saved");
});
