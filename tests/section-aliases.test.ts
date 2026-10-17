import { expect, test } from "bun:test";
import { Route as find } from "../src/client/routes/find";
import { Route as saved } from "../src/client/routes/saved";
import { Route as whereItPlays } from "../src/client/routes/where-it-plays";
import { frontendPaths, pathForSection, sectionForPath } from "../src/shared/page-paths";
import { detailHref } from "../src/client/detail-navigation";

function open(route: typeof find | typeof saved | typeof whereItPlays, searchStr: string) {
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

test("Where it plays' overview became the picker alone, so its address opens Home", () => {
  expect(open(whereItPlays, "")).toBe("/");
  expect(sectionForPath("/where-it-plays")).toBeUndefined();
});

test("Core serves the sections and the earlier addresses that redirect to them", () => {
  for (const path of ["/live", "/search", "/library", "/where-it-plays", "/find", "/saved"]) expect(frontendPaths).toContain(path);
  expect(sectionForPath("/live/")).toBe("Live");
  expect(sectionForPath("/collection")).toBe("Search");
  expect(pathForSection("For later")).toBe("/library");
});

test("an item or collection page keeps the section that opened it, as its URL says", () => {
  expect(sectionForPath("/item", "?kind=saved&id=x&from=library")).toBe("Library");
  expect(sectionForPath("/collection", "?provider=youtube&url=&from=home")).toBe("Home");
  expect(sectionForPath("/item", "?kind=radio&id=x&from=search")).toBe("Search");
  expect(sectionForPath("/item", "?kind=radio&id=x")).toBe("Live");
  expect(sectionForPath("/item", "?kind=saved&id=x&from=settings")).toBe("Search");
});

test("a detail link carries the section it renders in, so a new tab opens there too", () => {
  const page = globalThis as { location?: unknown };
  page.location = { pathname: "/library", search: "?tab=lists" };
  try {
    expect(detailHref("/item?kind=saved&id=x")).toBe("/item?kind=saved&id=x&from=library");
    expect(detailHref("/item?kind=saved&id=x&from=home")).toBe("/item?kind=saved&id=x&from=home");
  } finally { delete page.location; }
  expect(detailHref("/item?kind=saved&id=x")).toBe("/item?kind=saved&id=x");
});
