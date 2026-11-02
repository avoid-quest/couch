import assert from "node:assert/strict";
import { test } from "node:test";
import { nextEpisode, progressFor } from "../src/client/sections/find/provider-progress";
import type { ProviderItem } from "../src/shared/providers";
import type { HistoryItem } from "../src/shared/viewing";

const season = "https://ww8.123moviesfree.net/season/example-season-1-123/";
const episode = `${season}?episode=1`;

test("a 123MoviesFree season resumes its unfinished episode without mixing episode numbers or seasons", () => {
  const first: ProviderItem = {
    id: "episode-1",
    provider: "movies123",
    kind: "media",
    title: "Episode 1",
    url: episode,
  };
  const second: ProviderItem = {
    ...first,
    id: "episode-2",
    title: "Episode 2",
    url: `${season}?episode=2`,
  };
  const finished: HistoryItem = {
    mediaId: "first",
    title: first.title,
    url: first.url,
    position: 0,
    duration: 2000,
    watched: true,
    lastPlayedAt: 1,
    playable: true,
  };
  const unfinished: HistoryItem = {
    ...finished,
    mediaId: "second",
    title: second.title,
    url: second.url,
    position: 90,
    watched: false,
    lastPlayedAt: 2,
  };
  assert.equal(progressFor(second, [finished, unfinished]), unfinished);
  assert.equal(
    progressFor(second, [
      { ...unfinished, url: "https://ww8.123moviesfree.net/season/other-season-1-124/?episode=2" },
    ]),
    undefined,
  );
  assert.equal(
    progressFor(second, [{ ...unfinished, url: `${second.url}&token=PRIVATE` }]),
    undefined,
  );
});

test("123MoviesFree film resume and next episode match progress from alternate public hosts", () => {
  const first: ProviderItem = {
    id: "first",
    provider: "movies123",
    kind: "media",
    title: "Episode 1",
    url: episode,
  };
  const second: ProviderItem = {
    ...first,
    id: "second",
    title: "Episode 2",
    url: `${season}?episode=2`,
  };
  const film: ProviderItem = {
    ...first,
    id: "film",
    title: "Film",
    url: "https://ww8.123moviesfree.net/movie/example-film-456/",
  };
  for (const host of ["ww9.123moviesfree.net", "www.123moviesfree.net", "123moviesfree.net"]) {
    const alias = (url: string) =>
      url.replace("https://ww8.123moviesfree.net", `http://${host}`).replace(/\/(?=\?|$)/, "");
    const finished: HistoryItem = {
      mediaId: "first",
      title: first.title,
      url: alias(first.url),
      position: 0,
      duration: 2000,
      watched: true,
      lastPlayedAt: 1,
      playable: true,
    };
    const unfinished: HistoryItem = {
      ...finished,
      mediaId: "second",
      title: second.title,
      url: alias(second.url),
      position: 90,
      watched: false,
      lastPlayedAt: 2,
    };
    const filmProgress: HistoryItem = {
      ...unfinished,
      mediaId: "film",
      title: film.title,
      url: alias(film.url),
    };
    assert.equal(progressFor(film, [filmProgress]), filmProgress);
    assert.equal(progressFor(first, [finished]), finished);
    assert.equal(progressFor(second, [unfinished]), unfinished);
    assert.equal(nextEpisode([first, second], [finished]), second);
    assert.equal(nextEpisode([first, second], [finished, unfinished]), second);
  }
});
