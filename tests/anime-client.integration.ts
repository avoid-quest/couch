import assert from "node:assert/strict";
import { test } from "node:test";
import { providerCollectionCursor, readCollectionSearch } from "../src/client/collection-pagination";
import { collectionLinks } from "../src/client/collection-target";
import { queueItemLocation } from "../src/client/detail-navigation";
import { savedSourceLabel } from "../src/client/saved-source";
import { readSearchState, searchLocation } from "../src/client/search";
import { nextEpisode, progressFor, seriesResumeFor } from "../src/client/sections/find/provider-progress";
import type { ProviderItem } from "../src/shared/providers";
import type { HistoryItem } from "../src/shared/viewing";

const sources = [
  { provider: "animesaturn", name: "AnimeSaturn", catalogue: "https://animesaturn.ro/anime/", series: "https://animesaturn.ro/anime/one-piece/", episodes: ["https://animesaturn.ro/one-piece-episode-1/", "https://animesaturn.ro/one-piece-episode-2/"] },
  { provider: "animeunity", name: "AnimeUnity", catalogue: "https://www.animeunity.so/archivio", series: "https://www.animeunity.so/anime/12-one-piece", episodes: ["https://www.animeunity.so/anime/12-one-piece/5987", "https://www.animeunity.so/anime/12-one-piece/5988"] },
] as const;

for (const source of sources) {
  test(`${source.name} search and queued episode links retain the source and anime collection`, () => {
    const search = { query: "One Piece", source: source.name };
    assert.deepEqual(readSearchState(new URL(searchLocation(search), "http://couch.local").search), search);
    assert.equal(readCollectionSearch({ provider: source.provider }).provider, source.provider);
    for (const url of [source.catalogue, source.series, ...source.episodes]) {
      assert.equal(readCollectionSearch({ provider: source.provider, url }).provider, source.provider);
    }
    const collection = { title: "One Piece", url: source.series, index: 1 };
    const link = new URL(queueItemLocation({ id: "episode", source: `web:${source.episodes[1]}`, collection }), "http://couch.local");
    const state = readCollectionSearch({ provider: link.searchParams.get("provider"), url: link.searchParams.get("url"), context: JSON.parse(link.searchParams.get("context")!) });
    assert.equal(link.pathname, "/collection");
    assert.equal(state.provider, source.provider);
    assert.equal(state.url, source.episodes[1]);
    assert.deepEqual(state.context, collection);
    assert.equal(collectionLinks(collection).at(-1)?.provider, source.provider);
    assert.equal(savedSourceLabel({ id: "episode", title: "Episode 2", url: source.episodes[1] }), source.name);
    assert.equal(readCollectionSearch({ provider: source.provider, url: "https://www.youtube.com/watch?v=abcdefghijk" }).provider, undefined);
    assert.equal(readCollectionSearch({ provider: source.provider, url: source.episodes[1], context: { ...collection, url: "https://example.com/series" } }).context, undefined);
  });

  test(`${source.name} resumes the unfinished episode using its public episode identity`, () => {
    const collection = { title: "One Piece", url: source.series };
    const first: ProviderItem = { id: "first", provider: source.provider, kind: "media", title: "Episode 1", url: source.episodes[0], collection: { ...collection, index: 0 } };
    const second: ProviderItem = { ...first, id: "second", title: "Episode 2", url: source.episodes[1], collection: { ...collection, index: 1 } };
    const finished: HistoryItem = { mediaId: "first", title: first.title, url: first.url, position: 0, duration: 1400, watched: true, lastPlayedAt: 1, playable: true, collection: first.collection };
    const unfinished: HistoryItem = { ...finished, mediaId: "second", title: second.title, url: second.url, position: 90, watched: false, lastPlayedAt: 2, collection: second.collection };
    assert.equal(nextEpisode([first, second], []), first);
    assert.equal(nextEpisode([first, second], [finished]), second);
    assert.equal(nextEpisode([first, second], [finished, unfinished]), second);
    assert.equal(progressFor(second, [finished, unfinished]), unfinished);
    assert.equal(progressFor(first, [unfinished]), undefined);
    assert.equal(progressFor(second, [{ ...unfinished, url: `${second.url}?token=PRIVATE` }]), undefined);
  });

  test(`${source.name} resumes an episode outside the displayed page only for its validated collection`, () => {
    const series: ProviderItem = { id: "series", provider: source.provider, kind: "collection", title: "One Piece", url: source.series };
    const progress: HistoryItem = { mediaId: "off-page", title: "Episode", url: source.episodes[1], position: 90, duration: 1400, watched: false, lastPlayedAt: 2, playable: true, collection: { title: series.title, url: series.url, index: 130 } };
    assert.equal(seriesResumeFor(series, [{ ...progress, url: source.episodes[0], lastPlayedAt: 1 }, progress]), progress);
    assert.equal(seriesResumeFor({ ...series, url: series.url.replace("https:", "http:") }, [progress]), progress);
    for (const invalid of [
      { ...progress, url: `${progress.url}?token=PRIVATE` },
      { ...progress, url: "https://www.youtube.com/watch?v=abcdefghijk" },
      { ...progress, collection: { ...progress.collection!, url: series.url.replace("one-piece", "other-series") } },
      { ...progress, collection: undefined },
      { ...progress, watched: true },
      { ...progress, playable: false },
      { ...progress, position: 0 },
    ]) assert.equal(seriesResumeFor(series, [invalid]), undefined);
    assert.equal(seriesResumeFor({ ...series, kind: "media" }, [progress]), undefined);
  });
}

test("AnimeSaturn indices locate exact chunks while AnimeUnity number ranges cannot be inferred from indices", () => {
  const collection = { title: "One Piece", url: sources[0].series };
  assert.equal(providerCollectionCursor("animesaturn", collection), undefined);
  assert.equal(providerCollectionCursor("animesaturn", { ...collection, index: 49 }), undefined);
  assert.equal(providerCollectionCursor("animesaturn", { ...collection, index: 50 }), "1");
  assert.equal(providerCollectionCursor("animesaturn", { ...collection, index: 1179 }), "23");
  assert.equal(providerCollectionCursor("animeunity", { ...collection, url: sources[1].series, index: 239 }), undefined);
});
