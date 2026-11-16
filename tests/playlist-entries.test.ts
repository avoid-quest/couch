import { expect, test } from "bun:test";
import { capturePlaylistEntries } from "../src/server/playlists";

test("a saved radio station or Live TV channel keeps its station", () => {
  const radio = {
    id: "radio",
    title: "Lyl Radio",
    source: "radio:lyl",
    kind: "radio" as const,
    endless: true,
    station: { id: "lyl", name: "Lyl Radio" },
  };
  const channel = {
    id: "channel",
    title: "Rai 1",
    source: `iptv:${"a".repeat(64)}`,
    endless: true,
    station: { id: "a".repeat(64), name: "Rai 1" },
  };
  expect(capturePlaylistEntries([radio, channel])).toEqual([radio, channel]);
});
