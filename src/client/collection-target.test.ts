import { expect, test } from "bun:test";
import { collectionTarget } from "./collection-target";

test("saved episodes open the canonical show with every season reachable", () => {
  expect(collectionTarget({ title: "MasterChef Italia - Season 11", url: "https://streamingcommunityz.photos/it/titles/123-masterchef-italia/season-11" })?.url).toBe("https://streamingcommunityz.photos/it/titles/123-masterchef-italia");
});

test("albums and provider lists retain their exact catalog target", () => {
  const url = "https://artist.bandcamp.com/album/night";
  expect(collectionTarget({ title: "Night", url })?.url).toBe(url);
  expect(collectionTarget({ title: "Unknown", url: "https://example.com/season-11" })).toBeUndefined();
  expect(collectionTarget()).toBeUndefined();
});
