import { expect, test } from "bun:test";
import { collectionPagination, readCollectionSearch } from "../src/client/collection-pagination";
import { collectionLinks } from "../src/client/collection-target";

test("a full album clamps a stale page after filtering and exposes the correct slice", () => {
  expect(collectionPagination(70, 2, [])).toMatchObject({ page: 2, pages: 3, start: 24, end: 48, previous: true, next: true });
  expect(collectionPagination(3, 9, [])).toMatchObject({ page: 1, pages: 1, start: 0, end: 3, previous: false, next: false });
});

test("a provider's final cursor page stays a remote page without inventing a total", () => {
  expect(collectionPagination(5, 1, ["opaque-token"])).toEqual({ remote: true, page: 2, pages: undefined, start: 0, end: 5, previous: true, next: false });
});

test("cursor trails round trip and malformed collection links are rejected", () => {
  const route = { provider: "youtube", url: "https://www.youtube.com/playlist?list=abcdefghijk", cursors: ["24", "48"], page: 1, filter: "" };
  expect(readCollectionSearch(JSON.parse(JSON.stringify(route)))).toEqual(route);
  expect(readCollectionSearch({ ...route, provider: "raiplay", page: -1, cursors: [{}] })).toMatchObject({ provider: undefined, page: 1, cursors: [] });
});

test("a provider catalogue can open directly and item links retain their album context", () => {
  expect(readCollectionSearch({ provider: "bandcamp" }).provider).toBe("bandcamp");
  const context = { title: "Album", url: "https://artist.bandcamp.com/album/album", index: 28 };
  expect(readCollectionSearch({ provider: "bandcamp", url: "https://artist.bandcamp.com/track/song", context }).context).toEqual(context);
  expect(readCollectionSearch({ provider: "bandcamp", context: { ...context, url: "https://example.com/album" } }).context).toBeUndefined();
});

test("legacy StreamingCommunity metadata exposes both the series and the exact season", () => {
  const series = "https://streamingcommunityz.pictures/it/titles/42-the-show";
  expect(collectionLinks({ title: "The show - Season 2", url: `${series}/season-2` }).map(({ title, url }) => ({ title, url })))
    .toEqual([{ title: "The show", url: series }, { title: "The show - Season 2", url: `${series}/season-2` }]);
  expect(collectionLinks({ title: "Season 2", url: `${series}/season-2`, parent: { title: "Wrong provider", url: "https://www.youtube.com/@NASA" } })).toHaveLength(1);
});
