import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviders } from "../src/server/providers";
import { createBandcampCatalog } from "../src/server/providers/bandcamp";
import { createSoundCloudBrowser } from "../src/server/providers/soundcloud";
import type { ProviderId } from "../src/shared/providers";

test("music search routes serve results, reuse cached searches and retain actionable details", async () => {
  let calls = 0;
  const bandcamp = createBandcampCatalog(undefined, (async () => {
    calls++;
    return Response.json({ auto: { results: [{ type: "t", name: "Arsider track", item_url_path: "https://arsider.bandcamp.com/track/track" }] } });
  }) as typeof fetch);
  const soundcloud = createSoundCloudBrowser(async () => {
    calls++;
    return JSON.stringify({ entries: [{ title: "Arsider track", webpage_url: "https://soundcloud.com/arsiderprod/track" }] });
  });
  const providers = createProviders({ databasePath: ":memory:", browse: { bandcamp: bandcamp.browse, soundcloud } as Parameters<typeof createProviders>[0]["browse"] });
  try {
    for (const provider of ["bandcamp", "soundcloud"]) {
      const request = () => new Request(`http://localhost/api/providers/${provider}/items?q=arsider`);
      const response = await providers.handle(request());
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(page.items[0].provider, provider);
      assert.equal(page.items[0].kind, "media");
      assert.deepEqual(await (await providers.handle(request())).json(), page);
    }
    assert.equal(calls, 2);
  } finally { providers.close(); }
});

test("all nine search providers and RaiPlay live can be in flight together", async () => {
  const release = Promise.withResolvers<void>();
  const ids: ProviderId[] = ["youtube", "bandcamp", "soundcloud", "raiplay", "twitch", "streamingcommunity", "movies123", "animesaturn", "animeunity"];
  let calls = 0;
  const browse = Object.fromEntries(ids.map(id => [id, async () => { calls++; await release.promise; return { items: [] }; }])) as Parameters<typeof createProviders>[0]["browse"];
  const providers = createProviders({ databasePath: ":memory:", browse });
  try {
    const requests = [...ids.map(id => `/api/providers/${id}/items?q=arsider`), "/api/providers/raiplay/items?url=https%3A%2F%2Fwww.raiplay.it%2Fdirette"];
    const pending = requests.map(path => providers.handle(new Request(`http://localhost${path}`)));
    assert.equal(calls, 10);
    release.resolve();
    assert.deepEqual((await Promise.all(pending)).map(response => response.status), requests.map(() => 200));
  } finally { release.resolve(); providers.close(); }
});
