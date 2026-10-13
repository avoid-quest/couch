import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviders } from "../src/server/providers/index";
import { createBandcampCatalog } from "../src/server/providers/bandcamp";
import { ExtractionError } from "../src/server/yt-dlp";
import { providerJson } from "../src/server/providers/http";

for (const message of [
  "The website took too long to respond. Try again.",
  "This website requires an account or browser session. Website sign-in is not supported yet.",
  "This isn't available in your region.",
  "This item requires DRM playback, which is not supported.",
  "This live stream is offline or has not started yet.",
]) test(`safe extraction error survives catalog: ${message}`, async () => {
  const catalog = createBandcampCatalog(async () => { throw new ExtractionError(message); });
  const providers = createProviders({ databasePath: ":memory:", browse: { bandcamp: catalog.browse } as Parameters<typeof createProviders>[0]["browse"] });
  try {
    const response = await providers.handle(new Request("http://localhost/api/providers/bandcamp/items?url=https%3A%2F%2Fartist.bandcamp.com%2Ftrack%2Ftitle"));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, message);
  } finally { providers.close(); }
});

for (const error of [new Error("fetch failed: https://media.example/stream?signature=PRIVATE"), Object.assign(new Error("https://media.example/?token=PRIVATE"), { name: "ExtractionError" })]) {
  test("unknown exceptions and lookalikes stay generic; failures are retried", async () => {
    let calls = 0;
    const catalog = createBandcampCatalog(async () => {
      if (++calls < 3) throw error;
      return JSON.stringify({ title: "Recovered", vcodec: "none", acodec: "mp3", url: "https://audio.example/track.mp3" });
    });
    const providers = createProviders({ databasePath: ":memory:", browse: { bandcamp: catalog.browse } as Parameters<typeof createProviders>[0]["browse"] });
    const request = () => new Request("http://localhost/api/providers/bandcamp/items?url=https%3A%2F%2Fartist.bandcamp.com%2Ftrack%2Ftitle");
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await providers.handle(request());
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: "Couldn't complete this request. Try again." });
      }
      assert.equal((await providers.handle(request())).status, 200);
      assert.equal(calls, 3);
    } finally { providers.close(); }
  });
}

test("a provider fetch timeout gets safe copy", async () => {
  const providers = createProviders({ databasePath: ":memory:", browse: { youtube: async () => { await providerJson("https://private.example/catalog", {}, (async () => { throw new DOMException("https://private.example/?token=PRIVATE", "TimeoutError"); }) as typeof fetch); return { items: [] }; } } as Parameters<typeof createProviders>[0]["browse"] });
  try {
    const response = await providers.handle(new Request("http://localhost/api/providers/youtube/items"));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "The provider took too long to respond. Try again." });
  } finally { providers.close(); }
});

for (const declared of [false, true]) test(`provider JSON bounds a ${declared ? "declared" : "chunked"} response and cancels its body`, async () => {
  let cancelled = false;
  const request = (async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: declared ? { "Content-Length": "9999999" } : {} })) as typeof fetch;
  await assert.rejects(providerJson("https://provider.example/catalog", {}, request), /The provider returned too much data\./);
  assert.equal(cancelled, true);
});

test("provider JSON keeps safe empty and invalid response errors", async () => {
  for (const [response, message] of [[new Response(null), "The provider returned no data."], [new Response("<html>PRIVATE</html>"), "The provider returned invalid data."]] as const) {
    await assert.rejects(providerJson("https://provider.example/catalog", {}, (async () => response) as typeof fetch), error => error instanceof Error && error.message === message);
  }
});

test("provider JSON cancels a stalled response and keeps the caller's reason", async () => {
  const controller = new AbortController(), reason = new Error("Stopped browsing");
  let cancelled = false, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const request = (async () => {
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    started();
    return response;
  }) as typeof fetch;
  const pending = providerJson("https://provider.example/catalog", { signal: controller.signal }, request);
  await ready;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(cancelled, true);
});
