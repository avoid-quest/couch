import { expect, test } from "bun:test";
import { originalPageUrl, queuePageUrl } from "../src/client/original-page";
import { animeUnityPageUrl } from "../src/shared/animeunity";

test("media, live channels and collections retain their original page", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/playlist?list=PL1234567890",
    "https://www.youtube.com/@channel/videos", "https://www.twitch.tv/channel",
    "https://artist.bandcamp.com/album/record", "https://soundcloud.com/artist/sets/record",
    "https://www.raiplay.it/video/2026/10/episode.html", "https://www.raiplay.it/dirette/rai1",
    "https://animesaturn.ro/anime/show/", "https://www.animeunity.to/anime/123-show/456",
    "https://streamingcommunityz.pictures/watch/123?e=456", "https://www.nts.live/",
  ]) expect(originalPageUrl(url)).toBe(url);
});

test("Couch collection selectors open the real containing website page", () => {
  expect(originalPageUrl("https://www.raiplay.it/programmi/show/ContentSet-abcd-1234.json#block=abc"))
    .toBe("https://www.raiplay.it/programmi/show");
  expect(originalPageUrl("https://www.raiplay.it/video/2026/10/episode.json?json"))
    .toBe("https://www.raiplay.it/video/2026/10/episode.html");
  expect(originalPageUrl("https://streamingcommunityz.pictures/it/titles/123-show/season-2"))
    .toBe("https://streamingcommunityz.pictures/it/titles/123-show");
  expect(originalPageUrl("https://ww8.123moviesfree.net/season/show-123/?episode=2"))
    .toBe("https://ww8.123moviesfree.net/season/show-123/");
});

test("missing pages, files, streams and unsafe links have no browser action destination", () => {
  for (const value of [undefined, null, "", "not a URL", "/media/1", "file:///film.mp4", "javascript:alert(1)",
    "data:text/html,test", "https://user:password@example.com/page", "https://example.com/\npage",
    "https://example.com\\page", "https://cdn.example/stream.m3u8?token=secret", "https://cdn.example/audio.mp3",
  ]) expect(originalPageUrl(value)).toBeUndefined();
  for (const source of ["/films/film.mkv", "radio:station", "iptv:channel", "https://cdn.example/stream", "live:input"]) {
    expect(queuePageUrl({ id: "entry", title: "Content", source })).toBeUndefined();
  }
  const page = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  expect(queuePageUrl({ id: "entry", title: "Video", source: `web:${page}` })).toBe(page);
  expect(queuePageUrl({ id: "entry", title: "Shared input", source: `web:${page}`, liveSourceId: "input" })).toBeUndefined();
});


test("AnimeUnity opens the current site while saved page identities remain canonical", () => {
  const path = "/anime/123-show/456";
  const canonical = `https://www.animeunity.so${path}`;
  const current = `https://www.animeunity.to${path}`;
  expect(animeUnityPageUrl(current)?.href).toBe(canonical);
  expect(queuePageUrl({ id: "episode", title: "Episode", source: `web:${canonical}` })).toBe(canonical);
  expect(originalPageUrl(canonical)).toBe(current);
  expect(originalPageUrl(`http://animeunity.so${path}?view=episodes#player`)).toBe(`${current}?view=episodes#player`);
  expect(originalPageUrl(current)).toBe(current);
  expect(originalPageUrl(`https://www.animeunity.cc${path}`)).toBe(`https://www.animeunity.cc${path}`);
});
