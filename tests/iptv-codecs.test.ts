import { expect, test } from "bun:test";
import { mpvPlaylist } from "../src/server/iptv";

const master = (...codecs: string[]) => ["#EXTM3U", ...codecs.flatMap((list, index) => [`#EXT-X-STREAM-INF:BANDWIDTH=${index + 1}000000,CODECS="${list}",RESOLUTION=1280x720`, `${index}.m3u8`])].join("\n");

test("an HLS channel plays in mpv only when no variant decodes in Chromium", () => {
  expect(mpvPlaylist(master("avc1.64001f,ac-3"))).toBe(true);
  expect(mpvPlaylist(master("avc1.64001f,ec-3", "mp4v.61,mp4a.40.2"))).toBe(true);
  expect(mpvPlaylist(master("avc1.64001f,ac-3", "avc1.4d401e,mp4a.40.2"))).toBe(false);
  expect(mpvPlaylist(master("avc1.64001f,mp4a.40.2,ac-3"))).toBe(false);
  expect(mpvPlaylist(`${master("avc1.64001f,ac-3")}\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nunknown.m3u8`)).toBe(false);
  expect(mpvPlaylist(master("avc1.64001f,ac-3", ""))).toBe(false);
  expect(mpvPlaylist(master("hvc1.1.6.L93.B0,mp4a.40.2"), true)).toBe(true);
  expect(mpvPlaylist(master("hvc1.1.6.L93.B0,mp4a.40.2"), false)).toBe(false);
  // A media playlist names no codecs.
  expect(mpvPlaylist("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n0.ts")).toBe(false);
});
