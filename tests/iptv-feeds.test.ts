import { expect, test } from "bun:test";
import { parseGuideChannels, parseGuidePrograms } from "../src/server/iptv-feeds";

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

test("optional malformed categories do not discard radio or television programmes", () => {
  const invalid = `<category/><category lang="en"/><category>  </category><category>${"x".repeat(501)}</category><category>bad&#x7f;label</category>`;
  const xml = `<tv><channel id="one"/>
    <programme channel="one" start="20261023090000 +0000" stop="20261023100000 +0000"><title>Morning</title>${invalid}<category lang="en"> Jazz </category><category>jazz</category><category>Experimental</category></programme>
    <programme channel="one" start="20261023100000 +0000" stop="20261023110000 +0000"><title>Next</title>${invalid}</programme>
  </tv>`;
  for (const partial of [false, true]) {
    const programmes = parseGuidePrograms(xml, [{ id: "station", tvgId: "one" }], { partial });
    expect(programmes.map(programme => programme.title)).toEqual(["Morning", "Next"]);
    expect(programmes[0]!.categories).toEqual(["Jazz", "Experimental"]);
    expect(programmes[1]!.categories).toBeUndefined();
  }
  expect(() => parseGuidePrograms(xml.replace("<title>Morning</title>", ""), [{ id: "station", tvgId: "one" }])).toThrow("text fields");
});
