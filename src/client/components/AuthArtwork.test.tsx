import { setupUiTests, render as renderUI, waitFor, createTestQueryClient } from "../testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { AuthArtwork } from "./AuthArtwork";

setupUiTests();

let view: ReturnType<typeof renderUI>, client: QueryClient;
let intersect: (visible: boolean) => void;
const requests: Array<{ signal?: AbortSignal | null; authorization: string | null }> = [];
const pending: Array<(response: Response) => void> = [];
class Observer {
  constructor(callback: IntersectionObserverCallback) { intersect = visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  observe() {}
  disconnect() {}
}
beforeEach(async () => {
  requests.length = pending.length = 0;
  spyOn(globalThis, "IntersectionObserver").mockImplementation(((callback: IntersectionObserverCallback) => new Observer(callback)) as never);
  spyOn(globalThis, "fetch").mockImplementation(((_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ signal: init?.signal, authorization: new Headers(init?.headers).get("Authorization") });
    return new Promise<Response>(resolve => pending.push(resolve));
  }) as typeof fetch);
  client = createTestQueryClient();
  view = renderUI(null);
});
afterEach(() => { for (const resolve of pending) resolve(new Response()); });
const render = () => act(async () => view.rerender(<QueryClientProvider client={client}><AuthArtwork origin="http://localhost" token="paired" id="poster" /></QueryClientProvider>));

test("offscreen artwork waits for the viewport, authenticates once and cancels on unmount", async () => {
  await render(); expect(requests).toHaveLength(0);
  await act(async () => intersect(false)); expect(requests).toHaveLength(0);
  await act(async () => intersect(true));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]?.authorization).toBe("Bearer paired");
  await render(); expect(requests).toHaveLength(1);
  await act(async () => view.rerender(null));
  expect(requests[0]?.signal?.aborted).toBe(true);
});

test("artwork still loads when IntersectionObserver is unavailable", async () => {
  const observer = globalThis.IntersectionObserver;
  try {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    await render();
    await waitFor(() => expect(requests).toHaveLength(1));
  } finally { globalThis.IntersectionObserver = observer; }
});
