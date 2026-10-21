import { expect, test } from "bun:test";
import { createYouTubeBrowser } from "../src/server/providers/youtube";

const url = "https://www.youtube.com/channel/UC4eYXhJI4-7wSWc8UNRwD4A";
const avatar = "https://yt3.googleusercontent.com/avatar=s900";

test("A channel's page, and a Save made there, name the channel rather than its ID", async () => {
  const browse = createYouTubeBrowser(async args => {
    // Its listing without videos: the name and artwork only.
    expect(args.slice(-4)).toEqual(["--playlist-items", "0", "--", url]);
    return JSON.stringify({ _type: "playlist", title: "NPR Music", channel: "NPR Music", entries: [],
      thumbnails: [{ id: "banner_uncropped", url: "https://yt3.googleusercontent.com/banner=s0" }, { id: "avatar_uncropped", url: avatar }] });
  });
  const page = await browse({ url });
  expect([page.title, page.item?.title, page.item?.thumbnail]).toEqual(["NPR Music", "NPR Music", avatar]);
  expect(page.items.map(item => item.title)).toEqual(["Videos", "Playlists", "Shorts", "Live streams"]);
});

test("A channel whose listing fails keeps its sections, named after its address", async () => {
  const page = await createYouTubeBrowser(async () => { throw new Error("yt-dlp failed"); })({ url });
  expect(page.item?.title).toBe("UC4eYXhJI4-7wSWc8UNRwD4A");
  expect(page.items).toHaveLength(4);
});

test("a video's creator survives separately from the selected playlist", async () => {
  const playlist = "https://www.youtube.com/playlist?list=PLabcdefghijk";
  const page = await createYouTubeBrowser(async () => JSON.stringify({title: "Tiny Desk", entries: [
    {id: "abcdefghijk", title: "A concert", channel: "NPR Music", channel_url: url},
  ]}))({url: playlist});
  const item = page.items[0]!;
  expect(item.creator).toEqual({title: "NPR Music", url});
  expect(item.collection?.url).toBe(playlist);
  const { providerMetadata } = await import("../src/server/provider-metadata");
  expect(providerMetadata(item).creator).toEqual(item.creator);
  expect(providerMetadata(item).collection).toBeUndefined();
  expect(providerMetadata(item, true).collection?.url).toBe(playlist);
});
