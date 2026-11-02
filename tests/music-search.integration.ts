import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviders } from "../src/server/providers";
import { createSoundCloudBrowser } from "../src/server/providers/soundcloud";

test("SoundCloud details reuse fresh search metadata without resolving audio again", async t => {
  let calls = 0, now = 1_000;
  t.mock.method(Date, "now", () => now);
  const track = { title: "Track", webpage_url: "https://soundcloud.com/artist/track", duration: 42, uploader: "Artist" };
  const soundcloud = createSoundCloudBrowser(async args => {
    calls++;
    return JSON.stringify(args.at(-1)!.startsWith("scsearch") ? { entries: [track] } : track);
  });
  const providers = createProviders({ databasePath: ":memory:", browse: { soundcloud } as Parameters<typeof createProviders>[0]["browse"] });
  const details = () => providers.handle(new Request(`http://localhost/api/providers/soundcloud/items?url=${encodeURIComponent(track.webpage_url)}`));
  try {
    const search = await (await providers.handle(new Request("http://localhost/api/providers/soundcloud/items?q=artist"))).json();
    const page = await (await details()).json();
    assert.deepEqual(page, { title: "Track", item: search.items[0], items: search.items });
    assert.equal(calls, 1, "Opening a search result must not resolve all of its streams");
    now += 60_001;
    assert.equal((await details()).status, 200);
    assert.equal(calls, 2, "Expired metadata must still be refreshed");
  } finally { providers.close(); }
});
