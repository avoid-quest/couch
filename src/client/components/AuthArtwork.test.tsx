import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { Root } from "react-dom/client";
import { Window } from "happy-dom";
import { AuthArtwork } from "./AuthArtwork";

let root: Root, window: Window, client: QueryClient, request: ReturnType<typeof spyOn>;
let intersect: (visible: boolean) => void;
const originals = new Map<string, PropertyDescriptor | undefined>();
const requests: Array<{ signal?: AbortSignal | null; authorization: string | null }> = [];
const pending: Array<(response: Response) => void> = [];
class Observer {
  constructor(callback: IntersectionObserverCallback) { intersect = visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  observe() {}
  disconnect() {}
}
const flush = () => act(async () => { await Bun.sleep(10); });
beforeEach(async () => {
  requests.length = pending.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "IntersectionObserver", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "IntersectionObserver" ? Observer : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation(((_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ signal: init?.signal, authorization: new Headers(init?.headers).get("Authorization") });
    return new Promise<Response>(resolve => pending.push(resolve));
  }) as typeof fetch);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear();
  for (const resolve of pending) resolve(new Response());
  request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
const render = () => act(async () => root.render(<QueryClientProvider client={client}><AuthArtwork origin="http://localhost" token="paired" id="poster" /></QueryClientProvider>));

test("offscreen artwork waits for the viewport, authenticates once and cancels on unmount", async () => {
  await render(); await flush(); expect(requests).toHaveLength(0);
  await act(async () => intersect(false)); expect(requests).toHaveLength(0);
  await act(async () => intersect(true)); await flush();
  expect(requests).toHaveLength(1); expect(requests[0]?.authorization).toBe("Bearer paired");
  await render(); expect(requests).toHaveLength(1);
  await act(async () => root.render(null));
  expect(requests[0]?.signal?.aborted).toBe(true);
});

test("artwork still loads when IntersectionObserver is unavailable", async () => {
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
  await render(); await flush(); expect(requests).toHaveLength(1);
});
