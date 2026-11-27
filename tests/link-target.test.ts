import { expect, test } from "bun:test";
import {
  bandcampFanUrl,
  linkTarget,
  publicProviderMediaUrl,
  soundCloudListUrl,
  spotifyLink,
} from "../src/shared/providers";

test("a pasted link classifies from its URL alone", () => {
  const cases: [string, ReturnType<typeof linkTarget>][] = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", { provider: "youtube", shape: "atom" }],
    ["https://youtu.be/dQw4w9WgXcQ?si=share", { provider: "youtube", shape: "atom" }],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", { provider: "youtube", shape: "atom" }],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
      { provider: "youtube", shape: "atom" },
    ],
    [
      "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
      { provider: "youtube", shape: "playlist" },
    ],
    ["https://www.youtube.com/@couch", { provider: "youtube", shape: "page" }],
    [
      "https://soundcloud.com/bubble_wrap/sets/imballata-on-radio-blackout?si=x",
      { provider: "soundcloud", shape: "playlist" },
    ],
    ["https://soundcloud.com/bubble_wrap", { provider: "soundcloud", shape: "playlist" }],
    ["https://soundcloud.com/bubble_wrap/gisela?si=x", { provider: "soundcloud", shape: "atom" }],
    ["https://soundcloud.com/discover", undefined],
    [
      "https://nilsfrahm.bandcamp.com/album/all-melody",
      { provider: "bandcamp", shape: "playlist" },
    ],
    ["https://nilsfrahm.bandcamp.com/track/sunson", { provider: "bandcamp", shape: "atom" }],
    ["https://bandcamp.com/umbertopasinetti", { provider: "bandcamp", shape: "playlist" }],
    ["https://bandcamp.com/umbertopasinetti/wishlist", { provider: "bandcamp", shape: "playlist" }],
    ["https://bandcamp.com/discover", undefined],
    ["https://www.twitch.tv/videos/1990742383", undefined],
    ["https://www.twitch.tv/monstercat", { provider: "twitch", shape: "page" }],
    [
      "https://open.spotify.com/intl-it/album/4aawyAB9vmqN3uQ7FjRGTy",
      { provider: "spotify", shape: "playlist" },
    ],
    [
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x",
      { provider: "spotify", shape: "atom" },
    ],
    ["https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk", undefined],
    [
      "https://open.spotify.com/intl-it/artist/2enCZC6FjkZDdEW7rKBfw0",
      { provider: "spotify", shape: "playlist" },
    ],
    ["https://lyl.live/episode/dj-ale", { provider: "archives", shape: "atom" }],
    [
      "https://lyl.live/shows/residents?styles=Baile%20Funk",
      { provider: "archives", shape: "playlist" },
    ],
    ["https://radioblackout.org/shows/arsider/", { provider: "archives", shape: "playlist" }],
    ["https://www.nts.live/shows/minimal-effort", { provider: "archives", shape: "playlist" }],
    ["https://www.mixcloud.com/lylradio/", { provider: "mixcloud", shape: "playlist" }],
    ["https://user:secret@www.youtube.com/watch?v=dQw4w9WgXcQ", undefined],
  ];
  for (const [url, target] of cases) expect([url, linkTarget(url)]).toEqual([url, target]);
});

test("list links normalize to their canonical public page", () => {
  expect(soundCloudListUrl("https://m.soundcloud.com/Bubble_Wrap/sets/x/")).toBe(
    "https://soundcloud.com/Bubble_Wrap/sets/x",
  );
  expect(soundCloudListUrl("https://soundcloud.com/a/sets/x?secret_token=s-1")).toBeUndefined();
  expect(soundCloudListUrl("https://soundcloud.com/a/b")).toBeUndefined();
  expect(bandcampFanUrl("https://www.bandcamp.com/Fan_1/wishlist/")).toEqual({
    url: "https://bandcamp.com/fan_1/wishlist",
    fan: "fan_1",
    list: "wishlist",
  });
  expect(bandcampFanUrl("https://artist.bandcamp.com/fan")).toBeUndefined();
  expect(spotifyLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toEqual({
    url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    kind: "playlist",
    id: "37i9dQZF1DXcBWIGoYBM5M",
  });
  expect(spotifyLink("https://open.spotify.com:444/track/4uLU6hMCjMI75M1A2tKUQC")).toBeUndefined();
  // A shared track link and the album's copy of the same track are one playable page.
  expect(
    publicProviderMediaUrl("https://open.spotify.com/intl-it/track/4uLU6hMCjMI75M1A2tKUQC?si=x"),
  ).toBe("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
  expect(
    publicProviderMediaUrl("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy"),
  ).toBeUndefined();
});
