import { expect, mock, test } from "bun:test";
// The results page needs a browser; its route's redirect doesn't.
mock.module("../src/client/sections/find/SearchPage", () => ({ SearchPage: () => null }));
const { Route: search } = await import("../src/client/routes/search");
import { Route as find } from "../src/client/routes/find";
import { Route as live } from "../src/client/routes/live";
import { Route as library } from "../src/client/routes/library";
import { Route as whereItPlays } from "../src/client/routes/where-it-plays";
import { Route as discover } from "../src/client/routes/discover/index";
import { Route as discoverPage } from "../src/client/routes/discover/$";
import { frontendPaths, pagePaths, pathForSection, sectionForPath } from "../src/shared/page-paths";
import { detailHref } from "../src/client/detail-navigation";

type Redirecting = { options: { beforeLoad?: unknown } };
function open(route: Redirecting, searchStr: string, params: Record<string, string> = {}) {
  try { (route.options.beforeLoad as (context: unknown) => void)({ location: { pathname: "/", searchStr }, params }); }
  catch (redirect) { return (redirect as { options: { href: string } }).options.href; }
}

test("The sections are Home and Saved, then Remote and Settings; Search is the header's field", () => {
  expect(Object.keys(pagePaths).slice(0, 4)).toEqual(["Home", "Saved", "Remote", "Settings"]);
  expect(sectionForPath("/saved")).toBe("Saved");
  expect(sectionForPath("/search")).toBe("Search");
  // Home's own pages (every station, every channel) belong to it.
  expect(sectionForPath("/radio")).toBe("Home");
  expect(sectionForPath("/live-tv")).toBe("Home");
});

test("Discover folded into Home: its address opens Home, and its pages open Home's", () => {
  expect(open(discover, "")).toBe("/");
  expect(open(discoverPage, "?radioSource=Radio+directory&page=2", { _splat: "radio" })).toBe("/radio?radioSource=Radio+directory&page=2");
  expect(open(discoverPage, "?group=News", { _splat: "live-tv" })).toBe("/live-tv?group=News");
  expect(open(discoverPage, "", { _splat: "elsewhere" })).toBe("/");
});

test("An empty search is Home; a query stays on its results", () => {
  expect(open(search, "")).toBe("/");
  expect(open(search, "?source=YouTube")).toBe("/");
  expect(open(search, "?q=jazz")).toBeUndefined();
});

test("Live opens Home, or the Stations or Channels page it was on, and Library opens Saved on the same tab", () => {
  expect(open(live, "")).toBe("/");
  expect(open(live, "?radioSource=Radio+directory&page=2")).toBe("/radio?radioSource=Radio+directory&page=2");
  expect(open(live, "?group=News&channelPage=3&channelFilter=rai")).toBe("/live-tv?group=News&page=3&filter=rai");
  expect(open(library, "")).toBe("/saved");
  expect(open(library, "?tab=channels")).toBe("/saved?tab=channels");
});

test("Find's addresses open Search with their query, and its Radio and Live TV open Home's pages", () => {
  expect(open(find, "")).toBe("/search");
  expect(open(find, "?q=jazz&source=YouTube")).toBe("/search?q=jazz&source=YouTube");
  expect(open(find, "?browse=radio")).toBe("/radio");
  expect(open(find, "?browse=radio&radioSource=Radio+playlists&page=2")).toBe("/radio?radioSource=Radio+playlists&page=2");
  expect(open(find, "?browse=live-tv&group=News&page=3&filter=rai")).toBe("/live-tv?group=News&page=3&filter=rai");
});

test("Where it plays' overview became the picker alone, so its address opens Home", () => {
  expect(open(whereItPlays, "")).toBe("/");
  expect(sectionForPath("/where-it-plays")).toBeUndefined();
});

test("Core serves the sections, Home's pages, TV pairing and the earlier addresses that redirect to them", () => {
  for (const path of ["/radio", "/live-tv", "/pair/tv", "/discover", "/discover/radio", "/discover/live-tv", "/saved", "/search", "/live", "/library", "/where-it-plays", "/find"]) expect(frontendPaths).toContain(path);
  expect(sectionForPath("/saved/")).toBe("Saved");
  expect(sectionForPath("/collection")).toBe("Home");
  expect(pathForSection("For later")).toBe("/saved");
});

test("an item or collection page keeps the section that opened it, as its URL says", () => {
  expect(sectionForPath("/item", "?kind=saved&id=x&from=saved")).toBe("Saved");
  expect(sectionForPath("/collection", "?provider=youtube&url=&from=home")).toBe("Home");
  expect(sectionForPath("/item", "?kind=radio&id=x&from=search")).toBe("Search");
  expect(sectionForPath("/item", "?kind=radio&id=x")).toBe("Home");
  expect(sectionForPath("/item", "?kind=saved&id=x&from=settings")).toBe("Home");
  // An address from before Discover folded into Home opens in Home.
  expect(sectionForPath("/item", "?kind=radio&id=x&from=discover")).toBe("Home");
});

test("a detail link carries the section it renders in, so a new tab opens there too", () => {
  const page = globalThis as { location?: unknown };
  page.location = { pathname: "/saved", search: "?tab=lists" };
  try {
    expect(detailHref("/item?kind=saved&id=x")).toBe("/item?kind=saved&id=x&from=saved");
    expect(detailHref("/item?kind=saved&id=x&from=home")).toBe("/item?kind=saved&id=x&from=home");
  } finally { delete page.location; }
  expect(detailHref("/item?kind=saved&id=x")).toBe("/item?kind=saved&id=x");
  page.location = { pathname: "/radio", search: "" };
  try { expect(detailHref("/item?kind=radio&id=x")).toBe("/item?kind=radio&id=x&from=home"); }
  finally { delete page.location; }
});
