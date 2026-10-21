import { expect, test } from "bun:test";
import { mediaCreator } from "../src/server/media-creator";
import { parseMedia } from "../src/server/web-media";

test("public artist and channel relationships survive playback extraction", () => {
  const info = {url: "https://cdn.example/audio.mp3", uploader: "Artist", uploader_url: "https://artist.bandcamp.com"};
  expect(parseMedia(info, "").metadata?.creator).toEqual({title: "Artist", url: "https://artist.bandcamp.com/"});
  expect(mediaCreator({channel: "A channel"})).toBeUndefined();
  expect(mediaCreator({channel: "A channel", channel_url: "https://user:password@youtube.com/@channel"})).toBeUndefined();
  expect(mediaCreator({channel: "A channel", channel_url: "javascript:alert(1)"})).toBeUndefined();
});


test("creator names stay paired with their own destination", () => {
  expect(mediaCreator({ channel: "Channel", uploader: "Uploader", uploader_url: "https://youtube.com/@uploader" }))
    .toEqual({ title: "Uploader", url: "https://youtube.com/@uploader" });
  expect(mediaCreator({ channel: "Channel", uploader_url: "https://youtube.com/@uploader" })).toBeUndefined();
  expect(mediaCreator({ channel: "Channel", channel_url: "https://youtube.com/@channel", uploader: "Uploader", uploader_url: "https://youtube.com/@uploader" }))
    .toEqual({ title: "Channel", url: "https://youtube.com/@channel" });
  expect(mediaCreator({ channel: "Channel", channel_url: "invalid", artist: "Artist", artist_url: "https://artist.bandcamp.com" }))
    .toEqual({ title: "Artist", url: "https://artist.bandcamp.com/" });
});
