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
let favorite = false, pageFails = false, raiFails = false;
let query = "first", provider: ProviderId = "youtube", token = "paired";
const flush = () => act(async () => { await Bun.sleep(15); });
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Provider query behavior did not settle"); await flush(); }
}
async function render() {
  const { SearchOnlineResults } = await import("./SearchOnlineResults");
  await act(async () => root.render(<QueryClientProvider client={client}><SearchOnlineResults
    origin="http://localhost" token={token} provider={provider} query={query} quality="auto" connected canPlay active
    onCommand={async () => true} onEnqueued={() => {}} />
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
  favorite = pageFails = raiFails = false; requests = []; delayed = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname + url.search, token: new Headers(init?.headers).get("Authorization"), signal: init?.signal });
    if (url.pathname === "/api/providers/favorites") {
      if (init?.method === "POST") favorite = true;
      return Response.json({ favorites: favorite ? [item("first")] : [] });
    }
    if (url.pathname.startsWith("/api/providers/favorites/")) { favorite = false; return new Response(null, { status: 204 }); }
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

test("a rapid query change cancels the old read and never displays its late results", async () => {
  query = "slow"; delayed = Promise.withResolvers<Response>();
  await render();
  const request = requests.find(request => request.path.includes("q=slow"));
  expect(request).toBeDefined();
  query = "new"; await render();
  expect(request?.signal?.aborted).toBe(true);
  delayed.resolve(Response.json({ items: [item("retired", "Retired result")] }));
  await until(() => !!screen.queryByRole("button", { name: "Play: new" }));
  expect(screen.queryByRole("button", { name: "Play: Retired result" })).toBeNull();
});

test("switching provider cancels old results without borrowing another source's cache", async () => {
  query = "slow"; delayed = Promise.withResolvers<Response>(); await render();
  const request = requests.find(request => request.path.includes("q=slow"));
  provider = "twitch"; query = "broadcast"; await render();
  delayed.resolve(Response.json({ items: [item("retired", "Retired result")] }));
  await until(() => !!screen.queryByRole("button", { name: "Play: broadcast" }));
  expect(request?.signal?.aborted).toBe(true);
  expect(screen.getByRole("region", { name: "Twitch search results" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Play: Retired result" })).toBeNull();
});

test("pagination failure retains the first page and retry appends a deduplicated next page", async () => {
  await render(); await until(() => !!screen.queryByRole("button", { name: "Play: first" }));
  pageFails = true;
  await click("Show more YouTube");
  await until(() => !!screen.queryByRole("alert"));
  expect(screen.getByRole("button", { name: "Play: first" })).toBeDefined();
  expect(screen.getByRole("alert").textContent).toContain("Second page unavailable");
  pageFails = false; await click("Retry YouTube");
  await until(() => !!screen.queryByRole("button", { name: "Play: Second page" }));
  expect(screen.getAllByRole("button", { name: "Play: first", exact: true })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Show more YouTube" })).toBeNull();
});

test("favorite invalidation updates the shared kept status without resetting the browse trail", async () => {
  await render(); await until(() => !!screen.queryByRole("button", { name: "Keep first" }));
  await click("Keep first");
  await until(() => !!screen.queryByRole("button", { name: "Remove first" }));
  favorite = false;
  await act(async () => { await client.invalidateQueries({ queryKey: ["providers", "favorites"] }); });
  await until(() => !!screen.queryByRole("button", { name: "Keep first" }));
  await click("Open A collection");
  await until(() => !!screen.queryByRole("button", { name: "Play: Collection episode" }));
  await act(async () => { await client.invalidateQueries({ queryKey: ["providers", "favorites"] }); });
  expect(screen.getByRole("button", { name: "Back to results" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Play: Collection episode" })).toBeDefined();
});

test("back navigation restores the opener, visible results and scroll without a second cache", async () => {
  await render(); await until(() => !!screen.queryByRole("button", { name: "Open A collection" }));
  Object.defineProperty(document, "scrollingElement", { configurable: true, value: document.documentElement });
  document.documentElement.scrollTop = 420;
  const opener = screen.getByRole("button", { name: "Open A collection" });
  opener.focus(); await click("Open A collection");
  await until(() => !!screen.queryByRole("button", { name: "Play: Collection episode" }));
  document.documentElement.scrollTop = 0;
  await click("Back to results");
  await until(() => document.activeElement === screen.queryByRole("button", { name: "Open A collection" }));
  expect(document.documentElement.scrollTop).toBe(420);
});

test("RaiPlay preserves live partial results and their warning when catalogue search fails", async () => {
  provider = "raiplay"; query = "Rai 1"; raiFails = true;
  await render(); await until(() => !!screen.queryByRole("button", { name: "Play: Rai 1" }));
  const region = within(screen.getByRole("region", { name: "RaiPlay search results" }));
  expect(region.getByText("Some RaiPlay results could not be loaded. Try this search again to refresh them.")).toBeDefined();
});

test("retiring a connection client cancels its browse while new credentials use only the new cache", async () => {
  query = "slow"; delayed = Promise.withResolvers<Response>(); await render();
  const previous = client;
  const request = requests.find(request => request.path.includes("q=slow"));
  previous.clear(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  token = "new-pairing"; query = "new-household"; await render();
  delayed.resolve(Response.json({ items: [item("retired", "Retired result")] }));
  await until(() => !!screen.queryByRole("button", { name: "Play: new-household" }));
  expect(request?.signal?.aborted).toBe(true);
  expect(requests.some(request => request.path.includes("q=new-household") && request.token === "Bearer new-pairing")).toBe(true);
  expect(screen.queryByRole("button", { name: "Play: Retired result" })).toBeNull();
  expect(previous.getQueryCache().getAll()).toEqual([]);
});
