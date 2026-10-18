import { expect, test } from "bun:test";
import { Route as find } from "../src/client/routes/find";
import { Route as saved } from "../src/client/routes/saved";
import { frontendPaths, pathForSection, sectionForPath } from "../src/shared/page-paths";

function open(route: typeof find | typeof saved, searchStr: string) {
  try { route.options.beforeLoad!({ location: { pathname: "/", searchStr } } as never); }
  catch (redirect) { return (redirect as { options: { href: string } }).options.href; }
}

test("Find's addresses open Search with their query, and its Radio and Live TV open Live", () => {
  expect(open(find, "")).toBe("/search");
  expect(open(find, "?q=jazz&source=YouTube")).toBe("/search?q=jazz&source=YouTube");
  expect(open(find, "?browse=radio")).toBe("/live");
  expect(open(find, "?browse=radio&radioSource=Radio+playlists&page=2")).toBe("/live?radioSource=Radio+playlists&page=2");
  // Live TV's page and filter have their own names on Live, which it shares with Radio.
  expect(open(find, "?browse=live-tv&group=News&page=3&filter=rai")).toBe("/live?group=News&channelPage=3&channelFilter=rai");
});

test("Saved's addresses open Library on the same tab", () => {
  expect(open(saved, "")).toBe("/library");
  expect(open(saved, "?tab=channels")).toBe("/library?tab=channels");
});

test("Core serves the sections, Where it plays' overview and the earlier addresses that redirect to them", () => {
  for (const path of ["/live", "/search", "/library", "/where-it-plays", "/find", "/saved"]) expect(frontendPaths).toContain(path);
  expect(sectionForPath("/live/")).toBe("Live");
  expect(sectionForPath("/collection")).toBe("Search");
  expect(pathForSection("For later")).toBe("/library");
});
