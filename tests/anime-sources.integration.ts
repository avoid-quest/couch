import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviders } from "../src/server/providers";
import { createContinuationResolver } from "../src/server/continuation";
import type { ProviderItem, ProviderPage } from "../src/shared/providers";

const sources = [
  {
    provider: "animesaturn",
    series: "https://animesaturn.ro/anime/example/",
    episodes: [
      "https://animesaturn.ro/example-episode-1/",
      "https://animesaturn.ro/example-episode-2/",
    ],
  },
  {
    provider: "animeunity",
    series: "https://www.animeunity.so/anime/12-example",
    episodes: [
      "https://www.animeunity.so/anime/12-example/5987",
      "https://www.animeunity.so/anime/12-example/5988",
    ],
  },
] as const;

for (const source of sources) {
  const item: ProviderItem = {
    id: "series",
    provider: source.provider,
    kind: "collection",
    title: "Example",
    url: source.series,
  };
  const page: ProviderPage = {
    item,
    title: item.title,
    items: source.episodes.map((url, index) => ({
      id: `episode-${index}`,
      provider: source.provider,
      kind: "media",
      title: `Episode ${index + 1}`,
      url,
      collection: { title: item.title, url: source.series, index },
    })),
  };

  test(`${source.provider} routes browse, cache and save public collections`, async () => {
    let calls = 0;
    const providers = createProviders({
      databasePath: ":memory:",
      browse: {
        [source.provider]: async () => {
          calls++;
          return page;
        },
      } as Parameters<typeof createProviders>[0]["browse"],
    });
    try {
      const request = () =>
        new Request(
          `http://localhost/api/providers/${source.provider}/items?${new URLSearchParams({ url: source.series })}`,
        );
      for (let i = 0; i < 2; i++) {
        const response = await providers.handle(request());
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), page);
      }
      assert.equal(calls, 1);
      const save = (url: string) =>
        providers.handle(
          new Request("http://localhost/api/providers/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item: { ...item, url } }),
          }),
        );
      assert.equal((await save(source.series)).status, 200);
      assert.equal((await save("https://unrelated.example/anime/example/")).status, 400);
      assert.equal((await save(`${source.series}?token=private`)).status, 400);
      const saved = await (
        await providers.handle(new Request("http://localhost/api/providers/favorites"))
      ).json();
      assert.equal(saved.favorites[0].provider, source.provider);
      assert.equal(saved.favorites[0].url, source.series);
    } finally {
      providers.close();
    }
  });

  test(`${source.provider} continues only the selected anime and canonical episode`, async () => {
    const resolve = createContinuationResolver(async (provider, url) => {
      assert.equal(provider, source.provider);
      assert.equal(url, source.series);
      return page;
    });
    const first = page.items[0]!;
    for (const url of [first.url, first.url.replace("https:", "http:").replace("www.", "")]) {
      const continuation = await resolve(
        { id: "playing", title: first.title, source: `web:${url}`, collection: first.collection },
        new AbortController().signal,
      );
      assert.deepEqual(
        continuation?.entries.map((entry) => entry.source),
        [`web:${source.episodes[1]}`],
      );
    }
    assert.equal(
      await resolve(
        {
          id: "foreign",
          title: first.title,
          source: `web:${first.url.replace("example", "other")}`,
          collection: first.collection,
        },
        new AbortController().signal,
      ),
      null,
    );
  });
}
