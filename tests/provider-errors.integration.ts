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
