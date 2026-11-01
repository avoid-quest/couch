import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviders } from "../src/server/providers/index";
import type { BrowseRequest, ProviderPage } from "../src/shared/providers";

const page: ProviderPage = { items: [], title: "Shared result" };
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = (query = "same", signal?: AbortSignal, provider = "bandcamp", cursor = "", url = "") =>
  new Request(`http://localhost/api/providers/${provider}/items?${new URLSearchParams({ q: query, cursor, url })}`, { signal });
function catalog(browse: (request: BrowseRequest, signal?: AbortSignal) => Promise<ProviderPage>) {
  return createProviders({ databasePath: ":memory:", browse: { bandcamp: browse, twitch: browse } as Parameters<typeof createProviders>[0]["browse"] });
}

test("twelve identical pending reads share one upstream call and independent responses", async () => {
  const gate = Promise.withResolvers<ProviderPage>();
  let calls = 0;
  const providers = catalog(async () => { calls++; return gate.promise; });
  try {
    const reads = Array.from({ length: 12 }, (_, i) => providers.handle(request(i % 2 ? " same " : "same")));
    await tick();
    assert.equal(calls, 1);
    gate.resolve(page);
    const responses = await Promise.all(reads);
    assert.equal(new Set(responses).size, 12);
    for (const response of responses) { assert.equal(response.status, 200); assert.deepEqual(await response.json(), page); }
    await providers.handle(request());
    assert.equal(calls, 1);
  } finally { gate.resolve(page); providers.close(); }
});

test("one caller cancels promptly without canceling the other caller's work", async () => {
  const gate = Promise.withResolvers<ProviderPage>();
  let upstream: AbortSignal | undefined;
  const providers = catalog(async (_, signal) => { upstream = signal; return gate.promise; });
  const first = new AbortController(), second = new AbortController();
  try {
    const left = providers.handle(request("same", first.signal));
    const right = providers.handle(request("same", second.signal));
    await tick();
    first.abort();
    const outcome = await Promise.race([left, tick().then(() => null)]);
    assert.ok(outcome, "canceled caller must stop waiting before upstream resolves");
    assert.equal(upstream?.aborted, false);
    gate.resolve(page);
    assert.deepEqual(await (await right).json(), page);
  } finally { gate.resolve(page); providers.close(); }
});

test("shared failures leave no negative cache or stuck pending entry", async () => {
  const gate = Promise.withResolvers<ProviderPage>(); let calls = 0;
  const providers = catalog(async () => ++calls === 1 ? gate.promise : page);
  try {
    const reads = [providers.handle(request()), providers.handle(request())];
    await tick(); gate.reject(new Error("fixture"));
    for (const response of await Promise.all(reads)) assert.equal(response.status, 502);
    assert.equal((await providers.handle(request())).status, 200);
    assert.equal(calls, 2);
  } finally { providers.close(); }
});

test("provider, query, URL and cursor remain distinct and resolved TTLs expire", async () => {
  const realNow = Date.now; let now = realNow(), calls = 0;
  Date.now = () => now;
  const providers = catalog(async () => { calls++; return page; });
  try {
    await Promise.all([providers.handle(request()), providers.handle(request("different")), providers.handle(request("same", undefined, "twitch")), providers.handle(request("same", undefined, "bandcamp", "next")), providers.handle(request("same", undefined, "bandcamp", "", "https://artist.bandcamp.com/track/one"))]);
    assert.equal(calls, 5);
    now += 20_001;
    await providers.handle(request()); await providers.handle(request("same", undefined, "twitch"));
    assert.equal(calls, 6);
    now += 40_000; await providers.handle(request()); assert.equal(calls, 7);
  } finally { Date.now = realNow; providers.close(); }
});
