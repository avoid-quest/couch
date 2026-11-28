import { expect, test } from "bun:test";
import { originalPageUrl, queuePageUrl, shareableUrl } from "../src/client/original-page";
import { animeUnityPageUrl } from "../src/shared/animeunity";

test("missing pages, files, streams and unsafe links have no browser action destination", () => {
  for (const value of [
    undefined,
    null,
    "",
    "not a URL",
    "/media/1",
    "file:///film.mp4",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:password@example.com/page",
    "https://example.com/\npage",
    "https://example.com\\page",
    "https://cdn.example/stream.m3u8?token=secret",
    "https://cdn.example/audio.mp3",
  ])
    expect(originalPageUrl(value)).toBeUndefined();
  for (const source of [
    "/films/film.mkv",
    "radio:station",
    "iptv:channel",
    "https://cdn.example/stream",
    "live:input",
  ]) {
    expect(queuePageUrl({ id: "entry", title: "Content", source })).toBeUndefined();
  }
  const page = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  expect(queuePageUrl({ id: "entry", title: "Video", source: `web:${page}` })).toBe(page);
  expect(
    queuePageUrl({
      id: "entry",
      title: "Shared input",
      source: `web:${page}`,
      liveSourceId: "input",
    }),
  ).toBeUndefined();
});

test("AnimeUnity opens the current site while saved page identities remain canonical", () => {
  const path = "/anime/123-show/456";
  const canonical = `https://www.animeunity.so${path}`;
  const current = `https://www.animeunity.to${path}`;
  expect(animeUnityPageUrl(current)?.href).toBe(canonical);
  expect(queuePageUrl({ id: "episode", title: "Episode", source: `web:${canonical}` })).toBe(
    canonical,
  );
  expect(originalPageUrl(canonical)).toBe(current);
  expect(originalPageUrl(`http://animeunity.so${path}?view=episodes#player`)).toBe(
    `${current}?view=episodes#player`,
  );
});

test("Copy link hands out only a public page: never a private link's secret or an address on the network", () => {
  for (const value of [
    "https://soundcloud.com/artist/private-track/s-AbCdEf123",
    "https://soundcloud.com/artist/private-track?secret_token=s-AbCdEf123",
    "https://on.soundcloud.com/Xy12Ab",
    "https://example.com/watch?id=1&token=abc",
    "https://example.com/watch?api_key=abc",
    "http://192.168.1.20:4100/",
    "http://localhost:4353/item",
    "http://living-room.local/page",
    "https://cdn.example/stream.m3u8",
    // Couch's own address under any name, an extensionless stream, a signed CDN link, a secret in a fragment.
    "http://review-couchbox:4361/watch",
    "https://couch.example.org/watch",
    "https://cdn.example/live/stream",
    "https://d1.cloudfront.net/media/abc?Expires=1&Signature=x&Key-Pair-Id=y",
    "https://soundcloud.com/artist/sets/an-album#secret_token=s-AbCdEf123",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=1",
    "https://soundcloud.com/artist/sets/an-album/s-AbCdEf123",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://rr3---sn-a5mekn7z.googlevideo.com/videoplayback?expire=1",
    "https://www.raiplay.it/programmi/show?token=abc",
  ])
    expect(shareableUrl(value)).toBeUndefined();
  for (const value of [
    "https://soundcloud.com/artist/public-track",
    "https://soundcloud.com/artist/sets/an-album",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/playlist?list=PL6B3937A5D230E335",
    "https://www.raiplay.it/programmi/ilcommissariomontalbano",
    "https://www.mixcloud.com/NTSRadio/playlists/",
    "https://www.nts.live/",
  ])
    expect(shareableUrl(value)).toBe(value);
  expect(shareableUrl("https://youtu.be/dQw4w9WgXcQ?si=share")).toBe(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  expect(shareableUrl("https://www.raiplay.it/video/2024/01/Un-programma-abc123.json")).toBe(
    "https://www.raiplay.it/video/2024/01/Un-programma-abc123.html",
  );
});
