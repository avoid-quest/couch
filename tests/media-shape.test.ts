import { expect, test } from "bun:test";
import { artShape, fillsFrame, majorityShape } from "../src/client/art-shape";
import { episodeLabel, episodeRow, isChannelTab, mediaCaption, metaLine, pageTitle, withoutUrls } from "../src/client/media-caption";

test("each kind of item has one artwork shape", () => {
  expect(artShape("StreamingCommunity")).toBe("poster");
  expect(artShape("StreamingCommunity", "collection")).toBe("poster");
  expect(artShape("StreamingCommunity", "episode")).toBe("video");
  expect(artShape("YouTube")).toBe("video");
  expect(artShape("RaiPlay", "collection")).toBe("video");
  expect(artShape("Bandcamp", "collection")).toBe("square");
  expect(artShape("SoundCloud")).toBe("square");
  expect(artShape("Radio")).toBe("square");
  expect(artShape("Radio directory", "station")).toBe("square");
  expect(artShape("Twitch", "channel")).toBe("round");
  expect(artShape("YouTube", "channel")).toBe("round");
  expect(artShape("Twitch", "collection")).toBe("poster");
});

test("a shelf takes its majority shape and contains the rest", () => {
  expect(majorityShape(["video", "poster", "video"])).toBe("video");
  expect(majorityShape(["poster", "video"])).toBe("poster");
  expect(majorityShape([], "square")).toBe("square");
  expect(fillsFrame("round", "square")).toBe(true);
  expect(fillsFrame("poster", "video")).toBe(false);
});

test("an episode leads with its series, then its number and name", () => {
  const collection = { title: "Season 1", url: "https://example.test/phony/season-1", parent: { title: "Phony", url: "https://example.test/phony" } };
  expect(mediaCaption({ title: "S01E01 · Episodio 1", subtitle: "Phony", collection })).toEqual({ title: "Phony", lead: "S1 E1, Episodio 1", subtitle: undefined });
  expect(mediaCaption({ title: "S02E10", collection })).toEqual({ title: "Phony", lead: "S2 E10", subtitle: undefined });
  expect(mediaCaption({ title: "Big Buck Bunny", subtitle: "Blender" })).toEqual({ title: "Big Buck Bunny", subtitle: "Blender" });
});

test("an episode in its series' own list goes by its name, its number leading the meta", () => {
  expect(episodeRow("S01E01 · Episodio 1")).toEqual({ title: "Episodio 1", lead: "S1 E1" });
  expect(episodeRow("S29E02")).toEqual({ title: "S29 E2" });
  expect(episodeRow("Big Buck Bunny")).toEqual({ title: "Big Buck Bunny" });
});

test("a meta line has one separator", () => {
  expect(metaLine("Phony · StreamingCommunity", "35:30")).toBe("Phony, StreamingCommunity, 35:30");
  expect(metaLine(undefined, false, "", "YouTube")).toBe("YouTube");
});

test("descriptions drop bare addresses and the lines that only carried one", () => {
  expect(withoutUrls("Official video for “So What”\nListen to Miles Davis: https://MilesDavis.lnk.to/listenYD\nWatch more at www.example.com and see the whole archive of concerts")).toBe("Official video for “So What”\nWatch more at and see the whole archive of concerts");
  expect(withoutUrls("► Subscribe: https://youtube.com/x\n\n\n\nThanks")).toBe("Thanks");
  expect(withoutUrls(undefined)).toBe("");
});

test("a channel's tab is the channel, and an episode is named by its season and number", () => {
  expect(pageTitle("Stanford - Videos")).toBe("Stanford");
  expect(isChannelTab("Stanford - Shorts")).toBe(true);
  expect(pageTitle("Before - After")).toBe("Before - After");
  expect(episodeLabel({ title: "S01E02 · Episodio 2" })).toBe("S1 E2");
  expect(episodeLabel({ title: "Pilot", collection: { title: "The Office - Season 3", url: "https://example.test/s3", index: 0 } })).toBe("S3 E1");
  expect(episodeLabel({ title: "Pilot" })).toBeUndefined();
});

test("a snippet's link list keeps only what it said before its first address", () => {
  expect(withoutUrls("Official music video for “So What” by Miles Davis Listen to Miles Davis: https://MilesDavis.lnk.to/listenYD Watch more Miles Davis videos: https://lnk.to/x Facebook: https://fb.com/x")).toBe("Official music video for “So What” by Miles Davis");
});
