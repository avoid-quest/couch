import { setupUiTests, render as renderUI, act, waitFor, createTestQueryClient } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProviderId, ProviderItem } from "../../../shared/providers";

setupUiTests();

const item = (id: string, title = id): ProviderItem => ({ id, title, provider: "youtube", kind: "media", url: `https://www.youtube.com/watch?v=${id}` });
const collection: ProviderItem = { ...item("collection", "A collection"), kind: "collection", url: "https://www.youtube.com/playlist?list=PL1234567890" };
let view: ReturnType<typeof renderUI>, client: QueryClient;
let requests: Array<{ path: string; token: string | null; signal?: AbortSignal | null }>;
let delayed: ReturnType<typeof Promise.withResolvers<Response>> | undefined;
let favorite = false, savedWeb = false, pageFails = false, raiFails = false;
let query = "first", provider: ProviderId = "youtube", token = "paired";
let summary: import("./SearchOnlineResults").SearchResultSummary;
async function render() {
  const { SearchOnlineResults } = await import("./SearchOnlineResults");
  await act(async () => view.rerender(<QueryClientProvider client={client}><SearchOnlineResults
    origin="http://localhost" token={token} provider={provider} query={query} quality="auto" connected canPlay active
    onCommand={async () => true} onEnqueued={() => {}} onResults={(_, next) => { summary = next; }} />
  </QueryClientProvider>));
}

beforeEach(async () => {
  query = "first"; provider = "youtube"; token = "paired";
  favorite = savedWeb = pageFails = raiFails = false; requests = []; delayed = undefined;
  client = createTestQueryClient();
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
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
  view = renderUI(<></>);
});
afterEach(async () => {
  delayed?.resolve(Response.json({ items: [] }));

});

const hit = (title: string) => summary.hits?.find(item => item.title === title);
const run = async (action?: () => void) => { await act(async () => action?.()); };

test("a rapid query change cancels the old provider request and reports only current hits", async () => {
  query = "slow"; delayed = Promise.withResolvers<Response>(); await render();
  await waitFor(() => expect(requests.some(request => request.path.includes("q=slow"))).toBe(true));
  const old = requests.find(request => request.path.includes("q=slow"));
  query = "new"; await render();
  await waitFor(() => expect(hit("new")).toBeDefined());
  await act(async () => { delayed!.resolve(Response.json({ items: [item("retired", "Retired result")] })); });
  expect(old?.signal?.aborted).toBe(true);
  expect(hit("Retired result")).toBeUndefined();
});

test("provider pagination preserves first-page hits and retries a failed next page", async () => {
  await render(); await waitFor(() => expect(hit("first")).toBeDefined());
  pageFails = true; await run(summary.more);
  await waitFor(() => expect(summary.errorMessage).toContain("Second page unavailable"));
  expect(hit("first")).toBeDefined();
  pageFails = false; await run(summary.retry);
  await waitFor(() => expect(hit("Second page")).toBeDefined());
  expect(summary.hits?.filter(item => item.title === "first")).toHaveLength(1);
  expect(summary.more).toBeUndefined();
});

test("a collection exposes its opener and returns to the original provider hits", async () => {
  await render(); await waitFor(() => expect(hit("A collection")).toBeDefined());
  await run(hit("A collection")?.primary.run);
  await waitFor(() => expect(hit("Collection episode")).toBeDefined());
  expect(summary.collection?.title).toBe("A collection");
  expect(summary.collection?.openerId).toBe("youtube:collection");
  await run(summary.collection?.back);
  await waitFor(() => expect(hit("A collection")).toBeDefined());
  expect(summary.collection).toBeUndefined();
});

test("favorite changes refresh saved status through the shared provider cache", async () => {
  await render(); await waitFor(() => expect(hit("first")).toBeDefined());
  await run(hit("first")?.actions.find(action => action.label === "Save")?.run);
  await waitFor(() => expect(hit("first")?.actions.find(action => action.label === "Saved")).toBeDefined());
  expect(savedWeb).toBe(true);
  await run(hit("first")?.actions.find(action => action.label === "Saved")?.run);
  await waitFor(() => expect(hit("first")?.actions.find(action => action.label === "Save")).toBeDefined());
  expect(savedWeb).toBe(false);
});

test("provider reads use current credentials after client retirement", async () => {
  query = "slow"; delayed = Promise.withResolvers<Response>(); await render();
  await waitFor(() => expect(requests.some(request => request.path.includes("q=slow"))).toBe(true));
  const old = requests.find(request => request.path.includes("q=slow"));
  const previous = client;
  previous.clear(); client = createTestQueryClient();
  token = "new-pairing"; query = "new-household"; await render();
  await act(async () => { delayed!.resolve(Response.json({ items: [item("retired", "Retired result")] })); });
  await waitFor(() => expect(hit("new-household")).toBeDefined());
  expect(old?.signal?.aborted).toBe(true);
  expect(requests.some(request => request.path.includes("q=new-household") && request.token === "Bearer new-pairing")).toBe(true);
  expect(hit("Retired result")).toBeUndefined();
});
