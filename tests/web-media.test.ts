import { expect, test } from "bun:test";
import { parseMedia } from "../src/server/web-media";

// StreamingCommunity's plugin returns a video and an audio rendition of one HLS master (#700).
test("a split m3u8 pair from one master plays the master, with no separate sound", () => {
  const master = "https://vixcloud.example/playlist/206473?token=t&expires=1";
  const rendition = (type: string) => ({
    protocol: "m3u8_native",
    manifest_url: master,
    url: `https://vixcloud.example/playlist/206473?type=${type}&rendition=x`,
  });
  const media = parseMedia(
    {
      requested_formats: [
        { ...rendition("video"), vcodec: "avc1", acodec: "none" },
        { ...rendition("audio"), vcodec: "none", acodec: "mp4a" },
      ],
    },
    "",
  );
  expect(media.source).toBe(master);
  expect(media.hls).toBe(true);
  expect(media.audioSource).toBeUndefined();
});

test("an extensionless selected HLS transport keeps its protocol", () => {
  expect(
    parseMedia(
      {
        url: "https://media.example/playlist?token=fixture",
        protocol: "m3u8_native",
        vcodec: "avc1",
        acodec: "aac",
      },
      "",
    ).hls,
  ).toBe(true);
  expect(
    parseMedia(
      {
        url: "https://media.example/file",
        protocol: "https",
        vcodec: "avc1",
        formats: [{ protocol: "m3u8_native" }],
      },
      "",
    ).hls,
  ).toBeUndefined();
});
