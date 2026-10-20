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

test("last waiter cancellation retires pending work; late data cannot overwrite a replacement", async () => {
  const old = Promise.withResolvers<ProviderPage>(), fresh = Promise.withResolvers<ProviderPage>();
  let calls = 0, upstream: AbortSignal | undefined;
  const providers = catalog(async (_, signal) => { if (++calls === 1) { upstream = signal; return old.promise; } return fresh.promise; });
  const controller = new AbortController(), other = new AbortController();
  try {
    const abandoned = providers.handle(request("same", controller.signal));
    const alsoAbandoned = providers.handle(request("same", other.signal));
    await tick(); controller.abort(); await tick();
    assert.equal(upstream?.aborted, false);
    other.abort(); await tick();
    assert.equal(upstream?.aborted, true);
    const replacement = providers.handle(request());
    old.resolve({ items: [], title: "Obsolete" });
    await Promise.all([abandoned, alsoAbandoned]); await tick();
    const joined = providers.handle(request());
    fresh.resolve(page);
    for (const response of await Promise.all([replacement, joined])) assert.deepEqual(await response.json(), page);
    assert.equal(calls, 2);
    assert.deepEqual(await (await providers.handle(request())).json(), page);
  } finally { old.resolve(page); fresh.resolve(page); providers.close(); }
});

test("ten distinct upstream jobs stay bounded, while duplicates may join at capacity", async () => {
  const gate = Promise.withResolvers<ProviderPage>(); let calls = 0;
  const providers = catalog(async () => { calls++; return gate.promise; });
  try {
    const reads = Array.from({ length: 10 }, (_, i) => providers.handle(request(String(i))));
    const joined = providers.handle(request("0"));
    assert.equal((await providers.handle(request("overflow"))).status, 503);
    gate.resolve(page);
    for (const response of await Promise.all([...reads, joined])) assert.equal(response.status, 200);
    assert.equal(calls, 10);
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

test("shutdown cancels shared upstream work and releases all callers", async () => {
  const gate = Promise.withResolvers<ProviderPage>(); let upstream: AbortSignal | undefined;
  const providers = catalog(async (_, signal) => { upstream = signal; return gate.promise; });
  try {
    const reads = [providers.handle(request()), providers.handle(request())];
    await tick(); providers.close();
    assert.equal(upstream?.aborted, true);
    const outcome = await Promise.race([Promise.all(reads), tick().then(() => null)]);
    assert.ok(outcome, "shutdown must release callers even if upstream ignores cancellation");
    assert.equal((await providers.handle(request())).status, 503);
  } finally { gate.resolve(page); providers.close(); }
});

test("provider, query, URL and cursor remain distinct; resolved TTLs and 100-entry bound survive", async () => {
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
    for (let i = 0; i < 100; i++) await providers.handle(request(`entry-${i}`));
    await providers.handle(request("entry-99")); assert.equal(calls, 107);
    await providers.handle(request()); assert.equal(calls, 108);
  } finally { Date.now = realNow; providers.close(); }
});

test("already aborted callers start no work; cancellation during adapter startup also releases the caller", async () => {
  const gate = Promise.withResolvers<ProviderPage>(), controller = new AbortController();
  let calls = 0;
  const providers = catalog(async () => { calls++; controller.abort(); return gate.promise; });
  try {
    const aborted = new AbortController(); aborted.abort();
    await providers.handle(request("before", aborted.signal)); assert.equal(calls, 0);
    const read = providers.handle(request("during", controller.signal));
    assert.ok(await Promise.race([read, tick().then(() => null)]));
    assert.equal(calls, 1);
  } finally { gate.resolve(page); providers.close(); }
});

test("canceled adapters that are still settling retain their upstream slots", async () => {
  const gate = Promise.withResolvers<ProviderPage>(); let calls = 0;
  const providers = catalog(async () => { calls++; return gate.promise; });
  try {
    const controllers = Array.from({ length: 10 }, () => new AbortController());
    const reads = controllers.map((controller, i) => providers.handle(request(String(i), controller.signal)));
    controllers.forEach(controller => controller.abort());
    await Promise.all(reads);
    assert.equal((await providers.handle(request("new"))).status, 503);
    gate.resolve(page); await tick();
    assert.equal((await providers.handle(request("new"))).status, 200);
    assert.equal(calls, 11);
  } finally { gate.resolve(page); providers.close(); }
});
