import { expect, test } from "bun:test";
import { parseGuideChannels } from "../src/server/iptv-feeds";

test("a channel list keeps playable channels and counts those needing headers or repeating a tvg-id", () => {
  const list = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="one" group-title="News",One',
    "https://example.com/one.m3u8",
    '#EXTINF:-1 tvg-id="two" http-user-agent="Mozilla/5.0",Two',
    "#EXTVLCOPT:http-user-agent=Mozilla/5.0",
    "https://example.com/two.m3u8",
    '#EXTINF:-1 tvg-id="one",One again',
    "https://example.com/one-again.m3u8",
    '#EXTINF:-1 tvg-id="three",Three',
    "relative/three.m3u8",
  ].join("\n");
  const { channels, skipped } = parseGuideChannels(list, "source", "https://example.com/list.m3u");
  expect(channels.map(channel => [channel.tvgId, channel.streamUrl])).toEqual([["one", "https://example.com/one.m3u8"], ["three", "https://example.com/relative/three.m3u8"]]);
  expect(skipped).toEqual({ headers: 1, duplicates: 1 });
});
