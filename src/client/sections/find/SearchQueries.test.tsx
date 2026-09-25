import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ProviderId, ProviderItem } from "../../../shared/providers";
import { fireEvent, screen, within } from "../../testing";

const item = (id: string, title = id): ProviderItem => ({ id, title, provider: "youtube", kind: "media", url: `https://www.youtube.com/watch?v=${id}` });
const collection: ProviderItem = { ...item("collection", "A collection"), kind: "collection", url: "https://www.youtube.com/playlist?list=PL1234567890" };
const originals = new Map<string, PropertyDescriptor | undefined>();
let root: Root, window: Window, client: QueryClient, fetchSpy: ReturnType<typeof spyOn>;
let requests: Array<{ path: string; token: string | null; signal?: AbortSignal | null }>;
let delayed: ReturnType<typeof Promise.withResolvers<Response>> | undefined;
let favorite = false, savedWeb = false, pageFails = false, raiFails = false;
let query = "first", provider: ProviderId = "youtube", token = "paired";
let summary: import("./SearchOnlineResults").SearchResultSummary;
const flush = () => act(async () => { await Bun.sleep(15); });
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Provider query behavior did not settle"); await flush(); }
}
async function render() {
  const { SearchOnlineResults } = await import("./SearchOnlineResults");
  await act(async () => root.render(<QueryClientProvider client={client}><SearchOnlineResults
    origin="http://localhost" token={token} provider={provider} query={query} quality="auto" connected canPlay active
    onCommand={async () => true} onEnqueued={() => {}} onResults={(_, next) => { summary = next; }} />
  </QueryClientProvider>));
  await flush();
}
async function click(name: string) {
  await act(async () => fireEvent.click(screen.getByRole("button", { name, exact: true })));
  await flush();
}

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  query = "first"; provider = "youtube"; token = "paired";
  favorite = savedWeb = pageFails = raiFails = false; requests = []; delayed = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname + url.search, token: new Headers(init?.headers).get("Authorization"), signal: init?.signal });
    if (url.pathname === "/api/providers/favorites") {
      if (init?.method === "POST") favorite = true;
      return Response.json({ favorites: favorite ? [item("first")] : [] });
    }
    if (url.pathname.startsWith("/api/providers/favorites/")) { favorite = false; return new Response(null, { status: 204 }); }
    if (url.pathname === "/api/for-later") { if (init?.method === "POST") savedWeb = true; return Response.json({ items: savedWeb ? [{ id: "saved-first", url: item("first").url, title: "first" }] : [] }); }
    if (url.pathname.startsWith("/api/for-later/")) { savedWeb = false; return new Response(null, { status: 204 }); }
    if (url.searchParams.get("q") === "slow" && delayed) return delayed.promise;
    if (provider === "raiplay") {
      if (url.searchParams.has("url")) return Response.json({ items: [{ ...item("rai1", "Rai 1"), provider: "raiplay", live: true }] });
      if (raiFails) return Response.json({ error: "Catalogue unavailable" }, { status: 502 });
    }
    if (url.searchParams.has("url")) return Response.json({ title: "A collection", items: [item("episode", "Collection episode")] });
    if (url.searchParams.has("cursor")) return pageFails
      ? Response.json({ error: "Second page unavailable" }, { status: 502 })
      : Response.json({ items: [item("first"), item("second-page", "Second page")] });
    const current = url.searchParams.get("q") || "first";
    return Response.json({ items: [item(current), collection], nextCursor: "next" });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  delayed?.resolve(Response.json({ items: [] }));
  await act(async () => root.unmount()); client.clear(); fetchSpy.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});


const hit = (title: string) => summary.hits?.find(item => item.title === title);
const run = async (action?: () => void) => { await act(async () => action?.()); await flush(); };

test("a rapid query change cancels the old provider request and reports only current hits", async () => {
  query = "slow"; delayed = Promise.withResolvers<Response>(); await render();
  const old = requests.find(request => request.path.includes("q=slow"));
  query = "new"; await render();
  await until(() => !!hit("new"));
  delayed.resolve(Response.json({ items: [item("retired", "Retired result")] }));
  await flush();
  expect(old?.signal?.aborted).toBe(true);
  expect(hit("Retired result")).toBeUndefined();
});

test("provider pagination preserves first-page hits and retries a failed next page", async () => {
  await render(); await until(() => !!hit("first"));
  pageFails = true; await run(summary.more);
  await until(() => !!summary.error);
  expect(summary.errorMessage).toContain("Second page unavailable");
  expect(hit("first")).toBeDefined();
  pageFails = false; await run(summary.retry);
  await until(() => !!hit("Second page"));
  expect(summary.hits?.filter(item => item.title === "first")).toHaveLength(1);
  expect(summary.more).toBeUndefined();
});

test("a collection exposes its opener and returns to the original provider hits", async () => {
  await render(); await until(() => !!hit("A collection"));
  await run(hit("A collection")?.primary.run);
  await until(() => !!hit("Collection episode"));
  expect(summary.collection?.title).toBe("A collection");
  expect(summary.collection?.openerId).toBe("youtube:collection");
  await run(summary.collection?.back);
  await until(() => !!hit("A collection"));
  expect(summary.collection).toBeUndefined();
});

test("favorite changes refresh saved status through the shared provider cache", async () => {
  await render(); await until(() => !!hit("first"));
  await run(hit("first")?.actions.find(action => action.label === "Save")?.run);
  await until(() => !!hit("first")?.actions.find(action => action.label === "Saved"));
  expect(savedWeb).toBe(true);
  await run(hit("first")?.actions.find(action => action.label === "Saved")?.run);
  await until(() => !!hit("first")?.actions.find(action => action.label === "Save"));
  expect(savedWeb).toBe(false);
});

test("provider reads use current credentials after client retirement", async () => {
  query = "slow"; delayed = Promise.withResolvers<Response>(); await render();
  const old = requests.find(request => request.path.includes("q=slow"));
  const previous = client;
  previous.clear(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  token = "new-pairing"; query = "new-household"; await render();
  delayed.resolve(Response.json({ items: [item("retired", "Retired result")] }));
  await until(() => !!hit("new-household"));
  expect(old?.signal?.aborted).toBe(true);
  expect(requests.some(request => request.path.includes("q=new-household") && request.token === "Bearer new-pairing")).toBe(true);
  expect(hit("Retired result")).toBeUndefined();
});
