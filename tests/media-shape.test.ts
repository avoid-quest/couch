import { expect, test } from "bun:test";
import { artShape, fillsFrame, majorityShape } from "../src/client/art-shape";
import { mediaCaption, metaLine } from "../src/client/media-caption";

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

test("a meta line has one separator", () => {
  expect(metaLine("Phony · StreamingCommunity", "35:30")).toBe("Phony, StreamingCommunity, 35:30");
  expect(metaLine(undefined, false, "", "YouTube")).toBe("YouTube");
});
