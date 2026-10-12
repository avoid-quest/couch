import assert from "node:assert/strict";
import { test } from "node:test";
import { readCollectionSearch } from "../src/client/collection-pagination";
import { queueItemLocation } from "../src/client/detail-navigation";
import { readSearchState, searchLocation } from "../src/client/search";
import { nextEpisode, progressFor } from "../src/client/sections/find/provider-progress";
import type { ProviderItem } from "../src/shared/providers";
import type { HistoryItem } from "../src/shared/viewing";

const season = "https://ww8.123moviesfree.net/season/example-season-1-123/";
const episode = `${season}?episode=1`;

test("123MoviesFree search links preserve the chosen source", () => {
  const state = { query: "Example", source: "123MoviesFree" };
  const link = new URL(searchLocation(state), "http://couch.local");
  assert.deepEqual(readSearchState(link.search), state);
});

test("123MoviesFree collection and queued episode navigation retain the source and season", () => {
  const collection = { title: "Example season 1", url: season, index: 0 };
  assert.equal(readCollectionSearch({ provider: "movies123" }).provider, "movies123");
  for (const url of ["https://ww8.123moviesfree.net/movie/example-film-456/", season, episode]) {
    assert.equal(readCollectionSearch({ provider: "movies123", url }).provider, "movies123");
  }
  const link = new URL(queueItemLocation({ id: "episode", source: `web:${episode}`, collection }), "http://couch.local");
  const state = readCollectionSearch({ provider: link.searchParams.get("provider"), url: link.searchParams.get("url"), context: JSON.parse(link.searchParams.get("context")!) });
  assert.equal(link.pathname, "/collection");
  assert.equal(state.provider, "movies123");
  assert.equal(state.url, episode);
  assert.deepEqual(state.context, collection);
  assert.equal(readCollectionSearch({ provider: "movies123", url: "https://www.youtube.com/watch?v=abcdefghijk" }).provider, undefined);
  assert.equal(readCollectionSearch({ provider: "movies123", url: episode, context: { ...collection, url: "https://example.com/season" } }).context, undefined);
});

test("a 123MoviesFree season resumes its unfinished episode without mixing episode numbers or seasons", () => {
  const first: ProviderItem = { id: "episode-1", provider: "movies123", kind: "media", title: "Episode 1", url: episode };
  const second: ProviderItem = { ...first, id: "episode-2", title: "Episode 2", url: `${season}?episode=2` };
  const finished: HistoryItem = { mediaId: "first", title: first.title, url: first.url, position: 0, duration: 2000, watched: true, lastPlayedAt: 1, playable: true };
  const unfinished: HistoryItem = { ...finished, mediaId: "second", title: second.title, url: second.url, position: 90, watched: false, lastPlayedAt: 2 };
  assert.equal(nextEpisode([first, second], []), first);
  assert.equal(nextEpisode([first, second], [finished]), second);
  assert.equal(nextEpisode([first, second], [finished, unfinished]), second);
  assert.equal(progressFor(second, [finished, unfinished]), unfinished);
  assert.equal(progressFor(first, [unfinished]), undefined);
  assert.equal(progressFor(second, [{ ...unfinished, url: "https://ww8.123moviesfree.net/season/other-season-1-124/?episode=2" }]), undefined);
  assert.equal(progressFor(second, [{ ...unfinished, url: `${second.url}&token=PRIVATE` }]), undefined);
});
